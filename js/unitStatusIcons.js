// js/unitStatusIcons.js — 单位徽章上方的状态图标行（注册数组驱动）。
// 图标在徽章上方居中一字排开，来源两类：
//   A. 单位自身状态（非效果，HUD 效果队列不覆盖）：STATE_PROVIDERS 注册表逐项求值。
//   B. HUD 效果队列派生（js/effectItems.js），与 HUD 一一对应；
//      特例排除——士气（右上角固定位）；天气/地形/城市/机场等本就不进单位效果构建器。
// 军衔 V 杠（右下）与士气图标（右上）是固定特殊位，不进入本管线。
//
// IconSpec: { glyph, color?, alpha?, font?, shadowColor?, shadowBlur?, count?, countColor? }

import { COMMANDER_CONFIG } from '../rules/commanders.js';
import { areCommanderMechanicsSuppressed } from '../rules/movement.js';
import { isWaterTile } from '../rules/surfaces.js';
import { getRoundIndex } from './config.js';
import { buildUnitEffectItems } from './effectItems.js';

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", sans-serif';
const _pulse = (time, speed) => (Math.sin(time * speed * Math.PI) + 1) / 2;

// ── A. 单位自身状态（注册数组，按序排列）──
// resolve(unit, gameState, time) => IconSpec | null
const STATE_PROVIDERS = [
    {
        id: 'soulMinion',
        resolve: unit => (unit._isSoulMinion && unit.commander !== 'necromancer')
            ? { glyph: '💀', font: `15px ${EMOJI_FONT}`, alpha: 0.85 } : null
    },
    {
        id: 'submerged',
        resolve: (unit, _gs, time) => (unit.type === 'submarine' && unit._rank >= 1 && !unit._submarineAttackExposed)
            ? { glyph: '🌊', font: `13px ${EMOJI_FONT}`, alpha: 0.5 + _pulse(time, 2.5) * 0.3, shadowColor: 'rgba(30,140,200,0.8)', shadowBlur: 8 } : null
    },
    {
        id: 'pendingSpecialization',
        resolve: (unit, _gs, time) => unit.pendingSpecialization
            ? { glyph: '🎖️', font: `13px ${EMOJI_FONT}`, alpha: 0.78 + _pulse(time, 3.2) * 0.22, shadowColor: '#8d63d8', shadowBlur: 7 } : null
    },
    {
        id: 'berserkerRage',
        resolve: (unit, _gs, time) => {
            if (unit.commander !== 'berserker' || areCommanderMechanicsSuppressed(unit) || unit.hp >= unit.maxHp) return null;
            const balance = COMMANDER_CONFIG.berserker.balance;
            const stacks = Math.min(balance.maxStacks, Math.floor(((unit.maxHp - unit.hp) / unit.maxHp) / balance.hpLossPerStackPct));
            if (stacks <= 0) return null;
            const intensity = stacks / balance.maxStacks;
            return { glyph: '💢', font: `bold 12px ${EMOJI_FONT}`, alpha: (0.4 + _pulse(time, 6) * 0.4) * intensity, shadowColor: '#ff4400', shadowBlur: 4 + 4 * intensity };
        }
    },
    {
        id: 'smiteReady',
        resolve: (unit, _gs, time) => unit._smiteReady
            ? { glyph: '🗡️', font: `13px ${EMOJI_FONT}`, alpha: 0.7 + _pulse(time, 5) * 0.3, shadowColor: '#ffd700', shadowBlur: 6 } : null
    },
    {
        // 纵横家只显示生效中的连横（身处他人行政区时），不再常驻标记
        id: 'diplomatLianheng',
        resolve: (unit, _gs, time) => (unit.commander === 'diplomat' && !areCommanderMechanicsSuppressed(unit)
            && unit.tile && !isWaterTile(unit.tile) && unit.tile.camp !== unit.camp)
            ? { glyph: '🃏', font: `bold 12px ${EMOJI_FONT}`, color: `rgba(255,215,80,${0.5 + _pulse(time, 2.5) * 0.3})`, shadowColor: '#d4a017', shadowBlur: 5 } : null
    },
    {
        id: 'astrologerLock',
        resolve: (unit, gameState, time) => (unit.commander === 'astrologer' && gameState
            && gameState.weatherLockUntil > 0 && getRoundIndex(gameState) < gameState.weatherLockUntil)
            ? { glyph: '🔮', font: `bold 12px ${EMOJI_FONT}`, color: `rgba(180,160,255,${0.5 + _pulse(time, 3) * 0.3})`, shadowColor: '#ffd700', shadowBlur: 6 } : null
    },
    {
        id: 'newRecruit',
        resolve: unit => unit.isNewRecruit
            ? { glyph: 'NEW', color: 'rgba(255,255,120,0.75)', font: 'bold 9px Arial' } : null
    }
];

// 效果队列中不进入图标行的项：士气有右上角固定位（静态徽章 morale: 与限时士气
// 效果 timed:士气上升/下降/混乱 都排除，避免与角标重复）。
const EXCLUDED_EFFECT_PREFIXES = ['morale:'];
const EXCLUDED_EFFECT_LABELS = new Set(['士气上升', '士气下降', '混乱']);

/**
 * 求值当前单位的全部头顶状态图标（自身状态 + 效果队列派生），按行内顺序返回。
 */
export function getUnitStatusIcons(unit, gameState, time) {
    const icons = [];
    for (const provider of STATE_PROVIDERS) {
        const icon = provider.resolve(unit, gameState, time);
        if (icon) icons.push(icon);
    }
    for (const item of buildUnitEffectItems(unit, gameState)) {
        if (EXCLUDED_EFFECT_PREFIXES.some(prefix => item.key.startsWith(prefix))) continue;
        if (EXCLUDED_EFFECT_LABELS.has(item.label)) continue;
        icons.push({
            glyph: item.icon,
            color: item.color,
            font: item.iconFont ? `12px ${item.iconFont}` : `12px ${EMOJI_FONT}`,
            count: item.count || '',
            countColor: item.color
        });
    }
    return icons;
}
