import { campToKey } from './camps.js';
import { hexDistance, HEX_NEIGHBORS } from './hex.js';
import { getRoundIndex } from './turns.js';
import { isLandTile, isWaterTile } from './surfaces.js';

export const NAVAL_RULES = Object.freeze({
    shipVsLandDamage: -0.50,
    landVsShipDamage: -0.50,
    cruiserShoreBombardment: 0.50,
    shoreBatteryVsShipDamage: 0.30,
    shoreBatteryVsLandDamage: -0.60,
    detectorRadius: 2,
    portRepairPct: 0.10,
    portGuardRounds: 1,
    submarinePortRevealRounds: 2,
    shoreBatteryCooldownRounds: 2
});

export const NAVAL_UNIT_TYPES = Object.freeze(new Set(['destroyer', 'warship', 'submarine']));
export const SUBMARINE_DETECTOR_TYPES = Object.freeze(new Set(['destroyer', 'shoreBattery']));

export function isRegularNavalUnit(unitOrType) {
    const type = typeof unitOrType === 'string' ? unitOrType : unitOrType?.type;
    return NAVAL_UNIT_TYPES.has(type);
}

export function isWaterborneUnit(unit) {
    return !!unit && isWaterTile(unit.tile) && (isRegularNavalUnit(unit) || unit.isEmbarked === true);
}

export function isCoastalLandTile(tile, state) {
    if (!isLandTile(tile) || tile.renderOnly === true || tile.playable === false) return false;
    return HEX_NEIGHBORS.some(([dq, dr]) => isWaterTile(state?.tileMap?.get(`${tile.q + dq},${tile.r + dr}`)));
}

export function getCrossDomainDamageBonus(attacker, defender) {
    if (!attacker || !defender) return 0;
    if (attacker.type === 'shoreBattery') {
        return isWaterborneUnit(defender)
            ? NAVAL_RULES.shoreBatteryVsShipDamage
            : NAVAL_RULES.shoreBatteryVsLandDamage;
    }
    if (isRegularNavalUnit(attacker) && isLandTile(defender.tile)) {
        return NAVAL_RULES.shipVsLandDamage
            + (attacker.type === 'warship' ? NAVAL_RULES.cruiserShoreBombardment : 0);
    }
    if (!isRegularNavalUnit(attacker) && attacker.type !== 'drone' && isRegularNavalUnit(defender)) {
        return NAVAL_RULES.landVsShipDamage;
    }
    return 0;
}

function campKey(camp) {
    return campToKey(camp);
}

function roundIndex(state) {
    const value = getRoundIndex(state);
    return Number.isFinite(value) ? value : 0;
}

export function isSubmarineDetector(unit) {
    return !!unit && SUBMARINE_DETECTOR_TYPES.has(unit.type) && unit.hp > 0;
}

export function hasSubmarineDetectorInRange(submarine, detectingCamp, state) {
    const key = campKey(detectingCamp);
    if (!submarine?.tile || key === 'neutral') return false;
    return (state?.tiles || []).some(tile => {
        const detector = tile.unit;
        return isSubmarineDetector(detector)
            && campKey(detector.camp) === key
            && hexDistance(tile, submarine.tile) <= NAVAL_RULES.detectorRadius;
    });
}

function hasFactionReveal(submarine, detectingCamp, state) {
    const key = campKey(detectingCamp);
    const expires = state?.submarineReveals?.[key]?.[String(submarine?.id)];
    return Number.isFinite(expires) && expires > roundIndex(state);
}

export function isSubmarineTargetableBy(submarine, detectingCamp, state) {
    if (submarine?.type !== 'submarine') return true;
    if (campKey(submarine.camp) === campKey(detectingCamp)) return true;
    if (submarine._submarineAttackExposed === true) return true;
    const round = roundIndex(state);
    if (submarine.tile?.isPort && Number(submarine._submarinePortRevealUntilRound) > round) return true;
    return hasFactionReveal(submarine, detectingCamp, state)
        || hasSubmarineDetectorInRange(submarine, detectingCamp, state);
}

export function canUnitTargetUnit(attacker, defender, state) {
    if (!attacker || !defender || !attacker.tile || !defender.tile) return false;
    if (attacker.type === 'submarine' && !isWaterTile(defender.tile)) return false;
    if (defender.type === 'submarine' && !isSubmarineTargetableBy(defender, attacker.camp, state)) return false;
    return true;
}

export function markSubmarinesRevealedInArea(state, detectingCamp, centerTile, radius = 1, durationRounds = 2) {
    const key = campKey(detectingCamp);
    if (!state || !centerTile || key === 'neutral') return 0;
    state.submarineReveals ||= {};
    state.submarineReveals[key] ||= {};
    const expires = roundIndex(state) + Math.max(1, durationRounds);
    let count = 0;
    for (const tile of state.tiles || []) {
        if (tile.unit?.type !== 'submarine' || hexDistance(tile, centerTile) > radius) continue;
        state.submarineReveals[key][String(tile.unit.id)] = expires;
        count++;
    }
    return count;
}

export function clearExpiredSubmarineReveals(state) {
    const round = roundIndex(state);
    for (const reveals of Object.values(state?.submarineReveals || {})) {
        for (const [unitId, expires] of Object.entries(reveals || {})) {
            if (!Number.isFinite(expires) || expires <= round) delete reveals[unitId];
        }
    }
}

export function canCapturePort(unit) {
    return isRegularNavalUnit(unit) || unit?.isEmbarked === true;
}

export function capturePort(state, tile, unit) {
    if (!tile?.isPort || !unit || !canCapturePort(unit) || campKey(tile.camp) === campKey(unit.camp)) return false;
    tile.camp = unit.camp;
    tile._portCapturedIndependent = true;
    tile._portOperationalAtRound = roundIndex(state) + NAVAL_RULES.portGuardRounds;
    unit.remainingMP = 0;
    unit._portGuardUntilRound = tile._portOperationalAtRound;
    if (unit.type === 'submarine') {
        unit._submarinePortRevealUntilRound = roundIndex(state) + NAVAL_RULES.submarinePortRevealRounds;
    }
    return true;
}

export function clearPortDepartureState(unit, fromTile, toTile) {
    if (!unit || !fromTile?.isPort || fromTile === toTile) return;
    unit._portGuardUntilRound = 0;
    if (unit.type === 'submarine') unit._submarinePortRevealUntilRound = 0;
}

export function isPortGuarded(unit, state) {
    return !!unit?.tile?.isPort && Number(unit._portGuardUntilRound) > roundIndex(state);
}

export function isPortOperationalFor(tile, camp, state) {
    return !!tile?.isPort
        && campKey(tile.camp) === campKey(camp)
        && Number(tile._portOperationalAtRound || 0) <= roundIndex(state);
}

export function restoreSurrenderedPorts(state, surrenderedCamp) {
    let restored = 0;
    for (const tile of state?.tiles || []) {
        if (!tile.isPort || campKey(tile.camp) !== campKey(surrenderedCamp)) continue;
        const city = (state.tiles || []).find(candidate => candidate.isCity && candidate.districtId === tile.districtId);
        tile.camp = city?.camp || state.factions?.neutral || null;
        tile._portCapturedIndependent = false;
        tile._portOperationalAtRound = 0;
        restored++;
    }
    return restored;
}

export function repairShipsAtTurnStart(state, camp) {
    const healed = [];
    for (const tile of state?.tiles || []) {
        const unit = tile.unit;
        if (!tile.isPort || !unit || !isRegularNavalUnit(unit) || campKey(unit.camp) !== campKey(camp)) continue;
        if (!isPortOperationalFor(tile, camp, state) || unit.hp >= unit.maxHp) continue;
        const amount = Math.min(unit.maxHp - unit.hp, Math.round(unit.maxHp * NAVAL_RULES.portRepairPct));
        if (amount <= 0) continue;
        unit.heal(amount);
        healed.push({ unit, tile, amount });
    }
    return healed;
}

export function canBuildShoreBattery(state, camp) {
    const last = state?.shoreBatteryBuiltRound?.[campKey(camp)];
    return !Number.isFinite(last) || roundIndex(state) - last >= NAVAL_RULES.shoreBatteryCooldownRounds;
}

export function recordShoreBatteryBuilt(state, camp) {
    state.shoreBatteryBuiltRound ||= {};
    state.shoreBatteryBuiltRound[campKey(camp)] = roundIndex(state);
}
