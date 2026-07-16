// Read-only, renderer-backend-neutral battlefield scene extraction.
//
// The returned value contains only JSON-compatible primitives, arrays and plain
// objects. Runtime Tile / Unit instances, Map / Set collections and callbacks
// never cross the renderer boundary.

import {
    BOARD_LAYOUT,
    axialToBoardPixel,
    getViewportHexCoordinates,
    isBoardHexFullyVisible,
    normalizeBoardLayout
} from '../../rules/boardLayout.js';
import { campToKey } from '../../rules/camps.js';
import { BOARD_RULES } from '../../rules/constants.js';
import { getFactionKeys, getRelation } from '../../rules/diplomacy.js';
import { HEX_NEIGHBORS } from '../../rules/hex.js';
import { isMechanicEnabled } from '../../rules/mechanics.js';
import { getSurfaceBaseColor, getTileSurface, isWaterSurface } from '../../rules/surfaces.js';
import { resolveTargetingPreview, targetingTileKey } from '../../rules/targeting.js';
import { operationArrowStyleForAttacker } from '../../rules/attackPresentation.js';

export const BATTLEFIELD_SNAPSHOT_VERSION = 1;
export const BATTLEFIELD_SNAPSHOT_KIND = 'blades-of-hex/battlefield';

const VISIBILITY_STATES = new Set(['visible', 'explored', 'unexplored']);
const TARGET_KIND_ORDER = Object.freeze(['move', 'attack', 'card']);

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function optionalFinite(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function text(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}

function primitiveId(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return null;
}

function tileKey(q, r) {
    return `${q},${r}`;
}

function keyFromTile(tile) {
    return targetingTileKey(tile);
}

// Sort comparators call this O(n log n) times per snapshot at a 20Hz cadence;
// the key space is bounded by board size, so memoization is safe and hot.
const parsedTileKeyCache = new Map();

function parseTileKey(key) {
    const cached = parsedTileKeyCache.get(key);
    if (cached !== undefined) return cached;
    const [q, r] = String(key).split(',').map(Number);
    const parsed = Number.isFinite(q) && Number.isFinite(r) ? { q, r } : null;
    parsedTileKeyCache.set(key, parsed);
    return parsed;
}

function compareTileKeys(left, right) {
    const a = parseTileKey(left);
    const b = parseTileKey(right);
    if (!a || !b) return String(left).localeCompare(String(right));
    return a.r - b.r || a.q - b.q || String(left).localeCompare(String(right));
}

function sortedUniqueKeys(values, allowed = null) {
    const keys = new Set();
    for (const value of values || []) {
        const key = typeof value === 'string' ? value : keyFromTile(value);
        if (key && (!allowed || allowed.has(key))) keys.add(key);
    }
    return [...keys].sort(compareTileKeys);
}

function collectionAt(record, key) {
    if (record instanceof Map) return record.get(key);
    return record?.[key];
}

function collectionHas(collection, key) {
    if (!collection) return false;
    if (typeof collection.has === 'function') return collection.has(key);
    if (Array.isArray(collection)) return collection.includes(key);
    return Boolean(collection[key]);
}

function clonePoint(point, fallback = null) {
    const x = optionalFinite(point?.x);
    const y = optionalFinite(point?.y);
    if (x === null || y === null) return fallback;
    return { x, y };
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function fnv1a32(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function resolveViewerCamp(gameState, options) {
    const explicit = options.viewingCamp ?? options.viewerCampKey;
    if (explicit) return campToKey(explicit);
    if (gameState.campaignMode && gameState.localPlayerCampKey) return campToKey(gameState.localPlayerCampKey);
    if (gameState.gameMode === 'pve') {
        const human = Object.values(gameState.factions || {}).find(faction => faction?.controller === 'human');
        if (human) return campToKey(human);
    }
    return campToKey(gameState.currentCamp);
}

function resolveVisibility(tile, gameState, viewerCampKey, options) {
    if (typeof options.getVisibilityState === 'function') {
        const resolved = options.getVisibilityState(tile, viewerCampKey, gameState);
        if (VISIBILITY_STATES.has(resolved)) return resolved;
    }
    const override = collectionAt(options.visibilityByTileKey, keyFromTile(tile));
    if (VISIBILITY_STATES.has(override)) return override;
    if (!gameState.skirmishFog || !isMechanicEnabled(gameState, 'fogOfWar') || viewerCampKey === 'neutral') {
        return 'visible';
    }

    const key = keyFromTile(tile);
    if (collectionHas(collectionAt(gameState.visibleTiles, viewerCampKey), key)) return 'visible';
    if (isMechanicEnabled(gameState, 'alliedVision')) {
        for (const factionKey of getFactionKeys(gameState)) {
            if (factionKey === viewerCampKey) continue;
            if (getRelation(gameState, viewerCampKey, factionKey) !== 'ally') continue;
            if (collectionHas(collectionAt(gameState.visibleTiles, factionKey), key)) return 'visible';
        }
    }

    if (collectionHas(collectionAt(gameState.exploredTiles, viewerCampKey), key)) return 'explored';
    if (isMechanicEnabled(gameState, 'alliedVision')) {
        for (const factionKey of getFactionKeys(gameState)) {
            if (factionKey === viewerCampKey) continue;
            if (getRelation(gameState, viewerCampKey, factionKey) !== 'ally') continue;
            if (collectionHas(collectionAt(gameState.exploredTiles, factionKey), key)) return 'explored';
        }
    }
    return 'unexplored';
}

function buildPlayableTiles(gameState) {
    const sourceTiles = Array.isArray(gameState.tiles) ? gameState.tiles : [];
    const sourceMap = gameState.tileMap instanceof Map ? gameState.tileMap : null;
    const byKey = new Map();
    for (const tile of sourceTiles) {
        const key = keyFromTile(tile);
        if (!key || byKey.has(key)) continue;
        if (sourceMap && sourceMap.get(key) !== tile) continue;
        byKey.set(key, tile);
    }
    return [...byKey.entries()]
        .sort(([left], [right]) => compareTileKeys(left, right))
        .map(([key, tile]) => ({ key, tile }));
}

function surfaceFromTile(tile) {
    const kind = getTileSurface(tile);
    const campColor = text(tile.camp?.color, '#777777');
    const materialColor = getSurfaceBaseColor(kind);
    const currentColor = materialColor || text(tile.currentColor, text(tile.targetColor, campColor));
    const startColor = text(tile.startColor, currentColor);
    const targetColor = materialColor || text(tile.targetColor, currentColor);
    const transitionStartedAtMs = optionalFinite(tile.fadeStartTime);
    const transitionDurationMs = optionalFinite(tile.fadeDuration);
    const transitioning = transitionStartedAtMs !== null
        && transitionStartedAtMs > 0
        && transitionDurationMs !== null
        && transitionDurationMs > 0
        && startColor !== targetColor;
    return {
        kind,
        color: transitioning ? startColor : currentColor,
        transition: transitioning ? {
            from: startColor,
            to: targetColor,
            startedAtMs: transitionStartedAtMs,
            durationMs: transitionDurationMs
        } : null,
        inheritedFromKey: null
    };
}

function cityFromTile(tile) {
    if (!tile.isCity && !tile.isVillage) return null;
    return {
        kind: tile.isCity ? 'city' : 'village',
        districtId: finite(tile.isVillage ? tile.villageDistrictId : tile.districtId, 0),
        occupied: Boolean(tile.unit),
        disabledUntilRound: tile.isCity ? finite(tile._cityDisabledUntil, 0) : 0,
        reinforcedThisTurn: tile.isCity ? Boolean(tile._reinforcedThisTurn) : false
    };
}

function buildRealTileDto(entry, gameState, viewerCampKey, options) {
    const { key, tile } = entry;
    const surface = surfaceFromTile(tile);
    const water = isWaterSurface(surface.kind);
    return {
        id: primitiveId(tile.id),
        key,
        q: finite(tile.q),
        r: finite(tile.r),
        s: finite(tile.s, -finite(tile.q) - finite(tile.r)),
        center: {
            x: finite(tile.x, axialToBoardPixel(tile.q, tile.r).x),
            y: finite(tile.y, axialToBoardPixel(tile.q, tile.r).y)
        },
        playable: true,
        renderOnly: false,
        campKey: water ? null : campToKey(tile.camp),
        districtId: water ? null : finite(tile.districtId, 0),
        visibility: resolveVisibility(tile, gameState, viewerCampKey, options),
        surface,
        terrain: { type: text(tile.terrain, 'plains') },
        fortification: tile.fortification ? { type: text(tile.fortification) } : null,
        installation: tile.installation ? {
            type: text(tile.installation.type),
            status: text(tile.installation.status, 'ready')
        } : null,
        city: cityFromTile(tile),
        unitId: primitiveId(tile.unit?.id)
    };
}

function nearestRealTileDto(q, r, realTiles) {
    const point = axialToBoardPixel(q, r);
    let best = null;
    let bestDistance = Infinity;
    for (const tile of realTiles) {
        const dx = tile.center.x - point.x;
        const dy = tile.center.y - point.y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = tile;
        }
    }
    return best;
}

function buildBorderlessFillers(realTiles, realKeySet) {
    if (!realTiles.length) return [];
    const fillers = [];
    for (const coordinate of getViewportHexCoordinates({ includePartial: true })) {
        const key = tileKey(coordinate.q, coordinate.r);
        if (realKeySet.has(key) || isBoardHexFullyVisible(coordinate.q, coordinate.r)) continue;
        const source = nearestRealTileDto(coordinate.q, coordinate.r, realTiles);
        if (!source) continue;
        const center = axialToBoardPixel(coordinate.q, coordinate.r);
        fillers.push({
            id: null,
            key,
            q: coordinate.q,
            r: coordinate.r,
            s: -coordinate.q - coordinate.r,
            center: { x: center.x, y: center.y },
            playable: false,
            renderOnly: true,
            campKey: source.campKey,
            districtId: source.districtId,
            visibility: source.visibility,
            surface: {
                kind: source.surface.kind,
                color: source.surface.color,
                transition: source.surface.transition ? { ...source.surface.transition } : null,
                inheritedFromKey: source.key
            },
            terrain: null,
            fortification: null,
            installation: null,
            city: null,
            unitId: null
        });
    }
    return fillers.sort((left, right) => compareTileKeys(left.key, right.key));
}

function cloneMotion(unit, tileDto) {
    const path = Array.isArray(unit.movePath)
        ? unit.movePath.map(point => clonePoint(point)).filter(Boolean)
        : [];
    if (path.length < 2) {
        return {
            visualCenter: { ...tileDto.center },
            motion: null
        };
    }
    return {
        visualCenter: { ...path[0] },
        motion: {
            path,
            startedAtMs: finite(unit.movePathStart, 0),
            durationMs: Math.max(0, finite(unit.movePathDuration, 0))
        }
    };
}

function buildUnitDto(unit, tileDto, relationToViewer) {
    const healthCurrent = finite(unit.hp, 0);
    const healthMax = Math.max(1, finite(unit.maxHp, healthCurrent || 1));
    const shieldCurrent = Math.max(0, finite(unit._shield ?? unit.shield, 0));
    const shieldMax = Math.max(shieldCurrent, finite(unit._shieldMax ?? unit.shieldMax, shieldCurrent));
    const commanderId = text(unit.commander, '');
    const storyCommanderId = text(unit.storyCommanderId, '');
    const commanderName = text(unit.commanderName, '');
    const commanderPortrait = text(unit.commanderPortrait, '');
    const commander = commanderId || storyCommanderId || commanderName || commanderPortrait ? {
        id: commanderId || null,
        storyId: storyCommanderId || null,
        name: commanderName,
        portraitId: commanderPortrait || commanderId || null
    } : null;
    const movement = cloneMotion(unit, tileDto);

    return {
        id: primitiveId(unit.id),
        type: text(unit.type, 'unknown'),
        campKey: campToKey(unit.camp),
        relationToViewer: text(relationToViewer, 'unknown'),
        tileKey: tileDto.key,
        visualCenter: movement.visualCenter,
        motion: movement.motion,
        visibility: tileDto.visibility,
        renderable: tileDto.visibility === 'visible' && healthCurrent > 0,
        health: {
            current: healthCurrent,
            max: healthMax,
            ratio: Math.max(0, Math.min(1, healthCurrent / healthMax))
        },
        shield: {
            current: shieldCurrent,
            max: shieldMax,
            turns: Math.max(0, finite(unit._shieldTurns ?? unit.shieldTurns, 0))
        },
        action: {
            canAct: Boolean(unit.canAct),
            movedThisTurn: Boolean(unit.movedThisTurn),
            isNewRecruit: Boolean(unit.isNewRecruit),
            remainingMovePoints: Math.max(0, finite(unit.remainingMP, 0))
        },
        morale: finite(unit.morale ?? unit._morale, 2),
        rank: Math.max(0, finite(unit.rank ?? unit._rank, 0)),
        commander,
        presentation: {
            fallen: Boolean(unit._fallen),
            poisoned: Boolean(unit._poison),
            poisonTicks: Math.max(0, finite(unit._poison?.remainingTicks, 0)),
            airdropWaiting: Boolean(unit._airdropWaiting),
            airliftLandAtMs: optionalFinite(unit._airliftLandAt),
            soulRecallLandAtMs: optionalFinite(unit._soulRecallLandAt),
            embarked: Boolean(unit.isEmbarked)
        }
    };
}

function buildUnits(playableEntries, realTileDtos, gameState, viewerCampKey) {
    const dtoByKey = new Map(realTileDtos.map(tile => [tile.key, tile]));
    const units = [];
    for (const entry of playableEntries) {
        if (!entry.tile.unit) continue;
        units.push(buildUnitDto(
            entry.tile.unit,
            dtoByKey.get(entry.key),
            getRelation(gameState, viewerCampKey, entry.tile.unit.camp)
        ));
    }
    return units.sort((left, right) => compareTileKeys(left.tileKey, right.tileKey)
        || String(left.id).localeCompare(String(right.id)));
}

function buildCamps(gameState, playableEntries) {
    const references = new Map();
    for (const [key, faction] of Object.entries(gameState.factions || {})) references.set(key, faction);
    for (const { tile } of playableEntries) {
        if (!isWaterSurface(getTileSurface(tile))) references.set(campToKey(tile.camp), tile.camp);
        if (tile.unit) references.set(campToKey(tile.unit.camp), tile.unit.camp);
    }
    return [...references.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, faction]) => ({
            key,
            name: text(faction?.name, key),
            colorId: text(faction?.colorId, '') || null,
            color: text(faction?.color, '#777777'),
            flag: text(faction?.flag, '')
        }));
}

// Hex vertex offsets precomputed once: the border scan runs at the snapshot
// cadence and previously paid four trig calls per emitted edge.
const HEX_EDGE_OFFSETS = Array.from({ length: 6 }, (_, index) => {
    const firstAngle = Math.PI / 3 * (index + 0.5);
    const secondAngle = Math.PI / 3 * (((index + 1) % 6) + 0.5);
    return Object.freeze({
        x0: Math.cos(firstAngle) * BOARD_RULES.hexSize,
        y0: Math.sin(firstAngle) * BOARD_RULES.hexSize,
        x1: Math.cos(secondAngle) * BOARD_RULES.hexSize,
        y1: Math.sin(secondAngle) * BOARD_RULES.hexSize
    });
});

function hexEdge(center, edgeIndex) {
    const offset = HEX_EDGE_OFFSETS[edgeIndex];
    return {
        x0: center.x + offset.x0,
        y0: center.y + offset.y0,
        x1: center.x + offset.x1,
        y1: center.y + offset.y1
    };
}

// Single neighbor scan produces both border kinds; the previous per-kind
// implementation walked all tiles twice and rebuilt the key map both times.
function computeBorders(renderTiles, byKey) {
    const camp = [];
    const district = [];
    for (const tile of renderTiles) {
        const tileWater = isWaterSurface(tile.surface?.kind);
        for (let neighborIndex = 0; neighborIndex < HEX_NEIGHBORS.length; neighborIndex++) {
            const [dq, dr] = HEX_NEIGHBORS[neighborIndex];
            const neighborKey = tileKey(tile.q + dq, tile.r + dr);
            const neighbor = byKey.get(neighborKey);
            if (!neighbor || tile.key.localeCompare(neighbor.key) >= 0) continue;
            if (tileWater || isWaterSurface(neighbor.surface?.kind)) continue;
            const differentCamp = tile.campKey !== neighbor.campKey;
            const target = differentCamp
                ? camp
                : (tile.districtId !== neighbor.districtId ? district : null);
            if (!target) continue;
            const edgeIndex = (5 - neighborIndex + 6) % 6;
            target.push({
                ...hexEdge(tile.center, edgeIndex),
                aKey: tile.key,
                bKey: neighbor.key,
                qa: tile.q,
                ra: tile.r,
                qb: neighbor.q,
                rb: neighbor.r
            });
        }
    }
    return { camp: sortBorderEdges(camp), district: sortBorderEdges(district) };
}

function cloneBorderEdges(source, renderKeySet, renderByKey) {
    const edges = [];
    for (const edge of Array.isArray(source) ? source : []) {
        const x0 = optionalFinite(edge?.x0);
        const y0 = optionalFinite(edge?.y0);
        const x1 = optionalFinite(edge?.x1);
        const y1 = optionalFinite(edge?.y1);
        if ([x0, y0, x1, y1].some(value => value === null)) continue;
        const qa = optionalFinite(edge.qa);
        const ra = optionalFinite(edge.ra);
        const qb = optionalFinite(edge.qb);
        const rb = optionalFinite(edge.rb);
        const aKey = qa === null || ra === null ? null : tileKey(qa, ra);
        const bKey = qb === null || rb === null ? null : tileKey(qb, rb);
        if ((aKey && !renderKeySet.has(aKey)) || (bKey && !renderKeySet.has(bKey))) continue;
        if (aKey && bKey) {
            const aTile = renderByKey.get(aKey);
            const bTile = renderByKey.get(bKey);
            if (isWaterSurface(aTile?.surface?.kind) || isWaterSurface(bTile?.surface?.kind)) continue;
        }
        edges.push({ x0, y0, x1, y1, aKey, bKey, qa, ra, qb, rb });
    }
    return sortBorderEdges(edges);
}

function sortBorderEdges(edges) {
    return edges.sort((left, right) => compareTileKeys(left.aKey || '', right.aKey || '')
        || compareTileKeys(left.bKey || '', right.bKey || '')
        || left.x0 - right.x0
        || left.y0 - right.y0);
}

function cloneAirSource(source) {
    return {
        kind: text(source?.kind, 'unknown'),
        tileKey: text(source?.tileKey, '') || null,
        q: optionalFinite(source?.q),
        r: optionalFinite(source?.r),
        campKey: text(source?.campKey, '') || null,
        unitId: primitiveId(source?.unitId),
        unitType: text(source?.unitType, '') || null,
        commander: text(source?.commander, '') || null,
        ownerKnown: source?.ownerKnown === undefined ? null : Boolean(source.ownerKnown),
        providers: Array.isArray(source?.providers)
            ? source.providers.filter(value => typeof value === 'string').slice().sort()
            : [],
        provider: typeof source?.provider === 'string' ? source.provider : null,
        reduction: Math.max(0, finite(source?.reduction, 0))
    };
}

function entriesOf(value) {
    if (value instanceof Map) return [...value.entries()];
    if (value && typeof value === 'object') return Object.entries(value);
    return [];
}

function buildAirDto(air, playableKeySet) {
    if (!air) return null;
    const sourcesByKey = new Map(entriesOf(air.aaSourcesByTileKey));
    const aaCoverage = entriesOf(air.aaLayersByTileKey)
        .filter(([key]) => playableKeySet.has(key))
        .map(([key, layers]) => ({
            tileKey: key,
            layers: Math.max(0, Math.min(2, Math.trunc(finite(layers, 0)))),
            sources: (sourcesByKey.get(key) || []).map(cloneAirSource)
        }))
        .sort((left, right) => compareTileKeys(left.tileKey, right.tileKey));
    return {
        grounded: Boolean(air.grounded),
        colonelOriginUnitId: primitiveId(air.colonelOriginUnitId),
        transportSourceUnitId: primitiveId(air.transportSourceUnitId),
        rangeTileKeys: sortedUniqueKeys(air.rangeTileKeys, playableKeySet),
        aaCoverage
    };
}

function reconstructBfsKeys(gameState, startTileKey, endTileKey, sourceByKey) {
    if (!(gameState.moveParents instanceof Map)) return [];
    const startTile = startTileKey ? sourceByKey.get(startTileKey) : null;
    const endTile = endTileKey ? sourceByKey.get(endTileKey) : null;
    if (!startTile || !endTile) return [];
    const reversed = [];
    const visited = new Set();
    let current = endTile;
    while (current && !visited.has(current)) {
        visited.add(current);
        const key = keyFromTile(current);
        if (!key) break;
        reversed.push(key);
        if (current === startTile) return reversed.reverse();
        current = gameState.moveParents.get(current)?.parent || null;
    }
    return [];
}

function buildRoutePath(gameState, sourceByKey, playableKeySet, selectedUnitTileKey, selectedUnit, hoveredTileKey, moveTileKeys, attackTileKeys, chainTileKeys) {
    if (!selectedUnitTileKey) return null;
    // `selectedUnit` here is the runtime Unit instance, so gate on its direct
    // fields exactly like Canvas drawOperationInteractionRoute does.
    if (!selectedUnit || !selectedUnit.canAct || selectedUnit.isNewRecruit) return null;
    if (gameState.aiActing || gameState.cardTargeting) return null;

    const isRanged = operationArrowStyleForAttacker(selectedUnit) === 'fire';
    const attackAction = isRanged ? 'ranged' : 'melee';

    // 连招执行中（与 hover 无关）：攻击段锚定落点 B，等待单位抵达开火。
    const pending = gameState.pendingChainAttack;
    if (pending && pending.unit === selectedUnit
        && pending.targetUnit?.tile?.unit === pending.targetUnit) {
        const viaKey = keyFromTile(pending.viaTile);
        const targetKey = keyFromTile(pending.targetUnit.tile);
        if (viaKey && targetKey && playableKeySet.has(viaKey) && playableKeySet.has(targetKey)) {
            return { action: attackAction, sourceKey: viaKey, targetKey, anchor: 'tile' };
        }
    }

    if (!hoveredTileKey) return null;
    const hoveredUnit = sourceByKey.get(hoveredTileKey)?.unit || null;
    const isMove = !hoveredUnit && moveTileKeys.includes(hoveredTileKey)
        && Math.max(0, finite(selectedUnit.remainingMP, 0)) > 0;
    const isAttack = Boolean(hoveredUnit) && attackTileKeys.includes(hoveredTileKey);
    const isChain = Boolean(hoveredUnit) && !isAttack && chainTileKeys.includes(hoveredTileKey);
    if (!isMove && !isAttack && !isChain) return null;

    if (isMove) {
        const bfsKeys = reconstructBfsKeys(gameState, selectedUnitTileKey, hoveredTileKey, sourceByKey);
        if (bfsKeys.length < 2) return null;
        return { action: 'move', sourceKey: selectedUnitTileKey, targetKey: hoveredTileKey, bfsKeys };
    }

    if (isChain) {
        // 预演连招：A→B 行进段 + B→C 攻击段（B 为预演落点）
        const viaTile = gameState.chainAttackPlans?.get(sourceByKey.get(hoveredTileKey)) || null;
        const viaKey = viaTile ? keyFromTile(viaTile) : null;
        if (!viaKey || !playableKeySet.has(viaKey)) return null;
        const bfsKeys = reconstructBfsKeys(gameState, selectedUnitTileKey, viaKey, sourceByKey);
        return {
            action: 'chain',
            sourceKey: selectedUnitTileKey,
            viaKey,
            targetKey: hoveredTileKey,
            bfsKeys,
            attackAction
        };
    }

    // 移动动画尚未走完时，攻击线锚定逻辑落点而非飞行中的单位（防抖）。
    const nowMs = globalThis.performance?.now?.() ?? Date.now();
    const moveAnimating = Boolean(selectedUnit.movePath)
        && nowMs - finite(selectedUnit.movePathStart, 0) < finite(selectedUnit.movePathDuration, 0);
    return {
        action: attackAction,
        sourceKey: selectedUnitTileKey,
        targetKey: hoveredTileKey,
        ...(moveAnimating ? { anchor: 'tile' } : {})
    };
}

function buildInteraction(gameState, playableEntries, playableKeySet, viewerCampKey, options) {
    const sourceByKey = new Map(playableEntries.map(entry => [entry.key, entry.tile]));
    const validKey = tile => {
        const key = keyFromTile(tile);
        return key && playableKeySet.has(key) ? key : null;
    };
    const moveTileKeys = sortedUniqueKeys(gameState.movableTiles, playableKeySet);
    const attackTileKeys = sortedUniqueKeys(gameState.attackableTiles, playableKeySet);
    const chainAttackTileKeys = sortedUniqueKeys(gameState.chainAttackTiles, playableKeySet);
    const deselectMoveTileKeys = sortedUniqueKeys(gameState.deselectMoveTiles, playableKeySet);
    const deselectAttackTileKeys = sortedUniqueKeys(gameState.deselectAtkTiles, playableKeySet);
    const hoveredTileKey = validKey(gameState.hoveredTile);
    const hoveredTile = hoveredTileKey ? sourceByKey.get(hoveredTileKey) : null;

    const normalizedState = gameState.tileMap instanceof Map
        ? gameState
        : { ...gameState, tiles: playableEntries.map(entry => entry.tile), tileMap: sourceByKey };
    const cardTargeting = gameState.cardTargeting || null;
    const targetingCamp = options.targetingCamp ?? gameState.currentCamp ?? viewerCampKey;
    const preview = options.targetingPreview || (cardTargeting ? resolveTargetingPreview(normalizedState, cardTargeting, {
        myCamp: targetingCamp,
        hoveredTile: hoveredTile || null,
        isTileVisible: tile => resolveVisibility(tile, gameState, viewerCampKey, options) === 'visible'
    }) : null);
    const cardCandidateTileKeys = sortedUniqueKeys(preview?.candidateTileKeys, playableKeySet);
    const affectedTileKeys = sortedUniqueKeys(preview?.affectedTileKeys, playableKeySet);

    const targetKinds = new Map();
    const addKind = (keys, kind) => {
        for (const key of keys) {
            if (!targetKinds.has(key)) targetKinds.set(key, new Set());
            targetKinds.get(key).add(kind);
        }
    };
    addKind(moveTileKeys, 'move');
    addKind(attackTileKeys, 'attack');
    addKind(cardCandidateTileKeys, 'card');
    const targetCandidates = [...targetKinds.entries()]
        .map(([key, kinds]) => ({
            tileKey: key,
            kinds: TARGET_KIND_ORDER.filter(kind => kinds.has(kind)),
            intent: kinds.has('card') ? text(preview?.intent, '') || null : null
        }))
        .sort((left, right) => compareTileKeys(left.tileKey, right.tileKey));

    const selectedUnitTileKey = validKey(gameState.selectedUnit?.tile);
    const selectedUnit = selectedUnitTileKey ? sourceByKey.get(selectedUnitTileKey)?.unit : null;
    // Canvas gates every interaction hint on the local player's turn; the DTO
    // carries the caller-resolved flag so Pixi honours the same rule.
    const humanTurn = options.humanTurn !== false && !gameState.aiActing;
    const route = humanTurn ? buildRoutePath(gameState, sourceByKey, playableKeySet, selectedUnitTileKey, selectedUnit,
        hoveredTileKey, moveTileKeys, attackTileKeys, chainAttackTileKeys) : null;
    return {
        humanTurn,
        selection: {
            unitId: primitiveId(selectedUnit?.id),
            unitTileKey: selectedUnitTileKey,
            tileKey: validKey(gameState.selectedTile),
            cityTileKey: validKey(gameState.selectedCityTile),
            selectedAtMs: finite(gameState.selectionTime, 0),
            moveTileKeys,
            attackTileKeys,
            chainAttackTileKeys,
            deselecting: Boolean(gameState.deselecting),
            deselectionStartedAtMs: finite(gameState.deselectionTime, 0),
            deselectOriginTileKey: validKey(gameState.deselectOrigin),
            deselectMoveTileKeys,
            deselectAttackTileKeys
        },
        hover: {
            tileKey: hoveredTileKey,
            unitId: primitiveId(hoveredTile?.unit?.id)
        },
        targeting: {
            active: Boolean(cardTargeting || preview?.cardId),
            startedAtMs: finite(cardTargeting?.startedAt, 0),
            cardId: text(preview?.cardId ?? cardTargeting?.cardId, '') || null,
            targeting: text(preview?.targeting ?? cardTargeting?.targeting, '') || null,
            intent: text(preview?.intent, '') || null,
            shape: text(preview?.shape, '') || null,
            sourceUnitId: primitiveId(preview?.sourceUnitId),
            hoveredTileKey: playableKeySet.has(preview?.hoveredTileKey) ? preview.hoveredTileKey : null,
            candidateTileKeys: cardCandidateTileKeys,
            affectedTileKeys,
            air: buildAirDto(preview?.air, playableKeySet)
        },
        targetCandidates,
        route
    };
}

function inferRadius(realTiles) {
    let radius = 0;
    for (const tile of realTiles) radius = Math.max(radius, Math.abs(tile.q), Math.abs(tile.r), Math.abs(tile.s));
    return radius;
}

// Hash only what the Canvas-painted terrain texture actually reads: tile
// ownership colors, surfaces (incl. fade transitions), terrain, fortifications
// and city topology. Interaction, units, fog visibility and border overlays
// are painted by other layers, so they must not invalidate the texture.
function computeTerrainSignature(layout, camps, renderTiles) {
    const parts = [`layout:${layout}`];
    for (const camp of camps) parts.push(`${camp.key}=${camp.color}`);
    for (const tile of renderTiles) {
        const surface = tile.surface;
        const transition = surface.transition
            ? `${surface.transition.from}>${surface.transition.to}@${surface.transition.startedAtMs}/${surface.transition.durationMs}`
            : '';
        parts.push(
            `${tile.key}|${tile.campKey ?? ''}|${surface.kind}|${surface.color}|${transition}`
            + `|${tile.terrain?.type ?? ''}|${tile.fortification?.type ?? ''}`
            + `|${tile.installation?.type ?? ''}:${tile.installation?.status ?? ''}`
            + `|${tile.city ? `${tile.city.kind}#${tile.city.districtId}` : ''}`
        );
    }
    return `terrain-v${BATTLEFIELD_SNAPSHOT_VERSION}:${fnv1a32(parts.join('\n'))}`;
}

/**
 * Build a detached scene snapshot suitable for Canvas2D, Pixi/WebGL or tests.
 *
 * `signature` hashes the complete state-driven DTO. Unit motion paths and
 * surface transitions are represented parametrically, so a render loop can
 * compare signatures and call syncScene only when state actually changes.
 */
export function buildBattlefieldSnapshot(gameState, options = {}) {
    if (!gameState || typeof gameState !== 'object') {
        throw new TypeError('gameState must be an object');
    }
    const viewerCampKey = resolveViewerCamp(gameState, options);
    const layout = normalizeBoardLayout(options.layout ?? gameState.boardLayout ?? gameState.board?.layout);
    const playableEntries = buildPlayableTiles(gameState);
    const playableKeySet = new Set(playableEntries.map(entry => entry.key));
    const realTiles = playableEntries.map(entry => buildRealTileDto(entry, gameState, viewerCampKey, options));
    const fillers = layout === BOARD_LAYOUT.BORDERLESS
        ? buildBorderlessFillers(realTiles, playableKeySet)
        : [];
    const renderTiles = [...realTiles, ...fillers].sort((left, right) => compareTileKeys(left.key, right.key));
    const renderKeys = renderTiles.map(tile => tile.key);
    const renderKeySet = new Set(renderKeys);
    const renderByKey = new Map(renderTiles.map(tile => [tile.key, tile]));
    const { camp: computedCampBorders, district: computedDistrictBorders } = computeBorders(renderTiles, renderByKey);
    const campBorders = layout === BOARD_LAYOUT.BORDERLESS
        ? computedCampBorders
        : (Array.isArray(gameState.campBorderEdges) && gameState.campBorderEdges.length
            ? cloneBorderEdges(gameState.campBorderEdges, renderKeySet, renderByKey)
            : computedCampBorders);
    const districtBorders = layout === BOARD_LAYOUT.BORDERLESS
        ? computedDistrictBorders
        : (Array.isArray(gameState.districtBorderEdges) && gameState.districtBorderEdges.length
            ? cloneBorderEdges(gameState.districtBorderEdges, renderKeySet, renderByKey)
            : computedDistrictBorders);

    const payload = {
        kind: BATTLEFIELD_SNAPSHOT_KIND,
        version: BATTLEFIELD_SNAPSHOT_VERSION,
        viewerCampKey,
        board: {
            layout,
            coordinateSystem: 'axial-pointy',
            logicalWidth: BOARD_RULES.logicalWidth,
            logicalHeight: BOARD_RULES.logicalHeight,
            hexSize: BOARD_RULES.hexSize,
            radius: layout === BOARD_LAYOUT.HEX ? inferRadius(realTiles) : null,
            playableKeys: realTiles.map(tile => tile.key),
            renderKeys,
            renderOnlyKeys: fillers.map(tile => tile.key)
        },
        camps: buildCamps(gameState, playableEntries),
        tiles: renderTiles,
        units: buildUnits(playableEntries, realTiles, gameState, viewerCampKey),
        borders: {
            camp: campBorders,
            district: districtBorders
        },
        interaction: buildInteraction(gameState, playableEntries, playableKeySet, viewerCampKey, options)
    };
    const signature = `battlefield-v${BATTLEFIELD_SNAPSHOT_VERSION}:${fnv1a32(JSON.stringify(payload))}`;
    const terrainSignature = computeTerrainSignature(layout, payload.camps, renderTiles);
    return deepFreeze({ ...payload, signature, terrainSignature });
}

/** Return true when a backend needs a new syncScene call. */
export function shouldSyncBattlefieldSnapshot(previous, next) {
    if (!next) return false;
    return !previous
        || previous.version !== next.version
        || previous.signature !== next.signature;
}
