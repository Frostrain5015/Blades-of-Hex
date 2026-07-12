// 配置 → scenario 适配器 —— 把一份 level 配置包装成通用控制器认识的 scenario 接口。
// 关键点：config 关卡自带棋盘（buildsOwnBoard=true），启动流程据此跳过默认 initMap。
import { gameState } from '../../js/state.js';
import { normalizeLevel } from './schema.js';
import { buildBoardFromConfig } from './mapBuilder.js';
import { buildBattlefieldFromConfig, prepareCampaignFactions } from './battlefield.js';
import { createTriggerFlow, evaluateConditions } from './triggers.js';
import { readProgress } from '../progress.js';

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function scenarioFromConfig(rawConfig, options = {}) {
    const config = normalizeLevel(rawConfig);
    const storageKey = options.storageKey ?? '';

    // target 语义 → 棋盘 tile（供控制器绘制目标环）。
    function tileForTarget(target) {
        if (!target) return null;
        if (typeof target === 'string') {
            return gameState.tiles.find(t => t.unit?.id === target) || null;
        }
        if (target.unit) return gameState.tiles.find(t => t.unit?.id === target.unit) || null;
        if (target.q != null) return gameState.tileMap.get(`${target.q},${target.r}`) || null;
        // 区域：返回第一个 tile（供单个圆环兜底，实际区域由 syncRing 绘制）
        if (target.tiles?.length) {
            const t = gameState.tileMap.get(`${target.tiles[0].q},${target.tiles[0].r}`);
            return t || null;
        }
        return null;
    }

    function buildBattlefield() {
        prepareCampaignFactions(config, gameState);
        buildBoardFromConfig(config, gameState);
        // createTriggerFlow 会持有这个 Set；试玩重建棋盘时必须清空而不能替换，
        // 否则触发器写入的旗标与结算读取的旗标会分裂成两份状态。
        if (gameState._campaignFlags instanceof Set) gameState._campaignFlags.clear();
        else gameState._campaignFlags = new Set();
        const built = buildBattlefieldFromConfig(config, gameState);
        gameState.campaignVariables = storageKey ? { ...readProgress(storageKey).variables } : {};
        for (const variable of (config.variables || [])) {
            if (variable.scope === 'campaign' && !(variable.id in gameState.campaignVariables)) {
                gameState.campaignVariables[variable.id] = variable.initial ?? (variable.type === 'boolean' ? false : variable.type === 'string' ? '' : 0);
            }
        }
        return built;
    }

    function calculateResult(victory, api) {
        const flags = gameState._campaignFlags || new Set();
        const optionals = (config.optionalObjectives || []).map(opt => ({
            id: opt.id,
            text: opt.text,
            done: (opt.when && opt.when.length)
                ? evaluateConditions(opt.when, api, flags, config)
                : flags.has(`optional:${opt.id}`)
        }));
        let stars = 0;
        if (victory) {
            stars = 1;
            for (const rule of (config.result?.starRules || [])) {
                if (evaluateConditions(rule.when, api, flags, config)) stars++;
            }
            stars = Math.max(1, Math.min(3, stars));
        }
        return {
            stars,
            optionals,
            variables: { ...(gameState.campaignVariables || {}) },
            completedOptionalObjectives: optionals.filter(item => item.done).map(item => item.id)
        };
    }

    function resultText(victory, res, reason) {
        if (victory) return reason || config.result?.winText || '任务完成。';
        return reason || config.result?.loseText || '任务失败。';
    }

    function resultObjectivesHtml(victory, res) {
        if (!victory) return '<span>重新整顿部队，再次尝试。</span>';
        if (!res.optionals || res.optionals.length === 0) return '<span class="complete">✓ 任务达成</span>';
        return res.optionals
            .map(o => `<span class="${o.done ? 'complete' : ''}">${o.done ? '✓' : '◇'} ${escapeHtml(o.text)}</span>`)
            .join('');
    }

    const displayId = config.displayId || (config.id || '').toUpperCase();
    return {
        id: config.id,
        title: config.title,
        displayId,
        seed: config.seed || 1,
        turnLimit: config.turnLimit || 0,
        storageKey,
        initialStep: config.initialStep || '',
        initialObjective: Object.keys(config.objectives || {}).find(id => config.objectives[id].active !== false) || '',
        intro: { campaignTitle: config.intro?.campaignTitle || '', chapterTitle: '', scenarioSubtitle: `${displayId} ${config.title || ''}` },
        aiOpponentCampKey: config.aiOpponentCamp || '',
        aiDifficulty: config.aiDifficulty ?? 1.0,
        objectives: config.objectives || {},
        optionalObjectives: config.optionalObjectives || [],
        buildsOwnBoard: true,
        buildBattlefield,
        tileForTarget,
        createFlow: (api) => createTriggerFlow(config, api),
        calculateResult,
        resultText,
        resultObjectivesHtml,
        _config: config
    };
}
