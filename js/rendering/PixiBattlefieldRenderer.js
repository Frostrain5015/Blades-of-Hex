import {
    PERFORMANCE_PROFILE,
    RENDERER_BACKEND,
    RENDERER_LIFECYCLE,
    createImmutableRenderValue,
    normalizeRenderFrame,
    normalizeViewport,
    resolveRenderPolicy
} from './renderBackend.js';
import { createPixiSceneSnapshot } from './pixiSceneSnapshot.js';
import { resolveMovementTileReveal } from '../movementRegionAnimation.js';
import { getRangedPreviewTiming, sampleOperationRoute } from '../operationPreviewRenderer.js';

export const PIXI_BATTLEFIELD_LAYER_ORDER = Object.freeze([
    'surface',
    'terrainBack',
    'mapMarks',
    'interactionGround',
    'borders',
    'groundFx',
    'interactionRoute',
    'commanderBack',
    'units',
    'flags',
    'unitHud',
    'interactionTop',
    'skillFx',
    'fog',
    'screenFx'
]);

function assertReady(renderer) {
    if (renderer.lifecycle !== RENDERER_LIFECYCLE.READY) {
        throw new Error(`PixiBattlefieldRenderer is not ready (state: ${renderer.lifecycle})`);
    }
}

function resolveInitialViewport(options, policy) {
    if (options.viewport) return normalizeViewport(options.viewport, policy);
    return normalizeViewport({
        width: options.width ?? options.logicalWidth ?? 1,
        height: options.height ?? options.logicalHeight ?? 1,
        pixelRatio: options.pixelRatio ?? options.devicePixelRatio ?? policy.pixelRatio
    }, policy);
}

function drawPath(graphics, path, close = false) {
    if (!path.length) return;
    graphics.moveTo(path[0].x, path[0].y);
    for (let index = 1; index < path.length; index += 1) {
        graphics.lineTo(path[index].x, path[index].y);
    }
    if (close) graphics.closePath();
}

function drawArcPath(graphics, centerX, centerY, radius, startAngle, endAngle) {
    const sweep = Math.max(0, endAngle - startAngle);
    if (sweep <= 0 || radius <= 0) return false;
    const segments = Math.max(4, Math.ceil(sweep / (Math.PI / 24)));
    for (let index = 0; index <= segments; index++) {
        const angle = startAngle + sweep * index / segments;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        if (index === 0) graphics.moveTo(x, y);
        else graphics.lineTo(x, y);
    }
    return true;
}

const HEX_UNIT_VERTICES = Object.freeze(Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 3 * (index + 0.5);
    return Object.freeze({ x: Math.cos(angle), y: Math.sin(angle) });
}));

function drawHexagonPath(graphics, cx, cy, size) {
    graphics.moveTo(cx + HEX_UNIT_VERTICES[0].x * size, cy + HEX_UNIT_VERTICES[0].y * size);
    for (let index = 1; index < 6; index += 1) {
        graphics.lineTo(cx + HEX_UNIT_VERTICES[index].x * size, cy + HEX_UNIT_VERTICES[index].y * size);
    }
    graphics.closePath();
}

// Pixi v8 Graphics has no setLineDash: dashes are emitted as explicit
// sub-segments so marching-ants offsets stay identical to Canvas.
function drawDashedSegment(graphics, x0, y0, x1, y1, dash, gap, offset) {
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length <= 0.0001) return;
    const ux = (x1 - x0) / length;
    const uy = (y1 - y0) / length;
    const period = dash + gap;
    let position = -((offset % period) + period) % period;
    while (position < length) {
        const start = Math.max(0, position);
        const end = Math.min(length, position + dash);
        if (end > start) {
            graphics.moveTo(x0 + ux * start, y0 + uy * start);
            graphics.lineTo(x0 + ux * end, y0 + uy * end);
        }
        position += period;
    }
}

function drawDashedPolyline(graphics, points, dash, gap, offset) {
    let travelled = 0;
    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        drawDashedSegment(graphics, previous.x, previous.y, current.x, current.y, dash, gap, offset - travelled);
        travelled += Math.hypot(current.x - previous.x, current.y - previous.y);
    }
}

function drawDashedCircle(graphics, cx, cy, radius, dash, gap, offset) {
    const circumference = Math.PI * 2 * radius;
    const period = dash + gap;
    const count = Math.max(4, Math.floor(circumference / period));
    const anglePerUnit = Math.PI * 2 / circumference;
    for (let index = 0; index < count; index += 1) {
        const startLen = index * circumference / count + offset;
        const a0 = startLen * anglePerUnit;
        const a1 = (startLen + dash) * anglePerUnit;
        const segments = 4;
        for (let s = 0; s <= segments; s += 1) {
            const angle = a0 + (a1 - a0) * s / segments;
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;
            if (s === 0) graphics.moveTo(x, y);
            else graphics.lineTo(x, y);
        }
    }
}

// Clip an infinite hatch line to a circle so the Pixi origin marker matches
// Canvas's clipped diagonal hatching without a mask object.
function clipSegmentToCircle(x0, y0, x1, y1, cx, cy, radius) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const fx = x0 - cx;
    const fy = y0 - cy;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant <= 0 || a === 0) return null;
    const root = Math.sqrt(discriminant);
    const t0 = Math.max(0, (-b - root) / (2 * a));
    const t1 = Math.min(1, (-b + root) / (2 * a));
    if (t1 <= t0) return null;
    return {
        x0: x0 + dx * t0, y0: y0 + dy * t0,
        x1: x0 + dx * t1, y1: y0 + dy * t1
    };
}

function drawOriginHatching(graphics, marker, radius) {
    const invSqrt2 = Math.SQRT1_2;
    for (let offset = -radius + marker.hatchSpacing; offset < radius; offset += marker.hatchSpacing) {
        const halfLength = Math.sqrt(Math.max(0, radius * radius - offset * offset));
        const nx = invSqrt2 * offset;
        const ny = invSqrt2 * offset;
        const dx = invSqrt2 * halfLength;
        const dy = -invSqrt2 * halfLength;
        graphics.moveTo(marker.x + nx - dx, marker.y + ny - dy);
        graphics.lineTo(marker.x + nx + dx, marker.y + ny + dy);
    }
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function entryState(frame, descriptor) {
    if (!frame.motionEnabled || !descriptor.startedAtMs) return { alpha: 1, scale: 1 };
    const progress = clamp01(
        (frame.motionNowMs - descriptor.startedAtMs - (descriptor.delayMs || 0))
        / Math.max(1, descriptor.durationMs || 300)
    );
    const eased = 1 - Math.pow(1 - progress, 3);
    const overshoot = progress < 1
        ? Math.sin(progress * Math.PI) * (1 - progress) * 0.12
        : 0;
    return { alpha: eased, scale: 0.78 + eased * 0.22 + overshoot };
}

function exitAlpha(frame, descriptor) {
    if (!descriptor.endingStartedAtMs) return 1;
    if (!frame.motionEnabled) return 0;
    // Linear fade, matching Canvas _drawDeselectingActionPreview (1 - t/220).
    const progress = clamp01(
        (frame.motionNowMs - descriptor.endingStartedAtMs)
        / Math.max(1, descriptor.endingDurationMs || 220)
    );
    return 1 - progress;
}

function breatheAt(frame, phase = 0, periodMs = 1500) {
    if (!frame.motionEnabled) return 0.5;
    return (Math.sin(frame.motionNowMs / periodMs * Math.PI * 2 + phase) + 1) / 2;
}

function drawCornerFramePath(graphics, x, y, size) {
    const half = size / 2;
    const arm = size * 0.19;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        graphics.moveTo(x + sx * (half - arm), y + sy * half);
        graphics.lineTo(x + sx * half, y + sy * half);
        graphics.lineTo(x + sx * half, y + sy * (half - arm));
    }
}

function drawFrameMotif(graphics, frame, size, alphaValue) {
    const { x, y, color, motif } = frame;
    const stroke = (width = 1.5, alpha = alphaValue) => graphics.stroke({ color, alpha, width });
    if (motif === 'heal') {
        graphics.rect(x - size * 0.055, y - size * 0.19, size * 0.11, size * 0.38)
            .rect(x - size * 0.19, y - size * 0.055, size * 0.38, size * 0.11)
            .fill({ color, alpha: alphaValue * 0.88 });
        return;
    }
    if (motif === 'mobility') {
        for (const offset of [-size * 0.045, size * 0.115]) {
            graphics.moveTo(x - size * 0.14, y + offset);
            graphics.lineTo(x, y + offset - size * 0.13);
            graphics.lineTo(x + size * 0.14, y + offset);
        }
        stroke(size * 0.065, alphaValue * 0.88);
        return;
    }
    if (motif === 'shield') {
        graphics.moveTo(x, y - size * 0.2);
        graphics.lineTo(x + size * 0.16, y - size * 0.12);
        graphics.lineTo(x + size * 0.12, y + size * 0.1);
        graphics.lineTo(x, y + size * 0.22);
        graphics.lineTo(x - size * 0.12, y + size * 0.1);
        graphics.lineTo(x - size * 0.16, y - size * 0.12);
        graphics.closePath();
        stroke(size * 0.055, alphaValue * 0.86);
        return;
    }
    if (motif === 'deployment') {
        graphics.rect(x - size * 0.14, y - size * 0.02, size * 0.28, size * 0.19);
        graphics.moveTo(x - size * 0.18, y - size * 0.02);
        graphics.lineTo(x, y - size * 0.18);
        graphics.lineTo(x + size * 0.18, y - size * 0.02);
        stroke(size * 0.045, alphaValue * 0.82);
        return;
    }
    if (motif === 'transport') {
        graphics.circle(x, y - size * 0.06, size * 0.13);
        graphics.moveTo(x - size * 0.13, y - size * 0.06);
        graphics.lineTo(x, y + size * 0.16);
        graphics.lineTo(x + size * 0.13, y - size * 0.06);
        stroke(size * 0.045, alphaValue * 0.82);
        return;
    }
    if (motif === 'attach') {
        graphics.circle(x - size * 0.055, y, size * 0.105);
        graphics.circle(x + size * 0.055, y, size * 0.105);
        stroke(size * 0.04, alphaValue * 0.8);
        return;
    }

    const crossSize = motif === 'area' ? size * 0.15 : size * 0.19;
    graphics.moveTo(x - crossSize, y);
    graphics.lineTo(x + crossSize, y);
    graphics.moveTo(x, y - crossSize);
    graphics.lineTo(x, y + crossSize);
    stroke(size * (motif === 'area' ? 0.04 : 0.052), alphaValue * 0.9);
    if (motif === 'attack') {
        graphics.circle(x, y, size * 0.105).stroke({
            color,
            alpha: alphaValue * 0.62,
            width: size * 0.032
        });
    }
}

function drawCircularHatches(graphics, cell, reverse = false) {
    const radius = cell.radius;
    const invSqrt2 = Math.SQRT1_2;
    for (const factor of [-0.56, -0.28, 0, 0.28, 0.56]) {
        const offset = factor * radius;
        const halfLength = Math.sqrt(Math.max(0, radius * radius - offset * offset));
        const nx = invSqrt2 * offset;
        const ny = (reverse ? -invSqrt2 : invSqrt2) * offset;
        const dx = invSqrt2 * halfLength;
        const dy = (reverse ? invSqrt2 : -invSqrt2) * halfLength;
        graphics.moveTo(cell.x + nx - dx, cell.y + ny - dy);
        graphics.lineTo(cell.x + nx + dx, cell.y + ny + dy);
    }
}

function safeNotify(callback, error, payload, onNotificationError) {
    if (typeof callback !== 'function') return;
    try {
        const result = callback(error, payload);
        if (result && typeof result.then === 'function') {
            result.catch(notificationError => onNotificationError?.(notificationError));
        }
    } catch (notificationError) {
        onNotificationError?.(notificationError);
    }
}

function readApplicationCanvas(app) {
    if (!app) return null;
    try { return app.canvas || app.view || null; } catch { return null; }
}

// Returns `next` by reference when no exiting descriptor needs to be carried
// over, so callers can cheaply detect the no-op case and skip re-normalizing.
function mergeExitingDescriptors(previous = [], next = [], nowMs, fallbackDurationMs) {
    let merged = null;
    const nextIds = new Set(next.map(descriptor => descriptor.id));
    for (const descriptor of previous) {
        if (nextIds.has(descriptor.id)) continue;
        const endingStartedAtMs = descriptor.endingStartedAtMs || nowMs;
        const endingDurationMs = descriptor.endingDurationMs || fallbackDurationMs;
        if (nowMs - endingStartedAtMs >= endingDurationMs) continue;
        if (!merged) merged = [...next];
        merged.push({ ...descriptor, endingStartedAtMs, endingDurationMs });
    }
    return merged || next;
}

function descriptorStillAnimating(descriptor, nowMs) {
    if (!descriptor?.endingStartedAtMs) return true;
    return nowMs - descriptor.endingStartedAtMs < (descriptor.endingDurationMs || 220);
}

/**
 * Pixi v8 WebGL adapter for the battlefield backend boundary.
 *
 * `pixiLoader` is injectable so Node tests do not import a browser/WebGL
 * implementation. Production defaults to a lazy `import('pixi.js')` and thus
 * keeps Canvas2D startup independent from the optional GPU bundle.
 */
export class PixiBattlefieldRenderer {
    constructor(options = {}) {
        this.backend = RENDERER_BACKEND.PIXI_WEBGL;
        this.lifecycle = RENDERER_LIFECYCLE.NEW;
        this._pixiLoader = options.pixiLoader || (() => import('pixi.js'));
        this._createApplication = options.createApplication || null;
        this._performanceProfile = options.performanceProfile || PERFORMANCE_PROFILE.AUTO;
        this._reducedMotion = options.reducedMotion;
        this._capabilities = options.capabilities || {};
        this._providedCanvas = options.canvas || null;
        this._onContextLost = options.onContextLost || null;
        this._onContextRestored = options.onContextRestored || null;
        this._onNotificationError = options.onNotificationError || null;
        this._now = typeof options.now === 'function'
            ? options.now
            : () => globalThis.performance?.now?.() ?? Date.now();
        this._app = null;
        this._pixi = null;
        this._canvas = null;
        this._host = null;
        this._attachedCanvas = false;
        this._root = null;
        this._layers = Object.create(null);
        this._graphics = Object.create(null);
        this._scene = null;
        this._sceneDirty = false;
        this._events = [];
        this._viewport = null;
        this._policy = null;
        this._contextLost = false;
        this._handleContextLost = null;
        this._handleContextRestored = null;
        this._lastRenderedAtMs = -Infinity;
        this._terrainSprite = null;
        this._terrainTexture = null;
        this._terrainSource = null;
        this._terrainFade = null;
    }

    get app() { return this._app; }
    get canvas() { return this._canvas; }
    get viewport() { return this._viewport; }
    get policy() { return this._policy; }
    get scene() { return this._scene; }
    get contextLost() { return this._contextLost; }
    get layers() { return this._layers; }
    get layerOrder() { return PIXI_BATTLEFIELD_LAYER_ORDER; }

    async initialize(host = null, options = {}) {
        if (this.lifecycle !== RENDERER_LIFECYCLE.NEW) {
            throw new Error(`PixiBattlefieldRenderer cannot initialize from state: ${this.lifecycle}`);
        }
        this.lifecycle = RENDERER_LIFECYCLE.INITIALIZING;
        this._host = host;

        try {
            if (options.backend && options.backend !== RENDERER_BACKEND.PIXI_WEBGL) {
                throw new Error(`PixiBattlefieldRenderer only supports ${RENDERER_BACKEND.PIXI_WEBGL}`);
            }
            this._pixi = await this._pixiLoader();
            const { Application, Container, Graphics } = this._pixi || {};
            if (typeof Application !== 'function' || typeof Container !== 'function' || typeof Graphics !== 'function') {
                throw new TypeError('Pixi v8 Application, Container and Graphics constructors are required');
            }

            this._policy = resolveRenderPolicy({
                performanceProfile: options.performanceProfile || this._performanceProfile,
                reducedMotion: options.reducedMotion ?? this._reducedMotion,
                paused: options.paused,
                devicePixelRatio: options.devicePixelRatio
            }, this._capabilities);
            this._viewport = resolveInitialViewport(options, this._policy);

            this._app = this._createApplication
                ? await this._createApplication(this._pixi)
                : new Application();
            if (!this._app || typeof this._app.init !== 'function') {
                throw new TypeError('Pixi Application factory returned an invalid application');
            }

            const hostIsCanvas = Boolean(host && typeof host.getContext === 'function');
            const canvas = options.canvas || this._providedCanvas || (hostIsCanvas ? host : null);
            await this._app.init({
                preference: 'webgl',
                width: this._viewport.width,
                height: this._viewport.height,
                resolution: this._viewport.pixelRatio,
                autoDensity: true,
                autoStart: false,
                antialias: options.antialias !== false,
                backgroundAlpha: options.backgroundAlpha ?? 0,
                powerPreference: options.powerPreference || 'high-performance',
                ...(canvas ? { canvas } : {})
            });
            this._app.stop?.();
            this._canvas = this._app.canvas || this._app.view || canvas;
            if (!this._canvas) throw new Error('Pixi Application did not expose a canvas');

            this._root = new Container({ label: 'battlefield-root' });
            for (const name of PIXI_BATTLEFIELD_LAYER_ORDER) {
                const layer = new Container({ label: `battlefield-${name}` });
                const graphics = new Graphics();
                layer.addChild(graphics);
                this._layers[name] = layer;
                this._graphics[name] = graphics;
                this._root.addChild(layer);
            }
            this._app.stage.addChild(this._root);

            if (!hostIsCanvas && host && typeof host.appendChild === 'function' && this._canvas.parentNode !== host) {
                if (this.terrainMode || options.terrainMode) {
                    // Pixi handles terrain → canvas goes behind the existing Canvas2D canvas
                    const first = host.firstChild;
                    if (first) host.insertBefore(this._canvas, first);
                    else host.appendChild(this._canvas);
                } else {
                    host.appendChild(this._canvas);
                }
                this._attachedCanvas = true;
            }
            this._listenForContextLoss();
            this.lifecycle = RENDERER_LIFECYCLE.READY;
        } catch (error) {
            this._releaseResources();
            this.lifecycle = RENDERER_LIFECYCLE.NEW;
            throw error;
        }
    }

    /**
     * Display a Canvas-painted terrain snapshot as the bottom layer. The
     * source canvas is produced by the exact same Canvas2D terrain code, so
     * the two backends stay pixel-identical while Pixi handles compositing.
     */
    syncTerrainTexture(source, scale = 1) {
        assertReady(this);
        const { Texture, Sprite } = this._pixi;
        if (typeof Texture?.from !== 'function' || typeof Sprite !== 'function') return false;
        // 瞬时全量同步会覆盖淡入结果：先把进行中的渐变直接推进到终态。
        this._finishTerrainFade();
        if (this._terrainSprite && this._terrainSource !== source) {
            this._releaseTerrainTexture();
        }
        if (!this._terrainSprite) {
            this._terrainTexture = Texture.from(source);
            this._terrainSprite = new Sprite(this._terrainTexture);
            this._terrainSprite.label = 'battlefield-terrain-snapshot';
            this._terrainSource = source;
            this._layers.surface.addChildAt(this._terrainSprite, 0);
        } else {
            this._terrainTexture?.source?.update?.();
        }
        this._terrainSprite.scale.set(scale);
        this._sceneDirty = true;
        return true;
    }

    clearTerrainTexture() {
        this._releaseTerrainTexture();
        this._sceneDirty = true;
    }

    /**
     * GPU 交叉淡化到一张新的地形快照：新纹理只上传一次，随后每帧仅动
     * alpha，替代“渐变期间每 50ms 重画整幅离屏地形 + 全量纹理上传”。
     * 要求 source 与当前基底贴图使用不同的画布（调用方双缓冲）；没有
     * 基底、时长非法或画布相同时退化为瞬时同步。
     */
    beginTerrainCrossfade(source, scale = 1, durationMs = 1500, nowMs = this._now()) {
        assertReady(this);
        const { Texture, Sprite } = this._pixi;
        if (typeof Texture?.from !== 'function' || typeof Sprite !== 'function') return false;
        if (!this._terrainSprite || !(durationMs > 0) || this._terrainSource === source) {
            return this.syncTerrainTexture(source, scale);
        }
        // 渐变期间又来一次占领：直接把上一次推到终态，再叠加新渐变。
        this._finishTerrainFade();
        const texture = Texture.from(source);
        const sprite = new Sprite(texture);
        sprite.label = 'battlefield-terrain-fade';
        sprite.alpha = 0;
        sprite.scale.set(scale);
        const surfaceLayer = this._layers.surface;
        surfaceLayer.addChildAt(sprite, surfaceLayer.getChildIndex(this._terrainSprite) + 1);
        this._terrainFade = { sprite, texture, source, scale, startedAtMs: nowMs, durationMs };
        this._sceneDirty = true;
        return true;
    }

    _advanceTerrainFade(nowMs) {
        const fade = this._terrainFade;
        if (!fade) return;
        const progress = (nowMs - fade.startedAtMs) / fade.durationMs;
        if (progress >= 1) {
            this._finishTerrainFade();
            return;
        }
        // 地块渐变本身是线性 lerp；上层材质纯静态时 alpha 线性混合与
        // 逐地块颜色插值逐像素等价。
        fade.sprite.alpha = Math.max(0, progress);
    }

    _finishTerrainFade() {
        const fade = this._terrainFade;
        if (!fade) return;
        this._terrainFade = null;
        if (this._terrainSprite) {
            try { this._terrainSprite.destroy(); } catch {}
        }
        if (this._terrainTexture) {
            try { this._terrainTexture.destroy(true); } catch {}
        }
        fade.sprite.alpha = 1;
        this._terrainSprite = fade.sprite;
        this._terrainTexture = fade.texture;
        this._terrainSource = fade.source;
        this._sceneDirty = true;
    }

    _releaseTerrainTexture() {
        if (this._terrainFade) {
            const fade = this._terrainFade;
            this._terrainFade = null;
            try { fade.sprite.destroy(); } catch {}
            try { fade.texture.destroy(true); } catch {}
        }
        if (this._terrainSprite) {
            try { this._terrainSprite.destroy(); } catch {}
        }
        if (this._terrainTexture) {
            try { this._terrainTexture.destroy(true); } catch {}
        }
        this._terrainSprite = null;
        this._terrainTexture = null;
        this._terrainSource = null;
    }

    syncScene(snapshot) {
        assertReady(this);
        let next = createPixiSceneSnapshot(snapshot);
        if (this._scene) {
            const nowMs = this._now();
            const targetFrames = mergeExitingDescriptors(this._scene.targetFrames, next.targetFrames, nowMs, 220);
            const rangeRegions = mergeExitingDescriptors(this._scene.rangeRegions, next.rangeRegions, nowMs, 240);
            const antiAirCells = mergeExitingDescriptors(this._scene.antiAirCells, next.antiAirCells, nowMs, 220);
            // routePaths deliberately not merged: Canvas removes the hover
            // route on the exact frame the pointer leaves, with no fade.
            // Re-normalize only when an exit animation was actually carried
            // over; the common hover-sync path reuses the snapshot as-is.
            if (targetFrames !== next.targetFrames
                || rangeRegions !== next.rangeRegions
                || antiAirCells !== next.antiAirCells) {
                next = createPixiSceneSnapshot({ ...next, targetFrames, rangeRegions, antiAirCells });
            }
        }
        this._scene = next;
        this._sceneDirty = true;
    }

    enqueue(event) {
        assertReady(this);
        this._events.push(createImmutableRenderValue(event, 'battlefieldVisualEvent'));
    }

    resize(viewport) {
        assertReady(this);
        this._viewport = normalizeViewport(viewport, this._policy);
        this._app.renderer.resize(
            this._viewport.width,
            this._viewport.height,
            this._viewport.pixelRatio
        );
        return this._viewport;
    }

    render(frame = {}) {
        assertReady(this);
        const normalizedFrame = normalizeRenderFrame(frame, this._policy);
        if (this._contextLost) {
            return Object.freeze({
                backend: this.backend,
                rendered: false,
                reason: 'context-lost',
                frame: normalizedFrame
            });
        }

        const hasAnimatedInteraction = normalizedFrame.motionEnabled && Boolean(
            this._scene?.originMarker
            || this._scene?.routePaths?.length
            || this._scene?.targetFrames?.some(descriptor => descriptorStillAnimating(descriptor, normalizedFrame.motionNowMs))
            || this._scene?.rangeRegions?.some(descriptor => descriptorStillAnimating(descriptor, normalizedFrame.motionNowMs))
            || this._scene?.rangeRegions?.length
            || this._scene?.antiAirCells?.some(descriptor => descriptorStillAnimating(descriptor, normalizedFrame.motionNowMs))
        );
        // 地形交叉淡化不受 motionEnabled/节流约束：只改一个 sprite 的
        // alpha，跳帧反而会让渐变卡在半途。
        if (this._terrainFade) this._advanceTerrainFade(normalizedFrame.nowMs);
        if (!this._sceneDirty && this._events.length === 0 && !this._terrainFade) {
            if (!hasAnimatedInteraction) {
                return Object.freeze({
                    backend: this.backend,
                    rendered: false,
                    reason: 'unchanged-static-scene',
                    frame: normalizedFrame
                });
            }
            if (this._policy?.targetFps <= 30
                && normalizedFrame.nowMs - this._lastRenderedAtMs < 1000 / this._policy.targetFps - 1) {
                return Object.freeze({
                    backend: this.backend,
                    rendered: false,
                    reason: 'frame-throttled',
                    frame: normalizedFrame
                });
            }
        }

        if (this._sceneDirty) this._drawStaticScene();
        this._drawInteractionLayers(normalizedFrame);
        this._sceneDirty = false;

        if (typeof this._app.render === 'function') {
            this._app.render();
        } else {
            this._app.renderer.render({ container: this._app.stage });
        }
        this._lastRenderedAtMs = normalizedFrame.nowMs;
        const consumedEvents = this._events.length;
        this._events.length = 0;
        return Object.freeze({
            backend: this.backend,
            rendered: true,
            events: consumedEvents,
            frame: normalizedFrame
        });
    }

    destroy() {
        if (this.lifecycle === RENDERER_LIFECYCLE.DESTROYED) return;
        this._releaseResources();
        this._scene = null;
        this._events.length = 0;
        this._viewport = null;
        this._policy = null;
        this._host = null;
        this.lifecycle = RENDERER_LIFECYCLE.DESTROYED;
    }

    _drawStaticScene() {
        for (const name of PIXI_BATTLEFIELD_LAYER_ORDER) {
            this._graphics[name].clear();
        }
        if (!this._scene) {
            return;
        }

        const { world, surface, tiles, boundaries, units } = this._scene;
        this._root.position.set(world.x, world.y);
        this._root.scale.set(world.scale);

        const surfaceGraphics = this._graphics.surface;
        if (surface.width > 0 && surface.height > 0 && surface.alpha > 0) {
            surfaceGraphics.rect(surface.x, surface.y, surface.width, surface.height)
                .fill({ color: surface.color, alpha: surface.alpha });
        }
        for (const tile of tiles) {
            drawPath(surfaceGraphics, tile.points, true);
            surfaceGraphics.fill({ color: tile.fillColor, alpha: tile.fillAlpha });
            if (tile.gridWidth > 0 && tile.gridAlpha > 0) {
                drawPath(this._graphics.borders, tile.points, true);
                this._graphics.borders.stroke({
                    color: tile.gridColor,
                    alpha: tile.gridAlpha,
                    width: tile.gridWidth
                });
            }
        }

        for (const boundary of boundaries) {
            drawPath(this._graphics.borders, boundary.points, boundary.closed);
            this._graphics.borders.stroke({
                color: boundary.color,
                alpha: boundary.alpha,
                width: boundary.width
            });
        }

        for (const unit of units) {
            const body = this._graphics.units;
            body.circle(unit.x + unit.radius * 0.1, unit.y + unit.radius * 0.16, unit.radius * 1.02)
                .fill({ color: unit.shadowColor, alpha: unit.shadowAlpha });
            body.circle(unit.x, unit.y, unit.radius)
                .fill({ color: unit.color, alpha: unit.alpha });
            body.circle(unit.x, unit.y, unit.radius)
                .stroke({ color: unit.outlineColor, alpha: unit.outlineAlpha, width: unit.outlineWidth });
            body.circle(
                unit.x - unit.radius * 0.28,
                unit.y - unit.radius * 0.32,
                unit.radius * 0.34
            ).fill({ color: unit.highlightColor, alpha: unit.highlightAlpha });
            if (unit.health) this._drawHealthDial(unit);
        }
    }

    _drawHealthDial(unit) {
        const health = unit.health;
        const graphics = this._graphics.unitHud;
        const start = -Math.PI / 2;
        graphics.circle(unit.x, unit.y, health.ringRadius).stroke({
            color: health.trackColor,
            alpha: health.trackAlpha,
            width: health.trackWidth
        });
        if (health.ratio > 0) {
            drawArcPath(graphics, unit.x, unit.y, health.ringRadius, start, start + Math.PI * 2 * health.ratio);
            graphics.stroke({
                color: health.fillColor,
                alpha: health.fillAlpha,
                width: health.fillWidth
            });
        }
        if (health.shieldRatio > 0) {
            drawArcPath(graphics, unit.x, unit.y, health.shieldRadius, start, start + Math.PI * 2 * health.shieldRatio);
            graphics.stroke({
                color: health.shieldColor,
                alpha: health.shieldAlpha,
                width: health.shieldWidth
            });
        }
    }

    _drawInteractionLayers(frame) {
        const ground = this._graphics.interactionGround;
        const top = this._graphics.interactionTop;
        const route = this._graphics.interactionRoute;
        ground.clear();
        top.clear();
        route.clear();
        if (!this._scene) return;

        for (const region of this._scene.rangeRegions || []) {
            const exiting = Boolean(region.endingStartedAtMs);
            const exit = exitAlpha(frame, region);
            if (exit <= 0) continue;
            const nowMs = frame.motionNowMs;

            // Jelly fill: each reachable cell scales in with the shared
            // movement-region reveal, exactly like the Canvas renderer.
            for (const cell of region.cells) {
                if (cell.polygon) {
                    drawPath(ground, cell.polygon, true);
                    ground.fill({ color: region.color, alpha: region.fillAlpha * exit });
                    continue;
                }
                const reveal = exiting || !frame.motionEnabled
                    ? { scale: 1.008, alpha: 0.13 }
                    : resolveMovementTileReveal(
                        { q: 0, r: 0 },
                        { q: cell.distance, r: 0 },
                        nowMs,
                        region.startedAtMs
                    );
                if (reveal.alpha <= 0) continue;
                drawHexagonPath(ground, cell.x, cell.y, cell.size * reveal.scale);
                ground.fill({ color: region.color, alpha: reveal.alpha * exit });
            }

            if (!region.edges.length) continue;
            // Exterior border: marching-ants dashes ([14,9] period, -now/22
            // offset), soft glow halo, then inner pale line on the same dashes.
            const pulse = exiting || !frame.motionEnabled ? 0 : (Math.sin(nowMs / 420) + 1) / 2;
            const entryAlpha = exiting || !frame.motionEnabled
                ? 1
                : clamp01(((nowMs - region.startedAtMs) / 220) * 1.65);
            const borderAlpha = entryAlpha * exit;
            const dashOffset = frame.motionEnabled ? nowMs / 22 : 0;
            const blur = 6 + pulse * 2.5;

            const buildDashes = () => {
                for (const edge of region.edges) {
                    for (let i = 1; i < edge.length; i += 1) {
                        drawDashedSegment(ground, edge[i - 1].x, edge[i - 1].y, edge[i].x, edge[i].y, 14, 9, dashOffset);
                    }
                }
            };
            buildDashes();
            ground.stroke({
                color: 0x3ccdb9,
                alpha: 0.42 * 0.38 * borderAlpha,
                width: 2.6 + blur * 1.6,
                cap: 'round',
                join: 'round'
            });
            buildDashes();
            ground.stroke({
                color: region.borderColor,
                alpha: (exiting ? 0.78 : 0.72 + pulse * 0.14) * borderAlpha,
                width: 2.6,
                cap: 'round',
                join: 'round'
            });
            buildDashes();
            ground.stroke({
                color: region.innerLineColor,
                alpha: 0.34 * borderAlpha,
                width: 0.75,
                cap: 'round',
                join: 'round'
            });
        }

        for (const cell of this._scene.antiAirCells || []) {
            const entry = entryState(frame, cell);
            const visibility = entry.alpha * exitAlpha(frame, cell);
            if (visibility <= 0) continue;
            const breathe = 0.8 + breatheAt(frame, cell.phase, 1700) * 0.2;
            drawPath(ground, cell.points, true);
            ground.fill({ color: cell.color, alpha: 0.025 * visibility * breathe });
            drawCircularHatches(ground, cell, false);
            ground.stroke({
                color: cell.color,
                alpha: cell.alpha * visibility * breathe,
                width: this._policy?.effects === 'full' ? 1.55 : 1.25
            });
            if (cell.level >= 2) {
                drawCircularHatches(ground, cell, true);
                ground.stroke({
                    color: cell.color,
                    alpha: cell.alpha * visibility * breathe * 0.86,
                    width: this._policy?.effects === 'full' ? 1.45 : 1.15
                });
            }
        }

        if (this._scene.originMarker) this._drawOriginMarker(frame);

        for (const target of this._scene.targetFrames || []) {
            const entry = entryState(frame, target);
            const visibility = entry.alpha * exitAlpha(frame, target);
            if (visibility <= 0) continue;
            const wave = breatheAt(frame, target.phase, target.active ? 1080 : 1540);
            const activeScale = target.active ? 1.1 + wave * 0.045 : 1 + wave * 0.025;
            const size = target.size * entry.scale * activeScale;
            const alphaValue = target.alpha * visibility * (0.72 + wave * 0.28);

            // 宽而柔和的外层与清晰核心共享同一套角框路径，形成全息辉光。
            drawCornerFramePath(top, target.x, target.y, size * 1.035);
            top.stroke({
                color: target.color,
                alpha: alphaValue * (this._policy?.effects === 'full' ? 0.32 : 0.2),
                width: target.active ? 5.2 : 4
            });
            drawCornerFramePath(top, target.x, target.y, size);
            top.stroke({
                color: target.color,
                alpha: alphaValue,
                width: target.active ? 2.25 : 1.65
            });
            drawFrameMotif(top, target, size, alphaValue);
        }

        this._drawRoutePaths(frame);
    }

    // Faithful port of Canvas drawOperationOrigin: same radii, hatch clip,
    // dashed animated outer ring and per-action wave speed.
    _drawOriginMarker(frame) {
        const graphics = this._graphics.interactionGround;
        const marker = this._scene?.originMarker;
        if (!marker) return;

        const r = marker.unitRadius || marker.radius / 1.32;
        const seconds = frame.motionEnabled ? frame.motionNowMs / 1000 : 0;
        const waveSpeed = marker.action === 'move' ? 2.1 : 2.65;
        const wave = (Math.sin(seconds * waveSpeed) + 1) / 2;
        const innerRadius = r * (1.32 + wave * 0.036);
        const outerRadius = r * (1.66 + wave * 0.05);
        const blur = r * (0.12 + wave * 0.11);

        // Fill
        graphics.circle(marker.x, marker.y, innerRadius)
            .fill({ color: marker.color, alpha: 0.14 + wave * 0.025 });

        // Diagonal hatch clipped inside the inner disc (slope matches Canvas:
        // 4r horizontal span, -2.8r vertical drop, spacing 0.36r).
        const clipRadius = innerRadius * 0.94;
        const spacing = r * 0.36;
        for (let offset = -r * 2.7; offset <= r * 2.7; offset += spacing) {
            const clipped = clipSegmentToCircle(
                marker.x - r * 2, marker.y + offset + r * 1.4,
                marker.x + r * 2, marker.y + offset - r * 1.4,
                marker.x, marker.y, clipRadius
            );
            if (!clipped) continue;
            graphics.moveTo(clipped.x0, clipped.y0);
            graphics.lineTo(clipped.x1, clipped.y1);
        }
        graphics.stroke({
            color: marker.color,
            alpha: 0.28 + wave * 0.05,
            width: Math.max(1, r * 0.052)
        });

        // Inner solid ring with glow halo
        graphics.circle(marker.x, marker.y, innerRadius)
            .stroke({ color: marker.color, alpha: 0.24, width: r * 0.164 + blur * 1.6 });
        graphics.circle(marker.x, marker.y, innerRadius)
            .stroke({ color: marker.color, alpha: 0.90, width: r * 0.164 });

        // Outer dashed marching ring
        drawDashedCircle(
            graphics,
            marker.x, marker.y, outerRadius,
            r * 0.2, r * 0.32,
            seconds * r * 0.24
        );
        graphics.stroke({
            color: marker.color,
            alpha: 0.50 + wave * 0.09,
            width: r * 0.11,
            cap: 'round'
        });
    }

    // Faithful ports of operationPreviewRenderer's drawMoveRoute /
    // drawMeleeRoute / drawRangedRoute. All widths, dash patterns, chevron
    // cadences and the ranged carrier/impact cycle reuse the same constants.
    _drawRoutePaths(frame) {
        const graphics = this._graphics.interactionRoute;
        const paths = this._scene?.routePaths || [];
        if (!paths.length) return;
        const seconds = frame.motionEnabled ? frame.motionNowMs / 1000 : 0;

        for (const path of paths) {
            if (path.points.length < 2 || !path.totalLength) continue;
            if (path.action === 'move') this._drawMoveRoute(graphics, path, seconds);
            else if (path.action === 'melee') this._drawMeleeRoute(graphics, path, seconds);
            else if (path.action === 'ranged') this._drawRangedRoute(graphics, path, seconds);
        }
    }

    _traceRoute(graphics, path, endFraction = 1) {
        const capped = Math.max(0, Math.min(1, endFraction));
        const cappedDistance = path.totalLength * capped;
        const points = path.points;
        graphics.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
            const point = points[index];
            if (point.distance <= cappedDistance) {
                graphics.lineTo(point.x, point.y);
                continue;
            }
            const end = sampleOperationRoute(path, capped);
            if (end) graphics.lineTo(end.x, end.y);
            break;
        }
    }

    _dashRoute(graphics, path, dash, gap, offset, endFraction = 1) {
        const cappedDistance = path.totalLength * Math.max(0, Math.min(1, endFraction));
        const points = path.points;
        let travelled = 0;
        for (let index = 1; index < points.length; index += 1) {
            const previous = points[index - 1];
            let current = points[index];
            let segmentEnd = current.distance;
            if (previous.distance >= cappedDistance) break;
            if (segmentEnd > cappedDistance) {
                const end = sampleOperationRoute(path, cappedDistance / path.totalLength);
                if (!end) break;
                current = { ...end, distance: cappedDistance };
                segmentEnd = cappedDistance;
            }
            drawDashedSegment(graphics, previous.x, previous.y, current.x, current.y, dash, gap, offset - travelled);
            travelled += segmentEnd - previous.distance;
        }
    }

    _drawRouteArrowhead(graphics, path, fraction, color, length, open = false, alphaValue = 1) {
        const tip = sampleOperationRoute(path, fraction);
        if (!tip) return;
        const cos = Math.cos(tip.angle);
        const sin = Math.sin(tip.angle);
        const local = (lx, ly) => ({
            x: tip.x + lx * cos - ly * sin,
            y: tip.y + lx * sin + ly * cos
        });
        const wingA = local(-length, length * 0.58);
        const wingB = local(-length, -length * 0.58);
        graphics.moveTo(tip.x, tip.y);
        graphics.lineTo(wingA.x, wingA.y);
        if (!open) {
            const notch = local(-length * 0.68, 0);
            graphics.lineTo(notch.x, notch.y);
            graphics.lineTo(wingB.x, wingB.y);
            graphics.closePath();
            graphics.fill({ color, alpha: alphaValue });
        } else {
            graphics.moveTo(tip.x, tip.y);
            graphics.lineTo(wingB.x, wingB.y);
            graphics.stroke({
                color,
                alpha: alphaValue,
                width: Math.max(2, length * 0.26),
                cap: 'round',
                join: 'round'
            });
        }
    }

    _drawRouteChevron(graphics, path, fraction, color, size, alphaValue) {
        const point = sampleOperationRoute(path, fraction);
        if (!point) return;
        const cos = Math.cos(point.angle);
        const sin = Math.sin(point.angle);
        const local = (lx, ly) => ({
            x: point.x + lx * cos - ly * sin,
            y: point.y + lx * sin + ly * cos
        });
        const a = local(-size, -size * 0.56);
        const b = local(0, 0);
        const c = local(-size, size * 0.56);
        graphics.moveTo(a.x, a.y);
        graphics.lineTo(b.x, b.y);
        graphics.lineTo(c.x, c.y);
        graphics.stroke({
            color,
            alpha: alphaValue,
            width: Math.max(1.5, size * 0.29),
            cap: 'round',
            join: 'round'
        });
    }

    _drawMoveRoute(graphics, path, seconds) {
        const r = path.unitRadius;
        const color = path.color;
        const pulseProgress = ((seconds * 0.68) % 1 + 1) % 1;

        // Same-hue wide foundation
        this._traceRoute(graphics, path);
        graphics.stroke({ color, alpha: 0.10, width: r * 0.866, cap: 'round', join: 'round' });

        // Marching dashed overlay — exactly one stroke matching Canvas:
        // width 0.24r, alpha 0.92, no separate glow layer.
        const dash = r * 1.2;
        const gap = r * 0.734;
        const offset = seconds * r * 3.066;
        this._dashRoute(graphics, path, dash, gap, offset);
        graphics.stroke({ color, alpha: 0.92, width: r * 0.24, cap: 'round', join: 'round' });

        // Traveling chevrons
        for (const chevronOffset of [0, 1 / 3, 2 / 3]) {
            const fraction = ((seconds * 0.115 + chevronOffset) % 0.92 + 0.92) % 0.92;
            this._drawRouteChevron(graphics, path, fraction, color, r * 0.6, 0.72);
        }

        // Destination pulse ring
        const destination = sampleOperationRoute(path, 1);
        if (destination) {
            graphics.circle(destination.x, destination.y, r * (0.64 + pulseProgress * 0.84));
            graphics.stroke({ color, alpha: (1 - pulseProgress) * 0.58, width: r * 0.10 });
        }

        this._drawRouteArrowhead(graphics, path, 1, color, r * 1.08, false, 1);
    }

    _drawMeleeRoute(graphics, path, seconds) {
        const r = path.unitRadius;
        const color = path.color;
        const targetContactFraction = path.totalLength
            ? Math.max(0, Math.min(1, (path.totalLength - r) / path.totalLength))
            : 1;
        const bodyEnd = Math.max(0.08, targetContactFraction - r * 1.24 / path.totalLength);
        const bodyPoints = path.points.filter(point => point.distance < path.totalLength * bodyEnd);
        const bodyTip = sampleOperationRoute(path, bodyEnd);
        if (bodyTip) bodyPoints.push({ ...bodyTip, distance: path.totalLength * bodyEnd });
        if (bodyPoints.length < 2) return;

        const left = [];
        const right = [];
        bodyPoints.forEach((point, index) => {
            const previous = bodyPoints[Math.max(0, index - 1)];
            const next = bodyPoints[Math.min(bodyPoints.length - 1, index + 1)];
            const angle = Math.atan2(next.y - previous.y, next.x - previous.x);
            const progress = index / Math.max(1, bodyPoints.length - 1);
            const halfWidth = r * (0.68 - progress * 0.44);
            left.push({ x: point.x - Math.sin(angle) * halfWidth, y: point.y + Math.cos(angle) * halfWidth });
            right.push({ x: point.x + Math.sin(angle) * halfWidth, y: point.y - Math.cos(angle) * halfWidth });
        });

        graphics.moveTo(left[0].x, left[0].y);
        for (let index = 1; index < left.length; index += 1) graphics.lineTo(left[index].x, left[index].y);
        for (let index = right.length - 1; index >= 0; index -= 1) graphics.lineTo(right[index].x, right[index].y);
        graphics.closePath();
        graphics.fill({ color, alpha: 0.30 });
        graphics.stroke({ color, alpha: 0.88, width: r * 0.12, join: 'round' });

        for (const chevronOffset of [0, 0.26, 0.52]) {
            const cadence = Math.max(bodyEnd, 0.0001);
            const fraction = ((seconds * 0.2 + chevronOffset) % cadence + cadence) % cadence;
            this._drawRouteChevron(graphics, path, fraction, 0xffffff, r * 0.5, 0.86);
        }

        this._drawRouteArrowhead(graphics, path, targetContactFraction, color, r * 1.84, false, 1);
    }

    _drawRangedRoute(graphics, path, seconds) {
        const r = path.unitRadius;
        const color = path.color;
        const target = path.target;
        const timing = getRangedPreviewTiming(seconds);
        const targetContactFraction = path.totalLength
            ? Math.max(0, Math.min(1, (path.totalLength - r) / path.totalLength))
            : 1;

        // Single dashed rail (no separate glow layer — matches Canvas).
        const dash = r * 0.15;
        const gap = r * 0.44;
        const offset = seconds * r * 1.44;
        this._dashRoute(graphics, path, dash, gap, offset, targetContactFraction);
        graphics.stroke({ color, alpha: 0.96, width: r * 0.172, cap: 'round' });

        this._drawRouteArrowhead(graphics, path, targetContactFraction, color, r * 0.554, true, 1);

        if (timing.carrierVisible) {
            const carrier = sampleOperationRoute(path, timing.flightProgress * targetContactFraction);
            if (carrier) {
                const cos = Math.cos(carrier.angle);
                const sin = Math.sin(carrier.angle);
                // Trail
                graphics.moveTo(carrier.x - cos * r * 0.62, carrier.y - sin * r * 0.62);
                graphics.lineTo(carrier.x - cos * r * 0.16, carrier.y - sin * r * 0.16);
                graphics.stroke({ color, alpha: 0.34, width: Math.max(1.2, r * 0.12), cap: 'round' });
                // Glow halo + concentric body
                graphics.circle(carrier.x, carrier.y, r * 0.6)
                    .fill({ color, alpha: 0.10 });
                const scales = [0.426, 0.256, 0.128];
                for (let index = 0; index < scales.length; index += 1) {
                    graphics.circle(carrier.x, carrier.y, r * scales[index])
                        .fill({ color, alpha: 0.10 + index * 0.18 });
                }
            }
        }

        if (timing.impactVisible) {
            const progress = Math.max(0, Math.min(1, timing.impactProgress));
            const eased = 1 - (1 - progress) * (1 - progress);
            graphics.circle(target.x, target.y, r * (1.08 + eased * 1.28));
            graphics.stroke({
                color,
                alpha: (1 - progress) * 0.76,
                width: r * (0.12 - progress * 0.05)
            });
        }
    }

    _listenForContextLoss() {
        if (!this._canvas || typeof this._canvas.addEventListener !== 'function') return;
        this._handleContextLost = event => {
            event?.preventDefault?.();
            this._contextLost = true;
            const error = new Error('Pixi WebGL context lost');
            error.name = 'WebGLContextLostError';
            safeNotify(this._onContextLost, error, Object.freeze({
                backend: this.backend,
                renderer: this,
                originalEvent: event || null
            }), this._onNotificationError);
        };
        this._handleContextRestored = event => {
            this._contextLost = false;
            safeNotify(this._onContextRestored, null, Object.freeze({
                backend: this.backend,
                renderer: this,
                originalEvent: event || null
            }), this._onNotificationError);
        };
        this._canvas.addEventListener('webglcontextlost', this._handleContextLost, false);
        this._canvas.addEventListener('webglcontextrestored', this._handleContextRestored, false);
    }

    _releaseResources() {
        this._releaseTerrainTexture();
        const canvas = this._canvas || readApplicationCanvas(this._app);
        if (canvas && typeof canvas.removeEventListener === 'function') {
            if (this._handleContextLost) {
                canvas.removeEventListener('webglcontextlost', this._handleContextLost, false);
            }
            if (this._handleContextRestored) {
                canvas.removeEventListener('webglcontextrestored', this._handleContextRestored, false);
            }
        }
        this._handleContextLost = null;
        this._handleContextRestored = null;

        if (this._attachedCanvas && this._host && canvas) {
            try {
                if (typeof this._host.removeChild === 'function') this._host.removeChild(canvas);
                else canvas.remove?.();
            } catch {}
        }
        this._attachedCanvas = false;

        try { this._app?.destroy?.(false, { children: true }); } catch {}
        this._app = null;
        this._pixi = null;
        this._canvas = null;
        this._root = null;
        this._layers = Object.create(null);
        this._graphics = Object.create(null);
        this._contextLost = false;
        this._sceneDirty = false;
        this._lastRenderedAtMs = -Infinity;
    }
}
