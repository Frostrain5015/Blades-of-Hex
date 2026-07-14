// rules/camps.js — 阵营外观定义。
// CAMP 仅作为旧存档/未初始化状态的席位占位对象；运行中应从
// gameState.factions 读取真正阵营，禁止用 CAMP.playerN 推断颜色或行动顺序。

import { deepFreeze } from './freeze.js';
/** 传统席位占位对象。全部使用无色占位外观，不能据此推断阵营色或先后手。 */
export const CAMP_DATA = deepFreeze({
    player1: { id: 'player1', name: '第一阵营', colorId: null, color: '#c0c0c0', flag: '' },
    player2: { id: 'player2', name: '第二阵营', colorId: null, color: '#c0c0c0', flag: '' },
    player3: { id: 'player3', name: '第三阵营', colorId: null, color: '#c0c0c0', flag: '' },
    neutral: { id: 'neutral', name: '中立', colorId: 'gray', color: '#b0b0b0', flag: '' }
});

export const CAMP = CAMP_DATA;

export const CAMP_FLAG_COLORS = deepFreeze({
    neu: { main: '#888', dark: '#444', light: '#aaa' }
});

/**
 * 全局九色调色板 —— 所有模式共用的阵营外观唯一数据源。
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
    { id: 'gray',   label: '深灰', tile: '#b0b0b0', flag: { main: '#888888', dark: '#444444', light: '#aaaaaa' } },
    { id: 'white',  label: '白', tile: '#e8e8e8', flag: { main: '#bbbbbb', dark: '#888888', light: '#dddddd' } }
]);

export const FACTION_COLOR_KEYS = deepFreeze(FACTION_PALETTE.map(entry => entry.id));
/** 普通玩家对局仅开放七种彩虹色；深灰与白保留给中立、训练靶及剧情阵营。 */
export const PLAYER_FACTION_COLOR_KEYS = deepFreeze(
    FACTION_PALETTE.filter(entry => entry.id !== 'gray' && entry.id !== 'white').map(entry => entry.id)
);
export const DEFAULT_SEAT_COLOR_IDS = deepFreeze(['red', 'blue', 'green']);

export function isPlayerFactionColor(colorValue) {
    const id = getPaletteEntry(colorValue)?.id;
    return !!id && PLAYER_FACTION_COLOR_KEYS.includes(id);
}

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

/**
 * 城郭环与阵营共享色相，但刻意避开主旗色：亮阶用于轮廓，暗阶用于压边与门洞。
 * 这使城市标记能跟随动态阵营，又不会被误读为第二面旗帜。
 */
export function getCityMarkerColors(colorValue) {
    const flag = getFlagColors(colorValue);
    return { line: flag.light, shadow: flag.dark, fill: flag.dark };
}

/** 由阵营色生成默认名称；名称随颜色走，而不是随 player1/2/3 席位走。 */
export function getFactionColorName(colorValue, fallback = '未命名阵营') {
    const entry = getPaletteEntry(colorValue);
    return entry ? `${entry.label}军` : fallback;
}

export function campToKey(camp, mode = 'full') {
    const key = typeof camp === 'string' ? camp
        : typeof camp?.id === 'string' ? camp.id
            : 'neutral';
    if (mode !== 'short') return key;
    if (key === 'player1') return 'p1';
    if (key === 'player2') return 'p2';
    if (key === 'player3') return 'p3';
    return key === 'neutral' ? 'neu' : key;
}
