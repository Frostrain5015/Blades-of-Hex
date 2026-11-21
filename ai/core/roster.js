import { W } from './weights.js';

// 远征兵力口径必须在任务、时钟和生产层一致；后方经济将领不计作占领者。
export function isFieldCapturer(world, unit) {
    return world.isCapturable(unit) && !world.isImmobile(unit)
        && !['minister', 'astrologer'].includes(unit.commander);
}

export function shouldReserveCityGarrison(world, unit) {
    if (!unit.tile?.isCity || unit.tile.camp !== world.myCamp || !world.isCapturable(unit)) return false;
    if (world.caps.victoryClock && !world.gameState.campaignMode
        && world.cityGap === 1 && world.roundsRemaining <= W.leadDefenseRounds) {
        return true;
    }
    if (world.caps.opponentModeling && world.myCities.length === 1) {
        const city = unit.tile;
        const lowCapitalHp = Number(city.hp ?? 250) <= 180;
        const airdropThreat = (world.hostileAirfields || []).some(af =>
            world.helpers.hexDistance(af, city) <= 8) && city.fortification !== 'flak';
        const nearbyEnemy = world.rivalUnits.some(enemy =>
            enemy.tile && world.isCapturable(enemy) && world.helpers.hexDistance(enemy.tile, city) <= 2);
        const cannotReplace = world.gold < 8 && !['minister', 'astrologer'].includes(unit.commander);
        if ((airdropThreat && lowCapitalHp) || (nearbyEnemy && cannotReplace && lowCapitalHp)) {
            return true;
        }
    }
    return false;
}

export function shouldHoldCityPosition(world, unit, mission) {
    const city = unit.tile;
    return shouldReserveCityGarrison(world, unit)
        || (world.caps.emergencyDefense && city?.isCity && city.camp === world.myCamp
            && mission?.kind === 'garrison' && mission.targetQ === city.q && mission.targetR === city.r);
}
