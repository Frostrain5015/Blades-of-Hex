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
import { isBuildingUnit } from './units.js';
import { canAttack } from './diplomacy.js';
import { getAirCommandRange } from './airCommands.js';
import { isCitySiegeBlocked } from './citySiege.js';

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
    'airstrike', 'airdrop', 'diveStrafe', 'carpetBomb', 'airlift', 'airlift_dest',
    'air_command_strafe', 'air_command_bombing', 'air_command_airdrop', 'air_command_recon'
]));

export const COLONEL_TARGETING_CARD_IDS = Object.freeze(new Set([
    'diveStrafe', 'carpetBomb', 'airlift', 'airlift_dest'
]));

const AREA_TARGETING_CARD_IDS = new Set(['scout', 'airstrike', 'carpetBomb', 'air_command_bombing']);
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
    if (cardId === 'air_command_bombing' || cardId === 'air_command_recon') {
        return { intent: TARGET_INTENTS.AREA, shape: TARGET_SHAPES.AREA_CENTER };
    }
    if (cardId === 'air_command_airdrop') return { intent: TARGET_INTENTS.TRANSPORT, shape: TARGET_SHAPES.TILE };
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
    if (cardId === 'drone_deploy' || cardId === 'engineer_bunker' || cardId === 'build_bunker') {
        return { intent: TARGET_INTENTS.DEPLOY, shape: TARGET_SHAPES.TILE };
    }
    if (cardTargeting?.targeting?.startsWith('empty')) {
        return { intent: TARGET_INTENTS.DEPLOY, shape: TARGET_SHAPES.TILE };
    }
    return { intent: TARGET_INTENTS.HOSTILE, shape: TARGET_SHAPES.UNIT };
}

function isVisibleCandidate(gameState, cardTargeting, tile, myCamp, isTileVisible) {
    if (!gameState.skirmishFog) return true;
    if ((cardTargeting.cardId === 'scout' || cardTargeting.cardId === 'air_command_recon') && cardTargeting.targeting === 'anyTileGlobal') return true;
    return isTileVisible(tile, myCamp, gameState);
}

function isBaseTargetingCandidate(gameState, cardTargeting, tile, myCamp, sources) {
    const { cardId, targeting } = cardTargeting;
    const unit = tile.unit;

    if (cardId?.startsWith('air_command_')) {
        const launcher = sources.launcherTile;
        if (!launcher || hexDistance(launcher, tile) > getAirCommandRange(launcher)) return false;
        if (cardId === 'air_command_strafe') {
            if (unit) return !sameCamp(unit.camp, myCamp);
            // 无驻军但HP>0的敌方/中立城市也是合法扫射目标（削减城市HP）
            return (tile.isCity || tile.isUrban) && (Number(tile.hp) || 0) > 0
                && canAttack(gameState, myCamp, tile.camp);
        }
        if (cardId === 'air_command_airdrop') {
            return !unit && isLandDeploymentTile(tile) && !tile.isCity && !tile.isPort;
        }
        return true;
    }

    if (cardId === 'drone_deploy') {
        const source = sources.sourceUnit;
        return !!source?.tile
            && !unit
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
    if (cardId === 'build_bunker') {
        const source = sources.sourceUnit;
        return !!source?.tile && sameCamp(source.camp, myCamp) && !unit
            && isLandDeploymentTile(tile) && sameCamp(tile.camp, myCamp)
            && !tile.isCity && !tile.isVillage && !tile.isPort
            && hexDistance(source.tile, tile) === 1;
    }
    if (cardId === 'field_repair') {
        const source = sources.sourceUnit;
        return !!source?.tile && source.commander === 'engineer' && !!unit
            && sameCamp(unit.camp, myCamp) && unit.hp < unit.maxHp
            && (isBuildingUnit(unit) || unit._constructionScaffold)
            && hexDistance(source.tile, tile) <= 1;
    }
    if (cardId === 'airlift_dest') {
        return !!sources.transportUnit?.tile
            && sources.transportUnit.hp > 0
            && sameCamp(sources.transportUnit.camp, myCamp)
            && sources.transportUnit.commander !== 'colonel'
            && !sources.transportUnit._imprisoned
            && !unit
            && isLandDeploymentTile(tile)
            && !isCitySiegeBlocked(tile, myCamp, gameState)
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
    if (targeting === 'emptyTile') {
        if (unit || !isLandDeploymentTile(tile)) return false;
        // 普通空降不得越过尚未击破的敌方/中立城市血池；己方城市仍是合法落点。
        if (cardId === 'airdrop' && isCitySiegeBlocked(tile, myCamp, gameState)) return false;
        return true;
    }
    if (targeting === 'emptyFriendlyNonCityNonMountain') {
        return !unit && isLandDeploymentTile(tile) && !tile.isCity && tile.terrain !== 'mountain' && sameCamp(tile.camp, myCamp);
    }
    if (targeting === 'emptyFriendlyLandmine') {
        if (unit || tile._minePlanted || tile.isCity) return false;
        if (isLandDeploymentTile(tile)) return sameCamp(tile.camp, myCamp);
        const adjacentFriendlyShip = HEX_NEIGHBORS.some(([dq, dr]) => {
            const support = gameState.tileMap?.get(`${tile.q + dq},${tile.r + dr}`)?.unit;
            return support && sameCamp(support.camp, myCamp)
                && ['destroyer', 'warship', 'submarine', 'carrier'].includes(support.type)
                && support.isEmbarked !== true;
        });
        return adjacentFriendlyShip;
    }
    if (targeting === 'emptyFriendlyNonCity') {
        return !unit && isLandDeploymentTile(tile) && !tile.isCity && sameCamp(tile.camp, myCamp);
    }
    if (targeting === 'enemyCity') return tile.isCity && !sameCamp(tile.camp, myCamp);
    if (targeting === 'anyUnit') {
        if (cardId === 'poison') return !!unit && !unit._poison;
        return !!unit;
    }
    if (targeting === 'shieldTarget') return !!unit;
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
    const launcherTile = cardId.startsWith('air_command_')
        ? gameState?.tileMap?.get?.(`${cardTargeting.launcherQ},${cardTargeting.launcherR}`) || null
        : null;
    if (cardId === 'drone_deploy') {
        sourceUnit = findUnit(gameState, unit => unit.commander === 'tianyan'
            && !areCommanderMechanicsSuppressed(unit)
            && sameCamp(unit.camp, myCamp)
            && unit.hp > 0);
    } else if (cardId === 'drone_suicide') {
        sourceUnit = findUnitById(gameState, cardTargeting.droneId);
    } else if (cardId === 'engineer_bunker' || cardId === 'field_repair') {
        sourceUnit = findUnitById(gameState, cardTargeting.engineerUnitId);
    } else if (cardId === 'build_bunker') {
        sourceUnit = findUnitById(gameState, cardTargeting.builderUnitId);
    }

    const colonel = COLONEL_TARGETING_CARD_IDS.has(cardId) ? findLivingColonel(gameState, myCamp) : null;
    const transportUnit = cardId === 'airlift_dest'
        ? findUnitById(gameState, gameState._airliftTarget?.unitId)
        : null;
    return { sourceUnit, colonel, transportUnit, launcherTile };
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
        if (coverage.reduction > 0) {
            // 渲染器仍使用两档纹理强度；规则值本身保留在 source.reduction 中。
            aaLayersByTileKey.set(key, coverage.reduction >= 0.50 ? 2 : 1);
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
    } else if (cardId.startsWith('air_command_') && sources.launcherTile) {
        const range = getAirCommandRange(sources.launcherTile);
        for (const tile of gameState.tiles || []) {
            if (hexDistance(sources.launcherTile, tile) <= range) {
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
