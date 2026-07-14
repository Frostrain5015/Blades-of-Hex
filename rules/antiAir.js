// rules/antiAir.js — 防空覆盖的单一纯规则入口。
//
// 当前地图只保存 tile.fortification = 'flak'，没有工事 owner 字段。
// 因此 flak 按“无归属的本格防空”处理：只要工事规则启用，就为该格
// 提供 1 层防空；不得从当前驻军阵营反推工事归属。

import { campToKey } from './camps.js';
import { COLONEL_CARD_DATA } from './cards.js';
import { COMBAT_BALANCE } from './constants.js';
import { isMechanicEnabled } from './mechanics.js';

export const ANTI_AIR_RADIUS = COLONEL_CARD_DATA.antiairRadius;
export const ANTI_AIR_MAX_LAYERS = COMBAT_BALANCE.defense.antiairMaxLayers;

const UNIT_PROVIDER_TYPES = Object.freeze(new Set(['archer', 'mgNest']));

/** 炮兵、碉堡或挂载停滞者的单位各自提供 1 个防空来源。 */
export function isAntiAirUnit(unit) {
    return !!unit && (UNIT_PROVIDER_TYPES.has(unit.type) || unit.commander === 'staller');
}

function axialDistance(a, b) {
    const dq = Number(a?.q) - Number(b?.q);
    const dr = Number(a?.r) - Number(b?.r);
    if (!Number.isFinite(dq) || !Number.isFinite(dr)) return Infinity;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function tileKey(tile) {
    return `${tile.q},${tile.r}`;
}

function getUnitProviderKinds(unit) {
    const kinds = [];
    if (unit.type === 'archer') kinds.push('archer');
    if (unit.type === 'mgNest') kinds.push('mgNest');
    if (unit.commander === 'staller') kinds.push('staller');
    return kinds;
}

function makeFlakSource(tile) {
    return {
        kind: 'flak',
        tileKey: tileKey(tile),
        q: tile.q,
        r: tile.r,
        campKey: null,
        ownerKnown: false
    };
}

function makeUnitSource(tile, unit) {
    return {
        kind: 'unit',
        tileKey: tileKey(tile),
        q: tile.q,
        r: tile.r,
        campKey: campToKey(unit.camp),
        unitId: unit.id ?? null,
        unitType: unit.type ?? null,
        commander: unit.commander ?? null,
        providers: getUnitProviderKinds(unit)
    };
}

/**
 * 解析一个目标格受到的防空覆盖。
 *
 * @param {object} targetTile 当前真实地块，至少包含 q/r/fortification。
 * @param {object|string} attackingCamp 发起空中行动的阵营。
 * @param {Map<string, object>} tileMap 当前 gameState.tileMap。
 * @param {{ state?: object, includeSources?: boolean }} options
 * @returns {{ layers: 0|1|2, sources?: object[] }}
 *
 * sources 返回所有命中的原始来源，可能多于 layers；layers 始终按生产上限封顶。
 * 单个单位即使同时是炮兵并挂载停滞者，也只贡献一个来源、一层防空。
 */
export function resolveAntiAirCoverage(targetTile, attackingCamp, tileMap, options = {}) {
    const includeSources = options.includeSources === true;
    if (!targetTile) return includeSources ? { layers: 0, sources: [] } : { layers: 0 };

    const sources = [];
    let sourceCount = 0;
    const addSource = source => {
        sourceCount++;
        if (includeSources) sources.push(source);
    };

    if (targetTile.fortification === 'flak' && isMechanicEnabled(options.state, 'fortifications')) {
        addSource(makeFlakSource(targetTile));
    }

    const attackingCampKey = campToKey(attackingCamp);
    const tiles = tileMap && typeof tileMap.values === 'function' ? tileMap.values() : [];
    for (const tile of tiles) {
        const unit = tile?.unit;
        if (!isAntiAirUnit(unit)) continue;
        if (campToKey(unit.camp) === attackingCampKey) continue;
        if (axialDistance(tile, targetTile) > ANTI_AIR_RADIUS) continue;
        addSource(makeUnitSource(tile, unit));
    }

    const layers = /** @type {0|1|2} */ (Math.min(sourceCount, ANTI_AIR_MAX_LAYERS));
    return includeSources ? { layers, sources } : { layers };
}

/** 与现有 getAALayers 调用形态接近的数值便捷入口。 */
export function getAntiAirLayers(targetTile, attackingCamp, tileMap, options = {}) {
    return resolveAntiAirCoverage(targetTile, attackingCamp, tileMap, options).layers;
}
