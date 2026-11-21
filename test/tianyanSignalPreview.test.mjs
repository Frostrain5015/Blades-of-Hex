import test from 'node:test';
import assert from 'node:assert/strict';
import { engine } from '../core/headless.js';
import { register } from '../commander/fx/tianyan.js';
import { clearFxLayers, drawFxLayer } from '../js/fxRegistry.js';
import { axialToBoardPixel } from '../rules/boardLayout.js';
import { setInspectionTarget } from '../js/state.js';

test('天眼信号圈按敌我单位选中显示，范围排除假地块并遵守迷雾', () => {
    const state = engine.gameState;
    engine.resetGameState();
    engine.configureSkirmishState({ playerCount: 2 });
    const { player1, player2 } = state.factions;
    const makeTile = (q, r, extra) => ({ q, r, s: -q - r, ...axialToBoardPixel(q, r), ...extra });
    const source = makeTile(0, 0, { unit: { id: 1, commander: 'tianyan', camp: player2, hp: 100 } });
    const drone = makeTile(1, 0, { unit: { id: 2, _isDrone: true, camp: player2, hp: 75 } });
    const other = makeTile(6, 0, { unit: { id: 3, camp: player1, hp: 75 } });
    const filler = makeTile(-1, 0, { isVisualFiller: true, renderOnly: true });
    for (const tile of [source, drone, other]) tile.unit.tile = tile;
    state.tiles = [source, drone, other, filler];
    state.tileMap = new Map(state.tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
    state.currentCamp = player1;
    register();

    function draw(tile) {
        state.selectedTile = tile;
        setInspectionTarget(tile);
        const points = [];
        let strokes = 0;
        const noop = () => {};
        drawFxLayer('ground', {
            globalAlpha: 1, save: noop, restore: noop, beginPath: noop, closePath: noop,
            setLineDash: noop, stroke: () => strokes++,
            moveTo: (x, y) => points.push({ x, y }), lineTo: (x, y) => points.push({ x, y })
        }, 300);
        return { points, strokes };
    }

    try {
        assert.equal(draw(null).strokes, 0);
        assert.equal(draw(other).strokes, 0);
        const enemySource = draw(source);
        assert.equal(enemySource.strokes, 2);
        assert.equal(enemySource.points.length, 10, 'Two real hexes have ten exterior edges');
        assert.deepEqual(draw(drone), enemySource);
        state.currentCamp = player2;
        assert.deepEqual(draw(drone), enemySource);
        state.currentCamp = player1;
        state.skirmishFog = true;
        state.visibleTiles.player1 = new Set(['1,0']);
        assert.equal(draw(drone).strokes, 0, 'A visible drone does not reveal its hidden commander');
        state.visibleTiles.player1.add('0,0');
        assert.deepEqual(draw(drone), enemySource);
        assert.equal(draw(null).strokes, 0);
    } finally {
        clearFxLayers();
        engine.resetGameState();
    }
});
