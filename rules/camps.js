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

const HISTORICAL_NEUTRAL_COLORS = [
    { id: 'belgiumSage', label: '灰绿', tile: '#A9BE9A', flag: { main: '#698554', dark: '#374A2E', light: '#BACDAD' } },
    { id: 'polandSand', label: '暖灰米', tile: '#D5C5A7', flag: { main: '#9C8058', dark: '#5A4630', light: '#E6D6B8' } },
    { id: 'norwayRose', label: '灰玫瑰', tile: '#CCAAB9', flag: { main: '#A35F79', dark: '#613548', light: '#DFB6CA' } },
    { id: 'italyMauve', label: '灰紫', tile: '#99839D', flag: { main: '#896B91', dark: '#4B3653', light: '#C1AAC6' } },
    { id: 'iranJade', label: '灰青', tile: '#A1C4BF', flag: { main: '#47847D', dark: '#294C48', light: '#B8D9D2' } },
    { id: 'mongoliaClay', label: '黏土红', tile: '#CDA795', flag: { main: '#975E4C', dark: '#5F392E', light: '#E3BCAA' } },
    { id: 'malayaSlate', label: '灰蓝', tile: '#9AB7C9', flag: { main: '#547F98', dark: '#2C4A5D', light: '#B8D0DC' } },
    { id: 'indiaOchre', label: '赭金', tile: '#DFC4A0', flag: { main: '#A3723B', dark: '#674422', light: '#EAD0AB' } },
    { id: 'moroccoTerracotta', label: '陶红', tile: '#D7A99E', flag: { main: '#A45647', dark: '#62342C', light: '#E5BFB6' } },
    { id: 'saigonLilac', label: '浅灰紫', tile: '#C1B2C9', flag: { main: '#80698F', dark: '#4D3E5B', light: '#D8CBE0' } },
    { id: 'vietnamRose', label: '灰红', tile: '#D7A3AE', flag: { main: '#A14F63', dark: '#603141', light: '#E8BAC4' } },
    { id: 'philippinesCoral', label: '浅珊瑚', tile: '#D8ADAC', flag: { main: '#AA6563', dark: '#633B3A', light: '#EAC1BE' } },
    { id: 'burmaStone', label: '砂灰', tile: '#CDBFA6', flag: { main: '#897655', dark: '#534632', light: '#E2D4BA' } },
    { id: 'koreaLavender', label: '淡薰衣草', tile: '#C0B7D4', flag: { main: '#79669F', dark: '#47395F', light: '#DCD1EA' } },
    { id: 'manchukuoSand', label: '浅沙金', tile: '#D8BA8C', flag: { main: '#A47A42', dark: '#604721', light: '#E8CDA4' } }
];

/**
 * 全局调色板 —— 所有模式共用的阵营外观唯一数据源。
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
    { id: 'white',  label: '白', tile: '#e8e8e8', flag: { main: '#bbbbbb', dark: '#888888', light: '#dddddd' } },
    { id: 'snow',   label: '雪白', tile: '#e5edf6', flag: { main: '#c5d5e7', dark: '#7d96b0', light: '#f4f8ff' } },
    // 《世界征服者》风格历史预设阵营保留色（不占用普通色盘七色槽位）
    { id: 'usaTeal',     label: '青绿', tile: '#9eead2', flag: { main: '#2db58a', dark: '#136b4f', light: '#64ddb6' } },
    { id: 'franceSky',   label: '浅蓝', tile: '#bfe6fd', flag: { main: '#47a8eb', dark: '#1b659e', light: '#82ccf8' } },
    { id: 'japanOlive',  label: '黄绿', tile: '#e1f0a6', flag: { main: '#92bc29', dark: '#557211', light: '#bbde5e' } },
    { id: 'germanyGray', label: '深灰', tile: '#99a1aa', flag: { main: '#4b535b', dark: '#22272c', light: '#78828d' } },
    ...HISTORICAL_NEUTRAL_COLORS
]);

const RESERVED_PRESET_COLOR_IDS = new Set([
    'gray', 'white', 'snow', 'usaTeal', 'franceSky', 'japanOlive', 'germanyGray',
    ...HISTORICAL_NEUTRAL_COLORS.map(entry => entry.id)
]);

export const FACTION_COLOR_KEYS = deepFreeze(FACTION_PALETTE.map(entry => entry.id));
/** 普通色盘开放七种颜色，预设旗帜可使用保留色。 */
export const PLAYER_FACTION_COLOR_KEYS = deepFreeze(
    FACTION_PALETTE.filter(entry => !RESERVED_PRESET_COLOR_IDS.has(entry.id)).map(entry => entry.id)
);
export const DEFAULT_SEAT_COLOR_IDS = deepFreeze(['red', 'blue', 'green']);

// 主旗色的 HSL 色相，以度为单位。
const PLAYER_FACTION_HUES = Object.freeze({
    red: 0, orange: 28, yellow: 55, green: 120, cyan: 169, blue: 227, purple: 272
});

/** AI 逐席选择与真人及已分配 AI 最接近的颜色之间距离最大的选项。 */
export function assignAiFactionColors(colors, aiKeys) {
    const assigned = { ...colors };
    const used = new Set(Object.entries(colors)
        .filter(([key, color]) => !aiKeys.includes(key) && PLAYER_FACTION_COLOR_KEYS.includes(color))
        .map(([, color]) => color));
    for (const key of aiKeys) {
        let best = assigned[key];
        let bestDistance = -1;
        for (const candidate of PLAYER_FACTION_COLOR_KEYS) {
            if (used.has(candidate)) continue;
            const distance = Math.min(180, ...Array.from(used, color => {
                const delta = Math.abs(PLAYER_FACTION_HUES[candidate] - PLAYER_FACTION_HUES[color]);
                return Math.min(delta, 360 - delta);
            }));
            if (distance > bestDistance || (distance === bestDistance && candidate === assigned[key])) {
                best = candidate;
                bestDistance = distance;
            }
        }
        assigned[key] = best;
        used.add(best);
    }
    return assigned;
}

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
