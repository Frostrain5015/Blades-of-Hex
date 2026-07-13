// serializeState / deserializeState 序列化一致性测试
// 验证：所有将领内部状态字段被 serializeState 输出 → 能被 deserializeState 正确恢复

import { newTestPage } from './helpers.mjs';
import { Reporter } from '../lib/helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = new Reporter('state');

    // 注入一个带多层将领状态的 gameState，序列化再反序列化，验证字段保留
    const results = await page.evaluate(async () => {
        const state = await import('/js/state.js');
        const CAMP = (await import('/js/config.js')).CAMP;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? '✓' : '✗') + ' ' + msg); };

        // 重置 gameState 到相对干净状态
        state.resetGameState();
        const gs = state.gameState;

        // 设置 commander
        gs.commanderP1 = 'paladin';
        gs.commanderP2 = 'fallenAngel';
        gs.commanderP1Confirmed = true;
        gs.commanderP2Confirmed = true;
        gs.commanderPhase = 'done';
        gs.gameMode = 'pve';
        gs.isThreePlayer = true;
        gs.skirmishFog = true;
        gs.aiDifficulty = 1.5;
        gs.aiOpponentCamp = CAMP.player2;
        gs._colonelDeployed = { player1: true };
        gs._cardOverrides = { player1: { handSizeBonus: 1, useBonus: 1 } };
        gs.weatherLockUntil = 5;
        gs._starlightResume = true;
        gs.factionMoraleBoost = { player1: 2, player2: 0, player3: 1 };
        gs.killCount = { player1: 3, player2: 1, player3: 0, neutral: 0 };
        gs._friendlyDeathCount = { player1: 2 };
        gs.turnCounter = 5;

        // 创建带多种将领状态的 unit
        const uPaladin = {
            id: 'u_pal', type: 'infantry', hp: 150, maxHp: 260, canAct: true, movedThisTurn: false,
            counterAttackCount: 0, isNewRecruit: false, morale: 2, moraleBoostUntil: 0,
            remainingMP: 3, commander: 'paladin', _centurionTriggered: false,
            _atkBonus: 15, _rankDefBonus: 5, _rankCritBonus: 3, _rankRegenPct: 0,
            displaySpeed: 4, _xp: 20, _rank: 1, _fallen: false, activeSkillCD: 0, activeSkillDur: 0,
            _engineerConstruction: { targetQ: 2, targetR: 0 },
            _phantomStacks: 0, _imprisoned: false,
            _isImmobile: false, _airdropWaiting: false, _soulRecallLandAt: 0, _airliftLandAt: 0,
            _martyrPrimed: false, _elegyBonus: 0, _elegyProcessed: 0, _isSoulMinion: false,
            _shield: 120, _shieldMax: 120, _shieldTurns: 999,
            _faith: 2, _oathGainTurn: 5, _smiteReady: true, _smiteCharged: false,
            _healingAura: 0, _activeSkillBuffs: null,
            camp: CAMP.player1,
            tile: null,
            getVisualPos() { return { x: 400, y: 300 }; },
        };
        const uFallen = {
            id: 'u_fallen', type: 'infantry', hp: 100, maxHp: 270, canAct: true, movedThisTurn: false,
            counterAttackCount: 0, isNewRecruit: false, morale: 1, moraleBoostUntil: 5,
            remainingMP: 3, commander: 'fallenAngel', _centurionTriggered: false,
            _atkBonus: 30, _rankDefBonus: 0, _rankCritBonus: 0, _rankRegenPct: 0,
            displaySpeed: 3, _xp: 0, _rank: 0, _fallen: true, activeSkillCD: 0, activeSkillDur: 0,
            _phantomStacks: 0, _imprisoned: false,
            _isImmobile: false, _airdropWaiting: false, _soulRecallLandAt: 0, _airliftLandAt: 0,
            _martyrPrimed: false, _elegyBonus: 0, _elegyProcessed: 0, _isSoulMinion: false,
            _shield: 0, _shieldMax: 0, _shieldTurns: 0,
            _faith: 0, _oathGainTurn: undefined, _smiteReady: false, _smiteCharged: false,
            _healingAura: 0, _activeSkillBuffs: null,
            camp: CAMP.player2,
            tile: null,
            getVisualPos() { return { x: 500, y: 300 }; },
        };
        const uSoul = {
            id: 'u_soul', type: 'infantry', hp: 80, maxHp: 200, canAct: true, movedThisTurn: false,
            counterAttackCount: 0, isNewRecruit: false, morale: 2, moraleBoostUntil: 0, moralePenaltyUntil: 4,
            remainingMP: 3, commander: null, _centurionTriggered: false,
            _atkBonus: 0, _rankDefBonus: 0, _rankCritBonus: 0, _rankRegenPct: 0,
            displaySpeed: 3, _xp: 0, _rank: 0, _fallen: false, activeSkillCD: 0, activeSkillDur: 0,
            _phantomStacks: 0,
            _imprisoned: false, _isImmobile: false, _airdropWaiting: false,
            _soulRecallLandAt: 12345, _airliftLandAt: 0,
            _martyrPrimed: true, _elegyBonus: 15, _elegyProcessed: 3,
            _isSoulMinion: true,
            _shield: 0, _shieldMax: 0, _shieldTurns: 0,
            _faith: 0, _oathGainTurn: undefined, _smiteReady: false, _smiteCharged: false,
            _healingAura: 2, _activeSkillBuffs: [{ name: 'testBuff', duration: 3 }],
            camp: CAMP.player1,
            tile: null,
            getVisualPos() { return { x: 430, y: 360 } },
        };

        gs.tiles = [
            { q: 0, r: 0, x: 400, y: 300, unit: uPaladin, camp: CAMP.player1, isCity: true, districtId: 1, fortification: 'trench' },
            { q: 1, r: 0, x: 435, y: 300, unit: uFallen, camp: CAMP.player2, isCity: false },
            { q: 0, r: 1, x: 365, y: 320, unit: uSoul, camp: CAMP.player1, isCity: false, isVillage: true, villageDistrictId: 2 },
            { q: 2, r: 0, x: 470, y: 300, unit: null, camp: CAMP.neutral, isCity: false },
        ];
        // 设置 tileMap
        gs.tileMap = new Map();
        for (const t of gs.tiles) gs.tileMap.set(t.q + ',' + t.r, t);
        // 关联 unit.tile
        for (const t of gs.tiles) if (t.unit) t.unit.tile = t;

        // 额外全局状态
        gs._soulMarks = [{ q: 0, r: 1, campKey: 'player1', origType: 'infantry', origMaxHp: 200 }];
        gs.playerHands = { player1: ['diveStrafe', 'carpetBomb', 'airlift'], player2: ['fortify'], player3: [] };
        gs.cardDrawPile = ['testCard1', 'testCard2'];
        gs.cardDiscardPile = ['usedCard'];
        gs.playerDrawsThisTurn = { player1: 1, player2: 0, player3: 0 };
        gs.playerUsesThisTurn = { player1: 1, player2: 0, player3: 0 };

        // 需要 HexTile 和 Unit 类来 deserialize
        // 但从 network 同步走的是 applyRemoteState，不是直接调 deserializeState
        // 所以我们只测 serializeState 的输出格式完整性
        const serialized = state.serializeState();

        // ── 验证序列化输出包含所有将领状态字段 ──
        const palUnit = serialized.tiles.find(t => t.unit?.id === 'u_pal');
        assert(!!palUnit, 'serialize 输出含 paladin tile');
        if (palUnit && palUnit.unit) {
            const u = palUnit.unit;
            assert(u.commander === 'paladin', 'commander 字段');
            assert(u.hp === 150, 'HP 字段');
            assert(u.maxHp === 260, 'maxHp');
            assert(u.fallen === false, 'fallen');
            assert(u.shield === 120, 'shield');
            assert(u.shieldMax === 120, 'shieldMax');
            assert(u.shieldTurns === 999, 'shieldTurns');
            assert(u.faith === 2, 'faith');
            assert(u.oathGainTurn === 5, 'oathGainTurn');
            assert(u.smiteReady === true, 'smiteReady');
            assert(u.smiteCharged === false, 'smiteCharged');
            assert(u._atkBonus === 15 || u.atkBonus === 15, 'atkBonus');
            assert(palUnit.fortification === 'trench', 'fortification');
            assert(u.engineerConstruction?.targetQ === 2, 'engineerConstruction');
        }

        const fallenUnit = serialized.tiles.find(t => t.unit?.id === 'u_fallen');
        if (fallenUnit && fallenUnit.unit) {
            const u = fallenUnit.unit;
            assert(u.fallen === true, 'fallen=true');
            assert(u.morale === 1, 'morale=1');
        }

        const soulUnit = serialized.tiles.find(t => t.unit?.id === 'u_soul');
        if (soulUnit && soulUnit.unit) {
            const u = soulUnit.unit;
            assert(u.isSoulMinion === true, 'isSoulMinion');
            assert(u.moralePenaltyUntil === 4, 'moralePenaltyUntil');
            assert(u.martyrPrimed === true, 'martyrPrimed');
            assert(u.elegyBonus === 15, 'elegyBonus');
            assert(u.elegyProcessed === 3, 'elegyProcessed');
            assert(u.soulRecallLandAt > 0, 'soulRecallLandAt');
            assert(u.healingAura === 2, 'healingAura');
            assert(u.activeSkillBuffs !== null && u.activeSkillBuffs.length === 1, 'activeSkillBuffs');
        }

        // ── 验证全局状态字段 ──
        assert(serialized.isThreePlayer === true, 'isThreePlayer');
        assert(serialized.skirmishFog === true, 'skirmishFog');
        assert(serialized.aiDifficulty === 1.5, 'aiDifficulty');
        assert(serialized.colonelDeployed?.player1 === true, 'colonelDeployed');
        assert(serialized.cardOverrides?.player1?.handSizeBonus === 1, 'cardOverrides');
        assert(serialized.soulMarks.length === 1, 'soulMarks 数组');
        assert(serialized.cardDrawPile.length === 2, 'cardDrawPile');
        assert(serialized.playerHands.player1.length === 3, 'playerHands');
        assert(typeof serialized.weatherLockUntil === 'number', 'weatherLockUntil');

        // ── 验证反序列化后字段保留 ──
        // (注意：deserializeState 依赖 HexTile 和 Unit 类，但在浏览器里它们可用)
        try {
            const HexTileClass = (await import('/js/HexTile.js')).HexTile;
            const UnitClass = (await import('/js/Unit.js')).Unit;
            state.deserializeState(serialized, HexTileClass, UnitClass);
            assert(gs.tiles.length === 4, 'deserialize 还原 4 格');

            const restoredPal = gs.tiles.find(t => t.unit?.id === 'u_pal');
            assert(!!restoredPal, '圣骑士 tile 恢复');
            if (restoredPal?.unit) {
                assert(restoredPal.unit._faith === 2, '反序列化 faith=2');
                assert(restoredPal.unit._smiteReady === true, '反序列化 smiteReady');
                assert(restoredPal.unit._shield === 120, '反序列化 shield=120');
                assert(restoredPal.fortification === 'trench', '反序列化 fortification=trench');
                assert(restoredPal.unit._engineerConstruction?.targetQ === 2, '反序列化 engineerConstruction');
            }

            const restoredSoul = gs.tiles.find(t => t.unit?.id === 'u_soul');
            if (restoredSoul?.unit) {
                assert(restoredSoul.unit._isSoulMinion === true, '反序列化 isSoulMinion');
                assert(restoredSoul.unit.moralePenaltyUntil === 4, '反序列化 moralePenaltyUntil');
                assert(restoredSoul.unit._healingAura === 2, '反序列化 healingAura');
                assert(Array.isArray(restoredSoul.unit._activeSkillBuffs), '反序列化 activeSkillBuffs');
            }

            assert(gs._soulMarks.length === 1, '反序列化 soulMarks');
            assert(gs._cardOverrides.player1?.handSizeBonus === 1, '反序列化 cardOverrides');
            assert(gs._colonelDeployed.player1 === true, '反序列化 colonelDeployed');
            assert(gs.isThreePlayer === true, '反序列化 isThreePlayer');
            assert(gs.skirmishFog === true, '反序列化 skirmishFog');
        } catch(e) {
            assert(false, '反序列化异常: ' + e.message);
        }

        return R;
    });

    results.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— state: ${results.passed} 通过 / ${results.failed} 失败`);
    await page.context().close();
    return { passed: results.passed, failed: results.failed };
}
