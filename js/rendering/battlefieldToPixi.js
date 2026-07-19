import { createPixiSceneSnapshot } from './pixiSceneSnapshot.js';
import {
    buildMoveOperationAnchors,
    buildSmoothOperationRoute,
    buildRangedOperationRoute
} from '../operationPreviewRenderer.js';
import { UNIT_BADGE_RADIUS } from '../unitBadgeRenderer.js';

const RELATION_COLORS = Object.freeze({
    self: '#72e18b',
    ally: '#69aef5',
    neutral: '#efca55',
    enemy: '#ed6258',
    unknown: '#b9c6c8'
});

const HEX_NEIGHBORS = Object.freeze([
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]
]);

const TARGET_STYLE = Object.freeze({
    hostile: Object.freeze({ motif: 'attack', color: '#f05b52' }),
    heal: Object.freeze({ motif: 'heal', color: '#54e58c' }),
    mobility: Object.freeze({ motif: 'mobility', color: '#64e6f2' }),
    shield: Object.freeze({ motif: 'shield', color: '#66b9ff' }),
    attach: Object.freeze({ motif: 'attach', color: '#f1cb68' }),
    deploy: Object.freeze({ motif: 'deployment', color: '#efb360' }),
    transport: Object.freeze({ motif: 'transport', color: '#85dbea' }),
    area: Object.freeze({ motif: 'area', color: '#f05b52' })
});

const HEX_UNIT_VERTICES = Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 3 * (index + 0.5);
    return Object.freeze({ x: Math.cos(angle), y: Math.sin(angle) });
});

function hexPoints(center, size) {
    const points = new Array(6);
    for (let index = 0; index < 6; index += 1) {
        const vertex = HEX_UNIT_VERTICES[index];
        points[index] = {
            x: center.x + vertex.x * size,
            y: center.y + vertex.y * size
        };
    }
    return points;
}

function signatureRevision(signature) {
    const tail = /:([0-9a-f]{8})$/i.exec(signature || '')?.[1];
    return tail ? Number.parseInt(tail, 16) : 0;
}

function visibilityAlpha(visibility) {
    if (visibility === 'unexplored') return 0.1;
    if (visibility === 'explored') return 0.48;
    return 1;
}

function campColorMap(snapshot) {
    return new Map((snapshot.camps || []).map(camp => [camp.key, camp.color || '#777777']));
}

function unitById(snapshot) {
    return new Map((snapshot.units || []).map(unit => [String(unit.id), unit]));
}

function tileByKey(snapshot) {
    return new Map((snapshot.tiles || []).map(tile => [tile.key, tile]));
}

// Memoized: called for every tile and interaction key at the sync cadence,
// and the key space is bounded by board size.
const coordinatesFromKeyCache = new Map();

function coordinatesFromKey(key) {
    const cached = coordinatesFromKeyCache.get(key);
    if (cached !== undefined) return cached;
    const [q, r] = String(key || '').split(',').map(Number);
    const parsed = Number.isFinite(q) && Number.isFinite(r) ? { q, r } : null;
    coordinatesFromKeyCache.set(key, parsed);
    return parsed;
}

function hexDistanceByKey(leftKey, rightKey) {
    const left = coordinatesFromKey(leftKey);
    const right = coordinatesFromKey(rightKey);
    if (!left || !right) return 0;
    return Math.max(
        Math.abs(left.q - right.q),
        Math.abs(left.r - right.r),
        Math.abs((-left.q - left.r) - (-right.q - right.r))
    );
}

function outerRegionGeometry(keys, tiles, size) {
    const keySet = new Set(keys || []);
    const cells = [];
    const edges = [];
    for (const key of keySet) {
        const tile = tiles.get(key);
        const coordinate = coordinatesFromKey(key);
        if (!tile || !coordinate || tile.renderOnly) continue;
        const polygon = hexPoints(tile.center, size);
        cells.push(polygon);
        for (let edgeIndex = 0; edgeIndex < 6; edgeIndex += 1) {
            const [dq, dr] = HEX_NEIGHBORS[(5 - edgeIndex) % 6];
            if (keySet.has(`${coordinate.q + dq},${coordinate.r + dr}`)) continue;
            edges.push([polygon[edgeIndex], polygon[(edgeIndex + 1) % 6]]);
        }
    }
    return { cells, edges };
}

function targetCenter(tile, units) {
    const unit = tile?.unitId == null ? null : units.get(String(tile.unitId));
    return unit?.visualCenter || tile?.center || null;
}

function targetFrame(key, options) {
    const tile = options.tiles.get(key);
    const center = targetCenter(tile, options.units);
    if (!tile || !center || tile.renderOnly) return null;
    const distance = hexDistanceByKey(options.originKey, key);
    const coordinate = coordinatesFromKey(key) || { q: 0, r: 0 };
    return {
        id: `${options.prefix}-${key}`,
        center,
        size: options.size,
        color: options.style.color,
        motif: options.style.motif,
        active: key === options.activeKey,
        phase: coordinate.q * 0.43 + coordinate.r * 0.29,
        startedAtMs: options.startedAtMs,
        delayMs: distance * 34,
        durationMs: 290,
        endingStartedAtMs: options.endingStartedAtMs || 0,
        endingDurationMs: 220
    };
}

function borderDescriptor(edge, index, kind) {
    return {
        id: `${kind}-${index}`,
        points: [[edge.x0, edge.y0], [edge.x1, edge.y1]],
        color: kind === 'camp' ? '#11191a' : '#d8cba7',
        alpha: kind === 'camp' ? 0.88 : 0.48,
        width: kind === 'camp' ? 3.2 : 1.15
    };
}

/** Convert the backend-neutral scene DTO into the Pixi vertical-slice DTO. */
export function battlefieldSnapshotToPixi(snapshot, options = {}) {
    if (snapshot?.kind !== 'blades-of-hex/battlefield') {
        throw new TypeError('battlefieldSnapshotToPixi requires a battlefield snapshot');
    }
    const campColors = campColorMap(snapshot);
    const units = unitById(snapshot);
    const tilesByKey = tileByKey(snapshot);
    const showGrid = options.showGrid !== false;
    const overlayOnly = options.overlayOnly === true;
    const highBudget = options.performanceProfile === 'high';
    const hexSize = snapshot.board.hexSize;
    const tiles = overlayOnly ? [] : snapshot.tiles.map(tile => {
        const waterKind = tile.surface?.kind || tile.surfaceKind || 'land';
        const isWater = waterKind !== 'land';
        return {
            id: tile.key,
            points: hexPoints(tile.center, hexSize * 1.005),
            fillColor: isWater
                ? (waterKind === 'deepWater' ? '#264954' : '#456d72')
                : (tile.surface?.color || campColors.get(tile.campKey) || '#777777'),
            fillAlpha: visibilityAlpha(tile.visibility),
            gridColor: isWater ? '#789ba0' : '#7c8178',
            gridAlpha: showGrid ? (tile.renderOnly ? 0.18 : 0.32) : 0,
            gridWidth: showGrid ? 0.85 : 0
        };
    });

    // Hybrid deployments keep real units on Canvas; placeholder spheres are
    // only for standalone/test rendering of the full Pixi slice.
    const includeUnits = options.includeUnits !== false;
    const pixiUnits = (overlayOnly || !includeUnits) ? [] : snapshot.units
        .filter(unit => unit.renderable)
        .map(unit => {
            const relation = unit.relationToViewer || (unit.campKey === snapshot.viewerCampKey ? 'self' : 'enemy');
            const relationColor = RELATION_COLORS[relation] || RELATION_COLORS.unknown;
            return {
                id: unit.id,
                x: unit.visualCenter.x,
                y: unit.visualCenter.y,
                radius: 15,
                color: campColors.get(unit.campKey) || '#738b91',
                outlineColor: relationColor,
                outlineAlpha: 0.82,
                health: {
                    ratio: unit.health.ratio,
                    shieldRatio: Math.min(1, unit.shield.current / Math.max(1, unit.health.max)),
                    trackColor: relationColor,
                    trackAlpha: 0.34,
                    fillColor: relationColor,
                    ringRadius: 18.05,
                    trackWidth: 2.05,
                    fillWidth: 2.35,
                    shieldRadius: 19.35,
                    shieldWidth: 1.45
                }
            };
        });

    // ── Interaction hints ──────────────────────────────────────
    // Pixi owns only the selection/hover hot path (movement region, attack
    // frames, origin marker, operation routes). Card targeting keeps its rich
    // Canvas renderer (structure previews, AA markers, paratrooper badges…),
    // so nothing card-related is emitted here.
    const interaction = snapshot.interaction || {};
    const selection = interaction.selection || {};
    const targeting = interaction.targeting || {};
    const humanTurn = interaction.humanTurn !== false;
    const cardTargetingActive = Boolean(targeting.active);
    const interactionVisible = humanTurn && !cardTargetingActive;
    const originUnit = units.get(String(selection.unitId));

    const route = interactionVisible ? (interaction.route || null) : null;
    const unitRadius = UNIT_BADGE_RADIUS;

    // Origin marker mirrors Canvas drawOperationOrigin: red only while the
    // hovered tile is an attack target, teal otherwise.
    const originAction = route && route.action !== 'move' ? 'attack' : 'move';
    const showOrigin = interactionVisible
        && originUnit
        && (originUnit.action ? originUnit.action.canAct && !originUnit.action.isNewRecruit : true);
    const originMarker = showOrigin ? {
        x: originUnit.visualCenter.x,
        y: originUnit.visualCenter.y,
        unitRadius,
        radius: unitRadius * 1.32,
        color: originAction === 'attack' ? '#e95b50' : '#58c9b3',
        action: originAction,
        motif: 'origin',
        pulse: true
    } : null;

    const targetFrames = [];
    const normalAttackKeys = interactionVisible ? (selection.attackTileKeys || []) : [];
    const closingAttackKeys = normalAttackKeys.length ? [] : (selection.deselectAttackTileKeys || []);
    const attackKeys = normalAttackKeys.length ? normalAttackKeys : closingAttackKeys;
    const attackOriginKey = selection.unitTileKey || selection.deselectOriginTileKey;
    for (const key of attackKeys) {
        const frame = targetFrame(key, {
            prefix: 'attack',
            tiles: tilesByKey,
            units,
            originKey: attackOriginKey,
            activeKey: interaction.hover?.tileKey,
            size: highBudget ? 34 : 32,
            style: TARGET_STYLE.hostile,
            startedAtMs: selection.selectedAtMs || 0,
            endingStartedAtMs: closingAttackKeys.length ? selection.deselectionStartedAtMs : 0
        });
        if (frame) targetFrames.push(frame);
    }

    // 连招预演目标：同敌意样式、缩小一号，与 Canvas 版本保持一致语义。
    const chainAttackKeys = interactionVisible ? (selection.chainAttackTileKeys || []) : [];
    for (const key of chainAttackKeys) {
        const frame = targetFrame(key, {
            prefix: 'chain-attack',
            tiles: tilesByKey,
            units,
            originKey: attackOriginKey,
            activeKey: interaction.hover?.tileKey,
            size: highBudget ? 30 : 28,
            style: TARGET_STYLE.hostile,
            startedAtMs: selection.selectedAtMs || 0,
            endingStartedAtMs: 0
        });
        if (frame) targetFrames.push(frame);
    }

    // Movement region: fills animate per tile (jelly reveal); the exterior
    // border also encloses the origin tile, exactly like Canvas
    // drawUnitActionTargetingPreview.
    const rangeRegions = [];
    const airRangeKeys = interactionVisible ? (selection.airRangeTileKeys || []) : [];
    if (airRangeKeys.length) {
        const geometry = outerRegionGeometry(airRangeKeys, tilesByKey, hexSize);
        rangeRegions.push({
            id: 'air-range',
            cells: [],
            edges: geometry.edges,
            fillPolygons: [],
            color: '#78c8ff',
            borderColor: '#78c8ff',
            innerLineColor: '#e6f5ff',
            fillAlpha: 0,
            lineAlpha: 0.62,
            linePulseAlpha: 0.13,
            lineWidth: 2.6,
            glowColor: '#5ab4ff',
            glowAlpha: 0.55,
            glowBlur: 7,
            glowPulseBlur: 4,
            innerLineAlpha: 0.40,
            innerLinePulseAlpha: 0.20,
            innerLineWidth: 1,
            pulsePeriodMs: 300,
            startedAtMs: selection.selectedAtMs || 0,
            endingStartedAtMs: 0,
            endingDurationMs: 220
        });
    }
    const normalMoveKeys = interactionVisible ? (selection.moveTileKeys || []) : [];
    const closingMoveKeys = normalMoveKeys.length ? [] : (selection.deselectMoveTileKeys || []);
    const moveKeys = normalMoveKeys.length ? normalMoveKeys : closingMoveKeys;
    if (moveKeys.length) {
        const originKey = selection.unitTileKey || selection.deselectOriginTileKey;
        const originCoord = coordinatesFromKey(originKey);
        const fillGeometry = outerRegionGeometry(moveKeys, tilesByKey, hexSize * 1.008);
        const borderKeys = originKey ? [...moveKeys, originKey] : moveKeys;
        const borderGeometry = outerRegionGeometry(borderKeys, tilesByKey, hexSize);
        const cells = moveKeys.map(key => {
            const tile = tilesByKey.get(key);
            const coord = coordinatesFromKey(key);
            if (!tile || tile.renderOnly || !coord) return null;
            return {
                x: tile.center.x,
                y: tile.center.y,
                size: hexSize,
                distance: originCoord ? hexDistanceByKey(originKey, key) : 0
            };
        }).filter(Boolean);
        rangeRegions.push({
            id: 'movement-range',
            cells,
            edges: borderGeometry.edges,
            fillPolygons: fillGeometry.cells,
            color: '#41cdb9',
            borderColor: '#50e1cd',
            innerLineColor: '#d7fff8',
            startedAtMs: selection.selectedAtMs || 0,
            endingStartedAtMs: closingMoveKeys.length ? selection.deselectionStartedAtMs : 0,
            endingDurationMs: 220
        });
    }

    // ── Operation routes (movement / melee / ranged) ───────────
    const routePaths = [];
    const pushAttackRoutePath = (action, sourcePos, targetPos) => {
        if (!sourcePos || !targetPos) return;
        if (action === 'melee') {
            const smoothed = buildSmoothOperationRoute([sourcePos, targetPos]);
            if (smoothed.points.length >= 2) {
                routePaths.push({
                    action: 'melee',
                    points: smoothed.points,
                    source: sourcePos,
                    target: targetPos,
                    color: '#e95b50',
                    unitRadius,
                    totalLength: smoothed.totalLength
                });
            }
            return;
        }
        const ranged = buildRangedOperationRoute(sourcePos, targetPos, unitRadius, 'arc');
        if (ranged.points.length >= 2) {
            routePaths.push({
                action: 'ranged',
                points: ranged.points,
                source: sourcePos,
                target: targetPos,
                color: '#e95b50',
                unitRadius,
                trajectory: 'arc',
                totalLength: ranged.totalLength
            });
        }
    };
    const pushMoveRoutePath = (sourcePos, targetPos, bfsKeys) => {
        if (!sourcePos || !targetPos || !Array.isArray(bfsKeys) || bfsKeys.length < 2) return;
        const bfsPixelPath = bfsKeys
            .map(key => tilesByKey.get(key))
            .filter(t => t && t.center)
            .map(t => ({ x: t.center.x, y: t.center.y }));
        if (bfsPixelPath.length < 2) return;
        const anchors = buildMoveOperationAnchors(sourcePos, targetPos, bfsPixelPath);
        const smooth = buildSmoothOperationRoute(anchors);
        if (smooth.points.length < 2) return;
        routePaths.push({
            action: 'move',
            points: smooth.points,
            source: sourcePos,
            target: targetPos,
            color: '#58c9b3',
            unitRadius,
            totalLength: smooth.totalLength
        });
    };
    if (route) {
        const sourceUnitDto = originUnit || null;
        const targetTile = route.targetKey ? tilesByKey.get(route.targetKey) : null;
        const targetUnitDto = route.targetKey
            ? snapshot.units.find(u => u.tileKey === route.targetKey && u.renderable)
            : null;
        // anchor:'tile'：攻击段从地块中心（预演落点/移动逻辑终点）出发，
        // 而不是跟随飞行中的单位徽章 —— 连招执行与移动动画期间防抖。
        const anchorTileCenter = route.anchor === 'tile' && route.sourceKey
            ? tilesByKey.get(route.sourceKey)?.center || null
            : null;
        const sourcePos = anchorTileCenter
            ? { x: anchorTileCenter.x, y: anchorTileCenter.y }
            : (sourceUnitDto?.visualCenter
                ? { x: sourceUnitDto.visualCenter.x, y: sourceUnitDto.visualCenter.y }
                : null);
        const targetUnitPos = targetUnitDto?.visualCenter
            ? { x: targetUnitDto.visualCenter.x, y: targetUnitDto.visualCenter.y }
            : null;
        const targetPos = route.action === 'move'
            ? (targetTile?.center ? { x: targetTile.center.x, y: targetTile.center.y } : null)
            : targetUnitPos;

        if (route.action === 'chain') {
            // 预演连招：A→B 行进段 + B→C 攻击段
            const viaCenter = route.viaKey ? tilesByKey.get(route.viaKey)?.center || null : null;
            const viaPos = viaCenter ? { x: viaCenter.x, y: viaCenter.y } : null;
            if (viaPos) {
                pushMoveRoutePath(sourcePos, viaPos, route.bfsKeys);
                pushAttackRoutePath(route.attackAction === 'melee' ? 'melee' : 'ranged', viaPos, targetUnitPos);
            }
        } else if (sourcePos && targetPos) {
            if (route.action === 'move') {
                pushMoveRoutePath(sourcePos, targetPos, route.bfsKeys);
            } else if (route.action === 'melee' || route.action === 'ranged') {
                pushAttackRoutePath(route.action, sourcePos, targetPos);
            }
        }
    }

    return createPixiSceneSnapshot({
        revision: signatureRevision(snapshot.signature),
        world: options.world || { x: 0, y: 0, scale: 1 },
        surface: {
            bounds: {
                x: 0,
                y: 0,
                width: snapshot.board.logicalWidth,
                height: snapshot.board.logicalHeight
            },
            color: options.backgroundColor || '#0c1518',
            // Hybrid modes must keep the page background visible behind the
            // board exactly like the transparent Canvas, otherwise switching
            // backends mid-game turns the stage black.
            alpha: (overlayOnly || !includeUnits) ? 0 : 1
        },
        tiles,
        boundaries: overlayOnly ? [] : [
            ...(snapshot.borders?.camp || []).map((edge, index) => borderDescriptor(edge, index, 'camp')),
            ...(snapshot.borders?.district || []).map((edge, index) => borderDescriptor(edge, index, 'district'))
        ],
        units: pixiUnits,
        originMarker,
        targetFrames,
        rangeRegions,
        routePaths
    });
}
