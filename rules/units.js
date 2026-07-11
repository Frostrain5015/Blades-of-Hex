// rules/units.js — 兵种定义与克制关系。

import { deepFreeze } from './freeze.js';

/** 可招募兵种的面板与展示名称。 */
export const UNIT_CONFIG = deepFreeze({
    infantry: { name: '步', hp: 200, attack: 40, defense: 0.05, speed: 5, range: 1, cost: 8, color: '#0a0a0a' },
    cavalry: { name: '骑', hp: 150, attack: 50, defense: 0.05, speed: 8, range: 1, cost: 10, color: '#0a0a0a' },
    archer: { name: '炮', hp: 100, attack: 60, defense: 0, speed: 3, range: 2, cost: 12, color: '#0a0a0a' },
    mgNest: { name: '碉堡', hp: 200, attack: 40, defense: 0.05, speed: 0, range: 2, cost: 0, color: '#8B7355' },
    drone: { name: '无人机', hp: 75, attack: 30, defense: 0, speed: 8, range: 2, cost: 0, color: '#6bbcff' }
});

/** 行为克制关系。1 为无修正，大于 1 为顺克，小于 1 为逆克。 */
export const COUNTER_RELATION = deepFreeze({
    infantry: { archer: 0.75, cavalry: 1.25, infantry: 1, mgNest: 0.75, drone: 1 },
    archer: { cavalry: 0.75, infantry: 1.25, archer: 1, mgNest: 1.25, drone: 1 },
    cavalry: { infantry: 0.75, archer: 1.25, cavalry: 1, mgNest: 0.75, drone: 1 },
    mgNest: { infantry: 1.25, archer: 0.75, cavalry: 1.25, mgNest: 1, drone: 1 },
    drone: { infantry: 1.25, archer: 1, cavalry: 1, mgNest: 1, drone: 1 }
});
