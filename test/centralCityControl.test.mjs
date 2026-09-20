import test from 'node:test';
import assert from 'node:assert/strict';
import { engine } from '../core/headless.js';
import { updateDistrictColor } from '../js/gameLogic.js';
import { getStandardMap } from '../rules/standardMaps.js';

for (const playerCount of [2, 3]) {
    test(`${playerCount}P 实际占城流程只转移航母，反夺和航母阵亡后也不收编残军`, () => {
        engine.resetGameState();
        engine.seedMatchRng(`carrier-control-${playerCount}`);
        engine.configureSkirmishState({ playerCount });
        const state = engine.gameState;
        state.standardMapId = 'uncharted-passage';
        state.commanderPhase = 'done';
        engine.initMap();
        const map = getStandardMap(playerCount, state.standardMapId);
        const city = state.tiles.find(tile => tile.isCity && tile.districtId === map.carrierControl.districtId);
        const carrier = state.tiles.find(tile => tile.unit?.type === 'carrier').unit;
        const others = state.tiles.map(tile => tile.unit)
            .filter(unit => unit && unit !== carrier && unit.tile !== city)
            .map(unit => ({ unit, camp: unit.camp }));
        city.unit = null; // 守军已被消灭，进入真实行政区占领结算。
        for (const camp of [state.factions.player1, state.factions.player2]) {
            updateDistrictColor(city, camp);
            assert.equal(city.camp, camp);
            assert.equal(carrier.camp, camp);
            for (const { unit, camp: original } of others) assert.equal(unit.camp, original);
        }
        carrier.hp = 0;
        carrier.tile.unit = null;
        updateDistrictColor(city, state.factions.player1);
        assert.equal(state.tiles.some(tile => tile.unit?.type === 'carrier'), false, '不能重生奖励航母');
        for (const { unit, camp: original } of others) assert.equal(unit.camp, original);
    });
}
