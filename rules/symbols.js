// rules/symbols.js — UI 符号（emoji 与字体栈）。
// 所有前端图标集中定义，避免同一个效果出现不同图案或黑白字形。
// emoji 使用 FE0F 变体选择符，配合 EMOJI_FONT_STACK 保持彩色显示。

import { deepFreeze } from './freeze.js';

/** 用于 DOM 徽章和 Canvas 地图的彩色 emoji 字体栈。 */
export const EMOJI_FONT_STACK = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

export const EMOJI = deepFreeze({
    terrain: { plains: '🌾', forest: '🌲', mountain: '⛰️' },
    fortification: { trench: '🚧', trenchBadge: '🪖', flak: '🔫' },
    moraleBadge: { up: '⬆️', down: '⬇️', confused: '❓' },
    commander: {
        courageAura: '⚔️', healingAura: '💚', guardianAura: '🛡️',
        qixue: '🩸', oath: '✝️', martyr: '💥', drone: '✈️', soul: '👻'
    },
    cards: {
        heal: '💚', lightning: '⚡', mgNest: '🏰', airdrop: '🪂', imprison: '🔗',
        forceMarch: '🏃', scout: '🔭', airstrike: '✈️', shield: '🛡️',
        landmine: '💣', commanderDeploy: '🎖️', diveStrafe: '💥', carpetBomb: '💣', airlift: '🪂'
    }
});
