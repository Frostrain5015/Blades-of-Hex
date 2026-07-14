import assert from 'node:assert/strict';
import {
    CanvasBattlefieldRenderer,
    PERFORMANCE_PROFILE,
    RENDERER_BACKEND,
    RENDERER_LIFECYCLE,
    createBattlefieldRenderer,
    createImmutableRenderValue,
    detectRendererCapabilities,
    resolveRenderPolicy
} from '../js/rendering/index.js';

function createFakeCanvas(contexts = { '2d': {} }) {
    const context = contexts['2d'] || null;
    return {
        width: 0,
        height: 0,
        style: {},
        getContext(type) { return contexts[type] || null; },
        _context: context
    };
}

function createFakeHost() {
    return {
        children: [],
        appendChild(child) { this.children.push(child); },
        removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
    };
}

// Capability checks have no DOM requirement and use a fresh probe per context.
const capabilities = detectRendererCapabilities({
    createCanvas: () => createFakeCanvas({
        '2d': {},
        webgl2: {},
        webgl: {}
    }),
    navigatorLike: { gpu: {}, deviceMemory: 8, hardwareConcurrency: 12 },
    matchMedia: query => ({ matches: query.includes('reduce') }),
    devicePixelRatio: 3
});
assert.deepEqual(capabilities, {
    canvas2d: true,
    webgl2: true,
    webgl1: true,
    webgpu: true,
    prefersReducedMotion: true,
    devicePixelRatio: 3,
    deviceMemory: 8,
    hardwareConcurrency: 12
});

// Immutable submission is detached from the mutable source object.
const mutableScene = { revision: 7, interaction: { candidates: [{ q: 1, r: 2 }] } };
const immutableScene = createImmutableRenderValue(mutableScene);
mutableScene.interaction.candidates[0].q = 99;
assert.equal(immutableScene.interaction.candidates[0].q, 1);
assert.equal(Object.isFrozen(immutableScene.interaction.candidates[0]), true);
assert.throws(() => createImmutableRenderValue({ bad: new Map() }), /plain object or array/);

// Reduced motion and the low profile freeze animation time while retaining a frame.
const reducedPolicy = resolveRenderPolicy({
    performanceProfile: PERFORMANCE_PROFILE.HIGH
}, capabilities);
assert.equal(reducedPolicy.profile, PERFORMANCE_PROFILE.HIGH);
assert.equal(reducedPolicy.pixelRatio, 2);
assert.equal(reducedPolicy.motionMode, 'static');
const lowPolicy = resolveRenderPolicy({
    performanceProfile: PERFORMANCE_PROFILE.LOW,
    reducedMotion: false,
    devicePixelRatio: 2
}, {});
assert.equal(lowPolicy.pixelRatio, 1);
assert.equal(lowPolicy.motionMode, 'static');

// No Pixi factory is a supported state: the facade selects Canvas without throwing.
const frames = [];
const fallbackEvents = [];
const canvasContext = {
    transforms: [],
    setTransform(...args) { this.transforms.push(args); }
};
const canvas = createFakeCanvas({ '2d': canvasContext });
const host = createFakeHost();
const boundary = createBattlefieldRenderer({
    preferredBackend: RENDERER_BACKEND.PIXI_WEBGL,
    capabilities,
    performanceProfile: PERFORMANCE_PROFILE.BALANCED,
    onFallback: event => fallbackEvents.push(event),
    canvasOptions: {
        createCanvas: () => canvas,
        drawFrame: payload => frames.push(payload)
    }
});
await boundary.initialize(host, {
    viewport: { width: 320, height: 180, pixelRatio: 3 }
});
assert.equal(boundary.backend, RENDERER_BACKEND.CANVAS_2D);
assert.equal(boundary.lifecycle, RENDERER_LIFECYCLE.READY);
assert.equal(fallbackEvents[0].reason, 'factory-unavailable');
assert.equal(host.children[0], canvas);
assert.equal(canvas.width, 480);
assert.equal(canvas.height, 270);

const submittedScene = { revision: 8, interaction: { hoveredId: 'u-1' } };
const submittedEvent = { type: 'pulse', payload: { strength: 2 } };
boundary.syncScene(submittedScene);
boundary.enqueue(submittedEvent);
submittedScene.interaction.hoveredId = 'changed';
submittedEvent.payload.strength = 100;
boundary.render({ now: 120, delta: 16, frameId: 3 });
assert.equal(frames.length, 1);
assert.equal(frames[0].scene.interaction.hoveredId, 'u-1');
assert.equal(frames[0].events[0].payload.strength, 2);
assert.equal(frames[0].frame.motionEnabled, false);
assert.equal(frames[0].frame.motionNowMs, 0);
assert.equal(frames[0].policy.effects, 'reduced');

boundary.resize({ width: 200, height: 100, pixelRatio: 2 });
assert.equal(canvas.width, 300);
assert.equal(canvas.height, 150);
boundary.destroy();
assert.equal(boundary.lifecycle, RENDERER_LIFECYCLE.DESTROYED);
assert.equal(host.children.length, 0);
boundary.destroy();
assert.throws(() => boundary.render({}), /not ready/);

// Pixi initialization failures destroy the partial adapter and fall back.
let failedPixiDestroyed = false;
const fallbackCanvas = createFakeCanvas({
    '2d': { setTransform() {} }
});
const failedPixi = {
    async initialize() { throw new Error('synthetic WebGL init failure'); },
    syncScene() {},
    enqueue() {},
    resize() {},
    render() {},
    destroy() { failedPixiDestroyed = true; }
};
const initFailureBoundary = createBattlefieldRenderer({
    preferredBackend: RENDERER_BACKEND.PIXI_WEBGL,
    capabilities,
    pixiRendererFactory: async () => failedPixi,
    canvasOptions: { canvas: fallbackCanvas }
});
await initFailureBoundary.initialize(null, { width: 64, height: 32 });
assert.equal(failedPixiDestroyed, true);
assert.equal(initFailureBoundary.backend, RENDERER_BACKEND.CANVAS_2D);
initFailureBoundary.destroy();

// Runtime GPU failure hook replays the latest scene and unconsumed events.
const gpuFrames = [];
const fakePixi = {
    async initialize() {},
    syncScene(scene) { this.scene = scene; },
    enqueue(event) { this.event = event; },
    resize() {},
    render(frame) { gpuFrames.push(frame); },
    destroy() { this.destroyed = true; }
};
const recoveredFrames = [];
const recoveredCanvas = createFakeCanvas({ '2d': { setTransform() {} } });
const runtimeBoundary = createBattlefieldRenderer({
    preferredBackend: RENDERER_BACKEND.PIXI_WEBGL,
    capabilities,
    pixiRendererFactory: () => fakePixi,
    canvasOptions: {
        canvas: recoveredCanvas,
        drawFrame: payload => recoveredFrames.push(payload)
    }
});
await runtimeBoundary.initialize(null, { width: 80, height: 40 });
runtimeBoundary.syncScene({ revision: 9 });
runtimeBoundary.enqueue({ type: 'impact' });
assert.equal(await runtimeBoundary.fallbackToCanvas(new Error('context lost')), true);
assert.equal(runtimeBoundary.backend, RENDERER_BACKEND.CANVAS_2D);
runtimeBoundary.render({ nowMs: 30 });
assert.equal(recoveredFrames[0].scene.revision, 9);
assert.equal(recoveredFrames[0].events[0].type, 'impact');
runtimeBoundary.destroy();

// The concrete adapter also works directly with an externally owned canvas.
const externalCanvas = createFakeCanvas({ '2d': { setTransform() {} } });
const direct = new CanvasBattlefieldRenderer({ canvas: externalCanvas });
await direct.initialize(null, { width: 20, height: 10 });
direct.render({ nowMs: 1 });
direct.destroy();
assert.equal(externalCanvas.width > 0, true);

console.log('renderBackend tests passed');
