import { createPixiSceneSnapshot } from './pixiSceneSnapshot.js';

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

function hexPoints(center, size) {
    return Array.from({ length: 6 }, (_, index) => {
        const angle = Math.PI / 3 * (index + 0.5);
        return {
            x: center.x + Math.cos(angle) * size,
            y: center.y + Math.sin(angle) * size
        };
    });
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

function coordinatesFromKey(key) {
    const [q, r] = String(key || '').split(',').map(Number);
    return Number.isFinite(q) && Number.isFinite(r) ? { q, r } : null;
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

    const pixiUnits = overlayOnly ? [] : snapshot.units
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

    const interaction = snapshot.interaction || {};
    const selection = interaction.selection || {};
    const targeting = interaction.targeting || {};
    const airOriginId = targeting.air?.colonelOriginUnitId;
    const originUnit = airOriginId != null
        ? units.get(String(airOriginId))
        : units.get(String(selection.unitId));
    const originMarker = originUnit ? {
        x: originUnit.visualCenter.x,
        y: originUnit.visualCenter.y,
        radius: 22,
        color: airOriginId != null
            ? '#8ce8ff'
            : (selection.attackTileKeys?.length ? '#e95b50' : '#58c9b3'),
        motif: airOriginId != null ? 'plane' : 'origin',
        pulse: true,
        fillAlpha: highBudget ? 0.14 : 0.1,
        ringWidth: highBudget ? 2.1 : 1.75,
        hatchWidth: 1,
        hatchSpacing: 6
    } : null;

    const targetFrames = [];
    const normalAttackKeys = selection.attackTileKeys || [];
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

    if (targeting.active) {
        const style = TARGET_STYLE[targeting.intent] || TARGET_STYLE.hostile;
        const sourceUnit = targeting.sourceUnitId == null ? null : units.get(String(targeting.sourceUnitId));
        const sourceKey = sourceUnit?.tileKey || originUnit?.tileKey || null;
        const unitShape = targeting.shape === 'unit';
        for (const key of targeting.candidateTileKeys || []) {
            const frame = targetFrame(key, {
                prefix: `card-${targeting.cardId || 'target'}`,
                tiles: tilesByKey,
                units,
                originKey: sourceKey,
                activeKey: targeting.hoveredTileKey || interaction.hover?.tileKey,
                size: unitShape ? (highBudget ? 35 : 32) : (highBudget ? 29 : 27),
                style,
                startedAtMs: targeting.startedAtMs || 0
            });
            if (frame) targetFrames.push(frame);
        }
    }

    const rangeRegions = [];
    const normalMoveKeys = selection.moveTileKeys || [];
    const closingMoveKeys = normalMoveKeys.length ? [] : (selection.deselectMoveTileKeys || []);
    const moveKeys = normalMoveKeys.length ? normalMoveKeys : closingMoveKeys;
    if (moveKeys.length) {
        const geometry = outerRegionGeometry(moveKeys, tilesByKey, hexSize * 1.008);
        rangeRegions.push({
            id: 'movement-range',
            ...geometry,
            color: '#58d8d3',
            fillAlpha: highBudget ? 0.075 : 0.045,
            lineAlpha: highBudget ? 0.86 : 0.68,
            lineWidth: highBudget ? 3.1 : 2.5,
            startedAtMs: selection.selectedAtMs || 0,
            durationMs: 340,
            endingStartedAtMs: closingMoveKeys.length ? selection.deselectionStartedAtMs : 0,
            endingDurationMs: 240,
            phase: 0.18
        });
    }

    const rangeKeys = targeting.air?.rangeTileKeys || [];
    if (rangeKeys.length) {
        const geometry = outerRegionGeometry(rangeKeys, tilesByKey, hexSize * 1.008);
        rangeRegions.push({
            id: 'air-operation-range',
            ...geometry,
            color: '#70cfff',
            fillAlpha: highBudget ? 0.05 : 0.032,
            lineAlpha: highBudget ? 0.86 : 0.72,
            lineWidth: highBudget ? 2.8 : 2.2,
            startedAtMs: targeting.startedAtMs || 0,
            durationMs: 380
        });
    }

    const antiAirCells = (targeting.air?.aaCoverage || []).map((entry, index) => {
        const tile = tilesByKey.get(entry.tileKey);
        if (!tile || tile.renderOnly) return null;
        return {
            id: `aa-${entry.tileKey}`,
            points: hexPoints(tile.center, hexSize * 0.97),
            x: tile.center.x,
            y: tile.center.y,
            radius: hexSize * 0.78,
            level: entry.layers,
            color: '#efb54c',
            alpha: highBudget ? 0.68 : 0.54,
            startedAtMs: targeting.startedAtMs || 0,
            delayMs: hexDistanceByKey(originUnit?.tileKey, entry.tileKey) * 22,
            durationMs: 310,
            phase: index * 0.19
        };
    }).filter(Boolean);

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
            alpha: overlayOnly ? 0 : 1
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
        antiAirCells
    });
}
