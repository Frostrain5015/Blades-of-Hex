import { createCanvasElementFactory, detectRendererCapabilities } from './capabilities.js';
import {
    PERFORMANCE_PROFILE,
    RENDERER_BACKEND,
    RENDERER_LIFECYCLE,
    createImmutableRenderValue,
    normalizeRenderFrame,
    normalizeViewport,
    resolveRenderPolicy
} from './renderBackend.js';

function assertReady(renderer) {
    if (renderer.lifecycle !== RENDERER_LIFECYCLE.READY) {
        throw new Error(`CanvasBattlefieldRenderer is not ready (state: ${renderer.lifecycle})`);
    }
}

function resolveInitialViewport(canvas, options, policy) {
    if (options.viewport) return normalizeViewport(options.viewport, policy);
    const ratio = policy.pixelRatio || 1;
    const width = Number(options.width ?? options.logicalWidth ?? canvas?.width / ratio) || 1;
    const height = Number(options.height ?? options.logicalHeight ?? canvas?.height / ratio) || 1;
    return normalizeViewport({ width, height, pixelRatio: ratio }, policy);
}

/**
 * Canvas2D implementation of the backend contract. Existing renderer.js can be
 * injected through drawFrame during the migration; this adapter owns lifecycle,
 * immutable scene/event delivery, sizing and motion policy only.
 */
export class CanvasBattlefieldRenderer {
    constructor(options = {}) {
        this.backend = RENDERER_BACKEND.CANVAS_2D;
        this.lifecycle = RENDERER_LIFECYCLE.NEW;
        this._environment = options.environment || globalThis;
        this._providedCanvas = options.canvas || null;
        this._providedContext = options.context || null;
        this._createCanvas = options.createCanvas || createCanvasElementFactory(this._environment);
        this._drawFrame = typeof options.drawFrame === 'function' ? options.drawFrame : () => {};
        this._onInitialize = typeof options.onInitialize === 'function' ? options.onInitialize : null;
        this._onScene = typeof options.onScene === 'function' ? options.onScene : null;
        this._onResize = typeof options.onResize === 'function' ? options.onResize : null;
        this._onDestroy = typeof options.onDestroy === 'function' ? options.onDestroy : null;
        this._performanceProfile = options.performanceProfile || PERFORMANCE_PROFILE.AUTO;
        this._reducedMotion = options.reducedMotion;
        this._capabilities = options.capabilities || null;
        this._canvas = null;
        this._context = null;
        this._host = null;
        this._ownsCanvas = false;
        this._attachedCanvas = false;
        this._scene = null;
        this._events = [];
        this._viewport = null;
        this._policy = null;
    }

    get canvas() { return this._canvas; }
    get context() { return this._context; }
    get scene() { return this._scene; }
    get viewport() { return this._viewport; }
    get policy() { return this._policy; }
    get capabilities() { return this._capabilities; }

    async initialize(host = null, options = {}) {
        if (this.lifecycle !== RENDERER_LIFECYCLE.NEW) {
            throw new Error(`CanvasBattlefieldRenderer cannot initialize from state: ${this.lifecycle}`);
        }
        this.lifecycle = RENDERER_LIFECYCLE.INITIALIZING;

        try {
            this._host = host;
            const hostIsCanvas = Boolean(host && typeof host.getContext === 'function');
            this._canvas = options.canvas || this._providedCanvas || (hostIsCanvas ? host : null);
            if (!this._canvas) {
                if (typeof this._createCanvas !== 'function') {
                    throw new Error('Canvas2D backend requires a canvas or an injected createCanvas factory');
                }
                this._canvas = this._createCanvas();
                this._ownsCanvas = true;
            }
            if (!this._canvas || typeof this._canvas.getContext !== 'function') {
                throw new TypeError('Canvas2D backend received an invalid canvas');
            }

            this._context = options.context || this._providedContext || this._canvas.getContext('2d');
            if (!this._context) throw new Error('Canvas2D context is unavailable');

            if (this._ownsCanvas && host && typeof host.appendChild === 'function') {
                host.appendChild(this._canvas);
                this._attachedCanvas = true;
            }

            this._capabilities = this._capabilities || detectRendererCapabilities({
                environment: this._environment,
                createCanvas: this._createCanvas || (() => this._canvas)
            });
            this._policy = resolveRenderPolicy({
                performanceProfile: options.performanceProfile || this._performanceProfile,
                reducedMotion: options.reducedMotion ?? this._reducedMotion,
                paused: options.paused,
                devicePixelRatio: options.devicePixelRatio
            }, this._capabilities);
            this._viewport = resolveInitialViewport(this._canvas, options, this._policy);
            this._applyViewport(this._viewport);

            if (this._onInitialize) {
                await this._onInitialize(Object.freeze({
                    backend: this.backend,
                    canvas: this._canvas,
                    context: this._context,
                    viewport: this._viewport,
                    policy: this._policy,
                    capabilities: this._capabilities
                }));
            }
            this.lifecycle = RENDERER_LIFECYCLE.READY;
        } catch (error) {
            this._removeOwnedCanvas();
            this._canvas = null;
            this._context = null;
            this.lifecycle = RENDERER_LIFECYCLE.NEW;
            throw error;
        }
    }

    syncScene(snapshot) {
        assertReady(this);
        this._scene = createImmutableRenderValue(snapshot, 'battlefieldScene');
        this._onScene?.(this._scene);
    }

    enqueue(event) {
        assertReady(this);
        this._events.push(createImmutableRenderValue(event, 'battlefieldVisualEvent'));
    }

    resize(viewport) {
        assertReady(this);
        this._viewport = normalizeViewport(viewport, this._policy);
        this._applyViewport(this._viewport);
        this._onResize?.(this._viewport);
    }

    render(frame = {}) {
        assertReady(this);
        const normalizedFrame = normalizeRenderFrame(frame, this._policy);
        const events = Object.freeze(this._events.slice());
        const result = this._drawFrame(Object.freeze({
            backend: this.backend,
            canvas: this._canvas,
            context: this._context,
            scene: this._scene,
            events,
            viewport: this._viewport,
            frame: normalizedFrame,
            policy: this._policy
        }));
        this._events.splice(0, events.length);
        return result;
    }

    destroy() {
        if (this.lifecycle === RENDERER_LIFECYCLE.DESTROYED) return;
        const payload = Object.freeze({
            backend: this.backend,
            canvas: this._canvas,
            context: this._context
        });
        try {
            this._onDestroy?.(payload);
        } finally {
            this._events.length = 0;
            this._scene = null;
            this._removeOwnedCanvas();
            this._canvas = null;
            this._context = null;
            this._host = null;
            this.lifecycle = RENDERER_LIFECYCLE.DESTROYED;
        }
    }

    _applyViewport(viewport) {
        const backingWidth = Math.max(1, Math.round(viewport.width * viewport.pixelRatio));
        const backingHeight = Math.max(1, Math.round(viewport.height * viewport.pixelRatio));
        this._canvas.width = backingWidth;
        this._canvas.height = backingHeight;
        if (this._canvas.style) {
            this._canvas.style.width = `${viewport.width}px`;
            this._canvas.style.height = `${viewport.height}px`;
        }
        if (typeof this._context.setTransform === 'function') {
            this._context.setTransform(viewport.pixelRatio, 0, 0, viewport.pixelRatio, 0, 0);
        }
    }

    _removeOwnedCanvas() {
        if (!this._ownsCanvas || !this._canvas) return;
        if (this._attachedCanvas && this._host && typeof this._host.removeChild === 'function') {
            try { this._host.removeChild(this._canvas); } catch {}
        } else if (this._attachedCanvas && typeof this._canvas.remove === 'function') {
            try { this._canvas.remove(); } catch {}
        }
        this._attachedCanvas = false;
    }
}
