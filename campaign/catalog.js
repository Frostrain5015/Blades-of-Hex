// 将星列传目录（总集，轻量 eager）—— 汇总各传记元数据，提供查询与关卡懒加载。
// 新增一部传记/一个关卡：建 content 模块 + 在此登记，即被大厅自动收录、按需加载。
import HEART_AS_FIRE from './content/heartAsFire/chronicle.js';

// 传记按展示顺序排列（对应大厅 ◀/▶ 切换）。
export const CHRONICLES = Object.freeze([
    HEART_AS_FIRE
]);

export function listChronicles() {
    return CHRONICLES;
}

export function getChronicle(chronicleId) {
    return CHRONICLES.find(c => c.id === chronicleId) || null;
}

export function getScenarioMeta(chronicleId, scenarioId) {
    const chronicle = getChronicle(chronicleId);
    return chronicle?.scenarios.find(s => s.id === scenarioId) || null;
}

/**
 * 懒加载某关卡的运行时模块（scenario.js 的 default 导出）。
 * @returns {Promise<object|null>}
 */
export async function loadScenario(chronicleId, scenarioId) {
    const meta = getScenarioMeta(chronicleId, scenarioId);
    if (!meta) return null;
    const mod = await meta.load();
    return mod.default;
}
