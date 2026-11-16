import { W } from './weights.js';

// 远征兵力口径必须在任务、时钟和生产层一致；后方经济将领不计作占领者。
export function isFieldCapturer(world, unit) {
    return world.isCapturable(unit) && !world.isImmobile(unit)
        && !['minister', 'astrologer'].includes(unit.commander);
}

export function shouldReserveCityGarrison(world, unit) {
    return world.caps.victoryClock && !world.gameState.campaignMode
        && world.cityGap === 1 && world.roundsRemaining <= W.leadDefenseRounds
        && unit.tile?.isCity && unit.tile.camp === world.myCamp && world.isCapturable(unit);
}

export function shouldHoldCityPosition(world, unit, mission) {
    const city = unit.tile;
    return shouldReserveCityGarrison(world, unit)
        || (world.caps.emergencyDefense && city?.isCity && city.camp === world.myCamp
            && mission?.kind === 'garrison' && mission.targetQ === city.q && mission.targetR === city.r);
}
