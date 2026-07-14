// Pure, renderer-neutral topology for terrain that visually spans more than one
// hex.  The module deliberately consumes playable tiles only: render-only
// border fillers may inherit a surface colour, but can never create a forest,
// ridge, settlement wall, or trench connection.

import { HEX_NEIGHBORS } from './hex.js';
import { tileCoordinateKey } from './surfaces.js';

export const TERRAIN_TOPOLOGY_VERSION = 1;

export const TERRAIN_FEATURE = Object.freeze({
    FOREST: 'forest',
    MOUNTAIN: 'mountain',
    URBAN: 'urban',
    VILLAGE: 'village',
    TRENCH: 'trench'
});

const EDGE_TO_NEIGHBOR_INDEX = Object.freeze([5, 4, 3, 2, 1, 0]);

function finiteInteger(value) {
    return Number.isInteger(value) ? value : null;
}

function compareCoordinates(left, right) {
    return left.q - right.q || left.r - right.r;
}

function compareKeys(left, right) {
    const [lq, lr] = String(left).split(',').map(Number);
    const [rq, rr] = String(right).split(',').map(Number);
    return lq - rq || lr - rr;
}

function isPlayableTile(tile) {
    return tile?.renderOnly !== true
        && tile?.playable !== false
        && finiteInteger(tile?.q) !== null
        && finiteInteger(tile?.r) !== null;
}

function terrainType(tile) {
    return typeof tile?.terrain === 'string'
        ? tile.terrain
        : tile?.terrain?.type || 'plains';
}

function fortificationType(tile) {
    return typeof tile?.fortification === 'string'
        ? tile.fortification
        : tile?.fortification?.type || null;
}

function isUrbanTile(tile) {
    return tile?.isUrban === true
        || tile?.isCity === true
        || tile?.city?.kind === 'city'
        || tile?.city?.kind === 'urban';
}

function isVillageTile(tile) {
    return tile?.isVillage === true || tile?.city?.kind === 'village';
}

function keyOf(tile) {
    return tileCoordinateKey(tile);
}

function makePlayableIndex(tiles, suppliedTileMap) {
    const playableTiles = [];
    const tileMap = new Map();
    const supplied = suppliedTileMap instanceof Map ? suppliedTileMap : null;

    for (const candidate of tiles || []) {
        if (!isPlayableTile(candidate)) continue;
        const key = keyOf(candidate);
        // When a real runtime tile map is supplied, reject lookalike objects
        // that merely reuse an in-board coordinate.  This keeps fake cells out
        // even if a caller accidentally concatenates both arrays.
        if (supplied && supplied.get(key) !== candidate && supplied.has(key)) continue;
        if (tileMap.has(key)) continue;
        playableTiles.push(candidate);
        tileMap.set(key, candidate);
    }

    playableTiles.sort(compareCoordinates);
    return { playableTiles, tileMap };
}

function neighborAt(tileMap, tile, neighborIndex) {
    const [dq, dr] = HEX_NEIGHBORS[neighborIndex];
    return tileMap.get(tileCoordinateKey(tile.q + dq, tile.r + dr)) || null;
}

function frozenTileRef(tile) {
    return Object.freeze({ q: tile.q, r: tile.r, key: keyOf(tile) });
}

function frozenLink(left, right, neighborIndex) {
    return Object.freeze({
        key: `${keyOf(left)}|${keyOf(right)}`,
        from: frozenTileRef(left),
        to: frozenTileRef(right),
        neighborIndex
    });
}

/**
 * Return all unique shared edges inside one feature predicate.  These are used
 * as cross-hex continuity strokes, not as borders.
 */
function buildLinks(featureTiles, tileMap, predicate) {
    const featureKeys = new Set(featureTiles.map(keyOf));
    const links = [];
    for (const tile of featureTiles) {
        for (let neighborIndex = 0; neighborIndex < HEX_NEIGHBORS.length; neighborIndex++) {
            const neighbor = neighborAt(tileMap, tile, neighborIndex);
            if (!neighbor || !featureKeys.has(keyOf(neighbor)) || !predicate(neighbor)) continue;
            if (compareKeys(keyOf(tile), keyOf(neighbor)) >= 0) continue;
            links.push(frozenLink(tile, neighbor, neighborIndex));
        }
    }
    return Object.freeze(links);
}

function buildComponents(featureTiles, tileMap, predicate) {
    const remaining = new Set(featureTiles.map(keyOf));
    const components = [];
    for (const seed of featureTiles) {
        const seedKey = keyOf(seed);
        if (!remaining.delete(seedKey)) continue;
        const queue = [seed];
        const componentTiles = [];
        while (queue.length) {
            const tile = queue.shift();
            componentTiles.push(tile);
            for (let index = 0; index < HEX_NEIGHBORS.length; index++) {
                const neighbor = neighborAt(tileMap, tile, index);
                if (!neighbor || !predicate(neighbor)) continue;
                const neighborKey = keyOf(neighbor);
                if (!remaining.delete(neighborKey)) continue;
                queue.push(neighbor);
            }
        }
        componentTiles.sort(compareCoordinates);
        const tileRefs = Object.freeze(componentTiles.map(frozenTileRef));
        components.push(Object.freeze({
            id: `${keyOf(componentTiles[0])}:${componentTiles.length}`,
            tiles: tileRefs,
            tileKeys: Object.freeze(tileRefs.map(tile => tile.key))
        }));
    }
    return Object.freeze(components);
}

/**
 * Derive visible outer edges for a footprint.  Missing neighbours are skipped
 * on purpose: a classic-board edge is clipping, not a wall/effect boundary.
 */
function buildBoundaryEdges(groupTiles, tileMap, belongsToGroup, kind, groupId) {
    const edges = [];
    for (const tile of groupTiles) {
        for (let edgeIndex = 0; edgeIndex < 6; edgeIndex++) {
            const neighborIndex = EDGE_TO_NEIGHBOR_INDEX[edgeIndex];
            const neighbor = neighborAt(tileMap, tile, neighborIndex);
            if (!neighbor || belongsToGroup(neighbor)) continue;
            edges.push(Object.freeze({
                key: `${keyOf(tile)}:${edgeIndex}`,
                kind,
                groupId,
                tile: frozenTileRef(tile),
                neighbor: frozenTileRef(neighbor),
                edgeIndex,
                neighborIndex
            }));
        }
    }
    return Object.freeze(edges);
}

function urbanGroupKey(tile) {
    const explicit = tile?.urbanCenterKey ?? tile?.city?.centerKey ?? tile?.city?.id;
    return explicit == null || explicit === '' ? null : String(explicit);
}

function buildUrbanFootprints(urbanTiles, tileMap) {
    const explicitGroups = new Map();
    const ungrouped = [];
    for (const tile of urbanTiles) {
        const groupKey = urbanGroupKey(tile);
        if (groupKey == null) {
            ungrouped.push(tile);
            continue;
        }
        const group = explicitGroups.get(groupKey) || [];
        group.push(tile);
        explicitGroups.set(groupKey, group);
    }

    const groups = [];
    for (const [id, values] of explicitGroups) {
        values.sort(compareCoordinates);
        groups.push({ id, values, explicit: true });
    }

    // Old maps do not carry urbanCenterKey.  Connected urban cells still form
    // a stable footprint without making schema migration mandatory.
    const ungroupedComponents = buildComponents(ungrouped, tileMap, isUrbanTile);
    for (const component of ungroupedComponents) {
        const values = component.tileKeys.map(key => tileMap.get(key)).filter(Boolean);
        groups.push({ id: `urban:${component.id}`, values, explicit: false });
    }

    groups.sort((left, right) => compareKeys(keyOf(left.values[0]), keyOf(right.values[0])));
    return Object.freeze(groups.map(group => {
        const keys = new Set(group.values.map(keyOf));
        const belongs = group.explicit
            ? tile => isUrbanTile(tile) && urbanGroupKey(tile) === group.id
            : tile => keys.has(keyOf(tile));
        return Object.freeze({
            id: group.id,
            tiles: Object.freeze(group.values.map(frozenTileRef)),
            boundaryEdges: buildBoundaryEdges(group.values, tileMap, belongs, TERRAIN_FEATURE.URBAN, group.id),
            links: buildLinks(group.values, tileMap, belongs)
        });
    }));
}

function buildVillageFootprints(villageTiles, tileMap) {
    const components = buildComponents(villageTiles, tileMap, isVillageTile);
    return Object.freeze(components.map(component => {
        const values = component.tileKeys.map(key => tileMap.get(key)).filter(Boolean);
        const keys = new Set(component.tileKeys);
        return Object.freeze({
            id: `village:${component.id}`,
            tiles: component.tiles,
            boundaryEdges: buildBoundaryEdges(
                values,
                tileMap,
                tile => keys.has(keyOf(tile)),
                TERRAIN_FEATURE.VILLAGE,
                `village:${component.id}`
            ),
            links: buildLinks(values, tileMap, tile => keys.has(keyOf(tile)))
        });
    }));
}

function featureBundle(playableTiles, tileMap, predicate) {
    const tiles = playableTiles.filter(predicate);
    return Object.freeze({
        tiles: Object.freeze(tiles.map(frozenTileRef)),
        components: buildComponents(tiles, tileMap, predicate),
        links: buildLinks(tiles, tileMap, predicate)
    });
}

/**
 * Build cross-hex terrain topology from the real board.
 *
 * Input accepts runtime HexTile objects as well as detached renderer DTOs.
 * `tileMap` is optional, but passing the real runtime map adds an identity guard
 * against accidental fake-tile injection.
 */
export function buildTerrainTopology(tiles = [], tileMap = null) {
    const indexed = makePlayableIndex(tiles, tileMap);
    const { playableTiles, tileMap: playableMap } = indexed;
    const forest = featureBundle(playableTiles, playableMap, tile => terrainType(tile) === 'forest');
    const mountain = featureBundle(playableTiles, playableMap, tile => terrainType(tile) === 'mountain');
    const plains = featureBundle(playableTiles, playableMap, tile => terrainType(tile) === 'plains'
        && !isUrbanTile(tile) && !isVillageTile(tile));
    const trench = featureBundle(playableTiles, playableMap, tile => fortificationType(tile) === 'trench');
    const urbanTiles = playableTiles.filter(isUrbanTile);
    const villageTiles = playableTiles.filter(isVillageTile);

    return Object.freeze({
        version: TERRAIN_TOPOLOGY_VERSION,
        playableTileKeys: Object.freeze(playableTiles.map(keyOf)),
        forest,
        mountain,
        plains,
        trench,
        urbanFootprints: buildUrbanFootprints(urbanTiles, playableMap),
        villageFootprints: buildVillageFootprints(villageTiles, playableMap)
    });
}

export function terrainFeatureType(tile) {
    return terrainType(tile);
}

export function terrainFortificationType(tile) {
    return fortificationType(tile);
}

export function terrainTopologyTileKey(tile) {
    return keyOf(tile);
}
