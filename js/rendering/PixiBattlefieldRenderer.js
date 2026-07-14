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
    const progress = clamp01(
        (frame.motionNowMs - descriptor.endingStartedAtMs)
        / Math.max(1, descriptor.endingDurationMs || 220)
    );
    return 1 - progress * progress;
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

function mergeExitingDescriptors(previous = [], next = [], nowMs, fallbackDurationMs) {
    const nextIds = new Set(next.map(descriptor => descriptor.id));
    const merged = [...next];
    for (const descriptor of previous) {
        if (nextIds.has(descriptor.id)) continue;
        const endingStartedAtMs = descriptor.endingStartedAtMs || nowMs;
        const endingDurationMs = descriptor.endingDurationMs || fallbackDurationMs;
        if (nowMs - endingStartedAtMs >= endingDurationMs) continue;
        merged.push({ ...descriptor, endingStartedAtMs, endingDurationMs });
    }
    return merged;
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
        this.terrainMode = Boolean(options.terrainMode);
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
                if (options.terrainMode) {
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

    syncScene(snapshot) {
        assertReady(this);
        let next = createPixiSceneSnapshot(snapshot);
        if (this._scene) {
            const nowMs = this._now();
            next = createPixiSceneSnapshot({
                ...next,
                targetFrames: mergeExitingDescriptors(
                    this._scene.targetFrames,
                    next.targetFrames,
                    nowMs,
                    220
                ),
                rangeRegions: mergeExitingDescriptors(
                    this._scene.rangeRegions,
                    next.rangeRegions,
                    nowMs,
                    240
                ),
                antiAirCells: mergeExitingDescriptors(
                    this._scene.antiAirCells,
                    next.antiAirCells,
                    nowMs,
                    220
                ),
                routePaths: mergeExitingDescriptors(
                    this._scene.routePaths,
                    next.routePaths,
                    nowMs,
                    220
                )
            });
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
            this._scene?.originMarker?.pulse
            || this._scene?.targetFrames?.some(descriptor => descriptorStillAnimating(descriptor, normalizedFrame.motionNowMs))
            || this._scene?.rangeRegions?.some(descriptor => descriptorStillAnimating(descriptor, normalizedFrame.motionNowMs))
            || this._scene?.antiAirCells?.some(descriptor => descriptorStillAnimating(descriptor, normalizedFrame.motionNowMs))
            || this._scene?.routePaths?.some(descriptor => descriptorStillAnimating(descriptor, normalizedFrame.motionNowMs))
        );
        if (!this._sceneDirty && this._events.length === 0) {
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
            const entry = entryState(frame, region);
            const visibility = entry.alpha * exitAlpha(frame, region);
            if (visibility <= 0) continue;
            const breathe = 0.82 + breatheAt(frame, region.phase, 1850) * 0.18;
            for (const polygon of region.cells) {
                drawPath(ground, polygon, true);
                ground.fill({
                    color: region.color,
                    alpha: region.fillAlpha * visibility * breathe
                });
            }
            for (const edge of region.edges) drawPath(ground, edge, false);
            ground.stroke({
                color: region.color,
                alpha: region.lineAlpha * visibility * breathe,
                width: region.lineWidth
            });
            if (this._policy?.effects === 'full') {
                for (const edge of region.edges) drawPath(ground, edge, false);
                ground.stroke({
                    color: 0xe8fbff,
                    alpha: region.lineAlpha * visibility * 0.28,
                    width: Math.max(0.8, region.lineWidth * 0.42)
                });
            }
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

    _drawOriginMarker(frame) {
        const graphics = this._graphics.interactionGround;
        const marker = this._scene?.originMarker;
        if (!marker) return;

        const phase = marker.pulse && frame.motionEnabled
            ? (frame.motionNowMs % marker.pulsePeriodMs) / marker.pulsePeriodMs
            : 0;
        const wave = marker.pulse && frame.motionEnabled
            ? (Math.sin(phase * Math.PI * 2) + 1) / 2
            : 0;
        const radius = marker.radius * (1 + wave * marker.pulseAmount);
        const ringAlpha = marker.alpha * (0.74 + wave * 0.26);

        graphics.circle(marker.x, marker.y, radius)
            .fill({ color: marker.color, alpha: marker.fillAlpha });
        drawOriginHatching(graphics, marker, radius * 0.82);
        graphics.stroke({
            color: marker.color,
            alpha: marker.alpha * 0.5,
            width: marker.hatchWidth
        });
        graphics.circle(marker.x, marker.y, radius)
            .stroke({ color: marker.color, alpha: ringAlpha, width: marker.ringWidth });
        graphics.circle(marker.x, marker.y, radius * 0.72)
            .stroke({ color: marker.color, alpha: ringAlpha * 0.58, width: marker.ringWidth * 0.75 });
        if (marker.motif === 'plane') {
            const size = radius * 0.72;
            graphics.moveTo(marker.x, marker.y - size * 0.56);
            graphics.lineTo(marker.x + size * 0.09, marker.y - size * 0.08);
            graphics.lineTo(marker.x + size * 0.48, marker.y + size * 0.12);
            graphics.lineTo(marker.x + size * 0.45, marker.y + size * 0.25);
            graphics.lineTo(marker.x + size * 0.08, marker.y + size * 0.14);
            graphics.lineTo(marker.x + size * 0.07, marker.y + size * 0.5);
            graphics.lineTo(marker.x, marker.y + size * 0.59);
            graphics.lineTo(marker.x - size * 0.07, marker.y + size * 0.5);
            graphics.lineTo(marker.x - size * 0.08, marker.y + size * 0.14);
            graphics.lineTo(marker.x - size * 0.45, marker.y + size * 0.25);
            graphics.lineTo(marker.x - size * 0.48, marker.y + size * 0.12);
            graphics.lineTo(marker.x - size * 0.09, marker.y - size * 0.08);
            graphics.closePath();
            graphics.stroke({
                color: marker.color,
                alpha: ringAlpha * 0.9,
                width: marker.ringWidth * 0.9
            });
        }
    }

    _drawRoutePaths(frame) {
        const graphics = this._graphics.interactionRoute;
        const paths = this._scene?.routePaths || [];
        if (!paths.length) return;

        for (const path of paths) {
            const entry = entryState(frame, path);
            const visibility = entry.alpha * exitAlpha(frame, path);
            if (visibility <= 0 || path.points.length < 2) continue;

            const color = path.color;
            const target = path.target;
            const totalLength = path.totalLength || 1;
            const now = frame.motionEnabled ? frame.motionNowMs : 0;

            if (path.action === 'move') {
                // Solid route path: thick low-alpha background + thin bright overlay
                drawPath(graphics, path.points, false);
                graphics.stroke({ color, alpha: 0.30 * visibility, width: 3.4 });
                drawPath(graphics, path.points, false);
                graphics.stroke({ color, alpha: visibility * 0.90, width: 1.5 });
                // Arrowhead at destination
                this._drawArrowhead(graphics, path, 1, color, visibility);

            } else if (path.action === 'melee') {
                // Tapered wedge: wider at source, narrower at target
                const numPoints = path.points.length;
                const wedgeAlpha = 0.26 * visibility;
                if (numPoints >= 2) {
                    const left = [];
                    const right = [];
                    for (let i = 0; i < numPoints; i++) {
                        const p = path.points[i];
                        const prev = path.points[Math.max(0, i - 1)];
                        const next = path.points[Math.min(numPoints - 1, i + 1)];
                        const angle = Math.atan2(next.y - prev.y, next.x - prev.x);
                        const progress = i / (numPoints - 1);
                        const halfWidth = 8 * (1 - progress * 0.6);
                        left.push({ x: p.x - Math.sin(angle) * halfWidth, y: p.y + Math.cos(angle) * halfWidth });
                        right.push({ x: p.x + Math.sin(angle) * halfWidth, y: p.y - Math.cos(angle) * halfWidth });
                    }
                    graphics.moveTo(left[0].x, left[0].y);
                    for (let i = 1; i < left.length; i++) graphics.lineTo(left[i].x, left[i].y);
                    for (let i = right.length - 1; i >= 0; i--) graphics.lineTo(right[i].x, right[i].y);
                    graphics.closePath();
                    graphics.fill({ color, alpha: wedgeAlpha });
                    graphics.stroke({ color, alpha: 0.80 * visibility, width: 1.1 });
                }
                this._drawArrowhead(graphics, path, 0.94, color, visibility);

            } else if (path.action === 'ranged') {
                const pulse = frame.motionEnabled
                    ? (Math.sin(now / 550) + 1) / 2
                    : 0.5;

                // Arc rail
                drawPath(graphics, path.points, false);
                graphics.stroke({ color, alpha: 0.88 * visibility, width: 1.2 });

                // Carrier pulse: small circle that travels along the path
                if (frame.motionEnabled) {
                    const carrierFrac = ((now / 1550) % 1) * 0.88;
                    this._sampleRoutePosition(graphics, path, carrierFrac, color, visibility);
                }

                // Impact ring at target
                const impactAlpha = (1 - pulse) * 0.5 * visibility;
                const ringRadius = 10 + pulse * 12;
                if (impactAlpha > 0.01) {
                    graphics.circle(target.x, target.y, ringRadius);
                    graphics.stroke({
                        color,
                        alpha: impactAlpha,
                        width: 1.8
                    });
                }
            }
        }
    }

    _drawArrowhead(graphics, path, fraction, color, visibility) {
        const tip = this._sampleRoutePoint(path, fraction);
        if (!tip) return;
        const prev = this._sampleRoutePoint(path, Math.max(0, fraction - 0.04));
        if (!prev) return;
        const angle = Math.atan2(tip.y - prev.y, tip.x - prev.x);
        const size = 14;
        graphics.moveTo(tip.x, tip.y);
        graphics.lineTo(
            tip.x - Math.cos(angle - 0.52) * size,
            tip.y - Math.sin(angle - 0.52) * size
        );
        graphics.lineTo(
            tip.x - Math.cos(angle + 0.52) * size,
            tip.y - Math.sin(angle + 0.52) * size
        );
        graphics.closePath();
        graphics.fill({ color, alpha: 0.88 * visibility });
    }

    _sampleRoutePoint(path, fraction) {
        const points = path.points;
        const totalLength = path.totalLength;
        if (!points || points.length < 2 || !totalLength) return null;
        const clamped = Math.max(0, Math.min(1, fraction));
        const targetDist = clamped * totalLength;
        for (let i = 1; i < points.length; i++) {
            if (points[i].distance >= targetDist) {
                const prev = points[i - 1];
                const span = Math.max(1, points[i].distance - prev.distance);
                const t = (targetDist - prev.distance) / span;
                return {
                    x: prev.x + (points[i].x - prev.x) * t,
                    y: prev.y + (points[i].y - prev.y) * t
                };
            }
        }
        return { x: points[points.length - 1].x, y: points[points.length - 1].y };
    }

    _sampleRoutePosition(graphics, path, fraction, color, visibility) {
        const point = this._sampleRoutePoint(path, fraction);
        if (!point) return;
        const alpha = (0.5 + Math.sin(fraction * Math.PI * 6) * 0.3) * visibility;
        graphics.circle(point.x, point.y, 5);
        graphics.fill({ color, alpha: alpha * 0.7 });
        graphics.circle(point.x, point.y, 8);
        graphics.fill({ color, alpha: alpha * 0.15 });
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
