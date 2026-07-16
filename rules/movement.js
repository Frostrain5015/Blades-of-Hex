// Pure surface and hydrography movement rules shared by BFS, AI and final
// execution validation. Presentation code must not duplicate these checks.
import { HEX_NEIGHBORS } from './hex.js';
import { canonicalRiverSegmentKey } from './hydrography.js';
import { getTileSurface, isLandTile, isWaterTile, SURFACE_KIND, tileCoordinateKey } from './surfaces.js';
import { UNIT_CONFIG } from './units.js';

export const MOVEMENT_DOMAIN = Object.freeze({
    LAND: 'land',
    NAVAL: 'naval',
    AMPHIBIOUS: 'amphibious'
});

export const MOVEMENT_DOMAINS = Object.freeze(Object.values(MOVEMENT_DOMAIN));

export const RIVER_MOVEMENT = Object.freeze({
    STREAM_EXTRA_COST: 1,
    FORD_EXTRA_COST: 2
});

export const TRANSPORT_RULES = Object.freeze({
    speedCap: 4,
    baseAttack: 20,
    baseDefense: -0.25,
    deepWaterBaseDefense: -0.50,
    range: 1,
    effectLabel: '运输状态',
    effectIcon: '⚓',
    effectDescription: '正处于海洋地块，攻击力下降至20，防御力下降至-25%',
    deepWaterEffectDescription: '正处于深水地块，攻击力下降至20，防御力下降至-50%'
});
export const TRANSPORT_SPEED_CAP = TRANSPORT_RULES.speedCap;

function isPlayableTile(tile) {
    return !!tile && tile.renderOnly !== true && tile.playable !== false;
}

export function normalizeMovementDomain(domain) {
    return MOVEMENT_DOMAINS.includes(domain) ? domain : MOVEMENT_DOMAIN.LAND;
}

export function getUnitMovementDomain(unitOrType) {
    if (typeof unitOrType === 'string') {
        return normalizeMovementDomain(UNIT_CONFIG[unitOrType]?.movementDomain);
    }
    const type = unitOrType?.type;
    return normalizeMovementDomain(
        unitOrType?.movementDomain
        ?? unitOrType?.config?.movementDomain
        ?? UNIT_CONFIG[type]?.movementDomain
    );
}

export function isEmbarkableLandUnit(unitOrType) {
    const type = typeof unitOrType === 'string' ? unitOrType : unitOrType?.type;
    const config = typeof unitOrType === 'object' && unitOrType?.config
        ? unitOrType.config
        : UNIT_CONFIG[type];
    return normalizeMovementDomain(config?.movementDomain) === MOVEMENT_DOMAIN.LAND
        && Number(config?.speed) > 0
        && type !== 'drone';
}

export function areCommanderMechanicsSuppressed(unit) {
    return unit?.isEmbarked === true && isEmbarkableLandUnit(unit);
}

export function getUnitCombatRange(unit) {
    if (unit?.isEmbarked === true && isEmbarkableLandUnit(unit)) return TRANSPORT_RULES.range;
    return Math.max(1, (Number(unit?.config?.range) || 1) + (Number(unit?._rankPanelRangeBonus) || 0));
}

export function getTransportBaseDefense(unit) {
    if (unit?.isEmbarked !== true || !isEmbarkableLandUnit(unit)) return null;
    return getTileSurface(unit.tile) === SURFACE_KIND.DEEP_WATER
        ? TRANSPORT_RULES.deepWaterBaseDefense
        : TRANSPORT_RULES.baseDefense;
}

export function canUnitAssaultOccupiedTile(unit, targetTile) {
    return !!unit && !!targetTile;
}

export function isPortTile(tile, state = null) {
    if (!isPlayableTile(tile)) return false;
    if (tile.isPort === true) return true;
    return state?.portTiles?.has?.(tileCoordinateKey(tile)) === true;
}

/**
 * Movement-surface check: port tiles count as water so that naval domain
 * never gets a surface bridge to adjacent land tiles.  The tile's visual
 * surface (land with port buildings) is intentionally unchanged.
 */
export function isMovementWaterTile(tile, state = null) {
    return isWaterTile(tile) || isPortTile(tile, state);
}

/** Whether the unit may legally finish an action on this real board tile. */
export function canUnitOccupyTile(unitOrType, tile, state = null) {
    if (!isPlayableTile(tile)) return false;
    // 无人机（天眼哨机）是空军单位，不受陆地/水域限制
    if (unitOrType?._isDrone) return true;
    const domain = getUnitMovementDomain(unitOrType);
    if (domain === MOVEMENT_DOMAIN.NAVAL) {
        return isMovementWaterTile(tile, state);
    }
    if (domain === MOVEMENT_DOMAIN.AMPHIBIOUS) {
        return isLandTile(tile) || isWaterTile(tile);
    }
    return isLandTile(tile) || (unitOrType?.isEmbarked === true && isWaterTile(tile));
}

/** Deployments, air drops and fortifications are intentionally land-only. */
export function isLandDeploymentTile(tile) {
    return isPlayableTile(tile) && isLandTile(tile);
}

function neighborIndex(fromTile, toTile) {
    const dq = toTile?.q - fromTile?.q;
    const dr = toTile?.r - fromTile?.r;
    return HEX_NEIGHBORS.findIndex(([nq, nr]) => nq === dq && nr === dr);
}

/** Canonical hydrography segment key for the shared edge of adjacent hexes. */
export function sharedHexEdgeSegmentKey(fromTile, toTile) {
    const index = neighborIndex(fromTile, toTile);
    if (index < 0) return null;
    const firstVertex = (5 - index + 6) % 6;
    const secondVertex = (firstVertex + 1) % 6;
    return canonicalRiverSegmentKey(
        { q: fromTile.q, r: fromTile.r, vertex: firstVertex },
        { q: fromTile.q, r: fromTile.r, vertex: secondVertex }
    );
}

function isCoastalLandTile(tile, state, adjacentWaterTile = null) {
    if (!isLandTile(tile)) return false;
    if (isPortTile(tile, state)) return true;
    if (adjacentWaterTile && neighborIndex(tile, adjacentWaterTile) >= 0 && isWaterTile(adjacentWaterTile)) {
        return true;
    }
    const map = state?.tileMap;
    if (!map?.get) return false;
    return HEX_NEIGHBORS.some(([dq, dr]) => isWaterTile(map.get(`${tile.q + dq},${tile.r + dr}`)));
}

function canTraverseSurfaceBoundary(unitOrType, fromTile, toTile, state) {
    if (isEmbarkableLandUnit(unitOrType)) {
        return (isLandTile(fromTile) || isWaterTile(fromTile))
            && (isLandTile(toTile) || isWaterTile(toTile));
    }
    if (!canUnitOccupyTile(unitOrType, fromTile, state)
        || !canUnitOccupyTile(unitOrType, toTile, state)) return false;

    const domain = getUnitMovementDomain(unitOrType);
    if (domain !== MOVEMENT_DOMAIN.AMPHIBIOUS) return true;
    const changesSurface = isWaterTile(fromTile) !== isWaterTile(toTile);
    if (!changesSurface) return true;
    const landTile = isLandTile(fromTile) ? fromTile : toTile;
    const waterTile = landTile === fromTile ? toTile : fromTile;
    return isCoastalLandTile(landTile, state, waterTile);
}

/** Resolve the river rule on one adjacent movement edge. */
export function resolveRiverMovement(fromTile, toTile, state = null) {
    const segmentKey = sharedHexEdgeSegmentKey(fromTile, toTile);
    const topology = state?.riverTopology;
    const segments = segmentKey ? topology?.segmentsByKey?.get?.(segmentKey) : null;
    if (!segments?.length) {
        return Object.freeze({ segmentKey, kind: null, blocked: false, extraCost: 0 });
    }

    const crossings = topology?.crossingsBySegment?.get?.(segmentKey) || [];
    if (crossings.some(crossing => crossing?.kind === 'bridge')) {
        return Object.freeze({ segmentKey, kind: 'bridge', blocked: false, extraCost: 0 });
    }
    if (crossings.some(crossing => crossing?.kind === 'ford')) {
        return Object.freeze({
            segmentKey,
            kind: 'ford',
            blocked: false,
            extraCost: RIVER_MOVEMENT.FORD_EXTRA_COST
        });
    }
    // Direct river crossing (no bridge/ford): costs all remaining movement.
    return Object.freeze({ segmentKey, kind: 'river', blocked: false, extraCost: 0, drainRemaining: true });
}

/**
 * Resolve one adjacent step. `baseCost` remains owned by terrain/weather rules;
 * this function adds surface and river constraints without mutating state.
 */
export function resolveMovementStep(unitOrType, fromTile, toTile, state = null, options = {}) {
    if (neighborIndex(fromTile, toTile) < 0) {
        return Object.freeze({ allowed: false, reason: 'not-adjacent', cost: Infinity, requiresFullCost: true });
    }
    if (!canTraverseSurfaceBoundary(unitOrType, fromTile, toTile, state)) {
        return Object.freeze({ allowed: false, reason: 'surface', cost: Infinity, requiresFullCost: true });
    }

    const baseCost = Number.isFinite(options.baseCost) && options.baseCost >= 0
        ? options.baseCost
        : 1;
    const domain = getUnitMovementDomain(unitOrType);
    const embarking = isEmbarkableLandUnit(unitOrType) && isLandTile(fromTile) && isWaterTile(toTile);
    const disembarking = isEmbarkableLandUnit(unitOrType) && isWaterTile(fromTile) && isLandTile(toTile);
    if (embarking && unitOrType?.commander === 'martyr' && unitOrType?._martyrPrimed) {
        return Object.freeze({ allowed: false, reason: 'martyr-primed', cost: Infinity, requiresFullCost: true });
    }
    // Rivers are obstacles only when a step crosses an edge between two land
    // cells. A river segment may visually meet a coast, but it must not block
    // a ship docking at a port or an amphibious unit changing surface there.
    const crossesLandRiver = domain !== MOVEMENT_DOMAIN.NAVAL
        && isLandTile(fromTile)
        && isLandTile(toTile);
    const river = !crossesLandRiver
        ? Object.freeze({ segmentKey: sharedHexEdgeSegmentKey(fromTile, toTile), kind: null, blocked: false, extraCost: 0 })
        : resolveRiverMovement(fromTile, toTile, state);
    if (river.blocked) {
        return Object.freeze({ allowed: false, reason: 'river', cost: Infinity, requiresFullCost: true, river });
    }
    return Object.freeze({
        allowed: true,
        reason: null,
        cost: baseCost + river.extraCost,
        requiresFullCost: river.extraCost > 0,
        drainRemaining: river.drainRemaining === true || (embarking && !isPortTile(toTile, state)),
        transportSpeedCap: embarking ? TRANSPORT_SPEED_CAP : null,
        embarking,
        disembarking,
        river
    });
}
