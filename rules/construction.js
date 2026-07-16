import { campToKey } from './camps.js';
import { hexDistance } from './hex.js';
import { isBuildingUnit } from './units.js';
import { isLandTile } from './surfaces.js';
import { getRoundIndex } from './turns.js';
import { isMechanicEnabled } from './mechanics.js';
import { canBuildShoreBattery, isCoastalLandTile } from './naval.js';

export const CONSTRUCTION_CONFIG = Object.freeze({
    trench: Object.freeze({ name: '战壕', cost: 2, engineerCost: 1, range: 0, buildTurns: 0 }),
    flak: Object.freeze({ name: '高射机枪', cost: 2, engineerCost: 1, range: 0, buildTurns: 0 }),
    bunker: Object.freeze({ name: '碉堡', cost: 10, engineerCost: 7, range: 1, buildTurns: 1 }),
    shoreBattery: Object.freeze({ name: '岸防炮', cost: 10, range: 0, buildTurns: 0 }),
    airfield: Object.freeze({ name: '机场', cost: 10, engineerCost: 7, range: 0, buildTurns: 1 }),
    fieldRepair: Object.freeze({ name: '战地抢修', cost: 3, range: 1, healPct: 0.50, cooldown: 2 })
});

export function isOrdinaryGroundBuilder(unit) {
    return !!unit && unit.hp > 0 && unit.config?.movementDomain === 'land'
        && !isBuildingUnit(unit) && !unit._isDrone && !unit.isEmbarked;
}

export function constructionCost(kind, builder = null, cityTile = null) {
    const config = CONSTRUCTION_CONFIG[kind];
    if (!config) return Infinity;
    const engineerPresent = builder?.commander === 'engineer'
        || (kind === 'airfield' && cityTile?.unit?.commander === 'engineer');
    return engineerPresent && Number.isFinite(config.engineerCost) ? config.engineerCost : config.cost;
}

export function canBuildFieldFortification(unit, kind, state) {
    return isMechanicEnabled(state, 'fortifications')
        && (kind === 'trench' || kind === 'flak')
        && isOrdinaryGroundBuilder(unit)
        && unit.canAct && !unit.isNewRecruit
        && campToKey(unit.camp) === campToKey(state?.currentCamp)
        && isLandTile(unit.tile)
        && !unit.tile.fieldFortification && !unit.tile.fortification;
}

export function canBuildBunkerAt(unit, targetTile, state) {
    return isMechanicEnabled(state, 'fortifications')
        && isOrdinaryGroundBuilder(unit)
        && unit.canAct && !unit.isNewRecruit && campToKey(unit.camp) === campToKey(state?.currentCamp)
        && !!targetTile && isLandTile(targetTile) && campToKey(targetTile.camp) === campToKey(unit.camp)
        && hexDistance(unit.tile, targetTile) === 1
        && !targetTile.unit && !targetTile.isCity && !targetTile.isVillage && !targetTile.isPort;
}

export function canBuildShoreBatteryAt(targetTile, camp, state) {
    return isMechanicEnabled(state, 'fortifications')
        && !!targetTile && campToKey(targetTile.camp) === campToKey(camp)
        && campToKey(camp) === campToKey(state?.currentCamp)
        && !targetTile.unit && !targetTile.isCity && !targetTile.isVillage && !targetTile.isPort
        && !targetTile.fieldFortification && !targetTile.fortification
        && isCoastalLandTile(targetTile, state)
        && canBuildShoreBattery(state, camp);
}

export function getAirfieldCap(state, camp) {
    const key = campToKey(camp);
    const override = state?.airfieldCapOverrides?.[key];
    if (Number.isInteger(override) && override >= 0) return override;
    const cityCount = (state?.tiles || []).filter(tile => tile.isCity && campToKey(tile.camp) === key).length;
    return Math.ceil(cityCount / 3);
}

export function countAirfields(state, camp) {
    const key = campToKey(camp);
    return (state?.tiles || []).filter(tile => tile.installation?.type === 'airfield'
        && campToKey(tile.camp) === key).length;
}

export function canBuildAirfieldAt(cityTile, camp, state) {
    return isMechanicEnabled(state, 'airCommands')
        && !!cityTile?.isCity && cityTile.camp === camp && !cityTile.installation
        && !(cityTile._cityDisabledUntil > getRoundIndex(state))
        && countAirfields(state, camp) < getAirfieldCap(state, camp);
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
