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
export function classifyAttackPresentation(source) {
    const { type, isDrone } = readAttackSource(source);
    if (type === 'submarine') return ATTACK_PRESENTATION.FIRE_TORPEDO;
    if (type === 'carrier') return ATTACK_PRESENTATION.FIRE_AIR_STRAFE;
    if (isDrone || type === 'drone' || type === 'mgNest' || type === 'destroyer') return ATTACK_PRESENTATION.FIRE_TRACER;
    if (type === 'archer' || type === 'warship' || type === 'shoreBattery') return ATTACK_PRESENTATION.FIRE_CANNON;
    return ATTACK_PRESENTATION.ASSAULT;
}

export function isRangedAttackPresentation(source) {
    return classifyAttackPresentation(source) !== ATTACK_PRESENTATION.ASSAULT;
}

export function operationArrowStyleForAttacker(source) {
    return isRangedAttackPresentation(source) ? 'fire' : 'assault';
}
