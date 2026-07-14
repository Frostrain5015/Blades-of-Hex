import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CanvasBattlefieldLayers,
    createCanvasBoardClip
} from '../js/canvasBattlefieldLayers.js';

class FakePath {
    constructor() { this.commands = []; }
    _push(name, ...args) { this.commands.push([name, ...args]); }
    moveTo(...args) { this._push('moveTo', ...args); }
    lineTo(...args) { this._push('lineTo', ...args); }
    closePath(...args) { this._push('closePath', ...args); }
}

class SpyRenderer {
    constructor(kind, calls) {
        this.kind = kind;
        this.calls = calls;
        this.syncCalls = 0;
    }
    sync(scene) {
        this.syncCalls++;
        this.scene = scene;
        return true;
    }
    render(_context, options) {
        this.calls.push(`${this.kind}:${options.phase}`);
        assert.ok(options.clip, 'every production phase must use the board clip');
        return true;
    }
    getStats() { return { syncCalls: this.syncCalls }; }
}

function tile(q, r, overrides = {}) {
    return { q, r, x: q * 52 + r * 26, y: r * 45, terrain: 'plains', surface: 'land', ...overrides };
}

test('plain legacy boards stay on the old path while active layers use the fixed production order', () => {
    const calls = [];
    const terrain = new SpyRenderer('terrain', calls);
    const hydro = new SpyRenderer('hydro', calls);
    const layers = new CanvasBattlefieldLayers({
        hexSize: 30,
        terrainRenderer: terrain,
        hydrographyRenderer: hydro,
        clipPathFactory: () => new FakePath()
    });
    const plain = [tile(0, 0), tile(1, 0)];
    const plainScene = {
        playableTiles: plain,
        renderTiles: plain,
        tileMap: new Map(plain.map(value => [`${value.q},${value.r}`, value]))
    };

    assert.equal(layers.sync(plainScene), true);
    assert.equal(layers.terrainActive, false);
    assert.equal(layers.hydrographyActive, false);
    layers.renderGround({});
    layers.renderWaterways({});
    layers.renderRelief({});
    layers.renderDetails({});
    assert.deepEqual(calls, []);
    assert.equal(terrain.syncCalls, 0);
    assert.equal(hydro.syncCalls, 0);

    plain[0].terrain = 'forest';
    plain[1].surface = 'shallowWater';
    assert.equal(layers.sync(plainScene), true, 'in-place gameplay terrain changes invalidate the cache');
    assert.equal(layers.terrainActive, true);
    assert.equal(layers.hydrographyActive, true);
    assert.equal(layers.sync(plainScene), false, 'unchanged frames do not rebuild Path2D geometry');

    layers.renderGround({});
    layers.renderWaterways({});
    layers.renderRelief({});
    layers.renderDetails({});
    assert.deepEqual(calls, [
        'hydro:surface',
        'terrain:ground',
        'hydro:waterways',
        'terrain:relief',
        'terrain:fortifications',
        'hydro:details'
    ]);
    assert.equal(terrain.syncCalls, 1);
    assert.equal(hydro.syncCalls, 1);
});

test('classic clips stop at real cells while borderless clips include only explicit render fillers', () => {
    const real = tile(0, 0);
    const filler = tile(1, 0, {
        renderOnly: true,
        playable: false,
        sourceTile: real,
        surface: 'shallowWater'
    });
    const classic = createCanvasBoardClip([real], { pathFactory: () => new FakePath() });
    const borderless = createCanvasBoardClip([real, filler], { pathFactory: () => new FakePath() });
    assert.equal(classic.commands.filter(command => command[0] === 'closePath').length, 1);
    assert.equal(borderless.commands.filter(command => command[0] === 'closePath').length, 2);
});
