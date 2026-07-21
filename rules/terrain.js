// rules/terrain.js — 地形、工事、士气与天气定义。
// 既提供结算参数，也提供效果栏与地图的展示资料；描述文字在本模块内
// 由同一份平衡数值派生后整体冻结，不存在第二份数字。

import { deepFreeze } from './freeze.js';
import { percent } from './format.js';
import { EMOJI, EMOJI_FONT_STACK } from './symbols.js';
import { COMBAT_BALANCE } from './constants.js';

export const TERRAIN_CONFIG = deepFreeze({
    plains: { name: '平原', defenseBonus: 0, stepCost: 2, moveDesc: '', icon: '', iconFont: '' },
    forest: { name: '森林', defenseBonus: 0.05, stepCost: 3, moveDesc: '部队移动较慢', icon: EMOJI.terrain.forest, iconFont: `13px ${EMOJI_FONT_STACK}` },
    mountain: { name: '山地', defenseBonus: 0.05, stepCost: 6, moveDesc: '部队移动缓慢', icon: EMOJI.terrain.mountain, iconFont: `15px ${EMOJI_FONT_STACK}` }
});

export const FORTIFICATION_CONFIG = (() => {
    const trench = {
        name: '战壕', defenseBonus: 0.25, appliesTo: 'melee',
        icon: EMOJI.fortification.trench,
        iconFont: `14px ${EMOJI_FONT_STACK}`
    };
    const flak = {
        name: '高射机枪', defenseBonus: 0, appliesTo: 'air', providesSelfAA: true, antiAirReduction: 0.30,
        icon: EMOJI.fortification.flak,
        iconFont: `14px ${EMOJI_FONT_STACK}`
    };
    trench.desc = `对近战攻击防御力提高${percent(trench.defenseBonus)}`;
    flak.desc = `为本格单位提供${percent(flak.antiAirReduction)}防空火力`;
    return deepFreeze({ trench, flak });
})();

/** 士气的棋盘图形和效果徽章图形分开配置：前者保持原有表现，后者使用彩色 emoji。 */
export const MORALE_CONFIG = (() => {
    // 士气只进入攻击端；不再同时改变防御与随机浮动区间，避免一次士气变化
    // 在三层乘区里重复放大。defBonus 保留为0以兼容既有读取接口。
    const up = { name: '士气上升', atkBonus: 0.20, defBonus: 0, icon: '▲', badgeIcon: EMOJI.moraleBadge.up, color: '#ffd700' };
    const normal = { name: '正常', atkBonus: 0, defBonus: 0, icon: '', badgeIcon: '', color: '#aaa', desc: '' };
    const down = { name: '士气下降', atkBonus: -0.20, defBonus: 0, icon: '▼', badgeIcon: EMOJI.moraleBadge.down, color: '#b080e8' };
    const confused = { name: '混乱', atkBonus: 0, defBonus: 0, icon: '？', badgeIcon: EMOJI.moraleBadge.confused, color: '#666' };
    up.desc = `攻击力提高${percent(up.atkBonus)}`;
    down.desc = `攻击力降低${percent(Math.abs(down.atkBonus))}`;
    confused.desc = '无法移动、攻击或反击';
    return deepFreeze({ 3: up, 2: normal, 1: down, 0: confused });
})();

export const WEATHER_CONFIG = (() => {
    const w = COMBAT_BALANCE.weather;
    const cavalry = COMBAT_BALANCE.cavalry;
    const defense = COMBAT_BALANCE.defense;
    return deepFreeze({
        clear: { name: '晴', icon: '☀️', color: '#ffd700', desc: '无特殊效果' },
        rain: {
            name: '雨', icon: '🌧️', color: '#5588cc',
            desc: `驻扎在城市上的单位每回合恢复${percent(w.rainCityHealPct)}最大生命值，步兵守城防御提高${percent(defense.rainCityInfantryBonus)}，骑兵每步行动力消耗提高${w.rainCavalryMovementCost}点`
        },
        fog: {
            name: '雾', icon: '🌫️', color: '#bbccdd',
            desc: `炮兵射程${w.fogArcherRangeDelta}，骑兵伤害提高${percent(cavalry.fogDamageBonus)}且每格冲锋伤害额外提高${percent(cavalry.fogChargeDamagePerStep - cavalry.normalChargeDamagePerStep)}`
        },
        wind: {
            name: '风', icon: '💨', color: '#aaccaa',
            desc: `炮兵射程+${w.windArcherRangeDelta}，步兵防御力降低${percent(defense.windInfantryPenalty)}`
        },
        // 诺克提斯【血月之夜】召唤的特殊天气（判定在 rules/noctis.js）
        bloodMoon: {
            name: '血月', icon: '🌑', color: '#b3121f',
            desc: '血月之下伤口不愈：敌方单位无法回复生命；全场生命≤50%的单位每回合持续流血（真伤，越垂死掉得越快）'
        }
    });
})();
