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
    const log = makeLog();
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
    const log = makeLog();
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

    const stats = buildMatchStats(log);
    const breakthrough = stats.battleEvents.find(event => event.round === 11);
    assert.ok(breakthrough);
    assert.equal(breakthrough.label, '战线突破');
    assert.equal(breakthrough.totalLosses, 6);
    assert.equal(breakthrough.captures, 1);
});

test('将领单位显示具体身份并生成显著的阵亡时间点', () => {
    const log = makeLog();
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
    const log = makeLog();
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
    const log = makeLog();
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
