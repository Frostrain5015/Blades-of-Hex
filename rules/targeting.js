// rules/targeting.js — 对策卡与主动技能选点的唯一纯规则入口。
//
// 该模块只派生本地预览 DTO，不修改对局状态、不访问 DOM，也不发送协议动作。
// 渲染、指针命中和执行层终检应消费同一个 candidateTileKeys 结果。

import { campToKey } from './camps.js';
import { COLONEL_CARD_DATA } from './cards.js';
import { hexDistance, HEX_NEIGHBORS } from './hex.js';
import { isMechanicEnabled } from './mechanics.js';
import { resolveAntiAirCoverage } from './antiAir.js';
import { isSubmarineTargetableBy } from './naval.js';
import { COMMANDER_CONFIG } from './commanders.js';
import { areCommanderMechanicsSuppressed, getUnitMovementDomain, isLandDeploymentTile, MOVEMENT_DOMAIN } from './movement.js';

export const TARGET_INTENTS = Object.freeze({
    HOSTILE: 'hostile',
    HEAL: 'heal',
    MOBILITY: 'mobility',
    ATTACH: 'attach',
    SHIELD: 'shield',
    DEPLOY: 'deploy',
    TRANSPORT: 'transport',
    AREA: 'area'
});

export const TARGET_SHAPES = Object.freeze({
    UNIT: 'unit',
    TILE: 'tile',
    AREA_CENTER: 'areaCenter'
});

export const AIR_TARGETING_CARD_IDS = Object.freeze(new Set([
    'airstrike', 'airdrop', 'diveStrafe', 'carpetBomb', 'airlift', 'airlift_dest'
]));

export const COLONEL_TARGETING_CARD_IDS = Object.freeze(new Set([
    'diveStrafe', 'carpetBomb', 'airlift', 'airlift_dest'
]));

const AREA_TARGETING_CARD_IDS = new Set(['scout', 'airstrike', 'carpetBomb']);
const DRONE_DEPLOY_RANGE = COMMANDER_CONFIG.tianyan.balance.deployRange;
const DRONE_SUICIDE_RANGE = COMMANDER_CONFIG.tianyan.balance.suicideRange;

export function targetingTileKey(tile) {
    return tile && Number.isFinite(tile.q) && Number.isFinite(tile.r)
        ? `${tile.q},${tile.r}`
        : null;
}

function sameCamp(left, right) {
    return campToKey(left) === campToKey(right);
}

function findUnit(gameState, predicate) {
    for (const tile of gameState?.tiles || []) {
        if (tile.unit && predicate(tile.unit, tile)) return tile.unit;
    }
    return null;
}

function findUnitById(gameState, id) {
    if (id == null) return null;
    return findUnit(gameState, unit => unit.id === id);
}

export function findLivingColonel(gameState, camp) {
    return findUnit(gameState, unit => unit.commander === 'colonel'
        && sameCamp(unit.camp, camp)
        && unit.hp > 0
        && unit.tile);
}

function resolveIntent(cardTargeting) {
    const cardId = cardTargeting?.cardId;
    if (cardId === 'airstrike' || cardId === 'carpetBomb' || cardId === 'scout') {
        return { intent: TARGET_INTENTS.AREA, shape: TARGET_SHAPES.AREA_CENTER };
    }
    if (cardId === 'heal') return { intent: TARGET_INTENTS.HEAL, shape: TARGET_SHAPES.UNIT };
    if (cardId === 'forceMarch') return { intent: TARGET_INTENTS.MOBILITY, shape: TARGET_SHAPES.UNIT };
    if (cardId === 'commanderDeploy') return { intent: TARGET_INTENTS.ATTACH, shape: TARGET_SHAPES.UNIT };
    if (cardId === 'shield') return { intent: TARGET_INTENTS.SHIELD, shape: TARGET_SHAPES.UNIT };
    if (cardId === 'airlift') return { intent: TARGET_INTENTS.TRANSPORT, shape: TARGET_SHAPES.UNIT };
    if (cardId === 'airlift_dest' || cardId === 'airdrop') {
        return { intent: TARGET_INTENTS.TRANSPORT, shape: TARGET_SHAPES.TILE };
    }
    if (cardId === 'drone_deploy' || cardId === 'engineer_bunker') {
        return { intent: TARGET_INTENTS.DEPLOY, shape: TARGET_SHAPES.TILE };
    }
    if (cardTargeting?.targeting?.startsWith('empty')) {
        return { intent: TARGET_INTENTS.DEPLOY, shape: TARGET_SHAPES.TILE };
    }
    return { intent: TARGET_INTENTS.HOSTILE, shape: TARGET_SHAPES.UNIT };
}

function isVisibleCandidate(gameState, cardTargeting, tile, myCamp, isTileVisible) {
    if (!gameState.skirmishFog) return true;
    if (cardTargeting.cardId === 'scout' && cardTargeting.targeting === 'anyTileGlobal') return true;
    return isTileVisible(tile, myCamp, gameState);
}

function isBaseTargetingCandidate(gameState, cardTargeting, tile, myCamp, sources) {
    const { cardId, targeting } = cardTargeting;
    const unit = tile.unit;

    if (cardId === 'drone_deploy') {
        const source = sources.sourceUnit;
        return !!source?.tile
            && !unit
            && isLandDeploymentTile(tile)
            && !tile.isCity
            && tile.terrain !== 'mountain'
            && hexDistance(source.tile, tile) <= DRONE_DEPLOY_RANGE;
    }
    if (cardId === 'drone_suicide') {
        const source = sources.sourceUnit;
        return !!source?.tile
            && source._isDrone
            && sameCamp(source.camp, myCamp)
            && !!unit
            && !sameCamp(unit.camp, myCamp)
            && hexDistance(source.tile, tile) <= DRONE_SUICIDE_RANGE;
    }
    if (cardId === 'engineer_bunker') {
        const source = sources.sourceUnit;
        return !!source?.tile
            && source.commander === 'engineer'
            && !areCommanderMechanicsSuppressed(source)
            && sameCamp(source.camp, myCamp)
            && !unit
            && isLandDeploymentTile(tile)
            && !tile.isCity
            && !tile.isVillage
            && hexDistance(source.tile, tile) === 1;
    }
    if (cardId === 'airlift_dest') {
        return !!sources.transportUnit?.tile
            && sources.transportUnit.hp > 0
            && sameCamp(sources.transportUnit.camp, myCamp)
            && sources.transportUnit.commander !== 'colonel'
            && !sources.transportUnit._imprisoned
            && !unit
            && isLandDeploymentTile(tile)
            && canUnitOccupyTileForTransport(sources.transportUnit, tile, gameState)
            && !!sources.colonel?.tile
            && hexDistance(sources.colonel.tile, tile) <= COLONEL_CARD_DATA.range;
    }

    if (targeting === 'enemyGlobal') return !!unit && !sameCamp(unit.camp, myCamp);
    if (targeting === 'friendlyAlive') return !!unit && sameCamp(unit.camp, myCamp) && unit.canAct;
    if (targeting === 'friendlyAny') {
        if (!unit || !sameCamp(unit.camp, myCamp)) return false;
        if (cardId === 'commanderDeploy' && (unit.isCommanderUnit ?? Boolean(unit.commander))) return false;
        if (cardId === 'airlift' && (unit.commander === 'colonel'
            || unit._imprisoned
            || getUnitMovementDomain(unit) !== MOVEMENT_DOMAIN.LAND)) return false;
        return true;
    }
    if (targeting === 'emptyTile') return !unit && isLandDeploymentTile(tile);
    if (targeting === 'emptyFriendlyNonCityNonMountain') {
        return !unit && isLandDeploymentTile(tile) && !tile.isCity && tile.terrain !== 'mountain' && sameCamp(tile.camp, myCamp);
    }
    if (targeting === 'emptyFriendlyNonCity' || targeting === 'emptyFriendlyLandmine') {
        return !unit && isLandDeploymentTile(tile) && !tile.isCity && sameCamp(tile.camp, myCamp);
    }
    if (targeting === 'enemyCity') return tile.isCity && !sameCamp(tile.camp, myCamp);
    if (targeting === 'shieldTarget' || targeting === 'anyUnit') return !!unit;
    if (targeting === 'anyTileGlobal') return true;
    return false;
}

function canUnitOccupyTileForTransport(unit, tile, gameState) {
    // Airlift is a land deployment action. Keeping this helper local avoids
    // making non-deployment targeting branches depend on surface rules.
    return getUnitMovementDomain(unit) === MOVEMENT_DOMAIN.LAND
        && isLandDeploymentTile(tile)
        && gameState?.tileMap?.get?.(targetingTileKey(tile)) === tile;
}

function resolveSources(gameState, cardTargeting, myCamp) {
    const cardId = cardTargeting.cardId;
    let sourceUnit = null;
    if (cardId === 'drone_deploy') {
        sourceUnit = findUnit(gameState, unit => unit.commander === 'tianyan'
            && !areCommanderMechanicsSuppressed(unit)
            && sameCamp(unit.camp, myCamp)
            && unit.hp > 0);
    } else if (cardId === 'drone_suicide') {
        sourceUnit = findUnitById(gameState, cardTargeting.droneId);
    } else if (cardId === 'engineer_bunker') {
        sourceUnit = findUnitById(gameState, cardTargeting.engineerUnitId);
    }

    const colonel = COLONEL_TARGETING_CARD_IDS.has(cardId) ? findLivingColonel(gameState, myCamp) : null;
    const transportUnit = cardId === 'airlift_dest'
        ? findUnitById(gameState, gameState._airliftTarget?.unitId)
        : null;
    return { sourceUnit, colonel, transportUnit };
}

function colonelTargetingAvailable(gameState, cardId, myCamp, colonel) {
    if (!COLONEL_TARGETING_CARD_IDS.has(cardId)) return true;
    if (!colonel?.tile) return false;
    const deployed = gameState._colonelDeployed;
    return !deployed || deployed[campToKey(myCamp)] !== false;
}

function addAreaTiles(gameState, center, destination) {
    const centerKey = targetingTileKey(center);
    if (!centerKey || !gameState.tileMap?.has(centerKey)) return;
    destination.add(centerKey);
    for (const [dq, dr] of HEX_NEIGHBORS) {
        const key = `${center.q + dq},${center.r + dr}`;
        if (gameState.tileMap.has(key)) destination.add(key);
    }
}

function resolveAirOverlay(gameState, cardId, myCamp, sources, isTileVisible) {
    if (!AIR_TARGETING_CARD_IDS.has(cardId)) return undefined;
    const aaLayersByTileKey = new Map();
    const aaSourcesByTileKey = new Map();
    for (const tile of gameState.tiles || []) {
        if (gameState.skirmishFog && !isTileVisible(tile, myCamp, gameState)) continue;
        const key = targetingTileKey(tile);
        const coverage = resolveAntiAirCoverage(tile, myCamp, gameState.tileMap, {
            state: gameState,
            includeSources: true
        });
        if (coverage.layers > 0) {
            aaLayersByTileKey.set(key, coverage.layers);
            aaSourcesByTileKey.set(key, coverage.sources);
        }
    }

    const rangeTileKeys = new Set();
    if (COLONEL_TARGETING_CARD_IDS.has(cardId) && sources.colonel?.tile) {
        for (const tile of gameState.tiles || []) {
            if (hexDistance(sources.colonel.tile, tile) <= COLONEL_CARD_DATA.range) {
                rangeTileKeys.add(targetingTileKey(tile));
            }
        }
    }
    return {
        grounded: isMechanicEnabled(gameState, 'weatherEffects') && gameState.weather === 'fog',
        colonelOriginUnitId: sources.colonel?.id,
        transportSourceUnitId: sources.transportUnit?.id,
        rangeTileKeys,
        aaLayersByTileKey,
        aaSourcesByTileKey
    };
}

/**
 * 派生一次完整选点预览。候选和区域集合只包含 gameState.tiles 的真实可玩格。
 */
export function resolveTargetingPreview(gameState, cardTargeting, options = {}) {
    const myCamp = options.myCamp ?? gameState?.currentCamp;
    const isTileVisible = typeof options.isTileVisible === 'function' ? options.isTileVisible : () => true;
    const hoveredTile = options.hoveredTile ?? gameState?.hoveredTile ?? null;
    const candidateTileKeys = new Set();
    const candidateTiles = [];
    const affectedTileKeys = new Set();
    const { intent, shape } = resolveIntent(cardTargeting);

    if (!gameState || !cardTargeting || !myCamp) {
        return { intent, shape, candidateTileKeys, candidateTiles, affectedTileKeys, air: undefined };
    }

    const sources = resolveSources(gameState, cardTargeting, myCamp);
    const air = resolveAirOverlay(gameState, cardTargeting.cardId, myCamp, sources, isTileVisible);
    const airGrounded = air?.grounded === true;
    const colonelAvailable = colonelTargetingAvailable(
        gameState,
        cardTargeting.cardId,
        myCamp,
        sources.colonel
    );

    if (!airGrounded && colonelAvailable) {
        for (const tile of gameState.tiles || []) {
            const key = targetingTileKey(tile);
            if (!key || gameState.tileMap?.get(key) !== tile) continue;
            if (!isVisibleCandidate(gameState, cardTargeting, tile, myCamp, isTileVisible)) continue;
            if (!isBaseTargetingCandidate(gameState, cardTargeting, tile, myCamp, sources)) continue;
            if (intent === TARGET_INTENTS.HOSTILE
                && tile.unit?.type === 'submarine'
                && !isSubmarineTargetableBy(tile.unit, myCamp, gameState)) continue;
            if (COLONEL_TARGETING_CARD_IDS.has(cardTargeting.cardId)
                && hexDistance(sources.colonel.tile, tile) > COLONEL_CARD_DATA.range) continue;
            candidateTileKeys.add(key);
            candidateTiles.push(tile);
        }
    }

    const hoveredKey = targetingTileKey(hoveredTile);
    if (hoveredKey && candidateTileKeys.has(hoveredKey) && AREA_TARGETING_CARD_IDS.has(cardTargeting.cardId)) {
        addAreaTiles(gameState, hoveredTile, affectedTileKeys);
    }

    return {
        cardId: cardTargeting.cardId,
        targeting: cardTargeting.targeting,
        intent,
        shape,
        candidateTileKeys,
        candidateTiles,
        affectedTileKeys,
        hoveredTileKey: hoveredKey && candidateTileKeys.has(hoveredKey) ? hoveredKey : null,
        sourceUnitId: sources.sourceUnit?.id,
        air
    };
}

export function isResolvedTargetingCandidate(preview, tile) {
    const key = targetingTileKey(tile);
    return !!key && preview?.candidateTileKeys?.has(key) === true;
}
