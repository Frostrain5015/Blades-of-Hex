import { getUnitBaseType } from './units.js';

export const ATTACK_PRESENTATION = Object.freeze({
    ASSAULT: 'assault',
    FIRE_CANNON: 'fire-cannon',
    FIRE_TRACER: 'fire-tracer',
    FIRE_TORPEDO: 'fire-torpedo',
    FIRE_AIR_STRAFE: 'fire-air-strafe'
});

export const DIVE_STRAFE_FLIGHT = Object.freeze({
    startOffsetX: -380,
    startOffsetY: -300,
    deltaX: 720,
    deltaY: 320,
    firingPathMs: 1350,
    muzzleOffset: 22
});

// 航母扫射的子弹流飞行时长：伤害数字/血条/震屏统一延迟到弹流抵达时刻。
// 本地攻击（gameLogic）与联机重放（main）共用，避免两处各自维护字面量。
export const CARRIER_STRAFE_IMPACT_MS = 780;

export const STUKA_BOMB_RELEASE_PROGRESS = 0.51;

export const AIRSTRIKE_FLIGHT = Object.freeze({
    startOffsetX: -560,
    endOffsetX: 640,
    durationMs: 2000,
    dropDuration: 0.3
});
export const AIRSTRIKE_TARGET_PROGRESS = -AIRSTRIKE_FLIGHT.startOffsetX
    / (AIRSTRIKE_FLIGHT.endOffsetX - AIRSTRIKE_FLIGHT.startOffsetX);
export const AIRDROP_LANDING_MS = (AIRSTRIKE_TARGET_PROGRESS + AIRSTRIKE_FLIGHT.dropDuration)
    * AIRSTRIKE_FLIGHT.durationMs;
export const AIRSTRIKE_DAMAGED_AA_THRESHOLD = 0.5;
export const AIRSTRIKE_DAMAGED_START_PROGRESS = 0.5;

export function isAirstrikeDamagedByAntiAir(antiAirReduction) {
    const value = Number(antiAirReduction);
    return Number.isFinite(value) && value > AIRSTRIKE_DAMAGED_AA_THRESHOLD + 1e-6;
}

export function shouldRenderAirstrikeEngineFire(fx, progress, resolvedAntiAir = fx?.antiAir) {
    if (!fx || fx.type === 'airdrop') return false;
    const t = Number(progress);
    if (!Number.isFinite(t) || t < AIRSTRIKE_DAMAGED_START_PROGRESS || t >= 1) return false;
    return isAirstrikeDamagedByAntiAir(resolvedAntiAir);
}

export function getAirstrikePassPlanePosition(targetX, targetY, progress) {
    const t = Math.min(1, Math.max(0, Number(progress) || 0));
    const startX = targetX + AIRSTRIKE_FLIGHT.startOffsetX;
    const endX = targetX + AIRSTRIKE_FLIGHT.endOffsetX;
    return {
        x: startX + t * (endX - startX),
        y: targetY - 80,
        angle: 0
    };
}

export function isUnitWaitingForAirdrop(unit, now) {
    return unit._airdropWaiting || unit._airdropLandAt > now;
}

export function getStukaFlightPosition(targetX, targetY, boardWidth, progress) {
    const diveEnd = 0.65;
    const entryX = -48;
    const exitX = boardWidth + 48;
    const lowX = targetX - 18;
    const lowY = targetY - 20;
    const diving = progress <= diveEnd;
    const p = Math.max(0, Math.min(1, diving ? progress / diveEnd : (progress - diveEnd) / (1 - diveEnd)));
    const startX = diving ? entryX : lowX;
    const endX = diving ? lowX : exitX;
    const y = lowY - (lowY + 52) * (diving ? (1 - p) ** 2 : p ** 2);
    const slopeY = 2 * (lowY + 52) * (diving ? 1 - p : -p);
    return { x: startX + (endX - startX) * p, y, angle: Math.atan2(slopeY, endX - startX) };
}

export function getDiveStrafePlanePosition(targetX, targetY, elapsedMs) {
    const flight = DIVE_STRAFE_FLIGHT;
    const progress = Math.min(1, Math.max(0, Number(elapsedMs) / flight.firingPathMs));
    return {
        x: targetX + flight.startOffsetX + flight.deltaX * progress,
        y: targetY + flight.startOffsetY + flight.deltaY * progress,
        angle: Math.atan2(flight.deltaY, flight.deltaX)
    };
}

/** Returns the animated aircraft muzzle position for a dive-strafe tracer. */
export function getDiveStrafeMuzzlePosition(targetX, targetY, elapsedMs) {
    const flight = DIVE_STRAFE_FLIGHT;
    const plane = getDiveStrafePlanePosition(targetX, targetY, elapsedMs);
    return {
        x: plane.x + Math.cos(plane.angle) * flight.muzzleOffset,
        y: plane.y + Math.sin(plane.angle) * flight.muzzleOffset
    };
}

function readAttackSource(source) {
    if (typeof source === 'string') return { type: source, isDrone: source === 'drone' };
    if (!source || typeof source !== 'object') return { type: '', isDrone: false };
    return {
        type: source.attackerType ?? source.type ?? '',
        isDrone: Boolean(source.attackerIsDrone ?? source._isDrone)
    };
}

/**
 * Single presentation classifier shared by local attacks, remote replay and
 * route previews. It describes visuals only and never changes attack rules.
 */
function classifyCombatAttack({ type, isDrone }) {
    const baseType = getUnitBaseType(type) || type;
    if (baseType === 'submarine') return ATTACK_PRESENTATION.FIRE_TORPEDO;
    if (baseType === 'carrier') return ATTACK_PRESENTATION.FIRE_AIR_STRAFE;
    if (isDrone || type === 'cpc_guerrilla' || baseType === 'drone' || baseType === 'mgNest' || baseType === 'destroyer') return ATTACK_PRESENTATION.FIRE_TRACER;
    if (baseType === 'archer' || baseType === 'warship' || baseType === 'shoreBattery') return ATTACK_PRESENTATION.FIRE_CANNON;
    return ATTACK_PRESENTATION.ASSAULT;
}

export function classifyAttackPresentation(source) {
    const attack = readAttackSource(source);
    return attack.type === 'us_marine' ? ATTACK_PRESENTATION.FIRE_TRACER : classifyCombatAttack(attack);
}

export function isRangedCombatAttack(source) {
    return classifyCombatAttack(readAttackSource(source)) !== ATTACK_PRESENTATION.ASSAULT;
}

export function isRangedAttackPresentation(source) {
    return classifyAttackPresentation(source) !== ATTACK_PRESENTATION.ASSAULT;
}

export function operationArrowStyleForAttacker(source) {
    return isRangedAttackPresentation(source) ? 'fire' : 'assault';
}
