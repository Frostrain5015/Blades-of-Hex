import {
    detectRendererCapabilities,
    getRendererPreferenceOrder,
    rendererBackendSupported
} from './capabilities.js';
import {
    RENDERER_LIFECYCLE,
    assertBattlefieldRenderer,
    createImmutableRenderValue
} from './renderBackend.js';

function backendFailureRecord(backend, reason, error = null) {
    return Object.freeze({
        backend,
        reason,
        error: error || null
    });
}

function normalizeRendererFactories(factories) {
    if (factories instanceof Map) return new Map(factories);
    if (!factories || typeof factories !== 'object') return new Map();
    return new Map(Object.entries(factories));
}

/**
 * Backend-neutral renderer facade. Concrete engines are registered by backend
 * id and remain outside this module, so a future 3D adapter can implement the
 * same lifecycle without importing Pixi or changing game/rules code.
 */
export class BattlefieldRendererBoundary {
    constructor(options = {}) {
        this.lifecycle = RENDERER_LIFECYCLE.NEW;
        this._options = options;
        this._preferredBackend = options.preferredBackend || 'auto';
        this._capabilities = options.capabilities || detectRendererCapabilities(options.capabilityOptions);
        this._rendererFactories = normalizeRendererFactories(options.rendererFactories);
        this._onBackendFailure = typeof options.onBackendFailure === 'function'
            ? options.onBackendFailure
            : null;
        this._renderer = null;
        this._backend = null;
        this._scene = null;
        this._pendingEvents = [];
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

        const candidates = getRendererPreferenceOrder(this._preferredBackend, {
            allowExperimentalWebGPU: this._options.allowExperimentalWebGPU
        });
        let lastError = null;

        for (const backend of candidates) {
            const factory = this._rendererFactories.get(backend);
            if (typeof factory !== 'function') {
                this._onBackendFailure?.(backendFailureRecord(backend, 'factory-unavailable'));
                continue;
            }
            if (!rendererBackendSupported(backend, this._capabilities)) {
                this._onBackendFailure?.(backendFailureRecord(backend, 'capability-unavailable'));
                continue;
            }

            let candidate = null;
            try {
                candidate = await factory({ backend, capabilities: this._capabilities });
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
                this._onBackendFailure?.(backendFailureRecord(backend, 'initialization-failed', error));
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
        // Engines may pause while their graphics context is being restored.
        // Keep boundary-level events until a frame is actually presented.
        if (result?.rendered !== false) this._pendingEvents.length = 0;
        return result;
    }

    destroy() {
        if (this.lifecycle === RENDERER_LIFECYCLE.DESTROYED) return;
        try { this._renderer?.destroy(); } finally {
            this._renderer = null;
            this._backend = null;
            this._scene = null;
            this._pendingEvents.length = 0;
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
