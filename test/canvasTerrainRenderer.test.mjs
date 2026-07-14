import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CANVAS_TERRAIN_PHASE,
    CanvasTerrainRenderer,
    createCanvasTerrainLayer,
    drawCanvasTerrainLayer
} from '../js/canvasTerrainRenderer.js';

class FakePath {
    constructor() { this.commands = []; }
    _add(name, ...args) { this.commands.push([name, ...args]); }
    moveTo(...args) { this._add('moveTo', ...args); }
    lineTo(...args) { this._add('lineTo', ...args); }
    bezierCurveTo(...args) { this._add('bezierCurveTo', ...args); }
    quadraticCurveTo(...args) { this._add('quadraticCurveTo', ...args); }
    closePath(...args) { this._add('closePath', ...args); }
    rect(...args) { this._add('rect', ...args); }
    arc(...args) { this._add('arc', ...args); }
    ellipse(...args) { this._add('ellipse', ...args); }
}

class RecordingContext {
    constructor() {
        this.calls = [];
        this.depth = 0;
        this.globalAlpha = 1;
    }
    record(name, ...args) { this.calls.push({ name, args }); }
    save() { this.depth++; this.record('save'); }
    restore() { this.depth--; this.record('restore'); }
    beginPath() { this.record('beginPath'); }
    moveTo(...args) { this.record('moveTo', ...args); }
    lineTo(...args) { this.record('lineTo', ...args); }
    bezierCurveTo(...args) { this.record('bezierCurveTo', ...args); }
    quadraticCurveTo(...args) { this.record('quadraticCurveTo', ...args); }
    closePath() { this.record('closePath'); }
    rect(...args) { this.record('rect', ...args); }
    arc(...args) { this.record('arc', ...args); }
    ellipse(...args) { this.record('ellipse', ...args); }
    fill(...args) { this.record('fill', ...args); }
    stroke(...args) { this.record('stroke', ...args); }
    clip(...args) { this.record('clip', ...args); }
    setLineDash(...args) { this.record('setLineDash', ...args); }
}

function tile(q, r, overrides = {}) {
    return { q, r, x: q * 50, y: r * 45, terrain: 'plains', fortification: null, ...overrides };
}

function makeScene() {
    const playableTiles = [
        tile(0, 0, { terrain: 'forest' }),
        tile(1, 0, { terrain: 'forest' }),
        tile(0, 1, { terrain: 'mountain', fortification: 'trench' }),
        tile(-1, 1, { isCity: true, isUrban: true, urbanCenterKey: '-1,1' }),
        tile(-1, 2)
    ];
    const renderOnly = tile(2, 0, { terrain: 'forest', renderOnly: true, playable: false });
    return {
        boardRevision: 7,
        playableTiles,
        renderTiles: [...playableTiles, renderOnly],
        tileMap: new Map(playableTiles.map(value => [`${value.q},${value.r}`, value]))
    };
}

test('terrain layer compiles continuous features from playable tiles and consumes both projections', () => {
    const scene = makeScene();
    let playableProjectionCalls = 0;
    let renderProjectionCalls = 0;
    let pathCount = 0;
    const projection = {
        revision: 3,
        playable: tileValue => {
            playableProjectionCalls++;
            return { x: tileValue.x + 100, y: tileValue.y + 80, size: 30 };
        },
        render: tileValue => {
            renderProjectionCalls++;
            return { x: tileValue.x + 100, y: tileValue.y + 80, size: 30 };
        }
    };
    const layer = createCanvasTerrainLayer(scene, {
        projection,
        pathFactory: () => { pathCount++; return new FakePath(); }
    });

    assert.equal(layer.boardRevision, 7);
    assert.equal(layer.projectionRevision, 3);
    assert.equal(layer.metrics.playableTileCount, 5);
    assert.equal(layer.metrics.renderTileCount, 6);
    assert.equal(layer.metrics.forestTileCount, 2, 'render-only forest cannot enter topology');
    assert.equal(layer.metrics.forestLinkCount, 1);
    assert.equal(layer.metrics.mountainTileCount, 1);
    assert.equal(layer.metrics.trenchTileCount, 1);
    assert.equal(layer.metrics.urbanFootprintCount, 1);
    assert.ok(playableProjectionCalls >= 5);
    assert.equal(renderProjectionCalls, 1);
    assert.ok(pathCount > 10);
    assert.ok(layer.paths.forestCanopy.native.commands.some(command => command[0] === 'arc'));
});

test('CanvasTerrainRenderer rebuilds only for board/projection invalidation, never while rendering', () => {
    const scene = makeScene();
    let pathCount = 0;
    const projection = { revision: 1, playable: value => value, render: value => value };
    const renderer = new CanvasTerrainRenderer({
        projection,
        pathFactory: () => { pathCount++; return new FakePath(); }
    });

    assert.equal(renderer.sync(scene), true);
    const compiledPathCount = pathCount;
    assert.equal(renderer.sync(scene), false);

    const context = new RecordingContext();
    const clip = ctx => {
        ctx.rect(-10, -10, 400, 300);
    };
    assert.equal(renderer.render(context, { phase: CANVAS_TERRAIN_PHASE.ALL, clip }), true);
    assert.equal(renderer.render(context, { phase: CANVAS_TERRAIN_PHASE.GROUND, clip }), true);
    assert.equal(pathCount, compiledPathCount, 'render does not allocate new paths');
    assert.equal(context.depth, 0);
    assert.ok(context.calls.some(call => call.name === 'clip'));
    assert.ok(context.calls.some(call => call.name === 'fill' && call.args[0] instanceof FakePath));
    assert.ok(context.calls.some(call => call.name === 'stroke' && call.args[0] instanceof FakePath));

    scene.boardRevision = 8;
    assert.equal(renderer.sync(scene), true);
    assert.ok(pathCount > compiledPathCount);
    assert.deepEqual(renderer.getStats().rebuildCount, 2);
    assert.deepEqual(renderer.getStats().renderCount, 2);
});

test('non-Path2D fallback replays cached commands through a plain Canvas2D context', () => {
    const layer = createCanvasTerrainLayer(makeScene(), { pathFactory: () => null });
    const context = new RecordingContext();
    assert.equal(drawCanvasTerrainLayer(context, layer, { phase: CANVAS_TERRAIN_PHASE.RELIEF }), true);
    assert.equal(context.depth, 0);
    assert.ok(context.calls.some(call => call.name === 'arc'));
    assert.ok(context.calls.some(call => call.name === 'fill' && call.args.length === 0));
});
