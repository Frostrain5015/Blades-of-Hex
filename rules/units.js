// rules/units.js — 兵种定义与克制关系。

import { deepFreeze } from './freeze.js';

/** 可招募兵种的面板与展示名称。 */
export const UNIT_CONFIG = deepFreeze({
    infantry: { name: '步', hp: 200, attack: 40, defense: 0.05, speed: 5, range: 1, cost: 8, color: '#0a0a0a', movementDomain: 'land' },
    cavalry: { name: '骑', hp: 150, attack: 50, defense: 0.05, speed: 8, range: 1, cost: 10, color: '#0a0a0a', movementDomain: 'land' },
    archer: { name: '炮', hp: 100, attack: 60, defense: 0, speed: 3, range: 2, cost: 12, color: '#0a0a0a', movementDomain: 'land' },
    mgNest: { name: '碉堡', hp: 200, attack: 40, defense: 0.05, speed: 0, range: 2, cost: 0, color: '#8B7355', movementDomain: 'land' },
    shoreBattery: { name: '岸防炮', hp: 150, attack: 50, defense: 0, speed: 0, range: 2, cost: 10, color: '#6f6657', movementDomain: 'land' },
    drone: { name: '无人机', hp: 75, attack: 30, defense: 0, speed: 8, range: 2, cost: 0, color: '#6bbcff', movementDomain: 'land' },
    destroyer: { name: '驱逐舰', hp: 150, attack: 40, defense: 0.05, speed: 6, range: 1, cost: 10, color: '#477b8c', movementDomain: 'naval' },
    // 保留 warship 内部 ID 兼容旧存档与战役，显示及数值升级为巡洋舰。
    warship: { name: '巡洋舰', hp: 200, attack: 60, defense: 0.10, speed: 4, range: 3, cost: 15, color: '#315f78', movementDomain: 'naval' },
    submarine: { name: '潜艇', hp: 100, attack: 50, defense: 0, speed: 8, range: 1, cost: 12, color: '#233f50', movementDomain: 'naval' }
});

/** 行为克制关系。1 为无修正，大于 1 为顺克，小于 1 为逆克。 */
export const COUNTER_RELATION = deepFreeze({
    infantry: { archer: 0.75, cavalry: 1.25, infantry: 1, mgNest: 0.75, shoreBattery: 1, drone: 1, destroyer: 1, warship: 1, submarine: 1 },
    archer: { cavalry: 0.75, infantry: 1.25, archer: 1, mgNest: 1.25, shoreBattery: 1, drone: 1, destroyer: 1, warship: 1, submarine: 1 },
    cavalry: { infantry: 0.75, archer: 1.25, cavalry: 1, mgNest: 0.75, shoreBattery: 1, drone: 1, destroyer: 1, warship: 1, submarine: 1 },
    mgNest: { infantry: 1.25, archer: 0.75, cavalry: 1.25, mgNest: 1, shoreBattery: 1, drone: 1, destroyer: 1, warship: 1, submarine: 1 },
    shoreBattery: { infantry: 1, archer: 1, cavalry: 1, mgNest: 1, shoreBattery: 1, drone: 1, destroyer: 1, warship: 1, submarine: 1 },
    drone: { infantry: 1.25, archer: 1, cavalry: 1, mgNest: 1, shoreBattery: 1, drone: 1, destroyer: 1, warship: 1, submarine: 1 },
    destroyer: { infantry: 1, archer: 1, cavalry: 1, mgNest: 1, shoreBattery: 1, drone: 1, destroyer: 1, warship: 0.75, submarine: 1.25 },
    warship: { infantry: 1, archer: 1, cavalry: 1, mgNest: 1, shoreBattery: 1, drone: 1, destroyer: 1.25, warship: 1, submarine: 0.75 },
    submarine: { infantry: 1, archer: 1, cavalry: 1, mgNest: 1, shoreBattery: 1, drone: 1, destroyer: 0.75, warship: 1.25, submarine: 1 }
});
