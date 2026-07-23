import test from 'node:test';
import assert from 'node:assert/strict';

import { emit } from '../js/eventBus.js';
import {
    MATCH_LOG_SCHEMA,
    MATCH_REVIEW_SCHEMA,
    bindMatchRecorderState,
    buildMatchReview,
    clearMatchRecording,
    finalizeMatchRecording,
    getCurrentMatchLog,
    recordCommittedAction,
    resolvePendingLocalAction,
    serializeCurrentMatchLog,
    serializeCurrentMatchReview,
    startMatchRecording,
    withMatchActionCause
} from '../js/matchRecorder.js';

function makeState() {
    const player1 = { id: 'player1', name: '红军', controller: 'human', active: true };
    const player2 = { id: 'player2', name: '蓝军', controller: 'ai', active: true };
    const attacker = {
        id: 'u1', type: 'infantry', camp: player1, hp: 100, maxHp: 100,
        morale: 50, canAct: true, remainingMP: 3, tile: null
    };
    const defender = {
        id: 'u2', type: 'infantry', camp: player2, hp: 100, maxHp: 100,
        morale: 50, canAct: true, remainingMP: 3, tile: null
    };
    const start = { q: 0, r: 0, surface: 'land', terrain: 'plains', unit: attacker };
    const destination = { q: 0, r: 1, surface: 'land', terrain: 'forest', unit: null };
    const enemy = { q: 2, r: 0, surface: 'land', terrain: 'plains', unit: defender };
    attacker.tile = start;
    defender.tile = enemy;
    return {
        gameMode: 'pve', campaignMode: false, standardMapId: 'recorder-test',
        isThreePlayer: false, skirmishFog: true, doubleCommanderMode: false,
        factions: { player1, player2 }, turnOrder: ['player1', 'player2'],
        currentCamp: player1, turnCounter: 0, weather: 'clear',
        tiles: [start, destination, enemy],
        visibleTiles: { player1: new Set(['0,0', '0,1']), player2: new Set(['2,0']) },
        playerGold: { player1: 100, player2: 100 },
        playerHands: { player1: ['airstrike'], player2: [] },
        killCount: { player1: 0, player2: 0 }, surrenderedCamps: [],
        logHistory: [], gameOver: false, victoryCamp: null,
        attacker, defender, start, destination, enemy
    };
}

test('match recorder exports fog-aware, diff-based, LLM-readable JSON', () => {
    clearMatchRecording();
    const state = makeState();
    bindMatchRecorderState(state);
    const started = startMatchRecording(state, { matchId: 'test-match' });
    assert.equal(started.schema, MATCH_LOG_SCHEMA);
    assert.equal(started.coverage, 'full-from-initial-state');
    assert.equal(started.initialState.units.length, 2);

    state.start.unit = null;
    state.destination.unit = state.attacker;
    state.attacker.tile = state.destination;
    state.attacker.remainingMP = 2;
    state.playerGold.player1 = 90;
    state.logHistory.push('红军步兵移动到森林');

    const action = recordCommittedAction(state, {
        actionType: 'move',
        payload: { unitId: 'u1', q: 0, r: 1 },
        actorCampKey: 'player1',
        accepted: null
    });

    assert.equal(action.actionId, 'test-match:a1');
    assert.equal(action.decisionContext.informationPolicy, 'fog-limited');
    assert.deepEqual(action.decisionContext.knownOtherUnits, []);
    assert.deepEqual(action.outcome.changes.unitsMoved[0].to, { q: 0, r: 1 });
    assert.equal(action.outcome.changes.resources[0].changes.gold.after, 90);
    assert.deepEqual(action.outcome.engineMessages, ['红军步兵移动到森林']);

    const confirmed = resolvePendingLocalAction('move', true, { revision: 4 });
    assert.equal(confirmed.accepted, true);
    assert.equal(confirmed.network.revision, 4);

    state.defender.hp = 70;
    emit('match:unitHpChanged', {
        unitId: 'u2', unit: state.defender, oldHp: 100, newHp: 70, delta: -30,
        source: 'attack', sourceUnitId: 'u1', sourceUnit: state.attacker
    });
    state.gameOver = true;
    state.victoryCamp = state.factions.player1;
    const finalLog = finalizeMatchRecording(state, { reason: 'testVictory' });

    assert.equal(finalLog.complete, true);
    assert.equal(finalLog.result.winnerCampKey, 'player1');
    assert.equal(finalLog.summary.byCamp.player1.damageDealt, 30);
    assert.ok(finalLog.reviewGuide.length >= 4);
    assert.equal(getCurrentMatchLog(), finalLog);

    finalizeMatchRecording(state, { victory: true, reason: 'campaignVictory', stars: 3 });
    assert.equal(finalLog.result.reason, 'campaignVictory');
    assert.equal(finalLog.result.stars, 3);

    emit('match:unitKilled', {
        unitId: 'u2', unitType: 'infantry', camp: state.factions.player2,
        killerId: 'u1', killerType: 'infantry', killerCamp: state.factions.player1,
        reason: 'combat'
    });
    assert.equal(finalLog.summary.byCamp.player1.kills, 0);
    assert.equal(finalLog.summary.byCamp.player1.attributedKills, 1);
    assert.equal(finalLog.summary.byCamp.player2.unitsLost, 1);

    const parsed = JSON.parse(serializeCurrentMatchLog());
    assert.equal(parsed.matchId, 'test-match');
    assert.equal(parsed.timeline.filter(item => item.kind === 'action').length, 1);
    assert.equal(parsed.timeline.filter(item => item.kind === 'event').length, 2);

    const review = buildMatchReview(finalLog);
    assert.equal(review.schema, MATCH_REVIEW_SCHEMA);
    assert.equal(review.layer.detailFile, 'test-match.match-full.json');
    assert.equal(review.roundIndex.length, 1);
    assert.equal(review.controlTimeline[0].round, 0);
    assert.equal(review.keyEvents[0].sequence, 3);
    assert.equal('timeline' in review, false);
    assert.equal('initialState' in review, false);
    assert.equal(JSON.parse(serializeCurrentMatchReview()).matchId, 'test-match');
    clearMatchRecording();
});

test('delayed effects keep their originating action and do not leak into the next action diff', () => {
    clearMatchRecording();
    const state = makeState();
    bindMatchRecorderState(state);
    startMatchRecording(state, { matchId: 'deferred-cause-test' });
    const airAction = recordCommittedAction(state, {
        actionType: 'airCommand',
        payload: { kind: 'strafe' },
        actorCampKey: 'player1',
        accepted: true
    });

    withMatchActionCause(state, airAction.actionId, () => {
        state.defender.hp = 55;
        state.logHistory.push('扫射命中蓝军步兵');
        emit('match:unitHpChanged', {
            unitId: 'u2', unit: state.defender,
            oldHp: 100, newHp: 55, delta: -45,
            source: 'ranged'
        });
    });

    const delayedEvent = getCurrentMatchLog().timeline.find(item => item.eventType === 'unitHpChanged');
    assert.equal(delayedEvent.causedByActionId, airAction.actionId);
    assert.equal(airAction.outcome.deferredEffects[0].changes.unitHp[0].delta, -45);
    assert.deepEqual(airAction.outcome.deferredEffects[0].engineMessages, ['扫射命中蓝军步兵']);

    state.playerGold.player1 -= 4;
    const nextAction = recordCommittedAction(state, {
        actionType: 'drawCard',
        actorCampKey: 'player1',
        accepted: true
    });
    assert.equal(nextAction.outcome.changes.unitHp, undefined);
    assert.equal(nextAction.outcome.changes.resources[0].changes.gold.after, 96);
    clearMatchRecording();
});

test('commander active-skill runtime state is preserved in action diffs', () => {
    clearMatchRecording();
    const state = makeState();
    state.attacker.commander = 'paladin';
    state.attacker.isCommanderUnit = true;
    state.attacker._faith = 1;
    state.attacker._smiteReady = false;
    state.attacker._smiteCharged = false;
    bindMatchRecorderState(state);
    startMatchRecording(state, { matchId: 'active-skill-state-test' });

    state.attacker._faith = 0;
    state.attacker._smiteReady = true;
    const action = recordCommittedAction(state, {
        actionType: 'activateSkill',
        payload: { unitId: 'u1', commanderId: 'paladin', skillName: '至圣斩' },
        actorCampKey: 'player1',
        accepted: true
    });

    assert.equal(action.outcome.changed, true);
    assert.equal(action.outcome.changes.unitState[0].changes.faith.before, 1);
    assert.equal(action.outcome.changes.unitState[0].changes.faith.after, 0);
    assert.equal(action.outcome.changes.unitState[0].changes.smiteReady.after, true);
    clearMatchRecording();
});

test('Hero-bound faction skills are logged once with the faction logo and included in review', () => {
    clearMatchRecording();
    const state = makeState();
    state.doubleCommanderMode = true;
    state.factions.player1.flagEmoji = '🐉';
    bindMatchRecorderState(state);
    startMatchRecording(state, { matchId: 'faction-skill-test' });

    const event = {
        presentationEventId: 'sunMoon:player1:4',
        campKey: 'player1',
        affectedIds: ['u1']
    };
    emit('fx:tianhengBorrowDay', event);
    emit('fx:tianhengBorrowDay', event);
    finalizeMatchRecording(state, { reason: 'test' });

    const skillEvents = getCurrentMatchLog().timeline.filter(item => item.eventType === 'factionSkillActivated');
    assert.equal(skillEvents.length, 1);
    assert.equal(skillEvents[0].payload.logoEmoji, '🐉');
    assert.equal(skillEvents[0].payload.skillName, '日月天衡');
    const review = buildMatchReview(getCurrentMatchLog());
    assert.equal(review.factionSkillEvents.length, 1);
    assert.equal(review.factionSkillEvents[0].presentationEventId, 'sunMoon:player1:4');
    clearMatchRecording();
});
