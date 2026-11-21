import { listCultureStrikePlans } from '../../rules/cultureStrike.js';
import { isLandTile } from '../../rules/surfaces.js';
import { hpGold, residualGold } from './weights.js';

export function cultureStrikeValue(world, unit, plan) {
    const gain = plan.hits.reduce((total, { tile, multiplier }) => {
        const target = tile.unit;
        const health = target.hp + (target.activeShield || 0);
        const expected = world.combat.estimateDamage(unit, target, tile) * multiplier;
        return total + Math.min(health, expected) * hpGold(target)
            + (expected >= health ? residualGold(target) * 0.75 : 0);
    }, 0);
    if (!plan.landing) return gain;
    const risk = Math.max(0, world.threatAt(plan.landing, unit) - world.threatAt(unit.tile, unit));
    const relocation = plan.landing.isCity && plan.landing.camp !== unit.camp ? 30
        : isLandTile(plan.landing) ? 0 : -4;
    const leavesOnlyCity = world.myCities.length === 1 && unit.tile.isCity && unit.tile.camp === unit.camp;
    return gain + relocation - risk * hpGold(unit) - (leavesOnlyCity ? 5 : 0);
}

export function chooseCultureStrike(world, unit) {
    if (!world) return undefined;
    return listCultureStrikePlans(unit, world.gameState)
        .map(plan => ({ plan, value: cultureStrikeValue(world, unit, plan) }))
        .sort((a, b) => b.value - a.value)[0];
}
