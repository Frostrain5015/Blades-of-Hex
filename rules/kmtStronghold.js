import { campToKey } from './camps.js';
import { isFriendly } from './diplomacy.js';
import { HEX_NEIGHBORS } from './hex.js';

export const KMT_LINK_DEFENSE_SCALE = 0.50;
export const KMT_LINK_DAMAGE_BONUS = 0.15;

export function isKmtLinkMember(unit) {
    return unit?.type === 'kmt_training_brigade' && unit.hp > 0 && !unit.isEmbarked && !!unit.tile
        && !unit._airdropWaiting;
}

export function getKmtLinkedUnits(unit, state) {
    if (!isKmtLinkMember(unit)) return [];
    const key = campToKey(unit.camp);
    const members = (state?.tiles || []).map(tile => tile.unit)
        .filter(other => isKmtLinkMember(other) && campToKey(other.camp) === key);
    return members.length > 1 && members.includes(unit)
        ? members.sort((a, b) => String(a.id).localeCompare(String(b.id)))
        : [];
}

export function getKmtLinkDefenseBonus(unit, state, positionDefense) {
    return positionDefense > 0 && getKmtLinkedUnits(unit, state).length > 0
        ? positionDefense * KMT_LINK_DEFENSE_SCALE : 0;
}

export function getKmtLinkDamageBonus(unit, state) {
    if (!unit?.tile || unit.isEmbarked || unit.hp <= 0 || unit._airdropWaiting) return 0;
    if (getKmtLinkedUnits(unit, state).length) return KMT_LINK_DAMAGE_BONUS;
    for (const [dq, dr] of HEX_NEIGHBORS) {
        const other = state?.tileMap?.get(`${unit.tile.q + dq},${unit.tile.r + dr}`)?.unit;
        if (isKmtLinkMember(other) && isFriendly(state, other.camp, unit.camp)
            && getKmtLinkedUnits(other, state).length) return KMT_LINK_DAMAGE_BONUS;
    }
    return 0;
}

export function getKmtPoolCapacity(unit) {
    return Math.max(1, Math.min(unit.maxHp, unit._campaignMaxHp || unit.maxHp));
}

export function getKmtReinforceDeficit(unit, state) {
    const linked = getKmtLinkedUnits(unit, state);
    if (!linked.length) return Math.max(0, unit.maxHp - unit.hp);
    return linked.reduce((sum, member) => sum + Math.max(0, getKmtPoolCapacity(member) - member.hp), 0);
}

export function distributeKmtPoolChange(units, amount, healing = false) {
    if (healing) {
        const rooms = units.map(unit => Math.max(0, getKmtPoolCapacity(unit) - unit.hp));
        let remaining = Math.min(Math.round(amount), rooms.reduce((sum, room) => sum + room, 0));
        let roomLeft = rooms.reduce((sum, room) => sum + room, 0);
        return units.map((unit, index) => {
            const room = rooms[index];
            const share = roomLeft > 0 ? Math.round(remaining * room / roomLeft) : 0;
            remaining -= share;
            roomLeft -= room;
            return { unit, hp: unit.hp + share };
        });
    }

    const total = units.reduce((sum, unit) => sum + unit.hp, 0);
    const remaining = Math.round(total - amount);
    if (remaining < units.length) return units.map(unit => ({ unit, hp: 0 }));
    let aboveFloor = remaining - units.length;
    let hpAboveFloor = total - units.length;
    return units.map(unit => {
        const spare = unit.hp - 1;
        const share = hpAboveFloor > 0 ? Math.round(aboveFloor * spare / hpAboveFloor) : 0;
        aboveFloor -= share;
        hpAboveFloor -= spare;
        return { unit, hp: 1 + share };
    });
}
