// js/effectItems.js — 单位效果清单的共享构建器。
// HUD 效果队列（input.js）与棋盘状态图标行（unitStatusIcons.js）都从本模块取同一份
// 效果数组，保证"单位当前受什么影响"只有一个事实来源：
//   HUD 渲染完整卡片（图标+标题+描述+状态），棋盘渲染过滤后的图标行。
// 地块级效果（地形/城市/机场/工事）与天气不在此处——它们不属于"单位状态"，
// 仍由 input.js 自行构建。

import { MORALE_CONFIG } from '../rules/terrain.js';
import { EMOJI_FONT_STACK } from '../rules/symbols.js';
import { FRONTEND_TEXT } from '../rules/uiText.js';
import { COMMANDER_CONFIG } from '../rules/commanders.js';
import { getCommander, getCommanderAuraDefenseBonus, getStallerSnareLayers } from './commanderInterface.js';

const EFFECT_ICONS = FRONTEND_TEXT.icons.effect;

/**
 * 构建指定单位当前的全部效果项（不含地块与天气）。
 * 每项形如 { key, icon, iconFont?, label, desc, color, count?, status?, kind:'effect', active?, intensity? }。
 */
export function buildUnitEffectItems(unit, gameState) {
    if (!unit) return [];
    const items = [];

    const timedEffects = unit.getTimedEffects(gameState);
    const hasMoraleTimed = timedEffects.some(fx => fx.label === MORALE_CONFIG[unit.morale]?.name);
    if (unit.morale !== 2 && !hasMoraleTimed) {
        const morale = MORALE_CONFIG[unit.morale];
        items.push({
            key: 'morale:' + unit.morale,
            icon: morale.badgeIcon || morale.icon || '●',
            iconFont: EMOJI_FONT_STACK,
            label: morale.name,
            desc: morale.desc,
            color: morale.color,
            kind: 'effect'
        });
    }

    timedEffects.forEach((effect, index) => {
        const remaining = effect.remaining != null && effect.remaining !== '永久' ? effect.remaining : '';
        items.push({
            key: 'timed:' + effect.label + ':' + index,
            icon: EFFECT_ICONS[effect.label] || '✦',
            label: effect.label,
            desc: effect.desc || '效果生效中',
            color: effect.color || '#8fcfff',
            count: remaining !== '' ? '⏳' + remaining : '',
            status: effect.status || (remaining !== '' ? '持续' + remaining + '回合' : '持续生效'),
            kind: 'effect'
        });
    });

    if (unit._isDrone && unit._droneSignalDisabled) {
        items.push({
            key: 'tianyan:signal-lost',
            icon: '📡',
            label: '信号失联',
            desc: '超出天眼信号范围，当前无法行动',
            color: '#ff9b72',
            kind: 'effect'
        });
    }

    const auraDefBonus = getCommanderAuraDefenseBonus(unit);
    if (auraDefBonus > 0) {
        items.push({
            key: 'aura:ironGuard',
            icon: '🛡️',
            label: '守护灵光',
            desc: unit.commander === 'ironGuard'
                ? FRONTEND_TEXT.effectDescriptions.guardianSelf
                : FRONTEND_TEXT.effectDescriptions.guardianAlly,
            color: '#7eb8ff',
            kind: 'effect'
        });
    }

    // 夜观星光护体：移除独立徽章，改为在天气效果上叠加星标 + 描述标注

    if (unit.commander !== 'staller' && unit.tile) {
        const layers = getStallerSnareLayers(unit.tile, unit.camp, gameState.tileMap);
        if (layers > 0) {
            items.push({
                key: 'staller:snare',
                icon: '🕸️',
                label: '缚足',
                desc: '每层使得当前单位每步行动力消耗提高' + COMMANDER_CONFIG.staller.balance.movementCostPerLayer + '点',
                color: '#c08050',
                status: '当前生效 每步行动力消耗提高' + (layers * COMMANDER_CONFIG.staller.balance.movementCostPerLayer),
                kind: 'effect'
            });
        }
    }

    if (unit._engineerConstruction) {
        const remain = unit._engineerConstruction.turnsRemaining || 1;
        items.push({
            key: 'engineer:constructing',
            icon: '🚧',
            label: '施工中',
            desc: '碉堡还需' + remain + '回合建成',
            color: '#e8c477',
            count: '⏳' + remain,
            status: '持续' + remain + '回合',
            kind: 'effect'
        });
    }
    if (unit._engineerScaffold) {
        const remain = unit._engineerScaffold.turnsRemaining || 1;
        items.push({
            key: 'engineer:scaffold',
            icon: '🏗️',
            label: '脚手架',
            desc: '还需' + remain + '回合建成碉堡，可被攻击摧毁',
            color: '#e8c477',
            count: '⏳' + remain,
            status: '持续' + remain + '回合',
            kind: 'effect'
        });
    }
    if (unit._poison) {
        const remain = Math.max(0, unit._poison.remainingTicks || 0);
        items.push({
            key: 'status:poison',
            icon: '☣️',
            label: '中毒',
            desc: '所属阵营回合开始流失15%最大生命，可致死，并向相邻未中毒单位传播；疗愈卡可净化。',
            color: '#9bcf55',
            count: '⏳' + remain,
            status: `剩余${remain}次结算`,
            kind: 'effect'
        });
    }

    // 战役触发器施加的效果
    if (Array.isArray(unit._campaignEffects) && unit._campaignEffects.length) {
        for (const eff of unit._campaignEffects) {
            items.push({
                key: "campaign:" + eff.name + ":" + eff.id,
                icon: eff.emoji || "✨",
                label: eff.name,
                desc: (eff.desc || "战役效果") + (eff.duration ? " · 剩余" + eff.duration + "回合" : ""),
                color: "#ffd866",
                count: eff.duration ? "⏳" + eff.duration : "",
                status: eff.duration ? "持续" + eff.duration + "回合" : "持续生效",
                kind: 'effect'
            });
        }
    }
    return items;
}
