// rules/freeze.js — 规则数据只读保障。
// 深度冻结导出的规则定义，任何运行时写入都会在严格模式下抛错，
// 从而保证"逻辑与展示读同一规则键"的约定不被悄悄破坏。

export function deepFreeze(value) {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    if (Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
        deepFreeze(value[key]);
    }
    return value;
}
