// 战役进度存取 —— 登录玩家写入 Frost ID 档案，访客回退到统一 localStorage 档案。
// 与具体关卡/传记解耦：调用方传入 storageKey 与 scenarioId 即可，便于多传记各存各的。
import { readCampaignProfile, writeCampaignProfile } from '../js/playerProfile.js';

/**
 * 读取某传记的进度。
 * @param {string} storageKey
 * @returns {{ completedScenarioIds: string[], scenarioStars: Record<string, number>, bestStars: number, variables: object, completedOptionalObjectives: string[], collectibleIds: string[] }}
 */
export function readProgress(storageKey) {
    try {
        const parsed = readCampaignProfile(storageKey);
        const storedCompletedScenarioIds = Array.isArray(parsed.completedScenarioIds)
            ? parsed.completedScenarioIds.filter(id => typeof id === 'string')
            : [];
        const scenarioStars = {};
        if (parsed.scenarioStars && typeof parsed.scenarioStars === 'object' && !Array.isArray(parsed.scenarioStars)) {
            for (const [scenarioId, value] of Object.entries(parsed.scenarioStars)) {
                if (!scenarioId) continue;
                const stars = Math.max(0, Math.min(3, Number(value) || 0));
                if (stars > 0) scenarioStars[scenarioId] = stars;
            }
        }

        // 兼容旧存档：旧结构只记录“已完成集合”和传记级最高星，无法还原每关星级。
        // 已完成至少能确定为一星，因此仅补一星，不把某一关的高分错误复制给所有关卡。
        for (const scenarioId of storedCompletedScenarioIds) {
            if (!scenarioStars[scenarioId]) scenarioStars[scenarioId] = 1;
        }
        const completedScenarioIds = [...new Set([
            ...storedCompletedScenarioIds,
            ...Object.keys(scenarioStars).filter(id => scenarioStars[id] >= 1)
        ])];
        const bestStars = Math.max(
            Math.max(0, Math.min(3, Number(parsed.bestStars) || 0)),
            0,
            ...Object.values(scenarioStars)
        );
        return {
            completedScenarioIds,
            scenarioStars,
            bestStars,
            variables: parsed.variables && typeof parsed.variables === 'object' ? { ...parsed.variables } : {},
            completedOptionalObjectives: Array.isArray(parsed.completedOptionalObjectives)
                ? [...new Set(parsed.completedOptionalObjectives.filter(id => typeof id === 'string'))] : [],
            collectibleIds: Array.isArray(parsed.collectibleIds)
                ? [...new Set(parsed.collectibleIds.filter(id => typeof id === 'string' && id))] : []
        };
    } catch (_) {
        return { completedScenarioIds: [], scenarioStars: {}, bestStars: 0, variables: {}, completedOptionalObjectives: [], collectibleIds: [] };
    }
}

/** 调查成功时立即把收藏物写入整部传记的持久进度；返回本次是否首次获得。 */
export function unlockCollectible(storageKey, collectibleId) {
    if (!storageKey || !collectibleId) return false;
    const previous = readProgress(storageKey);
    if (previous.collectibleIds.includes(collectibleId)) return false;
    try {
        writeCampaignProfile(storageKey, {
            completed: previous.completedScenarioIds.length > 0,
            completedScenarioIds: previous.completedScenarioIds,
            scenarioStars: previous.scenarioStars,
            bestStars: previous.bestStars,
            variables: previous.variables,
            completedOptionalObjectives: previous.completedOptionalObjectives,
            collectibleIds: [...previous.collectibleIds, collectibleId],
            updatedAt: new Date().toISOString()
        });
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * 按目录顺序判断关卡是否开放：首关始终开放，其余关卡要求紧邻的上一关至少一星。
 * @param {{ id: string }[]} scenarios
 * @param {string} scenarioId
 * @param {{ scenarioStars?: Record<string, number> }} progress
 */
export function isScenarioUnlocked(scenarios, scenarioId, progress) {
    const index = scenarios.findIndex(scenario => scenario.id === scenarioId);
    if (index < 0) return false;
    if (index === 0) return true;
    const previousScenario = scenarios[index - 1];
    return (progress?.scenarioStars?.[previousScenario.id] || 0) >= 1;
}

/**
 * 记录一次通关：合并关卡完成集合、取更高星级。
 * @param {string} storageKey
 * @param {string} scenarioId
 * @param {number} stars
 */
export function saveVictory(storageKey, scenarioId, stars, details = {}) {
    const previous = readProgress(storageKey);
    const earnedStars = Math.max(1, Math.min(3, Number(stars) || 1));
    const completedScenarioIds = [...new Set([...previous.completedScenarioIds, scenarioId])];
    const scenarioStars = {
        ...previous.scenarioStars,
        [scenarioId]: Math.max(previous.scenarioStars[scenarioId] || 0, earnedStars)
    };
    writeCampaignProfile(storageKey, {
        completed: true,
        completedScenarioIds,
        scenarioStars,
        bestStars: Math.max(previous.bestStars, earnedStars),
        variables: { ...previous.variables, ...(details.variables || {}) },
        collectibleIds: previous.collectibleIds,
        completedOptionalObjectives: [...new Set([
            ...previous.completedOptionalObjectives,
            ...(details.completedOptionalObjectives || []).map(id => `${scenarioId}/${id}`)
        ])],
        completedAt: new Date().toISOString()
    });
}
