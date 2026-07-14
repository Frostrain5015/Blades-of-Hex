// 将星列传目录（总集，轻量 eager）—— 汇总各传记元数据，提供查询与关卡懒加载。
// 新增一部传记/一个关卡：建 content 模块 + 在此登记，即被大厅自动收录、按需加载。
import BLOOD_IRIS from './content/bloodIris/chronicle.js';
import VISUAL_QA from './content/visualQa/chronicle.js';

// 传记按展示顺序排列（对应大厅 ◀/▶ 切换）。
export const CHRONICLES = Object.freeze([
    BLOOD_IRIS,
    VISUAL_QA
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
 * 懒加载某关卡的运行时模块。支持两类关卡：
 *   1) 手写 scenario 模块：`export default <scenario>`（如雨幕孤城）。
 *   2) 配置关卡（编辑器产出）：模块 `export const config = <levelJSON>`，
 *      或 meta 直接内联 `meta.config`；由 scenarioFromConfig 包装为 scenario。
 * @returns {Promise<object|null>}
 */
export async function loadScenario(chronicleId, scenarioId) {
    const meta = getScenarioMeta(chronicleId, scenarioId);
    if (!meta) return null;
    const chronicle = getChronicle(chronicleId);
    const storageKey = chronicle?.storageKey || '';

    // 内联配置（无需单独模块文件）。
    if (meta.config) {
        const { scenarioFromConfig } = await import('./runtime/scenarioFromConfig.js');
        return scenarioFromConfig(meta.config, { storageKey });
    }

    const mod = meta.load ? await meta.load() : null;
    if (!mod) return null;
    if (mod.default) return mod.default;          // 手写 scenario
    if (mod.config) {                              // 配置关卡模块
        const { scenarioFromConfig } = await import('./runtime/scenarioFromConfig.js');
        return scenarioFromConfig(mod.config, { storageKey });
    }
    return null;
}
