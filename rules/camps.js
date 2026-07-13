// rules/camps.js — 阵营定义。
// 阵营对象在模块加载时创建一次，其他模块按引用比较 CAMP.player1 等；
// 对象已冻结，昵称等运行时信息应存放在对局状态而非此处。

import { deepFreeze } from './freeze.js';
import { EMOJI } from './symbols.js';

/** 阵营的显示名、底色和旗帜 emoji。 */
export const CAMP_DATA = deepFreeze({
    player1: { id: 'player1', name: '红军', color: '#ffaaaa', flag: EMOJI.camp.player1 },
    player2: { id: 'player2', name: '蓝军', color: '#aaaaff', flag: EMOJI.camp.player2 },
    player3: { id: 'player3', name: '绿军', color: '#aaffaa', flag: EMOJI.camp.player3 },
    neutral: { id: 'neutral', name: '中立', color: '#c0c0c0', flag: EMOJI.camp.neutral }
});

export const CAMP = CAMP_DATA;

export const CAMP_FLAG_COLORS = deepFreeze({
    p1: { main: '#d44040', dark: '#8b1a1a', light: '#f06060' },
    p2: { main: '#4060d0', dark: '#1a2a80', light: '#6080f0' },
    p3: { main: '#40a040', dark: '#1a601a', light: '#60d060' },
    neu: { main: '#777', dark: '#444', light: '#999' }
});

/**
 * 九色调色板 —— 战役编辑器中阵营可选色的完整定义。
 * 每色包含：地块底色（浅） + 旗帜三阶色（主/暗/亮）。
 * 关卡配置只保存稳定的 id；tile/flag 是运行时表现值，不属于作者数据契约。
 */
export const FACTION_PALETTE = deepFreeze([
    { id: 'red',    label: '红', tile: '#ffaaaa', flag: { main: '#d44040', dark: '#8b1a1a', light: '#f06060' } },
    { id: 'orange', label: '橙', tile: '#fcd6b0', flag: { main: '#e88430', dark: '#a05510', light: '#f5a860' } },
    { id: 'yellow', label: '黄', tile: '#fff5c0', flag: { main: '#d4c420', dark: '#908010', light: '#e8d840' } },
    { id: 'green',  label: '绿', tile: '#aaffaa', flag: { main: '#40a040', dark: '#1a601a', light: '#60d060' } },
    { id: 'cyan',   label: '青', tile: '#aaffdd', flag: { main: '#30b8a0', dark: '#107060', light: '#60d8c0' } },
    { id: 'blue',   label: '蓝', tile: '#aaaaff', flag: { main: '#4060d0', dark: '#1a2a80', light: '#6080f0' } },
    { id: 'purple', label: '紫', tile: '#d8aaff', flag: { main: '#9050c8', dark: '#602890', light: '#b878e0' } },
    { id: 'gray',   label: '深灰', tile: '#b0b0b0', flag: { main: '#666666', dark: '#444444', light: '#888888' } },
    { id: 'white',  label: '白', tile: '#e8e8e8', flag: { main: '#bbbbbb', dark: '#888888', light: '#dddddd' } }
]);

export const FACTION_COLOR_KEYS = deepFreeze(FACTION_PALETTE.map(entry => entry.id));

/** 根据规范 id 或旧地块色查找调色板条目；旧色值仅用于配置迁移。 */
export function getPaletteEntry(colorValue) {
    return FACTION_PALETTE.find(entry => entry.id === colorValue || entry.tile === colorValue) || null;
}

/** 把规范 id（或旧地块色）解析为地块色。 */
export function getTileColor(colorValue, fallback = '#777777') {
    const entry = getPaletteEntry(colorValue);
    if (entry) return entry.tile;
    return typeof colorValue === 'string' && /^#[0-9a-f]{6}$/i.test(colorValue) ? colorValue : fallback;
}

/** 根据规范 id（或旧地块色）获取旗帜三阶色。 */
export function getFlagColors(colorValue) {
    const entry = getPaletteEntry(colorValue);
    if (entry) return entry.flag;
    const fallback = getTileColor(colorValue);
    return { main: fallback, dark: fallback, light: fallback };
}

export function campToKey(camp, mode = 'full') {
    const key = typeof camp === 'string' ? camp
        : typeof camp?.id === 'string' ? camp.id
            : camp === CAMP.player1 ? 'player1'
                : camp === CAMP.player2 ? 'player2'
                    : camp === CAMP.player3 ? 'player3'
                        : 'neutral';
    if (mode !== 'short') return key;
    if (key === 'player1') return 'p1';
    if (key === 'player2') return 'p2';
    if (key === 'player3') return 'p3';
    return key === 'neutral' ? 'neu' : key;
}
