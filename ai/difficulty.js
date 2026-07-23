export const AI_DIFFICULTY_PROFILES = Object.freeze({
    easy: Object.freeze({
        id: 'easy',
        title: '简单',
        numericValue: 1.0,
        decisionNoise: 0.42,
        objectiveChoiceWindow: 3,
        coordinatedFocus: false,
        counterRecruitment: false,
        threatForecast: false,
        strategicOpponentModel: false,
        terminalPlanning: false,
        advancedCards: false,
        activeSkillPlanning: false,
        campaignPlanningDepth: 0,
        assetValuation: false,
        emergencyBudget: false,
        jointTaskForces: false,
        synergyForecast: false,
        replanPasses: 1,
        infrastructureLevel: 0,
        fallbackRecruitLimit: 1
    }),
    medium: Object.freeze({
        id: 'medium',
        title: '中等',
        numericValue: 1.5,
        decisionNoise: 0.24,
        objectiveChoiceWindow: 3,
        coordinatedFocus: true,
        counterRecruitment: true,
        threatForecast: false,
        strategicOpponentModel: false,
        terminalPlanning: true,
        advancedCards: true,
        activeSkillPlanning: true,
        campaignPlanningDepth: 1,
        assetValuation: true,
        emergencyBudget: true,
        jointTaskForces: false,
        synergyForecast: false,
        replanPasses: 2,
        infrastructureLevel: 1,
        fallbackRecruitLimit: 2
    }),
    hard: Object.freeze({
        id: 'hard',
        title: '困难',
        numericValue: 2.0,
        decisionNoise: 0,
        objectiveChoiceWindow: 1,
        coordinatedFocus: true,
        counterRecruitment: true,
        threatForecast: true,
        strategicOpponentModel: true,
        terminalPlanning: true,
        advancedCards: true,
        activeSkillPlanning: true,
        // Imperator 的能力上限只由我们当前能实现的水平决定，不设置人为保留。
        campaignPlanningDepth: 2,
        assetValuation: true,
        emergencyBudget: true,
        jointTaskForces: true,
        synergyForecast: true,
        replanPasses: 3,
        infrastructureLevel: 2,
        fallbackRecruitLimit: Infinity
    })
});

export function normalizeAiDifficulty(value) {
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === '简单') return 'easy';
        if (normalized === '中等') return 'medium';
        if (normalized === '困难') return 'hard';
        if (AI_DIFFICULTY_PROFILES[normalized]) return normalized;
        const numeric = Number(normalized);
        if (Number.isFinite(numeric)) value = numeric;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'easy';
    if (numeric >= 1.75) return 'hard';
    if (numeric >= 1.25) return 'medium';
    return 'easy';
}

export function getAiDifficultyProfile(value) {
    return AI_DIFFICULTY_PROFILES[normalizeAiDifficulty(value)];
}

export function resolveAiDifficultyProfile(state, campOrKey = null) {
    const campKey = typeof campOrKey === 'string' ? campOrKey : campOrKey?.id;
    const perCampValue = campKey ? state?.aiDifficultyByCamp?.[campKey] : null;
    return getAiDifficultyProfile(perCampValue ?? state?.aiDifficulty ?? state?.aiDifficultyId);
}

export function resolveAiIncomeMultiplier(state, campOrKey = null) {
    const campKey = typeof campOrKey === 'string' ? campOrKey : campOrKey?.id;
    const isCampaignAi = !!state?.campaignMode
        && !!campKey
        && state?.factions?.[campKey]?.controller === 'ai';
    if (!isCampaignAi) return 1;
    const multiplier = Number(state?.aiDifficulty);
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}
