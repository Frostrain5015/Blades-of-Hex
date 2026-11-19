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
        noise: 0.22,               // 由原 Legatus 下调至入门档：保留适量扰动与协助判断
        topK: 2,                   // 从前 k 个候选里按扰动后分数选
        duelModel: false,          // 交换只按单回合账面算（看不到缠斗结局）
        threatForecast: false,     // 威胁图只按当前射程，不预判位移
        intelTracking: true,       // 保留基础情报记录
        victoryClock: false,       // 不切换守钟/死斗姿态
        missionPersistence: false, // 任务只存活一回合
        cardScripts: true,         // 保留常规卡牌剧本
        conversionCapture: false,  // 不规划攻心夺城
        transportPlanning: false,  // 不把运输登陆当独立阶段
        interceptPricing: false,   // 不给“敌方占城者”额外定价
        scoutMissions: false,
        multiEscort: false,
        collapseConversion: false,
        emergencyDefense: false,
        lethalFocus: false,
        rearCommanderSafety: false,
        strategicPrizeRacing: false,
        opponentModeling: false
    }),
    medium: Object.freeze({
        id: 'medium',
        noise: 0,
        topK: 1,
        duelModel: true,           // Imperator（现中档）：继承原困难档完整规则推理能力
        threatForecast: true,      // 威胁图按 射程+机动力 外推一回合
        intelTracking: true,
        victoryClock: true,
        missionPersistence: true,  // 任务与单位编组跨回合锁定
        cardScripts: true,
        conversionCapture: true,
        transportPlanning: true,   // 海图占领路线与安全登陆
        interceptPricing: true,
        scoutMissions: true,
        multiEscort: true,
        collapseConversion: true,
        emergencyDefense: true,
        lethalFocus: true,
        rearCommanderSafety: true,
        strategicPrizeRacing: true,
        opponentModeling: false
    }),
    hard: Object.freeze({
        id: 'hard',
        noise: 0,
        topK: 1,
        duelModel: true,           // Hybrid（新困难档）：继承完整规则推理并融合人类策略模型
        threatForecast: true,      // 威胁图按 射程+机动力 外推一回合
        intelTracking: true,
        victoryClock: true,
        missionPersistence: true,
        cardScripts: true,
        conversionCapture: true,
        transportPlanning: true,
        interceptPricing: true,
        scoutMissions: true,
        multiEscort: true,
        collapseConversion: true,
        emergencyDefense: true,
        lethalFocus: true,
        rearCommanderSafety: true,
        strategicPrizeRacing: true,
        opponentModeling: true     // Hybrid 3.1 专属：对手风格建模、克制募兵/猎杀、高级主动技前瞻与残局破平
    })
});

export function isImperatorTier(caps) {
    return caps?.id === 'medium' || caps?.id === 'hard';
}

// ─── 通用估值权重（三档共享）──────────────────────────────────────
export const W = Object.freeze({
    // 击杀溢价：击杀除了抹掉剩余 HP 的价值，还消灭单位的未来产能，按残值的比率加算。
    killPremiumRatio: 0.55,
    // 将领单位被击杀的额外溢价（失去技能 + 士气打击）。
    commanderKillBonus: 45,
    // 净交换否决的宽容度：净亏损超过自方残值×该比率才放弃攻击（贴脸近战不退）。
    tradeVetoRatio: 0.45,
    // 高风险行动按略高于均值的承伤估算，给伤害浮动留出余量。
    lethalThreatMargin: 1.15,
    landingThreatWeight: 0.75,    // 等效回合：风险占己方血量的比例
    landingReadyBonus: 0.45,      // 等效回合：本回合落陆，下一回合可攻城
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
    focusFireRallyValue: 14,
    lethalFocusMargin: 1.10,
    // 残局攻城：除非新目标至少快这么多回合，否则不准整支军团换方向。
    allInTargetSwitchEtaGain: 2,
    // 已经打穿城防或削弱守军的目标拥有更强的沉没战果保护。
    allInDamagedTargetSwitchEtaGain: 3,
    // 死斗攻城编组 = 1 名占领者 + 至多 3 名护航/攻坚单位。
    allInEscortCount: 3,
    leadDefenseRounds: 8,
    objectiveCommitmentRounds: 3,
    objectiveSwitchEtaGain: 1,
    objectiveSwitchScoreMargin: 35,
    strategicPrizeRaceRatio: 0.65,
    strategicPrizeRaceWindow: 2,
    strategicPrizeFocusRatio: 1.75,
    // 处于敌方重火网（尤其双岸防炮重叠）下，下回合预期承伤逼近总血池时优先撤离
    lethalCrossfireRetreatRatio: 0.85,
    // 空城的对手下回合可招募一支守军时，按潜在守军折减攻城目标价值。
    rivalRecruitmentPressure: 15,
    leaderCityBonus: 26,
    leaderClockSwingBonus: 70,
    // 尚书腾位：至少囤够三名基础兵、兵力比落后，并隔一轮才能再次离城。
    ministerVacateRecruitBank: 24,
    ministerVacateForceRatio: 0.75,
    ministerVacateCooldownRounds: 2,
    // 每三名可占城单位至少配一名炮兵，避免残局生产退化为纯步兵海。
    siegeSupportPerAssault: 3,
    // 决胜城市的驻军即使本回合杀不完，也值得持续压低生命值。
    decisiveGarrisonProgressRatio: 0.16,
    rearCommanderRiskMultiplier: 2.1,
    rearCommanderCityValue: 180,
    // 反机场斩杀线与空袭压力：未逼近斩杀线时保留轻压（优先防空与掩体而不全图畏战）；逼近斩杀线时计入高危惩罚
    airThreatBackgroundWeight: 0.20,
    airThreatExposureWeight: 0.55,
    airportExecuteMargin: 1.05,
    airportKillzoneRiskRatio: 0.55,
    // 残血三段优先（补员 -> 治疗卡 -> 必死破罐破摔输出）
    healThreatRescueBonus: 90,
    doomedFatalCounterPenaltyRatio: 0.35
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
    // 将领具备光环、主动技能与士气支柱，不可等同于半个普通兵的价格去兑换
    const commanderValue = unit.commander ? 24 : 0;
    const rankValue = Math.max(0, Number(unit._rank || 0)) * 2;
    return cost * readiness + commanderValue + rankValue;
}

// ─── Imperator 多风格作战分支（仅困难档启用）─────────────────────
// 每分支只调整无量纲比率与建造/抽牌偏好，共享同一套规则认知与管线。
export const IMPERATOR_DOCTRINES = Object.freeze({
    grandmaster: Object.freeze({
        id: 'grandmaster',
        name: '铁血稳健',
        riskWeightScale: 1.0,
        tradeVetoRatio: 0.45,
        lethalThreatMargin: 1.15,
        retreatHpRatio: 0.30,
        retreatHpRatioCommander: 0.42,
        navalRetreatHpRatio: 0.46,
        occupierThreatTolerance: 1.9,
        killPremiumRatio: 0.55,
        commanderKillBonus: 65,
        commanderTargetFocusBonus: 36,
        commanderRiskPush: false,
        allowRiskySiege: false,
        siegeEtaTickRatio: 0.06,
        cardDrawSurplusMin: 3,
        cardFocus: false,
        navalWarshipBias: 1.15,
        navalSaturatedScale: 1.15,
        airfieldExpansionReserve: 15,
        airdropReserveFloor: 8,
        recruitOrderBias: 'balanced'
    }),
    blitz: Object.freeze({
        id: 'blitz',
        name: '闪击突进',
        riskWeightScale: 0.56,
        tradeVetoRatio: 0.80,
        lethalThreatMargin: 1.00,
        retreatHpRatio: 0.18,
        retreatHpRatioCommander: 0.25,
        navalRetreatHpRatio: 0.28,
        occupierThreatTolerance: 2.8,
        killPremiumRatio: 0.85,
        commanderKillBonus: 95,
        commanderTargetFocusBonus: 55,
        commanderRiskPush: true,
        allowRiskySiege: true,
        siegeEtaTickRatio: 0.095,
        cardDrawSurplusMin: 4,
        cardFocus: false,
        navalWarshipBias: 1.25,
        navalSaturatedScale: 1.1,
        airfieldExpansionReserve: 14,
        airdropReserveFloor: 6,
        recruitOrderBias: 'blitz'
    }),
    armada: Object.freeze({
        id: 'armada',
        name: '海空铁壁',
        riskWeightScale: 0.82,
        tradeVetoRatio: 0.55,
        lethalThreatMargin: 1.08,
        retreatHpRatio: 0.24,
        retreatHpRatioCommander: 0.34,
        navalRetreatHpRatio: 0.38,
        occupierThreatTolerance: 2.2,
        killPremiumRatio: 0.65,
        commanderKillBonus: 70,
        commanderTargetFocusBonus: 42,
        commanderRiskPush: false,
        allowRiskySiege: true,
        siegeEtaTickRatio: 0.075,
        cardDrawSurplusMin: 3,
        cardFocus: false,
        navalWarshipBias: 1.65,
        navalSaturatedScale: 1.45,
        airfieldExpansionReserve: 12,
        airdropReserveFloor: 4,
        recruitOrderBias: 'armada'
    }),
    trickster: Object.freeze({
        id: 'trickster',
        name: '诡道奇袭',
        riskWeightScale: 0.68,
        tradeVetoRatio: 0.65,
        lethalThreatMargin: 1.04,
        retreatHpRatio: 0.20,
        retreatHpRatioCommander: 0.28,
        navalRetreatHpRatio: 0.34,
        occupierThreatTolerance: 2.4,
        killPremiumRatio: 0.75,
        commanderKillBonus: 110,
        commanderTargetFocusBonus: 65,
        commanderRiskPush: true,
        allowRiskySiege: true,
        siegeEtaTickRatio: 0.080,
        cardDrawSurplusMin: 2,
        cardFocus: true,
        navalWarshipBias: 1.2,
        navalSaturatedScale: 1.1,
        airfieldExpansionReserve: 13,
        airdropReserveFloor: 5,
        recruitOrderBias: 'trickster'
    })
});

export const IMPERATOR_DOCTRINE_IDS = Object.freeze(Object.keys(IMPERATOR_DOCTRINES));

function sampleRngUnit(rng) {
    if (typeof rng === 'function') return rng();
    if (rng && typeof rng.next === 'function') return rng.next();
    return null;
}

function weightedDoctrinePick(weightsById, rng, allowedIds = IMPERATOR_DOCTRINE_IDS) {
    const poolIds = (allowedIds && allowedIds.length > 0 ? allowedIds : IMPERATOR_DOCTRINE_IDS)
        .filter(id => Number(weightsById[id]) > 0);
    const entries = (poolIds.length > 0 ? poolIds : ['grandmaster'])
        .map(id => [id, Math.max(0.05, Number(weightsById[id]) || 0.05)]);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    const sample = sampleRngUnit(rng);
    if (sample == null) return 'grandmaster';
    const roll = sample * total;
    let acc = 0;
    for (const [id, weight] of entries) {
        acc += weight;
        if (roll <= acc) return id;
    }
    return entries[0][0];
}

export function resolveImperatorDoctrine(gameState, myCampKey, context = {}) {
    if (!gameState || !myCampKey) return { ...IMPERATOR_DOCTRINES.grandmaster, shiftedFrom: null };
    const pinned = gameState._imperatorDoctrinePinByCamp?.[myCampKey]
        || gameState._imperatorDoctrinePin;
    if (pinned && pinned !== 'random' && Object.hasOwn(IMPERATOR_DOCTRINES, pinned)) {
        return { ...IMPERATOR_DOCTRINES[pinned], shiftedFrom: null, pinned: true };
    }

    const aiMemory = (gameState._aiCoreMemory ||= {});
    const campMemory = (aiMemory[myCampKey] ||= {});
    const round = Number(context.round ?? 0);
    const isOceanMap = !!context.oceanMap;
    const allowedIds = isOceanMap
        ? IMPERATOR_DOCTRINE_IDS
        : IMPERATOR_DOCTRINE_IDS.filter(id => id !== 'armada');

    if (!campMemory.doctrine || !Object.hasOwn(IMPERATOR_DOCTRINES, campMemory.doctrine)
        || (!isOceanMap && campMemory.doctrine === 'armada')) {
        const commanderIds = new Set(context.commanderIds || []);
        const cultureId = context.cultureId || null;
        const weights = {
            grandmaster: 1.0,
            blitz: 1.0,
            armada: isOceanMap ? 1.0 : 0,
            trickster: 1.0
        };
        if (isOceanMap) {
            weights.armada += 0.65;
            if (['colonel', 'engineer', 'tianyan'].some(id => commanderIds.has(id))
                || cultureId === 'de' || cultureId === 'us') {
                weights.armada += 0.55;
            }
        } else {
            if (commanderIds.has('engineer') || cultureId === 'fr' || cultureId === 'kmt') {
                weights.grandmaster += 0.45;
            }
            if (commanderIds.has('colonel') || commanderIds.has('tianyan') || cultureId === 'de' || cultureId === 'us') {
                weights.blitz += 0.35;
                weights.trickster += 0.30;
            }
        }
        if (['centurion', 'berserker', 'vampire', 'paladin'].some(id => commanderIds.has(id))
            || cultureId === 'jp' || cultureId === 'fr') {
            weights.blitz += 0.55;
        }
        if (['diplomat', 'advisor', 'magician'].some(id => commanderIds.has(id))) {
            weights.trickster += 0.60;
        }
        if (['minister', 'ironGuard', 'staller', 'priest'].some(id => commanderIds.has(id))) {
            weights.grandmaster += 0.45;
        }
        const chosen = weightedDoctrinePick(weights, gameState.rng, allowedIds);
        campMemory.openingDoctrine = chosen;
        campMemory.doctrine = chosen;
        campMemory.doctrineSinceRound = round;
        campMemory.doctrineShifts = [];
    }

    let shiftedFrom = null;
    const currentId = campMemory.doctrine;
    const sinceRound = Number(campMemory.doctrineSinceRound ?? 0);
    const cityGap = Number(context.cityGap);
    const hasSituationMetrics = Number.isFinite(cityGap);
    if (hasSituationMetrics && round >= 6 && round - sinceRound >= 4) {
        const incomeRatio = Number(context.incomeRatio ?? 1);
        const roundsRemaining = Number(context.roundsRemaining ?? 99);
        const ownCities = Number(context.ownCities ?? 1);
        const lastCaptureRound = Number(campMemory.lastCaptureRound ?? 0);
        const stagnantRounds = round - lastCaptureRound;
        const commanderIds = new Set(context.commanderIds || []);
        const gold = Number(context.gold ?? 0);
        let nextId = null;
        let reason = null;

        if (cityGap <= -1 && (incomeRatio < 0.85 || round >= 10 || context.bleeding)) {
            if (currentId === 'grandmaster' || currentId === 'armada') {
                const preferTrickster = gold >= 16 || ['diplomat', 'advisor', 'magician', 'colonel'].some(id => commanderIds.has(id));
                nextId = preferTrickster ? 'trickster' : 'blitz';
                reason = 'trailing-pivot';
            }
        } else if (cityGap >= 2 || (cityGap >= 1 && roundsRemaining <= 8)) {
            if (currentId === 'blitz' || currentId === 'trickster') {
                nextId = context.oceanMap ? 'armada' : 'grandmaster';
                reason = 'lead-consolidation';
            }
        } else if (round >= 8 && cityGap === 0 && ownCities <= 2 && stagnantRounds >= 5) {
            if (currentId === 'grandmaster') {
                nextId = context.oceanMap ? 'armada' : 'blitz';
                reason = 'stalemate-breaker';
            } else if (currentId === 'armada' && round >= 11 && stagnantRounds >= 6) {
                nextId = 'blitz';
                reason = 'sea-stalemate-blitz';
            }
        }

        if (nextId && nextId !== currentId) {
            shiftedFrom = currentId;
            campMemory.doctrine = nextId;
            campMemory.doctrineSinceRound = round;
            (campMemory.doctrineShifts ||= []).push({ round, from: currentId, to: nextId, reason });
        }
    }

    return {
        ...IMPERATOR_DOCTRINES[campMemory.doctrine],
        openingDoctrine: campMemory.openingDoctrine || campMemory.doctrine,
        shiftedFrom,
        pinned: false
    };
}

export function resolveEffectiveWeights(caps, doctrine = null) {
    if (!isImperatorTier(caps) || !doctrine) return W;
    return Object.freeze({
        ...W,
        riskWeightScale: doctrine.riskWeightScale ?? 1.0,
        tradeVetoRatio: doctrine.tradeVetoRatio ?? W.tradeVetoRatio,
        lethalThreatMargin: doctrine.lethalThreatMargin ?? W.lethalThreatMargin,
        retreatHpRatio: doctrine.retreatHpRatio ?? W.retreatHpRatio,
        retreatHpRatioCommander: doctrine.retreatHpRatioCommander ?? W.retreatHpRatioCommander,
        navalRetreatHpRatio: doctrine.navalRetreatHpRatio ?? 0.58,
        occupierThreatTolerance: doctrine.occupierThreatTolerance ?? W.occupierThreatTolerance,
        killPremiumRatio: doctrine.killPremiumRatio ?? W.killPremiumRatio,
        commanderKillBonus: doctrine.commanderKillBonus ?? W.commanderKillBonus,
        commanderTargetFocusBonus: doctrine.commanderTargetFocusBonus ?? 30,
        commanderRiskPush: !!doctrine.commanderRiskPush,
        allowRiskySiege: !!doctrine.allowRiskySiege,
        siegeEtaTickRatio: doctrine.siegeEtaTickRatio ?? W.siegeEtaTickRatio,
        cardDrawSurplusMin: doctrine.cardDrawSurplusMin ?? 3,
        cardFocus: !!doctrine.cardFocus,
        navalWarshipBias: doctrine.navalWarshipBias ?? 1.0,
        navalSaturatedScale: doctrine.navalSaturatedScale ?? 1.0,
        airfieldExpansionReserve: doctrine.airfieldExpansionReserve ?? 18,
        airdropReserveFloor: doctrine.airdropReserveFloor ?? 10,
        recruitOrderBias: doctrine.recruitOrderBias ?? 'balanced'
    });
}

/**
 * 难度与风格调节层（Area 4）：学说 × 文化驱动的混合温度、MLP/规则融合权重与战术倾向偏置。
 * 不同学说与国家文化呈现鲜明的攻防节奏差异，而不改变规则底线与合法性。
 */
export function resolveHybridFusionProfile(doctrine = null, cultureId = null, posture = 'contest') {
    const id = doctrine?.id || 'grandmaster';
    const baseByDoctrine = {
        grandmaster: { mlpWeight: 0.42, impWeight: 0.58, mlpTemp: 0.92, beamWeight: 1.0, cardBias: 0, attackBias: 0, moveBias: 0, styleTag: 'grandmaster' },
        blitz:       { mlpWeight: 0.48, impWeight: 0.52, mlpTemp: 0.84, beamWeight: 1.2, cardBias: -2, attackBias: 6, moveBias: 4, styleTag: 'blitz' },
        armada:      { mlpWeight: 0.45, impWeight: 0.55, mlpTemp: 0.95, beamWeight: 1.05, cardBias: 2, attackBias: 2, moveBias: 0, styleTag: 'armada' },
        trickster:   { mlpWeight: 0.52, impWeight: 0.48, mlpTemp: 1.12, beamWeight: 1.15, cardBias: 8, attackBias: 3, moveBias: 2, styleTag: 'trickster' }
    };
    const cfg = { ...(baseByDoctrine[id] || baseByDoctrine.grandmaster) };

    if (posture === 'allin') {
        cfg.attackBias += 5;
        cfg.moveBias += 4;
        cfg.beamWeight += 0.15;
    } else if (posture === 'hold' || posture === 'defend') {
        cfg.impWeight = Math.min(0.64, cfg.impWeight + 0.05);
        cfg.mlpWeight = 1.0 - cfg.impWeight;
        cfg.mlpTemp = Math.max(0.78, cfg.mlpTemp - 0.08);
    }

    if (cultureId === 'de' || cultureId === 'jp') {
        cfg.attackBias += 3;
        cfg.mlpTemp = Math.max(0.80, cfg.mlpTemp - 0.04);
    } else if (cultureId === 'us' || cultureId === 'gb') {
        cfg.cardBias += 3;
    } else if (cultureId === 'fr' || cultureId === 'kmt') {
        cfg.impWeight = Math.min(0.62, cfg.impWeight + 0.02);
        cfg.mlpWeight = 1.0 - cfg.impWeight;
    } else if (cultureId === 'cpc') {
        cfg.moveBias += 3;
        cfg.cardBias += 2;
    }

    return Object.freeze(cfg);
}

/** 攻击的账面金币净值：打出伤害 + 击杀溢价 − 预期反击成本。 */
export function tradeNetValue({ damageDealt = 0, target = null, kills = false, counterDamage = 0, attacker = null, weights = W }) {
    const w = weights || W;
    let value = damageDealt * hpGold(target);
    if (kills && target) {
        value += residualGold(target) * w.killPremiumRatio;
        if (target.commander) value += w.commanderKillBonus;
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
