import test from 'node:test';
import assert from 'node:assert/strict';

import { wireHeadlessEngine } from '../core/headless.js';
import { gameState, getViewingCamp, resetGameState } from '../js/state.js';
import { HexTile, computeCampBorders, computeDistrictBorders } from '../js/HexTile.js';
import { Unit } from '../js/Unit.js';
import { updateAllFogOfWar } from '../js/fogOfWar.js';
import { getViewingCampKey } from '../rules/diplomacy.js';
import { invalidateBoard } from '../js/config.js';
import {
    startMatchRecording,
    clearMatchRecording,
    serializeCurrentMatchLog,
    serializeCurrentMatchReview
} from '../js/matchRecorder.js';
import {
    isReplayableMatchLog,
    extractReplaySteps,
    buildReplayInitialState,
    applyReplayStep,
    createReplaySession
} from '../js/matchReplay.js';
import * as gl from '../js/gameLogic.js';

function replayDeps() {
    return {
        HexTileClass: HexTile,
        UnitClass: Unit,
        computeCampBorders,
        computeDistrictBorders,
        updateAllFogOfWar,
        invalidateBoard
    };
}

test('完整录像日志可校验且轻量化复盘索引不可启动回放', async () => {
    wireHeadlessEngine();
    clearMatchRecording();
    resetGameState();
    gameState.standardMapId = 'uncharted-passage';
    gameState.skirmishFog = true;
    gl.initMap();
    const p1 = gameState.factions.player1;
    gameState.currentCamp = p1;
    gameState.playerGold.player1 = 50;
    const infantryTile = gameState.tiles.find(t => t.unit?.camp === p1 && t.unit.type === 'infantry');
    assert.ok(infantryTile);
    const moveTarget = gl.getMovableTiles(infantryTile.unit)[0];
    assert.ok(moveTarget);
    gl.moveUnit(infantryTile.unit, moveTarget);
    assert.equal(gl.executeConstructionAt('trench', moveTarget), true);
    await gl.advanceAutomatedTurn();

    const fullLog = JSON.parse(serializeCurrentMatchLog(gameState));
    const reviewLog = JSON.parse(serializeCurrentMatchReview(gameState));
    clearMatchRecording();

    assert.equal(isReplayableMatchLog(fullLog), true);
    assert.equal(isReplayableMatchLog(reviewLog), false);
    assert.ok(fullLog.initialState.replaySnapshot, '新录像包含完整初始快照');
    assert.ok(extractReplaySteps(fullLog).length >= 3, '包含移动、建工事与结束回合动作');
});

test('录像回放精确复刻初始战局、每步动作与暂停/视角切换/只读锁及退出', async () => {
    wireHeadlessEngine();
    clearMatchRecording();
    resetGameState();
    gameState.standardMapId = 'uncharted-passage';
    gameState.skirmishFog = true;
    gl.initMap();
    const p1 = gameState.factions.player1;
    const p2 = gameState.factions.player2;
    gameState.currentCamp = p1;
    gameState.playerGold.player1 = 60;
    gameState.playerGold.player2 = 60;

    const unit = gameState.tiles.find(t => t.unit?.camp === p1 && t.unit.type === 'infantry')?.unit;
    assert.ok(unit);
    const origId = unit.id;
    const dest = gl.getMovableTiles(unit)[0];
    assert.ok(dest);
    gl.moveUnit(unit, dest);
    assert.equal(gl.executeConstructionAt('trench', dest), true);

    const p1City = gameState.tiles.find(t => t.isCity && t.camp === p1 && !t.unit);
    if (p1City) {
        gameState.selectedCityTile = p1City;
        gl.recruitUnit('infantry');
    }
    await gl.advanceAutomatedTurn();

    const log = JSON.parse(serializeCurrentMatchLog(gameState));
    const expectedTurnCounter = gameState.turnCounter;
    const expectedGoldP1 = gameState.playerGold.player1;
    clearMatchRecording();

    const deps = replayDeps();
    buildReplayInitialState(log, gameState, deps);

    assert.equal(gameState._replayMode, true);
    assert.equal(gameState._replayViewCampKey, 'neutral', '遭遇战默认全图视角');
    assert.equal(getViewingCampKey(gameState), 'neutral');
    assert.equal(getViewingCamp(), gameState.factions.neutral);
    assert.equal(gameState.turnCounter, 0);

    // 只读防误触：回放模式下任何修改棋盘入口均被阻断
    assert.equal(gl.recruitUnit('infantry'), false);
    assert.equal(gl.attackUnit(unit, unit), false);
    assert.equal(await gl.endTurn(), undefined);

    const steps = extractReplaySteps(log);
    const fxLog = [];
    for (const step of steps) {
        applyReplayStep(step, gameState, { ...deps, fxCallback: s => fxLog.push(s.actionType) });
    }

    const replayedUnit = gameState.tiles.find(t => t.unit?.id === origId)?.unit;
    assert.ok(replayedUnit, '原单位在回放后位置一致');
    assert.equal(replayedUnit.tile.q, dest.q);
    assert.equal(replayedUnit.tile.r, dest.r);
    assert.equal(gameState.tileMap.get(`${dest.q},${dest.r}`).fortification, 'trench', '野战工事位置精确复刻');
    assert.equal(gameState.turnCounter, expectedTurnCounter);
    assert.equal(gameState.playerGold.player1, expectedGoldP1);
    assert.equal(gameState.currentCamp, gameState.factions.player2);
    assert.ok(fxLog.includes('move') && fxLog.includes('endTurn'));

    // 遭遇战视角切换与暂停/继续/退出生命周期
    let exited = false;
    const session = createReplaySession({
        log,
        gameState,
        deps,
        onExit: () => { exited = true; }
    });
    const initStatus = session.start();
    assert.equal(initStatus.active, true);
    assert.equal(initStatus.paused, false);
    assert.equal(session.setPerspective('player1').viewCampKey, 'player1');
    assert.equal(getViewingCampKey(gameState), 'player1');
    assert.equal(session.setPerspective('player2').viewCampKey, 'player2');
    assert.equal(getViewingCampKey(gameState), 'player2');

    assert.equal(session.togglePause().paused, true);
    assert.equal(gameState._replayPaused, true);
    assert.equal(session.togglePause().paused, false);
    assert.equal(gameState._replayPaused, false);

    session.stop();
    assert.equal(exited, true);
    assert.equal(gameState._replayMode, false);
});

test('兼容未附带 replaySnapshot 的历史完整日志并在战役模式锁定视角切换', async () => {
    wireHeadlessEngine();
    clearMatchRecording();
    resetGameState();
    gameState.standardMapId = 'uncharted-passage';
    gl.initMap();
    const p1 = gameState.factions.player1;
    gameState.currentCamp = p1;
    const unit = gameState.tiles.find(t => t.unit?.camp === p1)?.unit;
    const dest = gl.getMovableTiles(unit)[0];
    gl.moveUnit(unit, dest);
    assert.equal(gl.executeConstructionAt('flak', dest), true);

    const legacyLog = JSON.parse(serializeCurrentMatchLog(gameState));
    delete legacyLog.initialState.replaySnapshot;
    legacyLog.mode.type = 'campaign';
    for (const entry of legacyLog.timeline) {
        if (entry.outcome?.changes?.fortificationsChanged) delete entry.outcome.changes.fortificationsChanged;
    }
    clearMatchRecording();

    const deps = replayDeps();
    buildReplayInitialState(legacyLog, gameState, deps);
    assert.equal(gameState.campaignMode, true);
    assert.equal(gameState._replayViewCampKey, 'player1', '战役模式默认锁定玩家自身视角');

    const session = createReplaySession({ log: legacyLog, gameState, deps });
    session.start();
    const afterSwitch = session.setPerspective('player2');
    assert.equal(afterSwitch.viewCampKey, 'player1', '战役模式不允许切换敌方实时视角');
    session.stop();

    buildReplayInitialState(legacyLog, gameState, deps);
    for (const step of extractReplaySteps(legacyLog)) {
        applyReplayStep(step, gameState, deps);
    }
    assert.equal(gameState.tileMap.get(`${dest.q},${dest.r}`).fortification, 'flak', '旧日志仍可按动作载荷恢复高射机枪工事');
    resetGameState();
});
