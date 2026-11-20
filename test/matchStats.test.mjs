import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMatchStats, buildMatchStatsDocument } from '../js/matchStats.js';

function makeLog() {
    return {
        matchId: 'stats-test',
        complete: true,
        durationMs: 125000,
        mode: { type: 'pve' },
        result: { winnerCampKey: 'player1' },
        participants: [
            { campKey: 'player1', name: '红军', controller: 'human' },
            { campKey: 'player2', name: '蓝军', controller: 'ai' }
        ],
        initialState: {
            units: [
                { id: 'u1', type: 'infantry', campKey: 'player1', hp: 100, maxHp: 100 },
                { id: 'u2', type: 'cavalry', campKey: 'player2', hp: 90, maxHp: 90 }
            ],
            sites: [
                { key: 'city:0,0', kind: 'city', campKey: 'player1' },
                { key: 'city:2,0', kind: 'city', campKey: 'player2' }
            ],
            resources: { player1: { gold: 20 }, player2: { gold: 20 } }
        },
        timeline: [
            {
                kind: 'action', sequence: 1, round: 1, actorCampKey: 'player1',
                actionType: 'attack', accepted: true, payload: { attackerUnitId: 'u1', attackerType: 'infantry' }
            },
            {
                kind: 'event', sequence: 2, round: 1, eventType: 'unitHpChanged',
                payload: {
                    unitId: 'u2', unitType: 'cavalry', campKey: 'player2',
                    delta: -35, sourceUnitId: 'u1', sourceCampKey: 'player1'
                }
            },
            {
                kind: 'event', sequence: 3, round: 1, eventType: 'unitHpChanged',
                payload: { unitId: 'u1', unitType: 'infantry', campKey: 'player1', delta: -12 }
            },
            {
                kind: 'event', sequence: 4, round: 2, eventType: 'unitHpChanged',
                payload: { unitId: 'u1', unitType: 'infantry', campKey: 'player1', delta: 8 }
            },
            {
                kind: 'event', sequence: 5, round: 2, eventType: 'unitKilled',
                payload: {
                    unitId: 'u2', unitType: 'cavalry', campKey: 'player2',
                    killerId: 'u1', killerType: 'infantry', killerCampKey: 'player1'
                }
            },
            {
                kind: 'event', sequence: 6, round: 2, eventType: 'cityCaptured',
                payload: { districtId: 2, campKey: 'player1', attackerUnitId: 'u1' }
            }
        ],
        finalState: {
            units: [{ id: 'u1', type: 'infantry', campKey: 'player1', hp: 96, maxHp: 100 }],
            sites: [
                { key: 'city:0,0', kind: 'city', campKey: 'player1' },
                { key: 'city:2,0', kind: 'city', campKey: 'player1' }
            ],
            resources: { player1: { gold: 14 }, player2: { gold: 7 } }
        }
    };
}

test('match stats aggregate camps, units, rounds and key events from the structured log', () => {
    const stats = buildMatchStats(makeLog());
    const red = stats.camps.find(camp => camp.campKey === 'player1');
    const blue = stats.camps.find(camp => camp.campKey === 'player2');
    const infantry = stats.units.find(unit => unit.id === 'u1');
    const cavalry = stats.units.find(unit => unit.id === 'u2');

    assert.equal(red.damageDealt, 35);
    assert.equal(red.damageTaken, 12);
    assert.equal(red.unattributedDamage, 12);
    assert.equal(red.kills, 1);
    assert.equal(red.captures, 1);
    assert.equal(red.damagePerAttack, 35);
    assert.equal(blue.losses, 1);

    assert.equal(infantry.damageDealt, 35);
    assert.equal(infantry.damageTaken, 12);
    assert.equal(infantry.healingReceived, 8);
    assert.equal(infantry.kills, 1);
    assert.equal(infantry.captures, 1);
    assert.equal(infantry.survived, true);
    assert.equal(cavalry.damageTaken, 35);
    assert.equal(cavalry.deaths, 1);
    assert.equal(cavalry.survived, false);

    assert.equal(stats.rounds.length, 2);
    assert.equal(stats.rounds[0].byCamp.player1.damageDealt, 35);
    assert.equal(stats.rounds[1].byCamp.player1.healingReceived, 8);
    assert.equal(stats.keyEvents.length, 2);
    assert.equal(stats.leaders.damageDealt.id, 'u1');
    assert.equal(stats.leaders.damageTaken.id, 'u2');
    assert.equal(stats.controlTimeline[0].round, 0);
    assert.equal(stats.controlTimeline[0].byCamp.player1.unitShare, 0.5);
    assert.equal(stats.controlTimeline.at(-1).byCamp.player1.unitShare, 1);
    assert.equal(stats.controlTimeline.at(-1).byCamp.player1.cityShare, 1);
});

test('match stats reject missing logs without throwing', () => {
    assert.equal(buildMatchStats(null), null);
    assert.equal(buildMatchStats({}), null);
});

test('battle events use relative per-match intensity instead of a fixed attack count', () => {
    const log = makeLog(); log.schema = 'blades-of-hex.match-log';
    log.timeline = [];
    let sequence = 0;
    for (const [round, attacks] of [[1, 1], [2, 2], [3, 6], [4, 2]]) {
        for (let index = 0; index < attacks; index++) {
            log.timeline.push({
                kind: 'action',
                sequence: ++sequence,
                round,
                actorCampKey: index % 2 ? 'player2' : 'player1',
                actionType: 'attack',
                accepted: true,
                payload: {}
            });
        }
    }
    log.finalState.round = 4;

    const stats = buildMatchStats(log);
    assert.deepEqual(stats.battleEvents.map(event => event.round), [3]);
    assert.equal(stats.battleEvents[0].engagements, 6);
    assert.ok(stats.methodology.battleEvents.includes('自适应'));
});

test('战线突破按阵亡与占城识别，不会因攻击次数较少漏掉关键回合', () => {
    const log = makeLog(); log.schema = 'blades-of-hex.match-log';
    log.timeline = [];
    let sequence = 0;
    for (let index = 0; index < 5; index++) {
        log.timeline.push({
            kind: 'action', sequence: ++sequence, round: 7,
            actorCampKey: 'player1', actionType: 'attack', accepted: true, payload: {}
        });
    }
    log.timeline.push({
        kind: 'action', sequence: ++sequence, round: 11,
        actorCampKey: 'player1', actionType: 'attack', accepted: true, payload: {}
    });
    for (let index = 0; index < 6; index++) {
        log.timeline.push({
            kind: 'event', sequence: ++sequence, round: 11, eventType: 'unitKilled',
            payload: {
                unitId: `lost-${index}`, unitType: 'destroyer', campKey: 'player2',
                killerCampKey: 'player1'
            }
        });
    }
    log.timeline.push({
        kind: 'event', sequence: ++sequence, round: 11, eventType: 'cityCaptured',
        payload: { districtId: 2, campKey: 'player1' }
    });
    log.finalState.round = 11;
    log.finalState.units.push({ id: 'u2', type: 'cavalry', campKey: 'player2', hp: 50, maxHp: 90 });
    log.finalState.sites[1].campKey = 'player2';

    const stats = buildMatchStats(log);
    const breakthrough = stats.battleEvents.find(event => event.round === 11);
    assert.ok(breakthrough);
    assert.equal(breakthrough.label, '战线突破');
    assert.equal(breakthrough.totalLosses, 6);
    assert.equal(breakthrough.captures, 1);
});

test('将领单位显示具体身份并生成显著的阵亡时间点', () => {
    const log = makeLog(); log.schema = 'blades-of-hex.match-log';
    log.initialState.units[1] = {
        id: 'u2', type: 'warship', campKey: 'player2', hp: 180, maxHp: 180,
        commanderId: 'colonel', isCommanderUnit: true
    };
    const death = log.timeline.find(item => item.eventType === 'unitKilled');
    death.payload = {
        unitId: 'u2', unitType: 'warship', campKey: 'player2',
        commanderId: 'colonel', isCommanderUnit: true,
        killerId: 'u1', killerType: 'infantry', killerCampKey: 'player1'
    };

    const stats = buildMatchStats(log);
    const commander = stats.units.find(unit => unit.id === 'u2');
    assert.equal(commander.displayName, '巡洋舰 · 空军上校');
    assert.equal(stats.commanderDeathEvents.length, 1);
    assert.equal(stats.commanderDeathEvents[0].round, 2);
    assert.equal(stats.commanderDeathEvents[0].commanderName, '空军上校');
});

test('单位占比快照分别统计同阵营陆军与海军色带', () => {
    const log = makeLog(); log.schema = 'blades-of-hex.match-log';
    log.initialState.units.push({
        id: 'u3', type: 'warship', campKey: 'player1', hp: 180, maxHp: 180
    });
    log.finalState.units.push({
        id: 'u3', type: 'warship', campKey: 'player1', hp: 180, maxHp: 180
    });
    const stats = buildMatchStats(log);
    const opening = stats.controlTimeline[0];
    assert.equal(opening.byCamp.player1.landUnits, 1);
    assert.equal(opening.byCamp.player1.navalUnits, 1);
    assert.equal(opening.byCamp.player1.landUnitShare, 1 / 3);
    assert.equal(opening.byCamp.player1.navalUnitShare, 1 / 3);
});

test('faction skill events preserve round, camp and logo for chart markers', () => {
    const log = makeLog(); log.schema = 'blades-of-hex.match-log';
    log.participants[0].flagEmoji = '🐉';
    log.timeline.push({
        kind: 'event',
        sequence: 7,
        round: 2,
        eventType: 'factionSkillActivated',
        payload: {
            campKey: 'player1',
            synergyId: 'tianheng',
            skillName: '日月天衡',
            logoEmoji: '🐉',
            presentationEventId: 'sunMoon:player1:2'
        }
    });
    const stats = buildMatchStats(log);
    assert.equal(stats.factionSkillEvents.length, 1);
    assert.deepEqual(stats.factionSkillEvents[0], {
        sequence: 7,
        round: 2,
        campKey: 'player1',
        synergyId: 'tianheng',
        skillName: '日月天衡',
        triggerKind: null,
        logoEmoji: '🐉',
        presentationEventId: 'sunMoon:player1:2',
        label: '红军发动阵营技能【日月天衡】'
    });
    assert.equal(stats.keyEvents.at(-1).type, 'factionSkillActivated');
});

test('lightweight review documents rebuild the statistics view without a full timeline', () => {
    const source = buildMatchStats(makeLog());
    const review = {
        schema: 'blades-of-hex.match-review',
        matchId: source.matchId,
        complete: true,
        durationMs: source.durationMs,
        mode: source.mode,
        result: source.result,
        overview: {
            totalActions: source.totalActions,
            totalDamage: source.totalDamage,
            totalLosses: source.totalLosses,
            camps: source.camps,
            leaders: {
                damageDealt: {
                    unitId: source.leaders.damageDealt.id,
                    unitType: source.leaders.damageDealt.type,
                    displayName: source.leaders.damageDealt.displayName,
                    damageDealt: source.leaders.damageDealt.damageDealt
                }
            }
        },
        controlTimeline: source.controlTimeline,
        battleEvents: source.battleEvents,
        factionSkillEvents: [{
            round: 2,
            campKey: 'player1',
            skillName: '日月天衡',
            logoEmoji: '🐉'
        }],
        commanderDeathEvents: source.commanderDeathEvents,
        roundIndex: source.rounds,
        keyEvents: source.keyEvents,
        unitHighlights: [{
            unitId: 'u1',
            unitType: 'infantry',
            displayName: '步兵',
            campKey: 'player1',
            damageDealt: 35
        }],
        methodology: source.methodology
    };

    const rebuilt = buildMatchStatsDocument(review);
    assert.equal(rebuilt.importedFromReview, true);
    assert.equal(rebuilt.units[0].id, 'u1');
    assert.equal(rebuilt.leaders.damageDealt.id, 'u1');
    assert.equal(rebuilt.controlTimeline.length, source.controlTimeline.length);
    assert.equal(rebuilt.factionSkillEvents[0].logoEmoji, '🐉');
    assert.deepEqual(rebuilt.commanderDeathEvents, source.commanderDeathEvents);
    assert.equal(buildMatchStatsDocument({ schema: 'unknown' }), null);
});

test('cultural and special units display Chinese names and gb_battleship counts as naval', () => {
    const log = makeLog(); log.schema = 'blades-of-hex.match-log';
    log.initialState.units = [
        { id: 'c1', type: 'kmt_training_brigade', campKey: 'player1', hp: 210, maxHp: 210, commanderId: 'colonel', isCommanderUnit: true },
        { id: 'c2', type: 'cpc_guerrilla', campKey: 'player2', hp: 165, maxHp: 165 },
        { id: 'c3', type: 'fr_heavy_cannon', campKey: 'player1', hp: 115, maxHp: 115 },
        { id: 'c4', type: 'gb_battleship', campKey: 'player2', hp: 230, maxHp: 230 },
        { id: 'c5', type: 'orbitalPlatform', campKey: 'player1', hp: 100, maxHp: 100 }
    ];
    log.finalState.units = [...log.initialState.units];
    const stats = buildMatchStats(log);
    const byId = Object.fromEntries(stats.units.map(u => [u.id, u]));
    assert.equal(byId.c1.displayName, '中央教导旅 · 空军上校');
    assert.equal(byId.c2.displayName, '游击纵队');
    assert.equal(byId.c3.displayName, '法国巨炮');
    assert.equal(byId.c4.displayName, '皇家战列舰');
    assert.equal(byId.c5.displayName, '天基轨道炮');
    assert.equal(stats.controlTimeline[0].byCamp.player2.navalUnits, 1);
    assert.equal(stats.controlTimeline[0].byCamp.player2.landUnits, 1);
    assert.ok(stats.methodology.unitShare.includes('深色（原色）表示陆军、浅色表示海军'));
});

test('high-threshold battleEvents keeps long matches focused on a few climax rounds', () => {
    const log = makeLog(); log.schema = 'blades-of-hex.match-log';
    log.timeline = [];
    let sequence = 0;
    for (let round = 1; round <= 22; round++) {
        const isClimax = round === 6 || round === 14 || round === 19;
        const attacks = isClimax ? 14 : (round % 3 === 0 ? 7 : 5);
        for (let i = 0; i < attacks; i++) {
            log.timeline.push({
                kind: 'action', sequence: ++sequence, round,
                actorCampKey: i % 2 ? 'player2' : 'player1',
                actionType: 'attack', accepted: true, payload: {}
            });
        }
        const losses = isClimax ? 5 : (round % 2 === 0 ? 2 : 1);
        for (let l = 0; l < losses; l++) {
            log.timeline.push({
                kind: 'event', sequence: ++sequence, round, eventType: 'unitKilled',
                payload: { unitId: `loss-${round}-${l}`, unitType: 'infantry', campKey: 'player2', killerCampKey: 'player1' }
            });
        }
        if (isClimax || round % 4 === 0) {
            log.timeline.push({
                kind: 'event', sequence: ++sequence, round, eventType: 'cityCaptured',
                payload: { districtId: round % 5, campKey: 'player1' }
            });
        }
    }
    log.finalState.round = 22;
    const stats = buildMatchStats(log);
    assert.ok(stats.battleEvents.length >= 2 && stats.battleEvents.length <= 5, `got ${stats.battleEvents.length}`);
    assert.deepEqual(stats.battleEvents.map(event => event.round), [6, 14, 19]);
});

test('imported review refreshes legacy raw unit names, unitShare wording and participant flags', () => {
    const rebuilt = buildMatchStatsDocument({
        schema: 'blades-of-hex.match-review',
        participants: [
            { campKey: 'player1', name: '中华民国', colorId: 'blue', flagPreset: 'img/flags/svg/tw.svg' }
        ],
        overview: {
            totalActions: 10,
            totalDamage: 500,
            totalLosses: 2,
            camps: [{ campKey: 'player1', name: '中华民国', colorId: 'blue', healingReceived: 120 }],
            leaders: {
                healingReceived: { unitId: 'u9', unitType: 'kmt_training_brigade', displayName: 'kmt_training_brigade · 空军上校', commanderId: 'colonel', healingReceived: 120 }
            }
        },
        controlTimeline: [{ round: 0, byCamp: { player1: { unitShare: 1, cityShare: 1, controlShare: 1 } } }],
        roundIndex: [{ round: 1, engagements: 2, byCamp: { player1: { damageTaken: 100, losses: 1, captures: 0 } } }],
        unitHighlights: [
            { unitId: 'u9', unitType: 'kmt_training_brigade', displayName: 'kmt_training_brigade · 空军上校', campKey: 'player1', healingReceived: 120 }
        ],
        methodology: {
            unitShare: '旧文案：浅色表示陆军、深色表示海军。'
        }
    });
    assert.equal(rebuilt.camps[0].flagPreset, 'img/flags/svg/tw.svg');
    assert.equal(rebuilt.units[0].displayName, '中央教导旅 · 空军上校');
    assert.equal(rebuilt.units[0].commanderId, 'colonel');
    assert.equal(rebuilt.leaders.healingReceived.displayName, '中央教导旅 · 空军上校');
    assert.equal(rebuilt.totalHealing, 120);
    assert.ok(rebuilt.methodology.unitShare.includes('深色（原色）表示陆军、浅色表示海军'));
});

test('camp rating grades span A+ through C across dominant, contested and collapsed camps', async () => {
    const { computeCampRating } = await import('../js/matchStats.js');
    const log = makeLog(); log.schema = 'blades-of-hex.match-log';
    const stats = buildMatchStats(log);
    const p1 = stats.camps.find(c => c.campKey === 'player1');
    const p2 = stats.camps.find(c => c.campKey === 'player2');
    assert.ok(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C'].includes(p1.rating.grade));
    assert.ok(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C'].includes(p2.rating.grade));
    assert.ok(p1.rating.score > p2.rating.score);

    const dominant = computeCampRating({
        campKey: 'player1', kills: 40, losses: 5, attacks: 80, actions: 240, captures: 8,
        damageDealt: 8000, damageTaken: 2000, healingReceived: 900, reinforcements: 4,
        initialCities: 1, finalCities: 6, initialForce: { units: 12 }, finalForce: { units: 14 },
        cards: 20, airCommands: 4, constructions: 2, recruits: 6
    }, { winnerCampKey: 'player1', maxDamage: 8000, maxActions: 240 });
    assert.equal(dominant.grade, 'A+');

    const collapsed = computeCampRating({
        campKey: 'neutral', kills: 0, losses: 10, attacks: 3, actions: 15, captures: 0,
        damageDealt: 400, damageTaken: 2200, healingReceived: 100, reinforcements: 0,
        initialCities: 4, finalCities: 0, initialForce: { units: 14 }, finalForce: { units: 0 },
        cards: 0, airCommands: 0, constructions: 0, recruits: 0
    }, { winnerCampKey: 'player1', maxDamage: 8000, maxActions: 240 });
    assert.equal(collapsed.grade, 'C');
});

test('matchStatsView renders 8 summary cards, medal ranks, HUD flags, chart flags and dark-land/light-naval unitShare', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(`<!doctype html><body>
        <div id="matchStatsOverlay">
            <button id="matchStatsCloseBtn"></button>
            <p id="matchStatsSubtitle"></p>
            <div id="matchStatsSummary"></div>
            <button type="button" data-control-metric="controlShare" class="active"></button>
            <button type="button" data-control-metric="unitShare"></button>
            <button type="button" data-control-metric="cityShare"></button>
            <svg id="matchControlChart"></svg>
            <div id="matchControlTooltip" hidden></div>
            <div id="matchControlLegend"></div>
            <p id="matchControlMethod"></p>
            <div id="matchCampCards"></div>
            <div id="matchUnitLeaders"></div>
            <div id="matchUnitMvp"></div>
            <select id="matchUnitMetric">
                <option value="damageDealt">造成伤害</option>
                <option value="kills">击杀</option>
                <option value="damageTaken">承受伤害</option>
                <option value="healingReceived">恢复量</option>
                <option value="actions">参与行动</option>
            </select>
            <select id="matchUnitCamp"></select>
            <div id="matchUnitTable"></div>
            <div id="matchBattleEvents"></div>
            <p id="matchBattleMethod"></p>
        </div>
    </body>`);
    const prevDoc = globalThis.document;
    globalThis.document = dom.window.document;
    try {
        const { initMatchStatsPanel } = await import('../js/matchStatsView.js');
        const log = makeLog(); log.schema = 'blades-of-hex.match-log';
        log.schema = 'blades-of-hex.match-log';
        log.participants[0].flagPreset = 'img/flags/svg/tw.svg';
        log.participants[1].flagPreset = 'img/flags/chinese-communist-party-old.svg';
        log.initialState.units.push(
            { id: 'u3', type: 'kmt_training_brigade', campKey: 'player1', hp: 210, maxHp: 210, commanderId: 'colonel' },
            { id: 'u5', type: 'destroyer', campKey: 'player1', hp: 140, maxHp: 140 },
            { id: 'u4', type: 'gb_battleship', campKey: 'player2', hp: 230, maxHp: 230 }
        );
        log.finalState.units.push(
            { id: 'u3', type: 'kmt_training_brigade', campKey: 'player1', hp: 180, maxHp: 210, commanderId: 'colonel' },
            { id: 'u5', type: 'destroyer', campKey: 'player1', hp: 140, maxHp: 140 },
            { id: 'u4', type: 'gb_battleship', campKey: 'player2', hp: 190, maxHp: 230 }
        );
        log.timeline.push(
            { kind: 'event', sequence: 9, round: 2, eventType: 'unitHpChanged', payload: { unitId: 'u4', unitType: 'gb_battleship', campKey: 'player2', sourceUnitId: 'u3', sourceCampKey: 'player1', oldHp: 230, newHp: 20, delta: -210 } },
            { kind: 'event', sequence: 10, round: 2, eventType: 'unitHpChanged', payload: { unitId: 'u3', unitType: 'kmt_training_brigade', campKey: 'player1', sourceUnitId: 'u4', sourceCampKey: 'player2', oldHp: 210, newHp: 10, delta: -200 } },
            { kind: 'event', sequence: 11, round: 2, eventType: 'unitKilled', payload: { unitId: 'u5', unitType: 'destroyer', campKey: 'player1', killerId: 'u4', killerType: 'gb_battleship', killerCampKey: 'player2' } }
        );
        const panel = initMatchStatsPanel({ getLog: () => log });
        assert.equal(panel.open(), true);

        const summaryCards = dom.window.document.querySelectorAll('#matchStatsSummary .match-stat-summary-card');
        assert.equal(summaryCards.length, 8);

        const unitRows = dom.window.document.querySelectorAll('#matchUnitTable .match-unit-row');
        assert.equal(unitRows[0].querySelector('.match-unit-rank').textContent, '🥇');
        assert.equal(unitRows[1].querySelector('.match-unit-rank').textContent, '🥈');
        assert.equal(unitRows[2].querySelector('.match-unit-rank').textContent, '🥉');
        assert.ok(unitRows[0].querySelector('.match-unit-name .match-hud-flag'));
        assert.ok(unitRows[0].querySelector('.match-unit-id').textContent.startsWith('#'));

        const campFlags = dom.window.document.querySelectorAll('#matchCampCards .match-camp-card header .match-hud-flag');
        assert.equal(campFlags.length, 2);
        assert.equal(dom.window.document.querySelectorAll('#matchCampCards .match-camp-card header strong').length, 0);
        const campGrades = dom.window.document.querySelectorAll('#matchCampCards .match-camp-grade');
        assert.equal(campGrades.length, 2);
        assert.ok(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C'].includes(campGrades[0].textContent));

        const mvpCards = dom.window.document.querySelectorAll('#matchUnitMvp .match-mvp-card');
        assert.equal(mvpCards.length, 3);
        assert.equal(mvpCards[0].querySelector('.match-mvp-rank').textContent.trim(), '🥇');
        assert.ok(!dom.window.document.querySelector('#matchStatsOverlay').textContent.includes('·'), 'DOM should never contain middle dot ·');
        const titledNodes = [...dom.window.document.querySelectorAll('#matchStatsOverlay [title]')];
        assert.ok(titledNodes.every(node => !node.getAttribute('title').includes('·')), 'title attributes should not contain middle dot ·');
        assert.equal(mvpCards[0].querySelectorAll('.match-mvp-identity .match-hud-flag').length, 0);
        const commanderPortrait = dom.window.document.querySelector('#matchUnitMvp .match-mvp-commander-portrait');
        assert.ok(commanderPortrait && commanderPortrait.getAttribute('src').includes('img/commander_tr/空军上校.webp'));
        assert.ok(dom.window.document.querySelector('#matchUnitMvp .match-mvp-backdrop-flag'));

        const bandFlags = dom.window.document.querySelectorAll('#matchControlChart .match-control-band-flag');
        assert.equal(bandFlags.length, 2);
        const leaderFlags = dom.window.document.querySelectorAll('#matchUnitLeaders .match-unit-leader-name .match-hud-flag');
        assert.ok(leaderFlags.length >= 2);
        assert.ok(!dom.window.document.querySelector('#matchControlLegend').textContent.includes('红军'));

        dom.window.document.querySelector('[data-control-metric="unitShare"]').click();
        const landPoly = dom.window.document.querySelector('#matchControlChart polygon[data-camp-key="player1"][data-unit-domain="land"]');
        const navalPoly = dom.window.document.querySelector('#matchControlChart polygon[data-camp-key="player1"][data-unit-domain="naval"]');
        assert.ok(landPoly && navalPoly);
        assert.notEqual(landPoly.getAttribute('fill'), navalPoly.getAttribute('fill'));
        const sumRgb = hex => [1, 3, 5].reduce((acc, idx) => acc + Number.parseInt(hex.slice(idx, idx + 2), 16), 0);
        assert.ok(sumRgb(landPoly.getAttribute('fill')) < sumRgb(navalPoly.getAttribute('fill')), 'land should stay darker than lightened naval shade');
    } finally {
        globalThis.document = prevDoc;
    }
});

test('MVP podium omits rank 2/3 when lagging far behind leader or direct predecessor', async () => {
    const { selectMvpUnits } = await import('../js/matchStats.js');
    const soloCarry = selectMvpUnits([
        { id: 'a', damageDealt: 1200, kills: 4, survived: true },
        { id: 'b', damageDealt: 450, kills: 1, survived: false },
        { id: 'c', damageDealt: 300, kills: 0, survived: false }
    ]);
    assert.deepEqual(soloCarry.map(u => u.id), ['a']);

    const duoCliff = selectMvpUnits([
        { id: 'a', damageDealt: 1000, kills: 3, survived: true },
        { id: 'b', damageDealt: 900, kills: 2, survived: true },
        { id: 'c', damageDealt: 350, kills: 0, survived: false }
    ]);
    assert.deepEqual(duoCliff.map(u => u.id), ['a', 'b']);
});

test('selectMainBelligerents isolates dominant pair in 5:5:2 fights and keeps balanced 3-way clashes', async () => {
    const { selectMainBelligerents } = await import('../js/matchStats.js');
    const twoVsBystander = selectMainBelligerents({
        player1: { damageDealt: 300, damageTaken: 200 },
        player2: { damageDealt: 200, damageTaken: 300 },
        player3: { damageDealt: 100, damageTaken: 100 }
    });
    assert.deepEqual(twoVsBystander.map(entry => entry.campKey), ['player1', 'player2']);

    const threeWay = selectMainBelligerents({
        player1: { damageDealt: 220, damageTaken: 180 },
        player2: { damageDealt: 190, damageTaken: 200 },
        player3: { damageDealt: 160, damageTaken: 150 }
    });
    assert.deepEqual(threeWay.map(entry => entry.campKey), ['player1', 'player2', 'player3']);
});

test('5 battle event categories, commander kill attribution and zero middle-dot UI render end-to-end', async () => {
    const { JSDOM } = await import('jsdom');
    const reviewDoc = {
        schema: 'blades-of-hex.match-review',
        matchId: 'events-5cat',
        complete: true,
        durationMs: 180000,
        mode: { type: 'pve' },
        result: { winnerCampKey: 'player1' },
        participants: [
            { campKey: 'player1', name: '中华民国', flagPreset: 'img/flags/svg/tw.svg', colorId: 'blue' },
            { campKey: 'player2', name: '苏联', flagPreset: 'img/flags/soviet-union.svg', colorId: 'red' },
            { campKey: 'player3', name: '日本', flagPreset: 'img/flags/japan.svg', colorId: 'yellow' }
        ],
        overview: {
            totalActions: 80,
            totalDamage: 3200,
            totalLosses: 14,
            camps: [
                { campKey: 'player1', name: '中华民国', kills: 9, losses: 3, attacks: 30, actions: 40, captures: 3, damageDealt: 1800, damageTaken: 700, healingReceived: 200, initialCities: 1, finalCities: 3, initialForce: { units: 6 }, finalForce: { units: 5 } },
                { campKey: 'player2', name: '苏联', kills: 4, losses: 5, attacks: 22, actions: 25, captures: 1, damageDealt: 950, damageTaken: 1300, healingReceived: 120, initialCities: 1, finalCities: 1, initialForce: { units: 6 }, finalForce: { units: 3 } },
                { campKey: 'player3', name: '日本', kills: 1, losses: 6, attacks: 12, actions: 15, captures: 0, damageDealt: 450, damageTaken: 1200, healingReceived: 0, initialCities: 1, finalCities: 0, initialForce: { units: 5 }, finalForce: { units: 0 } }
            ],
            leaders: {}
        },
        unitHighlights: [
            { id: 'u1', type: 'warship', campKey: 'player1', commanderId: 'fallenAngel', isCommanderUnit: true, displayName: '巡洋舰 · 堕天使', kills: 5, damageDealt: 1100, damageTaken: 240, healingReceived: 80, actions: 12, survived: true },
            { id: 'u2', type: 'warship', campKey: 'player2', kills: 1, damageDealt: 180, damageTaken: 350, healingReceived: 0, actions: 4, survived: false }
        ],
        commanderDeathEvents: [
            { sequence: 40, round: 3, campKey: 'player3', killerCampKey: 'player1', unitId: 'u3', unitType: 'warship', commanderId: 'ironGuard', commanderName: '铁卫', displayName: '巡洋舰 · 铁卫' }
        ],
        keyEvents: [
            { sequence: 60, round: 6, type: 'cityCaptured', campKey: 'player1', previousCampKey: 'player2', districtId: 4, label: '中华民国攻占行政区4' },
            { sequence: 90, round: 8, type: 'cityCaptured', campKey: 'player1', previousCampKey: 'player3', districtId: 9, label: '中华民国攻占行政区9' }
        ],
        controlTimeline: [
            { round: 0, byCamp: { player1: { units: 6, cities: 1, controlShare: 0.35 }, player2: { units: 6, cities: 1, controlShare: 0.35 }, player3: { units: 5, cities: 1, controlShare: 0.30 } } },
            { round: 1, byCamp: { player1: { units: 6, cities: 1, controlShare: 0.35 }, player2: { units: 6, cities: 1, controlShare: 0.35 }, player3: { units: 5, cities: 1, controlShare: 0.30 } } },
            { round: 2, byCamp: { player1: { units: 6, cities: 1, controlShare: 0.34 }, player2: { units: 5, cities: 1, controlShare: 0.34 }, player3: { units: 5, cities: 1, controlShare: 0.32 } } },
            { round: 3, byCamp: { player1: { units: 6, cities: 1, controlShare: 0.38 }, player2: { units: 5, cities: 1, controlShare: 0.34 }, player3: { units: 4, cities: 1, controlShare: 0.28 } } },
            { round: 4, byCamp: { player1: { units: 6, cities: 1, controlShare: 0.38 }, player2: { units: 5, cities: 1, controlShare: 0.35 }, player3: { units: 4, cities: 1, controlShare: 0.27 } } },
            { round: 5, byCamp: { player1: { units: 5, cities: 1, controlShare: 0.35 }, player2: { units: 6, cities: 1, controlShare: 0.48 }, player3: { units: 3, cities: 1, controlShare: 0.17 } } },
            { round: 6, byCamp: { player1: { units: 5, cities: 2, controlShare: 0.45 }, player2: { units: 5, cities: 1, controlShare: 0.36 }, player3: { units: 3, cities: 1, controlShare: 0.19 } } },
            { round: 7, byCamp: { player1: { units: 5, cities: 2, controlShare: 0.47 }, player2: { units: 4, cities: 1, controlShare: 0.35 }, player3: { units: 2, cities: 1, controlShare: 0.18 } } },
            { round: 8, byCamp: { player1: { units: 5, cities: 3, controlShare: 0.68 }, player2: { units: 3, cities: 1, controlShare: 0.32 }, player3: { units: 0, cities: 0, controlShare: 0 } } }
        ],
        roundIndex: [
            { round: 1, engagements: 2, byCamp: { player1: { damageDealt: 100, damageTaken: 80, kills: 0, losses: 0, captures: 0 }, player2: { damageDealt: 80, damageTaken: 100, kills: 0, losses: 0, captures: 0 }, player3: { damageDealt: 20, damageTaken: 20, kills: 0, losses: 0, captures: 0 } } },
            { round: 2, engagements: 14, byCamp: { player1: { damageDealt: 450, damageTaken: 350, kills: 2, losses: 1, captures: 0 }, player2: { damageDealt: 350, damageTaken: 450, kills: 1, losses: 2, captures: 0 }, player3: { damageDealt: 80, damageTaken: 80, kills: 0, losses: 0, captures: 0 } } },
            { round: 3, engagements: 5, commanderLosses: 1, byCamp: { player1: { damageDealt: 260, damageTaken: 120, kills: 1, losses: 0, captures: 0 }, player3: { damageDealt: 120, damageTaken: 260, kills: 0, losses: 1, captures: 0 } } },
            { round: 4, engagements: 2, byCamp: { player1: { damageDealt: 90, damageTaken: 60, kills: 0, losses: 0, captures: 0 }, player2: { damageDealt: 60, damageTaken: 90, kills: 0, losses: 0, captures: 0 } } },
            { round: 5, engagements: 5, byCamp: { player2: { damageDealt: 240, damageTaken: 100, kills: 2, losses: 0, captures: 0 }, player3: { damageDealt: 60, damageTaken: 190, kills: 0, losses: 2, captures: 0 }, player1: { damageDealt: 50, damageTaken: 60, kills: 0, losses: 1, captures: 0 } } },
            { round: 6, engagements: 9, byCamp: { player1: { damageDealt: 480, damageTaken: 200, kills: 4, losses: 1, captures: 1 }, player2: { damageDealt: 200, damageTaken: 480, kills: 1, losses: 4, captures: 0 } } },
            { round: 7, engagements: 2, byCamp: { player1: { damageDealt: 80, damageTaken: 70, kills: 0, losses: 0, captures: 0 }, player2: { damageDealt: 70, damageTaken: 80, kills: 0, losses: 0, captures: 0 } } },
            { round: 8, engagements: 5, byCamp: { player1: { damageDealt: 500, damageTaken: 110, kills: 2, losses: 0, captures: 1 }, player3: { damageDealt: 110, damageTaken: 500, kills: 0, losses: 2, captures: 0 } } }
        ]
    };
    const stats = buildMatchStatsDocument(reviewDoc);
    assert.deepEqual(stats.battleEvents.map(e => e.eventType), [
        'pitchedBattle',
        'commanderFall',
        'turningPoint',
        'breakthrough',
        'factionEliminated'
    ]);
    assert.deepEqual(stats.battleEvents[0].belligerents.map(b => b.campKey), ['player1', 'player2']);
    assert.equal(stats.mvpUnits.length, 1);

    const dom = new JSDOM('<!doctype html><body><div id="matchStatsOverlay"><button id="matchStatsCloseBtn"></button><p id="matchStatsSubtitle"></p><div id="matchStatsSummary"></div><button type="button" data-control-metric="controlShare" class="active"></button><button type="button" data-control-metric="unitShare"></button><button type="button" data-control-metric="cityShare"></button><svg id="matchControlChart"></svg><div id="matchControlTooltip" hidden></div><div id="matchControlLegend"></div><p id="matchControlMethod"></p><div id="matchCampCards"></div><div id="matchUnitLeaders"></div><div id="matchUnitMvp"></div><select id="matchUnitMetric"><option value="damageDealt">造成伤害</option></select><select id="matchUnitCamp"></select><div id="matchUnitTable"></div><div id="matchBattleEvents"></div><p id="matchBattleMethod"></p></div></body>');
    const prevDoc = globalThis.document;
    globalThis.document = dom.window.document;
    try {
        const { initMatchStatsPanel } = await import('../js/matchStatsView.js');
        const panel = initMatchStatsPanel({ getLog: () => reviewDoc });
        assert.equal(panel.open(), true);
        const overlayText = dom.window.document.querySelector('#matchStatsOverlay').textContent;
        assert.ok(!overlayText.includes('·'), 'rendered overlay text must not include middle dot ·');
        assert.equal(dom.window.document.querySelector('#matchUnitMvp .match-mvp-grid').getAttribute('data-count'), '1');
        assert.equal(dom.window.document.querySelector('#matchUnitMvp .match-mvp-rank').textContent.trim(), '🥇');
        assert.ok(dom.window.document.querySelector('#matchBattleEvents .match-battle-event.is-commander-fall .match-battle-headline').textContent.includes('击杀'));
        assert.ok(dom.window.document.querySelector('#matchBattleEvents .match-battle-event.is-breakthrough .match-battle-headline').textContent.includes('行政区4'));
    } finally {
        globalThis.document = prevDoc;
    }
});

test('matchStatsView displays specialization watermark and stacked badges for multi-kill / multi-elimination rounds', async () => {
    const { JSDOM } = await import('jsdom');
    const reviewDoc = {
        schema: 'blades-of-hex.match-review',
        matchId: 'multi-events-spec',
        complete: true,
        durationMs: 120000,
        mode: { type: 'local' },
        result: { winnerCampKey: 'player3' },
        participants: [
            { campKey: 'player1', name: '美国', flagPreset: 'img/flags/svg/us.svg', colorId: 'green' },
            { campKey: 'player2', name: '法国', flagPreset: 'img/flags/svg/fr.svg', colorId: 'blue' },
            { campKey: 'player3', name: '苏联', flagPreset: 'img/flags/soviet-union.svg', colorId: 'red' }
        ],
        overview: {
            totalActions: 40, totalDamage: 1800, totalLosses: 8,
            camps: [
                { campKey: 'player1', name: '美国', kills: 1, losses: 4, damageDealt: 300, damageTaken: 900, initialCities: 1, finalCities: 0, initialForce: { units: 4 }, finalForce: { units: 0 } },
                { campKey: 'player2', name: '法国', kills: 2, losses: 4, damageDealt: 450, damageTaken: 800, initialCities: 1, finalCities: 0, initialForce: { units: 4 }, finalForce: { units: 0 } },
                { campKey: 'player3', name: '苏联', kills: 7, losses: 1, damageDealt: 1200, damageTaken: 300, captures: 2, initialCities: 1, finalCities: 3, initialForce: { units: 5 }, finalForce: { units: 5 } }
            ],
            leaders: {}
        },
        unitHighlights: [
            { id: 313, type: 'infantry', specializationKey: 'assaultInfantry', displayName: '突击步兵', campKey: 'player3', kills: 5, damageDealt: 600, damageTaken: 200, healingReceived: 120, captures: 2, actions: 10, survived: true }
        ],
        commanderDeathEvents: [
            { round: 2, campKey: 'player3', killerCampKey: 'player2', unitType: 'ru_katyusha', commanderId: 'colonel', commanderName: '空军上校', displayName: '喀秋莎火箭炮 · 空军上校' },
            { round: 2, campKey: 'player1', killerCampKey: 'player3', unitType: 'infantry', commanderId: 'necromancer', commanderName: '亡灵法师', displayName: '步兵 · 亡灵法师' }
        ],
        keyEvents: [
            { round: 3, type: 'cityCaptured', campKey: 'player3', previousCampKey: 'player1', districtId: 1, label: '苏联攻占行政区1' },
            { round: 3, type: 'cityCaptured', campKey: 'player3', previousCampKey: 'player2', districtId: 3, label: '苏联攻占行政区3' }
        ],
        controlTimeline: [
            { round: 0, byCamp: { player1: { units: 4, cities: 1, controlShare: 0.33 }, player2: { units: 4, cities: 1, controlShare: 0.33 }, player3: { units: 5, cities: 1, controlShare: 0.34 } } },
            { round: 1, byCamp: { player1: { units: 4, cities: 1, controlShare: 0.32 }, player2: { units: 4, cities: 1, controlShare: 0.33 }, player3: { units: 5, cities: 1, controlShare: 0.35 } } },
            { round: 2, byCamp: { player1: { units: 3, cities: 1, controlShare: 0.25 }, player2: { units: 3, cities: 1, controlShare: 0.28 }, player3: { units: 5, cities: 1, controlShare: 0.47 } } },
            { round: 3, byCamp: { player1: { units: 0, cities: 0, controlShare: 0 }, player2: { units: 0, cities: 0, controlShare: 0 }, player3: { units: 5, cities: 3, controlShare: 1 } } }
        ],
        roundIndex: [
            { round: 1, engagements: 3, byCamp: { player1: { damageDealt: 100, damageTaken: 120, kills: 0, losses: 0, captures: 0 }, player3: { damageDealt: 120, damageTaken: 100, kills: 0, losses: 0, captures: 0 } } },
            { round: 2, engagements: 8, commanderLosses: 2, byCamp: { player2: { damageDealt: 250, damageTaken: 200, kills: 1, losses: 1, captures: 0 }, player3: { damageDealt: 380, damageTaken: 150, kills: 2, losses: 1, captures: 0 }, player1: { damageDealt: 100, damageTaken: 250, kills: 0, losses: 2, captures: 0 } } },
            { round: 3, engagements: 7, byCamp: { player3: { damageDealt: 700, damageTaken: 100, kills: 4, losses: 0, captures: 2 }, player1: { damageDealt: 50, damageTaken: 350, kills: 0, losses: 2, captures: 0 }, player2: { damageDealt: 50, damageTaken: 350, kills: 0, losses: 2, captures: 0 } } }
        ]
    };
    const dom = new JSDOM('<!doctype html><body><div id="matchStatsOverlay"><button id="matchStatsCloseBtn"></button><p id="matchStatsSubtitle"></p><div id="matchStatsSummary"></div><button type="button" data-control-metric="controlShare" class="active"></button><button type="button" data-control-metric="unitShare"></button><button type="button" data-control-metric="cityShare"></button><svg id="matchControlChart"></svg><div id="matchControlTooltip" hidden></div><div id="matchControlLegend"></div><p id="matchControlMethod"></p><div id="matchCampCards"></div><div id="matchUnitLeaders"></div><div id="matchUnitMvp"></div><select id="matchUnitMetric"><option value="damageDealt">造成伤害</option></select><select id="matchUnitCamp"></select><div id="matchUnitTable"></div><div id="matchBattleEvents"></div><p id="matchBattleMethod"></p></div></body>');
    const prevDoc = globalThis.document;
    globalThis.document = dom.window.document;
    try {
        const { initMatchStatsPanel } = await import('../js/matchStatsView.js');
        const panel = initMatchStatsPanel({ getLog: () => reviewDoc });
        assert.equal(panel.open(), true);
        assert.equal(dom.window.document.querySelector('#matchUnitMvp .match-mvp-unit-watermark').textContent.trim(), '突击');
        const cmdSide = dom.window.document.querySelector('#matchBattleEvents .match-battle-event.is-commander-fall .match-battle-side');
        assert.equal(cmdSide.querySelectorAll('.match-battle-matchup').length, 2, 'same-round dual commander kill stacks both matchups');
        const elimSide = dom.window.document.querySelector('#matchBattleEvents .match-battle-event.is-elimination .match-battle-side');
        assert.equal(elimSide.querySelectorAll('.match-hud-flag').length, 3, 'dual elimination badge shows finisher vs both eliminated camps');
        assert.ok(!dom.window.document.querySelector('#matchStatsOverlay').textContent.includes('·'));
    } finally {
        globalThis.document = prevDoc;
    }
});


test('single-city virtual airfield entities track air commands, separate by controlling camp on capture, credit airdrops as recruits, and render in MVP and leaderboard', async () => {
    const { JSDOM } = await import('jsdom');
    const log = makeLog(); log.schema = 'blades-of-hex.match-log';
    log.initialState.units = [
        { id: 'colonel-1', type: 'infantry', campKey: 'player1', hp: 120, maxHp: 120, commanderId: 'colonel', isCommanderUnit: true }
    ];
    log.initialState.sites = [
        { key: 'city:1,1', kind: 'city', q: 1, r: 1, campKey: 'player1', installation: 'airfield' },
        { key: 'city:4,4', kind: 'city', q: 4, r: 4, campKey: 'player2', installation: 'airfield' }
    ];
    log.finalState.units = [...log.initialState.units];
    log.finalState.sites = [
        { key: 'city:1,1', kind: 'city', q: 1, r: 1, campKey: 'player2', installation: 'airfield' },
        { key: 'city:4,4', kind: 'city', q: 4, r: 4, campKey: 'player2', installation: 'airfield' }
    ];
    log.timeline = [
        {
            kind: 'action', sequence: 1, round: 1, actorCampKey: 'player1', actionType: 'airCommand', accepted: true,
            payload: { kind: 'airdrop', launcherQ: 1, launcherR: 1, sourceUnitId: 'airfield:1,1:player1', sourceUnitType: 'airfield' }
        },
        {
            kind: 'action', sequence: 2, round: 1, actorCampKey: 'player1', actionType: 'airCommand', accepted: true,
            payload: { kind: 'strafe', launcherQ: 1, launcherR: 1, sourceUnitId: 'airfield:1,1:player1', sourceUnitType: 'airfield' }
        },
        {
            kind: 'event', sequence: 3, round: 1, eventType: 'unitHpChanged',
            payload: { unitId: 'u2', unitType: 'cavalry', campKey: 'player2', delta: -120, sourceUnitId: 'airfield:1,1:player1', sourceUnitType: 'airfield', sourceCampKey: 'player1' }
        },
        {
            kind: 'event', sequence: 4, round: 1, eventType: 'unitKilled',
            payload: { unitId: 'u2', unitType: 'cavalry', campKey: 'player2', killerId: 'airfield:1,1:player1', killerType: 'airfield', killerCampKey: 'player1' }
        },
        // 城市 (1,1) 被蓝军占领后，同一城市以新阵营独立建立虚拟空军实体
        {
            kind: 'action', sequence: 5, round: 2, actorCampKey: 'player2', actionType: 'airCommand', accepted: true,
            payload: { kind: 'airdrop', launcherQ: 1, launcherR: 1, sourceUnitId: 'airfield:1,1:player2', sourceUnitType: 'airfield' }
        },
        {
            kind: 'action', sequence: 6, round: 2, actorCampKey: 'player2', actionType: 'airCommand', accepted: true,
            payload: { kind: 'bombing', launcherQ: 1, launcherR: 1, sourceUnitId: 'airfield:1,1:player2', sourceUnitType: 'airfield' }
        },
        {
            kind: 'event', sequence: 7, round: 2, eventType: 'unitHpChanged',
            payload: { unitId: 'u-p1', unitType: 'infantry', campKey: 'player1', delta: -360, sourceUnitId: 'airfield:1,1:player2', sourceUnitType: 'airfield', sourceCampKey: 'player2' }
        },
        // 空军上校驻守发出的指令归入上校本人
        {
            kind: 'action', sequence: 8, round: 2, actorCampKey: 'player1', actionType: 'airCommand', accepted: true,
            payload: { kind: 'stukaDiveBomb', launcherQ: 0, launcherR: 0, sourceUnitId: 'colonel-1', sourceUnitType: 'infantry', colonelId: 'colonel-1', colonelCommander: 'colonel' }
        },
        {
            kind: 'event', sequence: 9, round: 2, eventType: 'unitHpChanged',
            payload: { unitId: 'u-p2', unitType: 'archer', campKey: 'player2', delta: -180, sourceUnitId: 'colonel-1', sourceUnitType: 'infantry', sourceCampKey: 'player1' }
        }
    ];

    const stats = buildMatchStats(log);
    const p1Air = stats.units.find(u => u.id === 'airfield:1,1:player1');
    const p2Air = stats.units.find(u => u.id === 'airfield:1,1:player2');
    const colonel = stats.units.find(u => u.id === 'colonel-1');
    assert.ok(p1Air && p2Air, 'same city flipped between factions yields two distinct virtual airfield entities');
    assert.equal(p1Air.displayName, '空军 (1,1)');
    assert.equal(p1Air.recruits, 1);
    assert.equal(p1Air.damageDealt, 120);
    assert.equal(p1Air.kills, 1);
    assert.equal(p1Air.survived, false, 'player1 lost control of city (1,1)');
    assert.equal(p2Air.displayName, '空军 (1,1)');
    assert.equal(p2Air.recruits, 1);
    assert.equal(p2Air.damageDealt, 360);
    assert.equal(p2Air.survived, true, 'player2 controls city (1,1) at match end');
    assert.equal(colonel.damageDealt, 180);
    assert.equal(colonel.airCommands, 1);
    assert.equal(stats.mvpUnits.some(u => u.type === 'airfield'), false, 'virtual airfield must not appear on MVP podium');
    assert.ok(stats.mvpUnits.some(u => u.id === 'colonel-1'), 'colonel garrison remains eligible for MVP');

    const dom = new JSDOM('<!doctype html><body><div id="matchStatsOverlay"><button id="matchStatsCloseBtn"></button><p id="matchStatsSubtitle"></p><div id="matchStatsSummary"></div><button type="button" data-control-metric="controlShare" class="active"></button><button type="button" data-control-metric="unitShare"></button><button type="button" data-control-metric="cityShare"></button><svg id="matchControlChart"></svg><div id="matchControlTooltip" hidden></div><div id="matchControlLegend"></div><p id="matchControlMethod"></p><div id="matchCampCards"></div><div id="matchUnitLeaders"></div><div id="matchUnitMvp"></div><select id="matchUnitMetric"><option value="damageDealt">造成伤害</option><option value="recruits">招募</option></select><select id="matchUnitCamp"></select><div id="matchUnitTable"></div><div id="matchBattleEvents"></div><p id="matchBattleMethod"></p></div></body>');
    const prevDoc = globalThis.document;
    globalThis.document = dom.window.document;
    try {
        const { initMatchStatsPanel } = await import('../js/matchStatsView.js');
        const panel = initMatchStatsPanel({ getLog: () => log });
        assert.equal(panel.open(), true);
        const mvpIds = [...dom.window.document.querySelectorAll('#matchUnitMvp .match-mvp-identity small')].map(el => el.textContent.trim());
        assert.ok(mvpIds.every(id => !id.startsWith('#airfield:')), 'MVP podium excludes virtual airfields');
        const dmgRows = [...dom.window.document.querySelectorAll('#matchUnitTable .match-unit-row .match-unit-id')].map(el => el.textContent.trim());
        assert.ok(dmgRows.includes('#airfield:1,1:player2'), 'leaderboard still includes virtual airfields');
        const metricEl = dom.window.document.getElementById('matchUnitMetric');
        metricEl.value = 'recruits';
        metricEl.dispatchEvent(new dom.window.Event('change'));
        const rows = [...dom.window.document.querySelectorAll('#matchUnitTable .match-unit-row')];
        assert.equal(rows.length, 2, 'recruits tab displays both airfield entities sorted cleanly');
        assert.ok(!dom.window.document.querySelector('#matchStatsOverlay').textContent.includes('·'));
    } finally {
        globalThis.document = prevDoc;
    }
});


test('unit leaderboard limits each metric to top 5 and neutral captures show neutral flag without splitting', async () => {
    const { JSDOM } = await import('jsdom');
    const reviewDoc = {
        schema: 'blades-of-hex.match-review',
        matchId: 'top5-and-neutral',
        complete: true,
        durationMs: 90000,
        mode: { type: 'pve' },
        result: { winnerCampKey: 'player1' },
        participants: [
            { campKey: 'player1', name: '红军', flagPreset: 'img/flags/svg/us.svg', colorId: 'red' },
            { campKey: 'player2', name: '蓝军', flagPreset: 'img/flags/svg/fr.svg', colorId: 'blue' }
        ],
        overview: {
            totalActions: 20, totalDamage: 1200, totalLosses: 4,
            camps: [
                { campKey: 'player1', name: '红军', kills: 3, losses: 1, damageDealt: 900, damageTaken: 300, captures: 2, initialCities: 1, finalCities: 3, initialForce: { units: 7 }, finalForce: { units: 7 } },
                { campKey: 'player2', name: '蓝军', kills: 1, losses: 3, damageDealt: 300, damageTaken: 900, captures: 0, initialCities: 1, finalCities: 1, initialForce: { units: 4 }, finalForce: { units: 2 } }
            ],
            leaders: {}
        },
        unitHighlights: Array.from({ length: 7 }, (_, i) => ({
            id: `u-${i + 1}`, type: 'infantry', displayName: '步兵', campKey: 'player1',
            kills: 0, damageDealt: (7 - i) * 100, damageTaken: 50, healingReceived: 0, actions: 2, survived: true
        })),
        commanderDeathEvents: [],
        keyEvents: [
            { round: 2, type: 'cityCaptured', campKey: 'player1', previousCampKey: 'neutral', districtId: 3, label: '红军攻占行政区3' },
            { round: 2, type: 'cityCaptured', campKey: 'player1', previousCampKey: 'neutral', districtId: 4, label: '红军攻占行政区4' }
        ],
        controlTimeline: [
            { round: 0, byCamp: { player1: { units: 7, cities: 1, controlShare: 0.5 }, player2: { units: 4, cities: 1, controlShare: 0.5 } } },
            { round: 2, byCamp: { player1: { units: 7, cities: 3, controlShare: 0.75 }, player2: { units: 2, cities: 1, controlShare: 0.25 } } }
        ],
        roundIndex: [
            { round: 1, engagements: 2, byCamp: { player1: { damageDealt: 200, damageTaken: 100, kills: 0, losses: 0, captures: 0 }, player2: { damageDealt: 100, damageTaken: 200, kills: 0, losses: 0, captures: 0 } } },
            { round: 2, engagements: 4, byCamp: { player1: { damageDealt: 700, damageTaken: 200, kills: 3, losses: 1, captures: 2 }, player2: { damageDealt: 200, damageTaken: 700, kills: 1, losses: 3, captures: 0 } } }
        ]
    };
    const dom = new JSDOM('<!doctype html><body><div id="matchStatsOverlay"><button id="matchStatsCloseBtn"></button><p id="matchStatsSubtitle"></p><div id="matchStatsSummary"></div><button type="button" data-control-metric="controlShare" class="active"></button><button type="button" data-control-metric="unitShare"></button><button type="button" data-control-metric="cityShare"></button><svg id="matchControlChart"></svg><div id="matchControlTooltip" hidden></div><div id="matchControlLegend"></div><p id="matchControlMethod"></p><div id="matchCampCards"></div><div id="matchUnitLeaders"></div><div id="matchUnitMvp"></div><select id="matchUnitMetric"><option value="damageDealt">造成伤害</option></select><select id="matchUnitCamp"></select><div id="matchUnitTable"></div><div id="matchBattleEvents"></div><p id="matchBattleMethod"></p></div></body>');
    const prevDoc = globalThis.document;
    globalThis.document = dom.window.document;
    try {
        const { initMatchStatsPanel } = await import('../js/matchStatsView.js');
        const panel = initMatchStatsPanel({ getLog: () => reviewDoc });
        assert.equal(panel.open(), true);
        const rows = [...dom.window.document.querySelectorAll('#matchUnitTable .match-unit-row')];
        assert.equal(rows.length, 5, 'leaderboard displays at most top 5 entries per metric');
        const headline = dom.window.document.querySelector('#matchBattleEvents .match-battle-event.is-breakthrough .match-battle-headline');
        assert.ok(headline.innerHTML.includes('img/flags/training-targets.svg'), 'neutral capture headline shows neutral faction flag');
        assert.ok(headline.textContent.includes('夺取') && !headline.textContent.includes('攻占'), 'uses unified capture phrasing instead of separate neutral phrasing');
        const sideBadge = dom.window.document.querySelector('#matchBattleEvents .match-battle-event.is-breakthrough .match-battle-side');
        assert.ok(sideBadge.innerHTML.includes('img/flags/training-targets.svg'), 'breakthrough badge shows capture from neutral flag');
    } finally {
        globalThis.document = prevDoc;
    }
});
