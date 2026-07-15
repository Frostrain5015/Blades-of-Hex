export const ATTACK_PRESENTATION = Object.freeze({
    ASSAULT: 'assault',
    FIRE_CANNON: 'fire-cannon',
    FIRE_TRACER: 'fire-tracer'
});

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
