import assert from 'node:assert/strict';
import {
    PERFORMANCE_PROFILE,
    RENDERER_BACKEND,
    RENDERER_LIFECYCLE,
    createBattlefieldRenderer,
    createImmutableRenderValue,
    detectRendererCapabilities,
    getRendererPreferenceOrder,
    rendererBackendSupported,
    resolveRenderPolicy
} from '../js/rendering/index.js';

function createFakeCanvas(contexts = {}) {
    return { getContext(type) { return contexts[type] || null; } };
}

function createFakeRenderer(options = {}) {
    return {
        lifecycle: RENDERER_LIFECYCLE.NEW,
        scenes: [],
        events: [],
        frames: [],
        async initialize(host, initOptions) {
            this.host = host;
            this.initOptions = initOptions;
            if (options.failInitialization) throw new Error('synthetic backend init failure');
            this.lifecycle = RENDERER_LIFECYCLE.READY;
        },
        syncScene(scene) { this.scenes.push(scene); },
        enqueue(event) { this.events.push(event); },
        resize(viewport) { this.viewport = viewport; return viewport; },
        render(frame) { this.frames.push(frame); return { rendered: options.rendered !== false }; },
        destroy() { this.destroyed = true; this.lifecycle = RENDERER_LIFECYCLE.DESTROYED; }
    };
}

// Capability checks remain environment-neutral. Canvas2D is still detected
// because the hybrid renderer uses it for auxiliary layers, not as a backend.
const capabilities = detectRendererCapabilities({
    createCanvas: () => createFakeCanvas({ '2d': {}, webgl2: {}, webgl: {} }),
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
assert.equal(rendererBackendSupported(RENDERER_BACKEND.PIXI_WEBGL, capabilities), true);
assert.equal(rendererBackendSupported('canvas2d', capabilities), false);
assert.deepEqual(getRendererPreferenceOrder('auto'), [RENDERER_BACKEND.PIXI_WEBGL]);
assert.deepEqual(
    getRendererPreferenceOrder(RENDERER_BACKEND.PIXI_WEBGPU, { allowExperimentalWebGPU: true }),
    [RENDERER_BACKEND.PIXI_WEBGPU, RENDERER_BACKEND.PIXI_WEBGL]
);
assert.throws(() => getRendererPreferenceOrder('canvas2d'), /Unknown renderer backend/);

const mutableScene = { revision: 7, interaction: { candidates: [{ q: 1, r: 2 }] } };
const immutableScene = createImmutableRenderValue(mutableScene);
mutableScene.interaction.candidates[0].q = 99;
assert.equal(immutableScene.interaction.candidates[0].q, 1);
assert.equal(Object.isFrozen(immutableScene.interaction.candidates[0]), true);
assert.throws(() => createImmutableRenderValue({ bad: new Map() }), /plain object or array/);

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

// The boundary knows only backend ids and registered factories. It can select
// another registered engine without importing a concrete renderer module.
const backendFailures = [];
const fakeWebglRenderer = createFakeRenderer();
const boundary = createBattlefieldRenderer({
    preferredBackend: RENDERER_BACKEND.PIXI_WEBGPU,
    allowExperimentalWebGPU: true,
    capabilities,
    rendererFactories: new Map([
        [RENDERER_BACKEND.PIXI_WEBGL, () => fakeWebglRenderer]
    ]),
    onBackendFailure: failure => backendFailures.push(failure)
});
await boundary.initialize({ id: 'host' }, { width: 320, height: 180 });
assert.equal(boundary.backend, RENDERER_BACKEND.PIXI_WEBGL);
assert.equal(boundary.lifecycle, RENDERER_LIFECYCLE.READY);
assert.equal(backendFailures[0].backend, RENDERER_BACKEND.PIXI_WEBGPU);
assert.equal(backendFailures[0].reason, 'factory-unavailable');

const scene = { revision: 8, interaction: { hoveredId: 'u-1' } };
const event = { type: 'pulse', payload: { strength: 2 } };
boundary.syncScene(scene);
boundary.enqueue(event);
scene.interaction.hoveredId = 'changed';
event.payload.strength = 100;
boundary.render({ nowMs: 120, deltaMs: 16, frameId: 3 });
assert.equal(fakeWebglRenderer.scenes[0].interaction.hoveredId, 'u-1');
assert.equal(fakeWebglRenderer.events[0].payload.strength, 2);
boundary.resize({ width: 200, height: 100, pixelRatio: 2 });
assert.equal(fakeWebglRenderer.viewport.width, 200);
boundary.destroy();
assert.equal(boundary.lifecycle, RENDERER_LIFECYCLE.DESTROYED);
assert.equal(fakeWebglRenderer.destroyed, true);
boundary.destroy();
assert.throws(() => boundary.render({}), /not ready/);

// A failed or missing production backend now fails closed; it never creates a
// hidden full-canvas renderer.
const failedRenderer = createFakeRenderer({ failInitialization: true });
const failedBoundary = createBattlefieldRenderer({
    preferredBackend: RENDERER_BACKEND.PIXI_WEBGL,
    capabilities,
    rendererFactories: {
        [RENDERER_BACKEND.PIXI_WEBGL]: () => failedRenderer
    }
});
await assert.rejects(
    failedBoundary.initialize(null, { width: 64, height: 32 }),
    /No battlefield renderer backend/
);
assert.equal(failedRenderer.destroyed, true);
assert.equal(failedBoundary.lifecycle, RENDERER_LIFECYCLE.NEW);

const missingBoundary = createBattlefieldRenderer({
    preferredBackend: RENDERER_BACKEND.PIXI_WEBGL,
    capabilities,
    rendererFactories: new Map()
});
await assert.rejects(
    missingBoundary.initialize(null, { width: 64, height: 32 }),
    /No battlefield renderer backend/
);

console.log('renderBackend tests passed');
