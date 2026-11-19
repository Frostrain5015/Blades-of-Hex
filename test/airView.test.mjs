import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveAirViewState } from '../rules/airView.js';
import { AIRFIELD_BASE_RANGE, COLONEL_AIR_RANGE_BONUS } from '../rules/airCommands.js';
import { CULTURE_CONFIG, FACTION_RULE_MODES } from '../rules/cultures.js';
import { createDefaultDiplomacy, createDefaultFactions } from '../rules/diplomacy.js';

const P1 = { id: 'player1', name: '第一阵营', color: '#d44040' };
const P2 = { id: 'player2', name: '第二阵营', color: '#4060d0' };
const P3 = { id: 'player3', name: '第三阵营', color: '#40a040' };
const NEU = { id: 'neutral', name: '中立', color: '#888888' };

function makeTile(q, r, extra = {}) {
    return { q, r, s: -q - r, camp: null, fortification: null, fieldFortification: null, unit: null, ...extra };
}

function makeUnit(id, type, camp, extra = {}) {
    return { id, type, camp, hp: 100, _rank: 1, ...extra };
}

function makeState(tiles, extra = {}) {
    const factions = createDefaultFactions([
        { id: 'player1', controller: 'human', active: true },
        { id: 'player2', controller: 'ai', active: true },
        { id: 'player3', controller: 'ai', active: true }
    ]);
    factions.neutral.active = true;
    const diplomacy = createDefaultDiplomacy({
        player1: { player2: 'enemy', player3: 'ally', neutral: 'neutral' },
        player2: { player1: 'enemy', player3: 'enemy', neutral: 'neutral' },
        player3: { player1: 'ally', player2: 'enemy', neutral: 'neutral' }
    }, factions);
    return {
        tiles,
        tileMap: new Map(tiles.map(t => [`${t.q},${t.r}`, t])),
        factions,
        diplomacy,
        roundNumber: 1,
        turnNumber: 1,
        currentCamp: P1,
        mechanics: { fortifications: true, airCommands: true },
        ...extra
    };
}

test('resolveAirViewState separates friendly/hostile/neutral airfields, AA levels, overlap cells, and filters unmanned flak', () => {
    const tiles = [
        // 己方就绪机场（驻守上校 -> +2 航程）+ 盟友在建机场
        makeTile(-2, 0, {
            camp: P1,
            isCity: true,
            installation: { type: 'airfield', status: 'ready' },
            unit: makeUnit('p1-colonel', 'infantry', P1, { commander: 'colonel' })
        }),
        makeTile(-2, 1, {
            camp: P3,
            isCity: true,
            installation: { type: 'airfield', status: 'building' }
        }),
        // 敌方机场 + 中立防空机场
        makeTile(3, 0, {
            camp: P2,
            isCity: true,
            installation: { type: 'airfield', status: 'ready' }
        }),
        // 己方防空炮(35%) + 己方高射机枪（有人驻守 30% -> 合计 65% level 2）
        makeTile(0, 0, {
            camp: P1,
            fieldFortification: { type: 'flak', campKey: 'player1', ownerKnown: true },
            unit: makeUnit('p1-op', 'infantry', P1)
        }),
        makeTile(-1, 0, {
            camp: P1,
            unit: makeUnit('p1-aa', 'archer', P1, { specializationKey: 'antiAirArtillery' })
        }),
        // 无人驻守的己方高射机枪 + 死伤(hp=0)守军的高射机枪（在己方AA范围外）：均无效
        makeTile(-5, 0, {
            camp: P1,
            fieldFortification: { type: 'flak', campKey: 'player1', ownerKnown: true }
        }),
        makeTile(-5, 1, {
            camp: P1,
            fieldFortification: { type: 'flak', campKey: 'player1', ownerKnown: true },
            unit: makeUnit('dead-op', 'infantry', P1, { hp: 0 })
        }),
        // 敌方防空炮在 (2,0) 覆盖到 (0,0)，形成交叠格 (0,0) 与 (1,0)
        makeTile(2, 0, {
            camp: P2,
            unit: makeUnit('p2-aa', 'archer', P2, { specializationKey: 'antiAirArtillery' })
        }),
        makeTile(1, 0, { camp: NEU }),
        // 中立有人高射机枪在 (4,0)：按非己方红防空展示
        makeTile(4, 0, {
            camp: NEU,
            fieldFortification: { type: 'flak', campKey: 'neutral', ownerKnown: true },
            unit: makeUnit('neu-op', 'infantry', NEU)
        }),
        // 不可玩填充格：忽略
        makeTile(5, 0, {
            playable: false,
            renderOnly: true,
            isVisualFiller: true,
            installation: { type: 'airfield', status: 'ready' },
            fieldFortification: { type: 'flak', campKey: 'player2', ownerKnown: true },
            unit: makeUnit('filler-aa', 'archer', P2, { specializationKey: 'antiAirArtillery' })
        })
    ];
    const state = makeState(tiles);
    const view = resolveAirViewState(state, P1);

    // 机场分类与航程
    assert.deepEqual(
        view.airfields.map(a => [a.key, a.isFriendly, a.status, a.range]),
        [
            ['-2,0', true, 'ready', AIRFIELD_BASE_RANGE + COLONEL_AIR_RANGE_BONUS],
            ['-2,1', true, 'building', AIRFIELD_BASE_RANGE],
            ['3,0', false, 'ready', AIRFIELD_BASE_RANGE]
        ]
    );

    // 己方防空等级：(-1,0)=0.35 level1, (0,0)=0.65 level2, (-5,0)/(-5,1)无人驻守均无效
    const friendlyByKey = new Map(view.friendlyCells.map(c => [c.key, c]));
    assert.equal(friendlyByKey.get('-1,0')?.level, 1);
    assert.equal(friendlyByKey.get('0,0')?.level, 2);
    assert.equal(friendlyByKey.get('1,0')?.level, 1);
    assert.equal(friendlyByKey.has('-5,0'), false, '无人高射机枪不应生成己方防空覆盖');
    assert.equal(friendlyByKey.has('-5,1'), false, '死亡单位高射机枪不应生成己方防空覆盖');

    // 非己方防空：含敌方防空炮与中立驻军高射机枪
    const hostileKeys = new Set(view.hostileCells.map(c => c.key));
    assert.equal(hostileKeys.has('0,0'), true);
    assert.equal(hostileKeys.has('2,0'), true);
    assert.equal(hostileKeys.has('4,0'), true, '中立有人驻守的高射机枪按非己方红防空标记');
    assert.equal(hostileKeys.has('5,0'), false, '不可玩填充格不得进入空军视图');

    // 交叠格与来源角标去重
    assert.deepEqual(view.overlapCells.map(c => c.key).sort(), ['0,0', '1,0']);
    assert.deepEqual(view.friendlySourceTiles.map(s => s.key).sort(), ['-1,0', '0,0']);
    assert.deepEqual(view.hostileSourceTiles.map(s => s.key).sort(), ['2,0', '4,0']);
});

test('resolveAirViewState enforces Royal Battleship non-stacking per side', () => {
    const tiles = [
        makeTile(0, 0, {
            camp: P1,
            unit: makeUnit('gb1', 'gb_battleship', P1, { _rank: 1 })
        }),
        makeTile(1, 0, {
            camp: P1,
            unit: makeUnit('gb2', 'gb_battleship', P1, { _rank: 1 })
        })
    ];
    const state = makeState(tiles, { factionRuleMode: FACTION_RULE_MODES.CULTURE });
    state.factions.player1.flagPreset = CULTURE_CONFIG.gb.flagPreset;
    const view = resolveAirViewState(state, P1);

    const cell = view.friendlyCells.find(c => c.key === '0,0');
    assert.ok(cell);
    assert.equal(cell.reduction, 0.35, '两艘皇家战列舰光环不叠加，维持 35%');
    assert.equal(cell.level, 1, '两艘低阶皇家战列舰不叠成 >=50% 二档');
});

test('resolveAirViewState respects skirmishFog and does not leak hidden enemy airfields, AA, or hidden Colonel range', () => {
    const tiles = [
        makeTile(0, 0, {
            camp: P1,
            isCity: true,
            installation: { type: 'airfield', status: 'ready' }
        }),
        // 可见敌方机场，但驻守的是处于潜隐状态的游击上校 -> 不得泄露 +2 航程
        makeTile(3, 0, {
            camp: P2,
            isCity: true,
            installation: { type: 'airfield', status: 'ready' },
            unit: makeUnit('stealth-col', 'cpc_guerrilla', P2, {
                commander: 'colonel',
                _guerrillaHiddenThroughRound: 5
            })
        }),
        // 迷雾内的敌方机场与防空炮
        makeTile(6, 0, {
            camp: P2,
            isCity: true,
            installation: { type: 'airfield', status: 'ready' },
            unit: makeUnit('fog-aa', 'archer', P2, { specializationKey: 'antiAirArtillery' })
        }),
        makeTile(4, 0, { camp: P2 }) // 可见且在雾外，但由迷雾中 (6,0) 敌方防空炮覆盖？此处验证迷雾外才画，迷雾内来源隐藏
    ];
    const visibleKeys = new Set(['0,0', '3,0', '4,0']);
    const state = makeState(tiles, { skirmishFog: true });
    const view = resolveAirViewState(state, P1, {
        isTileVisible: tile => visibleKeys.has(`${tile.q},${tile.r}`)
    });

    assert.deepEqual(
        view.airfields.map(a => [a.key, a.range]),
        [
            ['0,0', AIRFIELD_BASE_RANGE],
            ['3,0', AIRFIELD_BASE_RANGE]
        ],
        '迷雾外机场不泄露未显形敌将领的+2航程，迷雾内机场完全隐藏'
    );
    assert.equal(view.hostileSourceTiles.length, 0, '迷雾内的敌方防空单位不应暴露来源标记');
    assert.equal(view.hostileCells.length, 0, '迷雾内的敌方防空单位不应暴露覆盖区域');
});
