// rules/antiAir.js — 百分比防空覆盖的单一纯规则入口。

import { campToKey } from './camps.js';
import { COMMANDER_CONFIG } from './commanders.js';
import { isFriendly } from './diplomacy.js';
import { isMechanicEnabled } from './mechanics.js';
import { areCommanderMechanicsSuppressed } from './movement.js';
import { FORTIFICATION_CONFIG } from './terrain.js';
import { getSpecialization, getSpecializationAbilityValue } from './units.js';

export const FLAK_SELF_REDUCTION = FORTIFICATION_CONFIG.flak.antiAirReduction;
export const ANTI_AIR_TOTAL_REDUCTION_CAP = 0.85;
export const ANTI_AIR_RADIUS = 2;

function axialDistance(a, b) {
    const dq = Number(a?.q) - Number(b?.q);
    const dr = Number(a?.r) - Number(b?.r);
    if (!Number.isFinite(dq) || !Number.isFinite(dr)) return Infinity;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function tileKey(tile) {
    return `${tile.q},${tile.r}`;
}

export function getFieldFortification(tile) {
    if (tile?.fieldFortification && typeof tile.fieldFortification === 'object') return tile.fieldFortification;
    if (typeof tile?.fortification === 'object') return tile.fortification;
    if (typeof tile?.fortification === 'string') {
        return { type: tile.fortification, campKey: null, ownerKnown: false };
    }
    return null;
}

export function getAntiAirUnitProfile(unit) {
    if (!unit || unit.hp <= 0) return null;
    const antiAir = getSpecialization(unit.type, unit.specializationKey)?.abilities?.antiAir;
    if (antiAir) {
        return {
            radius: Number(antiAir.radius) || 0,
            reduction: Number(getSpecializationAbilityValue(unit, 'antiAir')) || 0,
            provider: unit.specializationKey
        };
    }
    if (unit.commander === 'staller' && !areCommanderMechanicsSuppressed(unit)) {
        return {
            radius: 2,
            reduction: COMMANDER_CONFIG.staller.balance.rangedDefenseBonus,
            provider: 'staller'
        };
    }
    return null;
}

export function isAntiAirUnit(unit) {
    return !!getAntiAirUnitProfile(unit);
}

/**
 * 返回目标格受到的原始防空百分比。不同来源直接相加，不在此处应用总减伤上限。
 */
export function resolveAntiAirCoverage(targetTile, attackingCamp, tileMap, options = {}) {
    const includeSources = options.includeSources === true;
    const empty = includeSources ? { reduction: 0, sources: [] } : { reduction: 0 };
    if (!targetTile) return empty;

    const attackingCampKey = campToKey(attackingCamp);
    const defendingCampKey = campToKey(targetTile.unit?.camp || targetTile.camp);
    const sources = [];
    let reduction = 0;
    const add = source => {
        reduction += source.reduction;
        if (includeSources) sources.push(source);
    };

    const fortification = getFieldFortification(targetTile);
    if (fortification?.type === 'flak' && isMechanicEnabled(options.state, 'fortifications')) {
        const ownerKnown = fortification.ownerKnown !== false && !!fortification.campKey;
        const protectsTarget = !ownerKnown
            || isFriendly(options.state, fortification.campKey, defendingCampKey);
        const opposesAttacker = !ownerKnown
            || !isFriendly(options.state, fortification.campKey, attackingCampKey);
        if (protectsTarget && opposesAttacker) {
            add({
                kind: 'flak', tileKey: tileKey(targetTile), q: targetTile.q, r: targetTile.r,
                campKey: fortification.campKey || null, ownerKnown, reduction: FLAK_SELF_REDUCTION
            });
        }
    }

    const tiles = tileMap && typeof tileMap.values === 'function' ? tileMap.values() : [];
    for (const tile of tiles) {
        const unit = tile?.unit;
        const profile = getAntiAirUnitProfile(unit);
        if (!profile || profile.reduction <= 0) continue;
        const unitCampKey = campToKey(unit.camp);
        if (unitCampKey === attackingCampKey) continue;
        if (defendingCampKey !== 'neutral' && !isFriendly(options.state, unitCampKey, defendingCampKey)) continue;
        if (axialDistance(tile, targetTile) > profile.radius) continue;
        add({
            kind: 'unit', tileKey: tileKey(tile), q: tile.q, r: tile.r,
            campKey: unitCampKey, unitId: unit.id ?? null, unitType: unit.type,
            specializationKey: unit.specializationKey || null, provider: profile.provider,
            radius: profile.radius, reduction: profile.reduction
        });
    }

    const normalized = Math.max(0, reduction);
    return includeSources ? { reduction: normalized, sources } : { reduction: normalized };
}

export function getAntiAirReduction(targetTile, attackingCamp, tileMap, options = {}) {
    return resolveAntiAirCoverage(targetTile, attackingCamp, tileMap, options).reduction;
}

// 过渡别名：旧调用方在迁移完成前仍可读取数值，但返回值已经是百分比而非层数。
export const getAntiAirLayers = getAntiAirReduction;
