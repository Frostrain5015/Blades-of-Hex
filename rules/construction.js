import { campToKey } from './camps.js';
import { hexDistance } from './hex.js';
import { isBuildingUnit, DEFENSE_BUILDING_MIN_DISTANCE } from './units.js';
import { isLandTile } from './surfaces.js';
import { getRoundIndex } from './turns.js';
import { isMechanicEnabled } from './mechanics.js';
import { canBuildShoreBattery, isCoastalLandTile } from './naval.js';
import { isCityDisabled } from './citySiege.js';

export const CONSTRUCTION_CONFIG = Object.freeze({
    trench: Object.freeze({ name: '战壕', cost: 2, engineerCost: 1, range: 0, buildTurns: 0 }),
    flak: Object.freeze({ name: '高射机枪', cost: 2, engineerCost: 1, range: 0, buildTurns: 0 }),
    bunker: Object.freeze({ name: '碉堡', cost: 10, engineerCost: 7, range: 1, buildTurns: 1 }),
    shoreBattery: Object.freeze({ name: '岸防炮', cost: 10, range: 0, buildTurns: 0 }),
    laserTower: Object.freeze({ name: '激光塔', cost: 15, range: 1, buildTurns: 0 }),
    airfield: Object.freeze({ name: '机场', cost: 10, engineerCost: 7, range: 0, buildTurns: 1 }),
    fieldRepair: Object.freeze({ name: '战地抢修', cost: 3, range: 1, healPct: 0.50, cooldown: 2 })
});

export const DEFENSE_CONSTRUCTION_SUPPORT_RANGE = 6;

export function isOrdinaryGroundBuilder(unit) {
    return !!unit && unit.hp > 0 && unit.config?.movementDomain === 'land'
        && !isBuildingUnit(unit) && !unit._isDrone && !unit.isEmbarked;
}

/**
 * 同类防御建筑间距：siteTile 的 minDist 半径内已存在同类建筑（含建造中脚手架，
 * 其单位类型与完工建筑相同）时返回 true。跨类型不限，地图预放置不受约束（只拦建造行为）。
 */
export function hasSameTypeBuildingWithin(state, siteTile, unitType, minDist = DEFENSE_BUILDING_MIN_DISTANCE) {
    if (!siteTile) return false;
    for (const tile of state?.tiles || []) {
        if (tile === siteTile) continue;
        if (tile.unit?.type !== unitType || tile.unit.hp <= 0) continue;
        if (hexDistance(tile, siteTile) < minDist) return true;
    }
    return false;
}

export function constructionCost(kind, builder = null, cityTile = null) {
    const config = CONSTRUCTION_CONFIG[kind];
    if (!config) return Infinity;
    const engineerPresent = builder?.commander === 'engineer'
        || (kind === 'airfield' && cityTile?.unit?.commander === 'engineer');
    return engineerPresent && Number.isFinite(config.engineerCost) ? config.engineerCost : config.cost;
}

export function findConstructionEngineer(state, camp) {
    const campKey = campToKey(camp);
    return (state?.tiles || [])
        .map(tile => tile.unit)
        .find(unit => unit?.hp > 0 && unit.commander === 'engineer'
            && campToKey(unit.camp) === campKey) || null;
}

function isCurrentConstructionCamp(camp, state) {
    return !!camp && campToKey(camp) === campToKey(state?.currentCamp);
}

function hasFriendlyConstructionSupport(targetTile, camp, state) {
    const campKey = campToKey(camp);
    return (state?.tiles || []).some(tile => tile.unit?.hp > 0
        && campToKey(tile.unit.camp) === campKey
        && hexDistance(tile, targetTile) <= DEFENSE_CONSTRUCTION_SUPPORT_RANGE);
}

export function canBuildFieldFortificationAt(targetTile, kind, camp, state, occupyingUnit = null) {
    if (!isMechanicEnabled(state, 'fortifications')
        || (kind !== 'trench' && kind !== 'flak')
        || !isCurrentConstructionCamp(camp, state)
        || !targetTile || !isLandTile(targetTile)
        || targetTile.fieldFortification || targetTile.fortification) return false;
    const campKey = campToKey(camp);
    return campToKey(targetTile.camp) === campKey
        || ((occupyingUnit || targetTile.unit)?.hp > 0
            && campToKey((occupyingUnit || targetTile.unit).camp) === campKey);
}

export function canBuildDefenseBuildingAt(targetTile, camp, state) {
    if (!isMechanicEnabled(state, 'fortifications')
        || !isCurrentConstructionCamp(camp, state)
        || !targetTile || !isLandTile(targetTile)
        || targetTile.unit || targetTile.isCity || targetTile.isVillage || targetTile.isPort
        || targetTile.fieldFortification || targetTile.fortification) return false;
    return campToKey(targetTile.camp) === campToKey(camp)
        || hasFriendlyConstructionSupport(targetTile, camp, state);
}

export function canBuildFieldFortification(unit, kind, state) {
    return isOrdinaryGroundBuilder(unit)
        && unit.canAct && !unit.isNewRecruit
        && campToKey(unit.camp) === campToKey(state?.currentCamp)
        && canBuildFieldFortificationAt(unit.tile, kind, unit.camp, state, unit);
}

export function canBuildBunkerAt(builderOrCamp, targetTile, state) {
    const camp = builderOrCamp?.camp || builderOrCamp;
    return canBuildDefenseBuildingAt(targetTile, camp, state)
        && !hasSameTypeBuildingWithin(state, targetTile, 'mgNest');
}

export function canBuildShoreBatteryAt(targetTile, camp, state) {
    return canBuildDefenseBuildingAt(targetTile, camp, state)
        && isCoastalLandTile(targetTile, state)
        && canBuildShoreBattery(state, camp)
        && !hasSameTypeBuildingWithin(state, targetTile, 'shoreBattery');
}

export function canBuildLaserTowerAt(builderOrCamp, targetTile, state) {
    const camp = builderOrCamp?.camp || builderOrCamp;
    return canBuildDefenseBuildingAt(targetTile, camp, state)
        && !hasSameTypeBuildingWithin(state, targetTile, 'laserTower');
}

export function getAirfieldCap(state, camp) {
    return Number.POSITIVE_INFINITY;
}

export function countAirfields(state, camp) {
    const key = campToKey(camp);
    return (state?.tiles || []).filter(tile => tile.installation?.type === 'airfield'
        && campToKey(tile.camp) === key).length;
}

export function canBuildAirfieldAt(cityTile, camp, state) {
    return isMechanicEnabled(state, 'airCommands')
        && !!cityTile?.isCity && cityTile.camp === camp && !cityTile.installation
        && !isCityDisabled(cityTile);
}

export function canFieldRepair(engineer, target, state) {
    const currentRound = getRoundIndex(state);
    const readyRound = Number.isFinite(engineer?._engineerFieldRepairReadyRound)
        ? engineer._engineerFieldRepairReadyRound
        : currentRound + Math.max(0, engineer?._fieldRepairCooldown || 0);
    return isMechanicEnabled(state, 'fortifications')
        && !!engineer && engineer.commander === 'engineer' && engineer.canAct && !engineer.isNewRecruit
        && engineer.camp === state?.currentCamp && readyRound <= currentRound
        && isFieldRepairTarget(engineer, target, state)
}

export function isFieldRepairTarget(engineer, target, state) {
    return !!engineer && !!target && target.camp === engineer.camp && target.hp > 0 && target.hp < target.maxHp
        && (isBuildingUnit(target) || target._constructionScaffold)
        && hexDistance(engineer.tile, target.tile) <= CONSTRUCTION_CONFIG.fieldRepair.range
        && target._fieldRepairedAtTurn !== state?.turnCounter;
}
