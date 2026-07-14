import { CanvasBattlefieldRenderer } from './CanvasBattlefieldRenderer.js';
import {
    detectRendererCapabilities,
    getRendererPreferenceOrder,
    rendererBackendSupported
} from './capabilities.js';
import {
    RENDERER_BACKEND,
    RENDERER_LIFECYCLE,
    assertBattlefieldRenderer,
    createImmutableRenderValue
} from './renderBackend.js';

function fallbackRecord(from, reason, error = null) {
    return Object.freeze({
        from,
        to: RENDERER_BACKEND.CANVAS_2D,
        reason,
        error: error || null
    });
}

/**
 * Stable facade for selecting a backend. Pixi is supplied as a factory later,
 * so this file never imports pixi.js. Missing/unsupported/failing Pixi safely
 * resolves to the legacy Canvas2D adapter.
 */
export class BattlefieldRendererBoundary {
    constructor(options = {}) {
        this.lifecycle = RENDERER_LIFECYCLE.NEW;
        this._options = options;
        this._preferredBackend = options.preferredBackend || 'auto';
        this._capabilities = options.capabilities || detectRendererCapabilities(options.capabilityOptions);
        this._pixiRendererFactory = options.pixiRendererFactory || null;
        this._canvasRendererFactory = options.canvasRendererFactory
            || (() => new CanvasBattlefieldRenderer({
                ...(options.canvasOptions || {}),
                capabilities: this._capabilities,
                performanceProfile: options.performanceProfile,
                reducedMotion: options.reducedMotion
            }));
        this._onFallback = typeof options.onFallback === 'function' ? options.onFallback : null;
        this._renderer = null;
        this._backend = null;
        this._host = null;
        this._initializeOptions = null;
        this._scene = null;
        this._pendingEvents = [];
        this._runtimeFallbackPromise = null;
    }

    get backend() { return this._backend; }
    get capabilities() { return this._capabilities; }
    get policy() { return this._renderer?.policy || null; }
    get renderer() { return this._renderer; }

    async initialize(host = null, options = {}) {
        if (this.lifecycle !== RENDERER_LIFECYCLE.NEW) {
            throw new Error(`BattlefieldRendererBoundary cannot initialize from state: ${this.lifecycle}`);
        }
        this.lifecycle = RENDERER_LIFECYCLE.INITIALIZING;
        this._host = host;
        this._initializeOptions = { ...options };

        const candidates = getRendererPreferenceOrder(this._preferredBackend, {
            allowExperimentalWebGPU: this._options.allowExperimentalWebGPU
        });
        let lastError = null;

        for (const backend of candidates) {
            if (backend !== RENDERER_BACKEND.CANVAS_2D) {
                if (!this._pixiRendererFactory) {
                    this._onFallback?.(fallbackRecord(backend, 'factory-unavailable'));
                    continue;
                }
                if (!rendererBackendSupported(backend, this._capabilities)) {
                    this._onFallback?.(fallbackRecord(backend, 'capability-unavailable'));
                    continue;
                }
            }

            let candidate = null;
            try {
                candidate = backend === RENDERER_BACKEND.CANVAS_2D
                    ? await this._canvasRendererFactory({ backend, capabilities: this._capabilities })
                    : await this._pixiRendererFactory({ backend, capabilities: this._capabilities });
                assertBattlefieldRenderer(candidate, `${backend} renderer`);
                await candidate.initialize(host, {
                    ...options,
                    backend,
                    performanceProfile: options.performanceProfile || this._options.performanceProfile,
                    reducedMotion: options.reducedMotion ?? this._options.reducedMotion
                });
                this._renderer = candidate;
                this._backend = backend;
                this.lifecycle = RENDERER_LIFECYCLE.READY;
                return;
            } catch (error) {
                lastError = error;
                try { candidate?.destroy?.(); } catch {}
                if (backend !== RENDERER_BACKEND.CANVAS_2D) {
                    this._onFallback?.(fallbackRecord(backend, 'initialization-failed', error));
                    continue;
                }
            }
        }

        this.lifecycle = RENDERER_LIFECYCLE.NEW;
        const error = new Error('No battlefield renderer backend could be initialized');
        if (lastError) error.cause = lastError;
        throw error;
    }

    syncScene(snapshot) {
        this._assertReady();
        this._scene = createImmutableRenderValue(snapshot, 'battlefieldScene');
        this._renderer.syncScene(this._scene);
    }

    enqueue(event) {
        this._assertReady();
        const immutableEvent = createImmutableRenderValue(event, 'battlefieldVisualEvent');
        this._pendingEvents.push(immutableEvent);
        this._renderer.enqueue(immutableEvent);
    }

    resize(viewport) {
        this._assertReady();
        return this._renderer.resize(viewport);
    }

    render(frame = {}) {
        this._assertReady();
        const result = this._renderer.render(frame);
        // A GPU adapter deliberately reports `rendered: false` while its
        // context is unavailable. Keep boundary-level events in that case so
        // the Canvas fallback can replay them instead of silently dropping the
        // effect between context loss and the async backend hand-off.
        if (result?.rendered !== false) this._pendingEvents.length = 0;
        return result;
    }

    /** Explicit hook for context-lost/resource failures reported by a GPU adapter. */
    async fallbackToCanvas(error, reason = 'runtime-failed') {
        if (this._runtimeFallbackPromise) return this._runtimeFallbackPromise;
        this._assertReady();
        if (this._backend === RENDERER_BACKEND.CANVAS_2D) return false;

        const fallbackPromise = this._performFallbackToCanvas(error, reason);
        this._runtimeFallbackPromise = fallbackPromise;
        try {
            return await fallbackPromise;
        } finally {
            if (this._runtimeFallbackPromise === fallbackPromise) {
                this._runtimeFallbackPromise = null;
            }
        }
    }

    async _performFallbackToCanvas(error, reason) {
        const failedBackend = this._backend;
        try { this._renderer.destroy(); } catch {}
        this._renderer = null;
        this._backend = null;
        this.lifecycle = RENDERER_LIFECYCLE.INITIALIZING;

        let canvasRenderer = null;
        try {
            canvasRenderer = await this._canvasRendererFactory({
                backend: RENDERER_BACKEND.CANVAS_2D,
                capabilities: this._capabilities
            });
            // A settings change may destroy this boundary while the async
            // fallback factory is resolving. Never resurrect that stale
            // boundary or attach a second canvas after it has been replaced.
            if (this.lifecycle === RENDERER_LIFECYCLE.DESTROYED) {
                try { canvasRenderer?.destroy?.(); } catch {}
                return false;
            }
            assertBattlefieldRenderer(canvasRenderer, 'canvas2d renderer');
            await canvasRenderer.initialize(this._host, {
                ...this._initializeOptions,
                backend: RENDERER_BACKEND.CANVAS_2D,
                performanceProfile: this._initializeOptions?.performanceProfile || this._options.performanceProfile,
                reducedMotion: this._initializeOptions?.reducedMotion ?? this._options.reducedMotion
            });
            if (this.lifecycle === RENDERER_LIFECYCLE.DESTROYED) {
                try { canvasRenderer.destroy(); } catch {}
                return false;
            }
            if (this._scene) canvasRenderer.syncScene(this._scene);
            for (const event of this._pendingEvents) canvasRenderer.enqueue(event);
            this._renderer = canvasRenderer;
            this._backend = RENDERER_BACKEND.CANVAS_2D;
            this.lifecycle = RENDERER_LIFECYCLE.READY;
            this._onFallback?.(fallbackRecord(failedBackend, reason, error));
            return true;
        } catch (fallbackError) {
            try { canvasRenderer?.destroy?.(); } catch {}
            if (this.lifecycle === RENDERER_LIFECYCLE.DESTROYED) return false;
            this.lifecycle = RENDERER_LIFECYCLE.NEW;
            if (error && fallbackError.cause === undefined) fallbackError.cause = error;
            throw fallbackError;
        }
    }

    destroy() {
        if (this.lifecycle === RENDERER_LIFECYCLE.DESTROYED) return;
        try { this._renderer?.destroy(); } finally {
            this._renderer = null;
            this._backend = null;
            this._scene = null;
            this._pendingEvents.length = 0;
            this._host = null;
            this._initializeOptions = null;
            this._runtimeFallbackPromise = null;
            this.lifecycle = RENDERER_LIFECYCLE.DESTROYED;
        }
    }

    _assertReady() {
        if (this.lifecycle !== RENDERER_LIFECYCLE.READY || !this._renderer) {
            throw new Error(`BattlefieldRendererBoundary is not ready (state: ${this.lifecycle})`);
        }
    }
}

export function createBattlefieldRenderer(options = {}) {
    return new BattlefieldRendererBoundary(options);
}
