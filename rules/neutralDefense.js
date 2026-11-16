import { HEX_NEIGHBORS, hexDistance } from './hex.js';
import { isRegularNavalUnit } from './naval.js';
import { isWaterTile } from './surfaces.js';
import { getAttackRangeCap, getMinimumAttackRange } from './units.js';

export function isNeutralAi(camp) {
    return camp?.id === 'neutral' && camp.controller === 'ai';
}

export function isNeutralDistrict(state, tile) {
    if (tile?.districtId == null) return false;
    const center = tile.isCity ? tile : state.tiles.find(city => city.isCity && city.districtId === tile.districtId);
    return isNeutralAi((center || tile).camp);
}

export function isNextToNeutralCoast(state, tile) {
    return HEX_NEIGHBORS.some(([dq, dr]) => {
        const shore = state.tileMap.get(`${tile.q + dq},${tile.r + dr}`);
        return shore && (shore.isPort ? isNeutralAi(shore.camp) : !isWaterTile(shore) && isNeutralDistrict(state, shore));
    });
}

export function canNeutralAttackTile(state, attacker, targetTile) {
    if (!isNeutralAi(attacker.camp)) return true;
    if (attacker.type === 'carrier' || !targetTile) return false;
    if (isNeutralDistrict(state, targetTile)) return true;
    const ship = targetTile.unit;
    if (attacker.type !== 'shoreBattery' || !isWaterTile(targetTile) || !isRegularNavalUnit(ship)
        || !isNextToNeutralCoast(state, targetTile)) return false;

    // 接近海岸还不够。敌舰须能直接夺走邻近港口，或已把中立城郭/守军纳入射程。
    const range = Math.min(getAttackRangeCap(ship.type), ship.getEffectiveRange?.() ?? ship.config.range);
    const minimumRange = getMinimumAttackRange(ship.type);
    return state.tiles.some(tile => {
        const distance = hexDistance(targetTile, tile);
        if (distance === 1 && tile.isPort && isNeutralAi(tile.camp) && !tile.unit) return true;
        return ship.morale !== 0 && distance >= minimumRange && distance <= range
            && isNeutralDistrict(state, tile)
            && (isNeutralAi(tile.unit?.camp) || (ship.type !== 'submarine' && (tile.isCity || tile.isUrban) && tile.hp > 0));
    });
}
