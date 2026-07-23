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
    assert.equal(buildMatchStatsDocument({ schema: 'unknown' }), null);
});
