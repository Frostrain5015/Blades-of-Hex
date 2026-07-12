// 战役进度存取 —— 通用 localStorage 读写，以传记(chronicle)的 storageKey 为键。
// 与具体关卡/传记解耦：调用方传入 storageKey 与 scenarioId 即可，便于多传记各存各的。

/**
 * 读取某传记的进度。
 * @param {string} storageKey
 * @returns {{ completedScenarioIds: string[], bestStars: number, variables: object, completedOptionalObjectives: string[] }}
 */
export function readProgress(storageKey) {
    try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
        const completedScenarioIds = Array.isArray(parsed.completedScenarioIds)
            ? parsed.completedScenarioIds.filter(id => typeof id === 'string')
            : [];
        return {
            completedScenarioIds,
            bestStars: Math.max(0, Math.min(3, Number(parsed.bestStars) || 0)),
            variables: parsed.variables && typeof parsed.variables === 'object' ? { ...parsed.variables } : {},
            completedOptionalObjectives: Array.isArray(parsed.completedOptionalObjectives)
                ? [...new Set(parsed.completedOptionalObjectives.filter(id => typeof id === 'string'))] : []
        };
    } catch (_) {
        return { completedScenarioIds: [], bestStars: 0, variables: {}, completedOptionalObjectives: [] };
    }
}

/**
 * 记录一次通关：合并关卡完成集合、取更高星级。
 * @param {string} storageKey
 * @param {string} scenarioId
 * @param {number} stars
 */
export function saveVictory(storageKey, scenarioId, stars, details = {}) {
    const previous = readProgress(storageKey);
    const completedScenarioIds = [...new Set([...previous.completedScenarioIds, scenarioId])];
    localStorage.setItem(storageKey, JSON.stringify({
        completed: true,
        completedScenarioIds,
        bestStars: Math.max(previous.bestStars, Math.max(0, Math.min(3, Number(stars) || 0))),
        variables: { ...previous.variables, ...(details.variables || {}) },
        completedOptionalObjectives: [...new Set([
            ...previous.completedOptionalObjectives,
            ...(details.completedOptionalObjectives || []).map(id => `${scenarioId}/${id}`)
        ])],
        completedAt: new Date().toISOString()
    }));
}
