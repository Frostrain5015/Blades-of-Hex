import { RENDERER_BACKEND } from './renderBackend.js';

function defaultCanvasFactory(environment) {
    const documentLike = environment?.document;
    if (documentLike && typeof documentLike.createElement === 'function') {
        return () => documentLike.createElement('canvas');
    }
    const OffscreenCanvasLike = environment?.OffscreenCanvas;
    if (typeof OffscreenCanvasLike === 'function') {
        return () => new OffscreenCanvasLike(1, 1);
    }
    return null;
}

function canAcquireContext(createCanvas, contextNames) {
    if (typeof createCanvas !== 'function') return false;
    try {
        const probe = createCanvas();
        if (!probe || typeof probe.getContext !== 'function') return false;
        return contextNames.some(name => Boolean(probe.getContext(name)));
    } catch {
        return false;
    }
}

/**
 * Browser capability probing with every environment dependency injectable.
 * Importing this module in Node never reads document/window at module scope.
 */
export function detectRendererCapabilities(options = {}) {
    const environment = options.environment || globalThis;
    const createCanvas = options.createCanvas || defaultCanvasFactory(environment);
    const navigatorLike = options.navigatorLike || environment?.navigator || null;
    const matchMedia = options.matchMedia || environment?.matchMedia || null;

    let prefersReducedMotion = false;
    if (typeof matchMedia === 'function') {
        try {
            prefersReducedMotion = Boolean(matchMedia.call(environment, '(prefers-reduced-motion: reduce)')?.matches);
        } catch {
            prefersReducedMotion = false;
        }
    }

    return Object.freeze({
        canvas2d: canAcquireContext(createCanvas, ['2d']),
        webgl2: canAcquireContext(createCanvas, ['webgl2']),
        webgl1: canAcquireContext(createCanvas, ['webgl', 'experimental-webgl']),
        webgpu: Boolean(navigatorLike?.gpu),
        prefersReducedMotion,
        devicePixelRatio: Math.max(1, Number(options.devicePixelRatio ?? environment?.devicePixelRatio) || 1),
        deviceMemory: Math.max(0, Number(options.deviceMemory ?? navigatorLike?.deviceMemory) || 0),
        hardwareConcurrency: Math.max(0, Number(options.hardwareConcurrency ?? navigatorLike?.hardwareConcurrency) || 0)
    });
}

export function rendererBackendSupported(backend, capabilities = {}) {
    switch (backend) {
        case RENDERER_BACKEND.CANVAS_2D:
            return Boolean(capabilities.canvas2d);
        case RENDERER_BACKEND.PIXI_WEBGL:
            return Boolean(capabilities.webgl2 || capabilities.webgl1);
        case RENDERER_BACKEND.PIXI_WEBGPU:
            return Boolean(capabilities.webgpu);
        default:
            return false;
    }
}

/** WebGPU is never selected by auto; it remains an explicit experiment. */
export function getRendererPreferenceOrder(preferredBackend = 'auto', options = {}) {
    const allowExperimentalWebGPU = Boolean(options.allowExperimentalWebGPU);
    switch (preferredBackend) {
        case RENDERER_BACKEND.CANVAS_2D:
            return Object.freeze([RENDERER_BACKEND.CANVAS_2D]);
        case RENDERER_BACKEND.PIXI_WEBGL:
            return Object.freeze([RENDERER_BACKEND.PIXI_WEBGL, RENDERER_BACKEND.CANVAS_2D]);
        case RENDERER_BACKEND.PIXI_WEBGPU:
            return Object.freeze(allowExperimentalWebGPU
                ? [RENDERER_BACKEND.PIXI_WEBGPU, RENDERER_BACKEND.PIXI_WEBGL, RENDERER_BACKEND.CANVAS_2D]
                : [RENDERER_BACKEND.PIXI_WEBGL, RENDERER_BACKEND.CANVAS_2D]);
        case 'auto':
            return Object.freeze([RENDERER_BACKEND.PIXI_WEBGL, RENDERER_BACKEND.CANVAS_2D]);
        default:
            throw new TypeError(`Unknown renderer backend preference: ${preferredBackend}`);
    }
}

export function createCanvasElementFactory(environment = globalThis) {
    return defaultCanvasFactory(environment);
}
