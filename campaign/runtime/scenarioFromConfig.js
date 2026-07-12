// 配置 → scenario 适配器 —— 把一份 level 配置包装成通用控制器认识的 scenario 接口。
// 关键点：config 关卡自带棋盘（buildsOwnBoard=true），启动流程据此跳过默认 initMap。
import { gameState } from '../../js/state.js';
import { normalizeLevel } from './schema.js';
import { buildBoardFromConfig } from './mapBuilder.js';
import { buildBattlefieldFromConfig, prepareCampaignFactions } from './battlefield.js';
import { createTriggerFlow, evaluateConditions } from './triggers.js';
import { readProgress } from '../progress.js';

/**
 * @param {object} rawConfig  level 配置（未归一化亦可）
 * @param {{ storageKey?: string }} [options]  storageKey 为空时不写通关进度（编辑器测试用）
 * @returns {object} scenario 对象
 */
// 配置步骤（简化模型：台词/旁白 + 统一「下一步」）→ 控制器步骤格式。
// 有 next 的步骤渲染为对白（带按钮）；无 next 的步骤为等待态（目标环 + 输入白名单，
// 由触发器推进）。phase 取非 dialog/card/action 值时控制器才绘制目标环。
function toControllerSteps(configSteps) {
    const out = {};
    for (const [stepId, step] of Object.entries(configSteps || {})) {
        out[stepId] = {
            phase: step.next != null && step.next !== '' ? 'dialog' : 'wait',
            mode: step.mode === 'character' ? 'character' : 'narrator',
            text: step.text || '',
            speaker: step.mode === 'character' ? step.speaker : undefined,
            button: step.next != null && step.next !== '' ? '下一步' : undefined,
            next: step.next || undefined,
            target: step.target,
            allow: step.allow
        };
    }
    return out;
}

export function scenarioFromConfig(rawConfig, options = {}) {
    const config = normalizeLevel(rawConfig);
    const storageKey = options.storageKey ?? '';
    const controllerSteps = toControllerSteps(config.steps);

    // step.target 语义 → 棋盘 tile（供控制器绘制目标环）。
    function tileForTarget(target) {
        if (!target) return null;
        if (typeof target === 'string') {
            return gameState.tiles.find(t => t.unit?.id === target) || null;
        }
        if (target.unit) return gameState.tiles.find(t => t.unit?.id === target.unit) || null;
        if (typeof target.q === 'number') return gameState.tileMap.get(`${target.q},${target.r}`) || null;
        return null;
    }

    function buildBattlefield() {
        prepareCampaignFactions(config, gameState);
        buildBoardFromConfig(config, gameState);
        gameState._campaignFlags = new Set();
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
            // 有显式条件按条件判定；否则看触发器是否打过「支线完成」标记。
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
        if (victory) return config.result?.winText || '任务完成。';
        return reason || config.result?.loseText || '任务失败。';
    }

    function resultObjectivesHtml(victory, res) {
        if (!victory) return '<span>重新整顿部队，再次尝试。</span>';
        if (!res.optionals || res.optionals.length === 0) return '<span class="complete">✓ 任务达成</span>';
        return res.optionals
            .map(o => `<span class="${o.done ? 'complete' : ''}">${o.done ? '✓' : '◇'} ${o.text}</span>`)
            .join('');
    }

    return {
        id: config.id,
        title: config.title,
        seed: config.seed || 1,   // 0 会让 xorshift RNG 卡死在零态
        turnLimit: config.turnLimit || 0,
        storageKey,
        initialStep: config.initialStep || '',
        initialObjective: Object.keys(config.objectives || {}).find(id => config.objectives[id].active !== false) || '',
        intro: { campaignTitle: config.intro?.campaignTitle || '', chapterTitle: '', scenarioSubtitle: config.title || '' },
        aiOpponentCampKey: config.aiOpponentCamp || '',
        aiDifficulty: config.aiDifficulty ?? 1.0,
        steps: controllerSteps,
        objectives: config.objectives || {},
        optionalObjectives: config.optionalObjectives || [],
        buildsOwnBoard: true,          // 告知启动流程跳过默认 initMap
        buildBattlefield,
        tileForTarget,
        createFlow: (api) => createTriggerFlow(config, api),
        calculateResult,
        resultText,
        resultObjectivesHtml,
        // 保留原始配置，便于「从测试返回编辑器」等场景取回。
        _config: config
    };
}
