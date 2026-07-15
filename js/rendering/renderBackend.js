// Backend-neutral contracts for the battlefield renderer migration.
// This module is deliberately DOM-free so rules, tests and server-side tools can
// import the DTO helpers without creating a canvas or touching browser globals.

export const RENDERER_BACKEND = Object.freeze({
    CANVAS_2D: 'canvas2d',
    PIXI_WEBGL: 'pixi-webgl',
    PIXI_WEBGPU: 'pixi-webgpu'
});

export const RENDERER_LIFECYCLE = Object.freeze({
    NEW: 'new',
    INITIALIZING: 'initializing',
    READY: 'ready',
    DESTROYED: 'destroyed'
});

export const PERFORMANCE_PROFILE = Object.freeze({
    AUTO: 'auto',
    HIGH: 'high',
    BALANCED: 'balanced',
    LOW: 'low'
});

const PROFILE_PRESETS = Object.freeze({
    [PERFORMANCE_PROFILE.HIGH]: Object.freeze({
        maxPixelRatio: 2,
        effects: 'full',
        targetFps: 60,
        freezesMotion: false
    }),
    [PERFORMANCE_PROFILE.BALANCED]: Object.freeze({
        maxPixelRatio: 1.5,
        effects: 'reduced',
        targetFps: 60,
        freezesMotion: false
    }),
    [PERFORMANCE_PROFILE.LOW]: Object.freeze({
        maxPixelRatio: 1,
        effects: 'minimal',
        targetFps: 30,
        freezesMotion: true
    })
});

const immutableRoots = new WeakSet();

function pathForProperty(path, property) {
    return /^[A-Za-z_$][\w$]*$/.test(property)
        ? `${path}.${property}`
        : `${path}[${JSON.stringify(property)}]`;
}

// Error paths reconstruct the offending DTO path from the frame stack, so the
// hot path never allocates path strings (this clone runs on every scene sync).
function renderPathFromFrames(root, frames) {
    let path = root;
    for (const frame of frames) {
        path = typeof frame === 'number' ? `${path}[${frame}]` : pathForProperty(path, frame);
    }
    return path;
}

function clonePlainRenderValue(value, root, frames, ancestors) {
    if (value === null || value === undefined) return value;

    const kind = typeof value;
    if (kind === 'string' || kind === 'boolean' || kind === 'bigint') return value;
    if (kind === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError(`${renderPathFromFrames(root, frames)} must contain only finite numbers`);
        }
        return value;
    }
    if (kind === 'function' || kind === 'symbol') {
        throw new TypeError(`${renderPathFromFrames(root, frames)} is not a serializable render DTO value`);
    }
    if (kind !== 'object') return value;

    if (ancestors.has(value)) {
        throw new TypeError(`${renderPathFromFrames(root, frames)} contains a cyclic reference`);
    }
    ancestors.add(value);

    let copy;
    if (Array.isArray(value)) {
        copy = new Array(value.length);
        for (let index = 0; index < value.length; index += 1) {
            frames.push(index);
            copy[index] = clonePlainRenderValue(value[index], root, frames, ancestors);
            frames.pop();
        }
    } else {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`${renderPathFromFrames(root, frames)} must be a plain object or array`);
        }
        if (Object.getOwnPropertySymbols(value).length) {
            throw new TypeError(`${renderPathFromFrames(root, frames)} must not contain symbol-keyed properties`);
        }

        copy = Object.create(prototype === null ? null : Object.prototype);
        for (const property of Object.keys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, property);
            if (descriptor?.get || descriptor?.set) {
                frames.push(property);
                throw new TypeError(`${renderPathFromFrames(root, frames)} must not be an accessor`);
            }
            frames.push(property);
            const cloned = clonePlainRenderValue(value[property], root, frames, ancestors);
            // Plain assignment of a literal "__proto__" key would rewrite the
            // prototype instead of creating an own property.
            if (property === '__proto__') {
                Object.defineProperty(copy, property, {
                    value: cloned, enumerable: true, configurable: true, writable: true
                });
            } else {
                copy[property] = cloned;
            }
            frames.pop();
        }
    }

    ancestors.delete(value);
    Object.freeze(copy);
    return copy;
}

/**
 * Detach a renderer DTO from mutable game state and recursively freeze it.
 * DTOs are intentionally JSON-like: plain objects, arrays and primitives only.
 * Already-produced roots are returned as-is, avoiding duplicate copies when the
 * backend facade hands a snapshot to a concrete adapter.
 */
export function createImmutableRenderValue(value, label = 'renderDto') {
    if (value && typeof value === 'object' && immutableRoots.has(value)) return value;
    const copy = clonePlainRenderValue(value, label, [], new WeakSet());
    if (copy && typeof copy === 'object') immutableRoots.add(copy);
    return copy;
}

export function isImmutableRenderValue(value) {
    return Boolean(value && typeof value === 'object' && immutableRoots.has(value));
}

function finiteOr(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function inferAutoProfile(capabilities = {}) {
    const memory = finiteOr(capabilities.deviceMemory, 0);
    const cores = finiteOr(capabilities.hardwareConcurrency, 0);
    if ((memory > 0 && memory <= 4) || (cores > 0 && cores <= 4)) {
        return PERFORMANCE_PROFILE.LOW;
    }
    if (memory >= 8 && cores >= 8) return PERFORMANCE_PROFILE.HIGH;
    return PERFORMANCE_PROFILE.BALANCED;
}

/** Resolve DPR/effects/motion once at the backend boundary. */
export function resolveRenderPolicy(options = {}, capabilities = {}) {
    const requested = options.performanceProfile || PERFORMANCE_PROFILE.AUTO;
    if (!Object.values(PERFORMANCE_PROFILE).includes(requested)) {
        throw new TypeError(`Unknown performance profile: ${requested}`);
    }

    const profile = requested === PERFORMANCE_PROFILE.AUTO
        ? inferAutoProfile(capabilities)
        : requested;
    const preset = PROFILE_PRESETS[profile];
    const reducedMotion = options.reducedMotion === undefined
        ? Boolean(capabilities.prefersReducedMotion)
        : Boolean(options.reducedMotion);
    const paused = Boolean(options.paused);
    const motionMode = reducedMotion || paused || preset.freezesMotion ? 'static' : 'full';
    const requestedPixelRatio = Math.max(1, finiteOr(
        options.devicePixelRatio,
        finiteOr(capabilities.devicePixelRatio, 1)
    ));

    return Object.freeze({
        requestedProfile: requested,
        profile,
        maxPixelRatio: preset.maxPixelRatio,
        pixelRatio: Math.min(requestedPixelRatio, preset.maxPixelRatio),
        effects: preset.effects,
        targetFps: preset.targetFps,
        motionMode,
        reducedMotion,
        paused
    });
}

export function normalizeViewport(viewport = {}, policy = resolveRenderPolicy()) {
    const width = finiteOr(viewport.width ?? viewport.logicalWidth, 0);
    const height = finiteOr(viewport.height ?? viewport.logicalHeight, 0);
    if (width <= 0 || height <= 0) {
        throw new TypeError('viewport width and height must be positive finite numbers');
    }
    const requestedPixelRatio = Math.max(1, finiteOr(
        viewport.pixelRatio ?? viewport.devicePixelRatio,
        policy.pixelRatio
    ));
    return Object.freeze({
        width,
        height,
        pixelRatio: Math.min(requestedPixelRatio, policy.maxPixelRatio)
    });
}

export function normalizeRenderFrame(frame = {}, policy = resolveRenderPolicy()) {
    const nowMs = finiteOr(frame.nowMs ?? frame.now, 0);
    const deltaMs = Math.max(0, finiteOr(frame.deltaMs ?? frame.delta, 0));
    const frameId = Math.max(0, Math.trunc(finiteOr(frame.frameId, 0)));
    const interpolation = Math.max(0, Math.min(1, finiteOr(frame.interpolation, 1)));
    const motionEnabled = policy.motionMode === 'full';
    return Object.freeze({
        nowMs,
        deltaMs,
        frameId,
        interpolation,
        motionEnabled,
        motionNowMs: motionEnabled ? nowMs : 0,
        motionDeltaMs: motionEnabled ? deltaMs : 0
    });
}

export function assertBattlefieldRenderer(renderer, label = 'renderer') {
    if (!renderer || typeof renderer !== 'object') {
        throw new TypeError(`${label} must be an object`);
    }
    for (const method of ['initialize', 'syncScene', 'enqueue', 'resize', 'render', 'destroy']) {
        if (typeof renderer[method] !== 'function') {
            throw new TypeError(`${label}.${method} must be a function`);
        }
    }
    return renderer;
}
