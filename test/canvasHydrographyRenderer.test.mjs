import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CANVAS_HYDROGRAPHY_PHASE,
    CanvasHydrographyRenderer,
    createCanvasHydrographyLayer,
    drawCanvasHydrographyLayer
} from '../js/canvasHydrographyRenderer.js';
import { buildRiverTopology } from '../rules/hydrography.js';
import { SURFACE_KIND } from '../rules/surfaces.js';

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
        this.lineDashOffset = 0;
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

function tile(q, r, surface = SURFACE_KIND.LAND, overrides = {}) {
    const x = Math.sqrt(3) * 30 * (q + r / 2);
    const y = 45 * r;
    return { q, r, x, y, surface, ...overrides };
}

function makeScene() {
    const land = tile(0, 0);
    const shallow = tile(1, 0, SURFACE_KIND.SHALLOW_WATER);
    const deep = tile(1, -1, SURFACE_KIND.DEEP_WATER);
    const lowerLand = tile(0, 1);
    const playableTiles = [land, shallow, deep, lowerLand];
    const filler = tile(2, 0, SURFACE_KIND.LAND, {
        playable: false,
        renderOnly: true,
        surface: { inheritedFromKey: '1,0' }
    });
    const rivers = [{
        id: 'main',
        width: 'river',
        points: [
            { q: 0, r: 0, vertex: 5 },
            { q: 0, r: 0, vertex: 0 },
            { q: 0, r: 0, vertex: 1 }
        ]
    }, {
        id: 'brook',
        width: 'stream',
        points: [
            { q: 0, r: 1, vertex: 5 },
            { q: 0, r: 1, vertex: 0 }
        ]
    }];
    const crossings = [
        { riverId: 'main', segmentIndex: 1, kind: 'bridge' },
        { riverId: 'brook', segmentIndex: 0, kind: 'ford' }
    ];
    return {
        boardRevision: 12,
        playableTiles,
        renderTiles: [...playableTiles, filler],
        tileMap: new Map(playableTiles.map(value => [`${value.q},${value.r}`, value])),
        coastEdges: [
            { land: { q: 0, r: 0 }, water: { q: 1, r: 0 }, landEdge: 5 },
            { land: { q: 0, r: 0 }, water: { q: 2, r: 0 }, landEdge: 5 }
        ],
        riverTopology: buildRiverTopology(rivers, crossings),
        ports: [{ q: 0, r: 0 }]
    };
}

test('hydro layer extends neutral water into render-only fillers without creating a fake coast', () => {
    const scene = makeScene();
    let playableProjectionCalls = 0;
    let renderProjectionCalls = 0;
    const projection = {
        revision: 4,
        playable: value => {
            playableProjectionCalls++;
            return value;
        },
        render: value => {
            renderProjectionCalls++;
            return value;
        }
    };
    const layer = createCanvasHydrographyLayer(scene, {
        projection,
        pathFactory: () => new FakePath()
    });

    assert.equal(layer.metrics.playableTileCount, 4);
    assert.equal(layer.metrics.renderTileCount, 5);
    assert.equal(layer.metrics.shallowWaterTileCount, 2, 'one real shallow cell plus its visual filler');
    assert.equal(layer.metrics.deepWaterTileCount, 1);
    assert.equal(layer.metrics.coastEdgeCount, 1, 'the supplied coast whose water side is not playable is rejected');
    assert.equal(layer.metrics.riverSegmentCount, 2);
    assert.equal(layer.metrics.streamSegmentCount, 1);
    assert.equal(layer.metrics.bridgeCount, 1);
    assert.equal(layer.metrics.fordCount, 1);
    assert.equal(layer.metrics.portCount, 1);
    assert.equal(renderProjectionCalls, 1);
    assert.ok(playableProjectionCalls >= 4);
    assert.equal(layer.paths.shallowMask.native.commands.filter(command => command[0] === 'closePath').length, 2);
    assert.ok(layer.paths.shallowWaves.native.commands.some(command => command[0] === 'bezierCurveTo'));
});

test('CanvasHydrographyRenderer caches geometry by board/projection revision and clips every phase', () => {
    const scene = makeScene();
    let pathCount = 0;
    const projection = { revision: 1, playable: value => value, render: value => value };
    const renderer = new CanvasHydrographyRenderer({
        projection,
        pathFactory: () => { pathCount++; return new FakePath(); }
    });
    assert.equal(renderer.sync(scene), true);
    const compiledPathCount = pathCount;
    assert.equal(renderer.sync(scene), false);

    const context = new RecordingContext();
    const clip = ctx => ctx.rect(-50, -100, 350, 300);
    assert.equal(renderer.render(context, { phase: CANVAS_HYDROGRAPHY_PHASE.ALL, clip, now: 500 }), true);
    assert.equal(renderer.render(context, { phase: CANVAS_HYDROGRAPHY_PHASE.WATERWAYS, clip }), true);
    assert.equal(context.depth, 0);
    assert.equal(pathCount, compiledPathCount, 'rendering may animate dash offsets but does not rebuild paths');
    assert.ok(context.calls.some(call => call.name === 'clip'));
    assert.ok(context.calls.some(call => call.name === 'fill' && call.args[0] instanceof FakePath));
    assert.ok(context.calls.some(call => call.name === 'stroke' && call.args[0] instanceof FakePath));

    projection.revision = 2;
    assert.equal(renderer.sync(scene), true);
    assert.ok(pathCount > compiledPathCount);
    assert.equal(renderer.getStats().rebuildCount, 2);
    assert.equal(renderer.getStats().renderCount, 2);
});

test('hydrography falls back to replayable command buffers when Path2D is unavailable', () => {
    const layer = createCanvasHydrographyLayer(makeScene(), { pathFactory: () => null });
    const context = new RecordingContext();
    assert.equal(drawCanvasHydrographyLayer(context, layer, {
        phase: CANVAS_HYDROGRAPHY_PHASE.SURFACE,
        reducedMotion: true
    }), true);
    assert.equal(context.depth, 0);
    assert.ok(context.calls.some(call => call.name === 'bezierCurveTo'));
    assert.ok(context.calls.some(call => call.name === 'fill' && call.args.length === 0));
});
