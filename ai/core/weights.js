// 权重与档位能力配置 —— 新架构里唯一允许"拍脑袋"的地方。
//
// 设计约定（反臃肿、反过拟合）：
// 1. 所有评分的量纲统一为「等效金币」。伤害按目标每 HP 金价折算，城市按行政区
//    资产估值（ai/strategy.estimateDistrictAssetValue）折算，威胁按自方每 HP 金价
//    折算。因此本文件里绝大多数旋钮是**无量纲比率**（敢不敢冒险、愿不愿等待），
//    而不是彼此互搏的绝对分值。
// 2. 三档共用同一套规划管线，档位差异 = 信息使用与思考深度，不是三份决策代码。
// 3. 任何新增权重必须在这里命名并注释量纲；流程代码里禁止出现裸数字。

// ─── 档位能力档（tier capabilities）────────────────────────────────
// 与 ai/difficulty.js 的三档一一对应；difficulty.js 负责运行时（重规划次数、
// 招募辅助开关），本表负责规划器内部的认知深度。
export const TIER_CAPABILITIES = Object.freeze({
    easy: Object.freeze({
        id: 'easy',
        noise: 0.45,               // 选项评分的随机扰动幅度（相对值）
        topK: 2,                   // 从前 k 个候选里按扰动后分数选
        duelModel: false,          // 交换只按单回合账面算（看不到缠斗结局）
        threatForecast: false,     // 威胁图只按当前射程，不预判位移
        intelTracking: false,      // 不维护敌方最后已知位置
        victoryClock: false,       // 不切换守钟/死斗姿态
        missionPersistence: false, // 任务只存活一回合
        cardScripts: false,        // 卡牌逐张独立评估
        conversionCapture: false,  // 不规划攻心夺城
        transportPlanning: false,  // 不把运输登陆当独立阶段
        interceptPricing: false,   // 不给"敌方占城者"额外定价
        scoutMissions: false,
        multiEscort: false
    }),
    medium: Object.freeze({
        id: 'medium',
        noise: 0.22,
        topK: 2,
        duelModel: false,          // 交换只按单回合账面算（看不到缠斗结局）
        threatForecast: false,
        intelTracking: true,
        victoryClock: false,       // 没有残局时钟：中档不会在终局切换守钟/死斗
        missionPersistence: false, // 任务只存活一回合
        cardScripts: true,
        conversionCapture: false,  // 不规划攻心夺城
        transportPlanning: false,
        interceptPricing: false,   // 不给"敌方占城者"额外定价
        scoutMissions: false,
        multiEscort: false
    }),
    hard: Object.freeze({
        id: 'hard',
        noise: 0,
        topK: 1,
        duelModel: true,           // 近战贴脸按整段缠斗定价（决斗期望）
        threatForecast: true,      // 威胁图按 射程+机动力 外推一回合
        intelTracking: true,
        victoryClock: true,
        missionPersistence: true,  // 任务与单位编组跨回合锁定
        cardScripts: true,
        conversionCapture: true,
        transportPlanning: false, // 实测目前是负资产：陆军运去海上喂潜艇
        interceptPricing: true,
        scoutMissions: true,
        multiEscort: true
    })
});

// ─── 通用估值权重（三档共享）──────────────────────────────────────
export const W = Object.freeze({
    // 击杀溢价：击杀除了抹掉剩余 HP 的价值，还消灭单位的未来产能，按残值的比率加算。
    killPremiumRatio: 0.55,
    // 将领单位被击杀的额外溢价（失去技能 + 士气打击）。
    commanderKillBonus: 45,
    // 净交换否决的宽容度：净亏损超过自方残值×该比率才放弃攻击（贴脸近战不退）。
    tradeVetoRatio: 0.45,
    // 攻城任务中"占领者"每提前一回合到位的价值（占城市资产值的比率）。
    siegeEtaTickRatio: 0.06,
    // 守城价值：每座己方城市的守备预算（按城市资产值比率）。
    garrisonValueRatio: 0.35,
    // 撤退：HP 低于该比率且受威胁时允许撤退（脆弱将领另有系数）。
    retreatHpRatio: 0.30,
    retreatHpRatioCommander: 0.42,
    // 威胁暴露的默认容忍（1.0 = 按账面金币等价交换）。
    threatTolerance: 1.0,
    // 占领者（能进城的近战）走向空城/破城时，威胁容忍提高到该倍数——为夺城挨一轮火力是划算的。
    occupierThreatTolerance: 1.9,
    // 港口/村庄的进驻价值（金币；港口在海图更高）。
    villageValue: 26,
    portValueLand: 34,
    portValueOcean: 62,
    // 侦察：每格未知邻域的情报价值（金币，随信息龄期放大）。
    scoutValuePerUnknown: 3.5,
    // 敌方"能占城的近战"贴近我方/中立城市时的截杀定价（金币，按城市资产比率）。
    interceptBaseRatio: 0.42,
    // 攻心夺城：谋士每次攻击守军的转化期望概率（对齐 commander/advisor 的 1/4）。
    conversionChancePerHit: 0.25,
    // 运输状态补偿：登陆窗口的占领者 ETA 按每回合 4 格（TRANSPORT_RULES.speedCap）折算，
    // 但深水承伤风险按该比率折损任务价值。
    transportRiskRatio: 0.12,
    // 卡牌：抽牌的机会成本门槛 = 抽牌费 + 计划招募支出 + 紧急预留；手牌答案缺口另算。
    cardValueMargin: 1.25,
    // 补充兵员：守军 HP 低于该比率且在城市/村庄时值得补。
    reinforceHpRatio: 0.75,
    // 编队：向同一任务集结的友军每个的集火价值（金币）。
    focusFireRallyValue: 14
});

/** 单位每 HP 的金币价值。伤害估价的唯一换算器，全管线统一。 */
export function hpGold(unit) {
    const cost = Math.max(2, Number(unit?.config?.cost) || 8);
    const maxHp = Math.max(1, Number(unit?.maxHp ?? unit?.config?.hp ?? 100));
    return cost / maxHp;
}

/** 击杀一个单位抹掉的全部残余价值（与 ai/strategy.estimateForceValue 同口径）。 */
export function residualGold(unit) {
    if (!unit || unit.hp <= 0) return 0;
    const cost = Math.max(1, Number(unit.config?.cost) || 8);
    const maxHp = Math.max(1, Number(unit.maxHp ?? unit.config?.hp ?? unit.hp));
    const readiness = Math.max(0.25, Math.min(1, Number(unit.hp) / maxHp));
    const commanderValue = unit.commander ? 8 : 0;
    const rankValue = Math.max(0, Number(unit._rank || 0)) * 2;
    return cost * readiness + commanderValue + rankValue;
}

/** 攻击的账面金币净值：打出伤害 + 击杀溢价 − 预期反击成本。 */
export function tradeNetValue({ damageDealt = 0, target = null, kills = false, counterDamage = 0, attacker = null }) {
    let value = damageDealt * hpGold(target);
    if (kills && target) {
        value += residualGold(target) * W.killPremiumRatio;
        if (target.commander) value += W.commanderKillBonus;
    }
    value -= counterDamage * hpGold(attacker);
    return value;
}

/**
 * 档位噪声：同一个确定性散列把评分乘上 (1 ± noise) 的扰动。
 * 用盐值（单位/目标/回合）而不是 Math.random，保证自对局按种子可复现。
 * hard 档 noise=0，扰动恒为 1。
 */
export function noiseJitter(caps, salt) {
    if (!caps?.noise) return 1;
    let hash = 2166136261 >>> 0;
    const text = String(salt);
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    const uniform = ((hash >>> 0) % 10000) / 10000;
    return 1 + (uniform - 0.5) * 2 * caps.noise;
}
