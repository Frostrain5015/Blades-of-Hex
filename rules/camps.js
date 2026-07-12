// rules/camps.js — 阵营定义。
// 阵营对象在模块加载时创建一次，其他模块按引用比较 CAMP.player1 等；
// 对象已冻结，昵称等运行时信息应存放在对局状态而非此处。

import { deepFreeze } from './freeze.js';
import { EMOJI } from './symbols.js';

/** 阵营的显示名、底色和旗帜 emoji。 */
export const CAMP_DATA = deepFreeze({
    player1: { name: '红军', color: '#e05050', flag: EMOJI.camp.player1 },
    player2: { name: '蓝军', color: '#aaaaff', flag: EMOJI.camp.player2 },
    player3: { name: '绿军', color: '#aaffaa', flag: EMOJI.camp.player3 },
    neutral: { name: '中立', color: '#c0c0c0', flag: EMOJI.camp.neutral }
});

export const CAMP = CAMP_DATA;

export const CAMP_FLAG_COLORS = deepFreeze({
    p1: { main: '#d44040', dark: '#8b1a1a', light: '#f06060' },
    p2: { main: '#4060d0', dark: '#1a2a80', light: '#6080f0' },
    p3: { main: '#40a040', dark: '#1a601a', light: '#60d060' },
    neu: { main: '#777', dark: '#444', light: '#999' }
});

export function campToKey(camp, mode = 'full') {
    if (camp === CAMP.player1) return mode === 'short' ? 'p1' : 'player1';
    if (camp === CAMP.player2) return mode === 'short' ? 'p2' : 'player2';
    if (camp === CAMP.player3) return mode === 'short' ? 'p3' : 'player3';
    return 'neutral';
}
