// rules/format.js — 统一文案格式化函数。
// 技能详情、状态栏效果、卡牌描述和帮助文本都必须通过这里把
// 平衡数值写进字符串；禁止在描述里手写第二份数字。

/** 0.25 -> "25%"。规则数值统一用小数存储。 */
export const percent = (value) => `${Math.round(value * 100)}%`;

/** (40, 60) -> "40~60"。 */
export const rangeText = (min, max) => `${min}~${max}`;
