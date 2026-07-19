import assert from 'node:assert/strict';
import {
    PIXI_BATTLEFIELD_LAYER_ORDER,
    PERFORMANCE_PROFILE,
    RENDERER_BACKEND,
    RENDERER_LIFECYCLE,
    PixiBattlefieldRenderer,
    createBattlefieldRenderer,
    createPixiSceneSnapshot
} from '../js/rendering/index.js';

function createEventCanvas() {
    const listeners = new Map();
    return {
        style: {},
        parentNode: null,
        getContext() { return {}; },
        addEventListener(type, handler) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(handler);
        },
        removeEventListener(type, handler) {
            listeners.get(type)?.delete(handler);
        },
        dispatch(type, event = {}) {
            for (const handler of listeners.get(type) || []) handler(event);
        },
        listenerCount(type) { return listeners.get(type)?.size || 0; }
    };
}

function createHost() {
    return {
        children: [],
        appendChild(child) {
            this.children.push(child);
            child.parentNode = this;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            child.parentNode = null;
        }
    };
}

function createFakePixi(options = {}) {
    const applications = [];

    class Container {
        constructor(config = {}) {
            this.label = config.label || '';
            this.children = [];
            this.position = {
                x: 0,
                y: 0,
                set: (x, y = x) => {
                    this.position.x = x;
                    this.position.y = y;
                }
            };
            this.scale = {
                x: 1,
                y: 1,
                set: (x, y = x) => {
                    this.scale.x = x;
                    this.scale.y = y;
                }
            };
        }
        addChild(child) {
            this.children.push(child);
            return child;
        }
    }

    class Graphics {
        constructor() { this.commands = []; }
        clear() { this.commands = [{ type: 'clear' }]; return this; }
        moveTo(x, y) { this.commands.push({ type: 'moveTo', x, y }); return this; }
        lineTo(x, y) { this.commands.push({ type: 'lineTo', x, y }); return this; }
        closePath() { this.commands.push({ type: 'closePath' }); return this; }
        rect(x, y, width, height) {
            this.commands.push({ type: 'rect', x, y, width, height });
            return this;
        }
        circle(x, y, radius) {
            this.commands.push({ type: 'circle', x, y, radius });
            return this;
        }
        fill(style) { this.commands.push({ type: 'fill', style }); return this; }
        stroke(style) { this.commands.push({ type: 'stroke', style }); return this; }
    }

    class Application {
        constructor() {
            this.stage = new Container({ label: 'stage' });
            this.canvas = options.canvasFactory?.() || createEventCanvas();
            this.renderer = {
                resizeCalls: [],
                renderCalls: [],
                resize: (...args) => this.renderer.resizeCalls.push(args),
                render: (...args) => this.renderer.renderCalls.push(args)
            };
            this.initOptions = null;
            this.renderCount = 0;
            this.destroyCalls = [];
            this.stopped = false;
            applications.push(this);
        }
        async init(initOptions) {
            this.initOptions = initOptions;
            if (initOptions.canvas) this.canvas = initOptions.canvas;
            if (options.failInitialization) throw new Error('synthetic Pixi initialization failure');
        }
        stop() { this.stopped = true; }
        render() { this.renderCount += 1; }
        destroy(...args) { this.destroyCalls.push(args); }
    }

    return {
        module: { Application, Container, Graphics },
        applications
    };
}

function hasCommand(renderer, layer, type) {
    return renderer.layers[layer].children[0].commands.some(command => command.type === type);
}

const source = {
    revision: 17,
    world: { x: 4, y: 7, scale: 1.25 },
    surface: {
        bounds: { x: -20, y: -10, width: 240, height: 160 },
        color: '#10252a'
    },
    tiles: [{
        id: '0,0',
        points: [[10, 0], [20, 6], [20, 18], [10, 24], [0, 18], [0, 6]],
        fillColor: '#24464b',
        gridColor: '#8bc8cc'
    }],
    boundaries: [{
        id: 'north-edge',
        points: [[0, 0], [60, 0], [80, 12]],
        color: 0xa8f4ff,
        width: 3
    }],
    units: [{
        id: 'unit-a',
        x: 42,
        y: 58,
        radius: 15,
        color: '#3e7080',
        health: { ratio: 0.64 }
    }],
    originMarker: {
        x: 42,
        y: 58,
        radius: 21,
        color: '#55edff',
        pulse: true
    },
    targetFrames: [{
        id: 'target-a',
        center: { x: 86, y: 58 },
        size: 32,
        color: '#f05b52',
        motif: 'attack',
        startedAtMs: 100
    }],
    rangeRegions: [{
        cells: [[[60, 30], [90, 30], [98, 58], [90, 86], [60, 86], [52, 58]]],
        edges: [[[60, 30], [90, 30]]],
        startedAtMs: 100
    }],
    antiAirCells: [{
        points: [[110, 30], [140, 30], [148, 58], [140, 86], [110, 86], [102, 58]],
        x: 125,
        y: 58,
        radius: 20,
        level: 2,
        startedAtMs: 100
    }]
};

// Snapshot construction is renderer-only, detached, normalized and immutable.
const snapshot = createPixiSceneSnapshot(source);
source.units[0].x = 999;
source.tiles[0].points[0][0] = 999;
assert.equal(snapshot.units[0].x, 42);
assert.equal(snapshot.tiles[0].points[0].x, 10);
assert.equal(snapshot.surface.color, 0x10252a);
assert.equal(Object.isFrozen(snapshot.originMarker), true);
assert.throws(() => createPixiSceneSnapshot({
    tiles: [{ points: [[0, 0], [1, 1]] }]
}), /at least 3 points/);

// Pixi v8 initialization is asynchronous, WebGL-first and manually rendered.
const fakePixi = createFakePixi();
const host = createHost();
const contextNotifications = [];
let sceneClock = 400;
const renderer = new PixiBattlefieldRenderer({
    pixiLoader: async () => fakePixi.module,
    capabilities: {
        devicePixelRatio: 2,
        hardwareConcurrency: 8,
        deviceMemory: 8,
        prefersReducedMotion: false
    },
    performanceProfile: PERFORMANCE_PROFILE.BALANCED,
    now: () => sceneClock,
    onContextLost: (error, payload) => contextNotifications.push({ error, payload })
});

await renderer.initialize(host, {
    viewport: { width: 640, height: 360, pixelRatio: 2 }
});
const app = fakePixi.applications[0];
assert.equal(renderer.lifecycle, RENDERER_LIFECYCLE.READY);
assert.equal(renderer.backend, RENDERER_BACKEND.PIXI_WEBGL);
assert.equal(app.initOptions.preference, 'webgl');
assert.equal(app.initOptions.width, 640);
assert.equal(app.initOptions.height, 360);
assert.equal(app.initOptions.resolution, 1.5);
assert.equal(app.initOptions.autoDensity, true);
assert.equal(app.initOptions.autoStart, false);
assert.equal(app.stopped, true);
assert.deepEqual(
    app.stage.children[0].children.map(layer => layer.label),
    PIXI_BATTLEFIELD_LAYER_ORDER.map(name => `battlefield-${name}`)
);
assert.equal(host.children[0], renderer.canvas);
assert.equal(renderer.canvas.listenerCount('webglcontextlost'), 1);

renderer.syncScene(snapshot);
renderer.enqueue({ type: 'preview-pulse', point: { x: 42, y: 58 } });
const renderedFrame = renderer.render({ nowMs: 350, deltaMs: 16, frameId: 22 });
assert.equal(renderedFrame.rendered, true);
assert.equal(renderedFrame.events, 1);
assert.equal(app.renderCount, 1);
assert.equal(renderer.layers.surface.parent, undefined);
assert.equal(app.stage.children[0].position.x, 4);
assert.equal(app.stage.children[0].position.y, 7);
assert.equal(app.stage.children[0].scale.x, 1.25);
assert.equal(hasCommand(renderer, 'surface', 'rect'), true);
assert.equal(hasCommand(renderer, 'surface', 'fill'), true);
assert.equal(hasCommand(renderer, 'borders', 'stroke'), true);
assert.equal(hasCommand(renderer, 'units', 'circle'), true);
assert.equal(hasCommand(renderer, 'unitHud', 'circle'), true);
assert.equal(hasCommand(renderer, 'unitHud', 'lineTo'), true);
assert.equal(hasCommand(renderer, 'interactionGround', 'lineTo'), true);
assert.equal(hasCommand(renderer, 'interactionGround', 'circle'), true);
assert.equal(hasCommand(renderer, 'interactionTop', 'lineTo'), true);

// Removed interaction descriptors remain just long enough to fade out, then
// are pruned on the next scene sync instead of accumulating indefinitely.
const noInteractionSource = {
    ...source,
    targetFrames: [],
    rangeRegions: [],
    antiAirCells: []
};
renderer.syncScene(noInteractionSource);
assert.equal(renderer.scene.targetFrames[0].endingStartedAtMs, 400);
assert.equal(renderer.scene.rangeRegions[0].endingStartedAtMs, 400);
assert.equal(renderer.render({ nowMs: 450, deltaMs: 16 }).rendered, true);
sceneClock = 700;
renderer.syncScene(noInteractionSource);
assert.equal(renderer.scene.targetFrames.length, 0);
assert.equal(renderer.scene.rangeRegions.length, 0);
assert.equal(renderer.scene.antiAirCells.length, 0);

renderer.resize({ width: 320, height: 180, pixelRatio: 2 });
assert.deepEqual(app.renderer.resizeCalls[0], [320, 180, 1.5]);

let prevented = false;
const renderCountBeforeContextLoss = app.renderCount;
renderer.canvas.dispatch('webglcontextlost', {
    preventDefault() { prevented = true; }
});
assert.equal(prevented, true);
assert.equal(renderer.contextLost, true);
assert.equal(contextNotifications.length, 1);
assert.equal(contextNotifications[0].error.name, 'WebGLContextLostError');
assert.equal(renderer.render({ nowMs: 500 }).reason, 'context-lost');
assert.equal(app.renderCount, renderCountBeforeContextLoss);
renderer.canvas.dispatch('webglcontextrestored');
assert.equal(renderer.contextLost, false);
assert.equal(renderer.render({ nowMs: 520 }).rendered, true);

const canvas = renderer.canvas;
renderer.destroy();
assert.equal(renderer.lifecycle, RENDERER_LIFECYCLE.DESTROYED);
assert.equal(host.children.length, 0);
assert.equal(canvas.listenerCount('webglcontextlost'), 0);
assert.equal(app.destroyCalls.length, 1);
renderer.destroy();
assert.throws(() => renderer.render({}), /not ready/);

// Reduced-motion/static scenes render once per state change rather than
// rebuilding identical Graphics commands on every requestAnimationFrame.
const staticPixi = createFakePixi();
const staticRenderer = new PixiBattlefieldRenderer({
    pixiLoader: async () => staticPixi.module,
    reducedMotion: true,
    capabilities: { devicePixelRatio: 1, prefersReducedMotion: false }
});
await staticRenderer.initialize(createHost(), { width: 100, height: 60 });
staticRenderer.syncScene(snapshot);
assert.equal(staticRenderer.render({ nowMs: 100 }).rendered, true);
const unchangedStaticFrame = staticRenderer.render({ nowMs: 116 });
assert.equal(unchangedStaticFrame.rendered, false);
assert.equal(unchangedStaticFrame.reason, 'unchanged-static-scene');
assert.equal(staticPixi.applications[0].renderCount, 1);
staticRenderer.enqueue({ type: 'forced-refresh' });
assert.equal(staticRenderer.render({ nowMs: 132 }).rendered, true);
assert.equal(staticPixi.applications[0].renderCount, 2);
staticRenderer.destroy();

// Partial async initialization is safely destroyed and can be rejected by the boundary.
const failingPixi = createFakePixi({ failInitialization: true });
const failingRenderer = new PixiBattlefieldRenderer({
    pixiLoader: () => Promise.resolve(failingPixi.module),
    capabilities: { devicePixelRatio: 1 }
});
await assert.rejects(
    failingRenderer.initialize(createHost(), { width: 80, height: 40 }),
    /synthetic Pixi initialization failure/
);
assert.equal(failingRenderer.lifecycle, RENDERER_LIFECYCLE.NEW);
assert.equal(failingPixi.applications[0].destroyCalls.length, 1);
failingRenderer.destroy();

// The concrete adapter satisfies BattlefieldRendererBoundary without a Pixi import at module load.
const boundaryPixi = createFakePixi();
let boundaryAdapter = null;
const boundary = createBattlefieldRenderer({
    preferredBackend: RENDERER_BACKEND.PIXI_WEBGL,
    capabilities: {
        canvas2d: true,
        webgl1: true,
        webgl2: true,
        webgpu: false,
        devicePixelRatio: 1,
        hardwareConcurrency: 8,
        deviceMemory: 8,
        prefersReducedMotion: false
    },
    rendererFactories: new Map([
        [RENDERER_BACKEND.PIXI_WEBGL, ({ capabilities }) => {
            boundaryAdapter = new PixiBattlefieldRenderer({
                pixiLoader: async () => boundaryPixi.module,
                capabilities
            });
            return boundaryAdapter;
        }]
    ])
});
await boundary.initialize(createHost(), { width: 160, height: 90 });
assert.equal(boundary.backend, RENDERER_BACKEND.PIXI_WEBGL);
boundary.syncScene(snapshot);
assert.equal(boundary.render({ nowMs: 10 }).rendered, true);

// A frame skipped during context loss must not consume queued visual events.
// Restoring the same backend presents them without changing engine ownership.
boundary.enqueue({ type: 'impact-pulse', at: { x: 86, y: 58 } });
boundaryAdapter.canvas.dispatch('webglcontextlost', { preventDefault() {} });
assert.equal(boundary.render({ nowMs: 20 }).rendered, false);
assert.equal(boundary.backend, RENDERER_BACKEND.PIXI_WEBGL);
boundaryAdapter.canvas.dispatch('webglcontextrestored');
assert.equal(boundary.render({ nowMs: 30 }).events, 1);
boundary.destroy();
assert.equal(boundaryAdapter.lifecycle, RENDERER_LIFECYCLE.DESTROYED);

console.log('pixiBattlefieldRenderer tests passed');
