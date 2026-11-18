// 对局日志的纯数据统计层。
// 不依赖 DOM，也不读取实时 gameState，确保结算页、自动测试和未来的复盘工具使用同一套口径。

import { COMMANDER_CONFIG } from '../rules/commanders.js';
import { UNIT_CONFIG, getSpecialization } from '../rules/units.js';

const COMMANDER_NAME_TO_ID = Object.freeze(
    Object.fromEntries(
        Object.entries(COMMANDER_CONFIG)
            .map(([id, entry]) => [entry?.definition?.name, id])
            .filter(([name]) => Boolean(name))
    )
);

const HISTORICAL_FLAG_BY_NAME = Object.freeze({
    美国: 'img/flags/svg/us.svg',
    英国: 'img/flags/svg/gb.svg',
    法国: 'img/flags/svg/fr.svg',
    苏联: 'img/flags/soviet-union.svg',
    苏军驻东北部队: 'img/flags/soviet-union.svg',
    中华民国: 'img/flags/kuomintang.svg',
    中共苏区: 'img/flags/chinese-communist-party-old.svg',
    德国: 'img/flags/germany-iron-cross.svg',
    日本: 'img/flags/svg/jp.svg'
});

function inferHistoricalFlagPreset(camp, mode = null) {
    if (!camp || camp.flagPreset || camp.flagUrl || camp.flagConfig) return camp?.flagPreset || null;
    if (mode?.factionRuleMode === 'none') return null;
    return HISTORICAL_FLAG_BY_NAME[camp.name] || null;
}

function resolveDurationMs(source) {
    const raw = finiteNumber(source?.durationMs);
    if (raw > 0) return raw;
    const started = Date.parse(source?.startedAt);
    const ended = Date.parse(source?.endedAt);
    return Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? ended - started : 0;
}

const ACTION_BUCKETS = Object.freeze({
    move: 'moves',
    attack: 'attacks',
    recruit: 'recruits',
    reinforce: 'reinforcements',
    repairShip: 'reinforcements',
    fieldRepair: 'reinforcements',
    airCommand: 'airCommands',
    tacticalCard: 'cards',
    drawCard: 'cards',
    buildFortification: 'constructions',
    buildBunker: 'constructions',
    buildAirfield: 'constructions',
    engineerTrench: 'constructions',
    engineerFlak: 'constructions',
    engineerBunkerStart: 'constructions'
});

const UNIT_TYPE_NAMES = Object.freeze({
    ...Object.fromEntries(Object.entries(UNIT_CONFIG).map(([type, config]) => [type, config.name])),
    drone: '天眼哨机',
    fr_heavy_cannon: '法国巨炮',
    bunker: '碉堡',
    airfield: '空军',
    fortification: '野战工事',
    trench: '战壕',
    flak: '防空阵地',
    landmine: '地雷',
    orbitalPlatform: '天基轨道炮',
    scaffold: '施工脚手架',
    unknown: '未知单位'
});

const NAVAL_UNIT_TYPES = new Set([
    'destroyer',
    'warship',
    'submarine',
    'carrier',
    ...Object.entries(UNIT_CONFIG)
        .filter(([, config]) => config.movementDomain === 'naval')
        .map(([type]) => type)
]);

const emptyCombatStats = () => ({
    actions: 0,
    moves: 0,
    attacks: 0,
    recruits: 0,
    reinforcements: 0,
    airCommands: 0,
    cards: 0,
    constructions: 0,
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    healingReceived: 0,
    kills: 0,
    losses: 0,
    captures: 0
});

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function computeCampRating(camp, { winnerCampKey = null, maxDamage = 0, maxActions = 0 } = {}) {
    const kills = finiteNumber(camp?.kills);
    const losses = finiteNumber(camp?.losses);
    const attacks = finiteNumber(camp?.attacks);
    const actions = finiteNumber(camp?.actions);
    const captures = finiteNumber(camp?.captures);
    const damageDealt = finiteNumber(camp?.damageDealt);
    const damageTaken = finiteNumber(camp?.damageTaken);
    const healingReceived = finiteNumber(camp?.healingReceived);
    const reinforcements = finiteNumber(camp?.reinforcements);
    const initialCities = finiteNumber(camp?.initialCities);
    const finalCities = finiteNumber(camp?.finalCities);
    const cityDelta = camp?.cityDelta != null ? finiteNumber(camp.cityDelta) : (finalCities - initialCities);
    const initialUnits = finiteNumber(camp?.initialForce?.units);
    const finalUnits = finiteNumber(camp?.finalForce?.units);
    const forceDelta = camp?.forceDelta != null ? finiteNumber(camp.forceDelta) : (finalUnits - initialUnits);
    const damagePerAttack = camp?.damagePerAttack != null
        ? finiteNumber(camp.damagePerAttack)
        : (attacks > 0 ? damageDealt / attacks : 0);

    const isWinner = winnerCampKey != null && winnerCampKey === camp?.campKey;
    const isNeutral = camp?.campKey === 'neutral';
    const combatInvolvement = clamp((kills + losses + attacks * 0.5) / 8, 0, 1);
    const dmgVolumeFactor = maxDamage > 0 ? clamp(damageDealt / (maxDamage * 0.25), 0.15, 1) : 0.2;

    // 1. 胜势与战线成果（25）
    const cityHold = initialCities > 0 ? clamp(finalCities / initialCities, 0, 1.5) : 0;
    const outcome = (isWinner ? 11 : 0)
        + clamp(4.2 * cityHold + cityDelta * 1.8 + Math.min(6, captures * 1.15), 0, 14);

    // 2. 交战交换比与伤害交换效率（28）；对未实质参战的旁观方做参与度加权
    const smoothKdr = (kills + 1.5) / (losses + 1.5);
    const rawKdr = clamp(5.4 * Math.log2(smoothKdr + 0.35) + 5.2, 0, 14);
    const kdrScore = rawKdr * (0.20 + 0.80 * combatInvolvement);

    const dmgRatio = (damageDealt + 300) / (damageTaken + 300);
    const rawDmgEx = clamp(5.4 * Math.log2(dmgRatio + 0.35) + 4.7, 0, 14);
    const dmgExScore = rawDmgEx * (0.20 + 0.80 * combatInvolvement);
    const combat = kdrScore + dmgExScore;

    // 3. 火力总量贡献与单次打击质量（21）
    const relDmg = maxDamage > 0 ? damageDealt / maxDamage : 0;
    const dmgShareScore = Math.min(13, Math.sqrt(Math.max(0, relDmg)) * 13);
    const strikeScore = (attacks > 0 ? Math.min(8, (damagePerAttack / 82) * 7.4) : 1.0) * dmgVolumeFactor;
    const firepower = dmgShareScore + strikeScore;

    // 4. 部队存续与后勤恢复韧性（14）
    const retentionRatio = initialUnits > 0 ? finalUnits / initialUnits : (finalUnits > 0 ? 1 : 0);
    const forceScore = clamp(retentionRatio * 5.5 + (forceDelta > 0 ? 1.5 : 0), 0, 7)
        * (isNeutral && combatInvolvement < 0.3 ? 0.25 : 1);
    const healScore = (damageTaken > 0
        ? Math.min(7, Math.sqrt(healingReceived / Math.max(1, damageTaken)) * 6.8 + Math.min(2, reinforcements * 0.45))
        : 0.5) * (0.20 + 0.80 * combatInvolvement);
    const sustain = forceScore + healScore;

    // 5. 战场行动与战术主动性（12）
    const relAct = maxActions > 0 ? actions / maxActions : 0;
    const tacticalCount = finiteNumber(camp?.cards)
        + finiteNumber(camp?.airCommands)
        + finiteNumber(camp?.constructions)
        + finiteNumber(camp?.recruits);
    const initiative = Math.min(12, relAct * 7.5 + Math.min(4.5, tacticalCount * 0.28));

    const score = Math.round(clamp(outcome + combat + firepower + sustain + initiative, 0, 100));
    const grade = score >= 84 ? 'A+'
        : score >= 74 ? 'A'
        : score >= 63 ? 'A-'
        : score >= 52 ? 'B+'
        : score >= 41 ? 'B'
        : score >= 32 ? 'B-'
        : 'C';

    return {
        score,
        grade,
        breakdown: {
            outcome: Math.round(outcome),
            combat: Math.round(combat),
            firepower: Math.round(firepower),
            sustain: Math.round(sustain),
            initiative: Math.round(initiative)
        }
    };
}

function attachCampRatings(camps, winnerCampKey) {
    const maxDamage = Math.max(0, ...(camps || []).map(camp => finiteNumber(camp?.damageDealt)));
    const maxActions = Math.max(0, ...(camps || []).map(camp => finiteNumber(camp?.actions)));
    return (camps || []).map(camp => ({
        ...camp,
        rating: computeCampRating(camp, { winnerCampKey, maxDamage, maxActions })
    }));
}

export function computeUnitMvpScore(unit) {
    if (!unit) return 0;
    const damageDealt = finiteNumber(unit.damageDealt);
    const damageTaken = finiteNumber(unit.damageTaken);
    const healingDone = finiteNumber(unit.healingDone);
    const healingReceived = finiteNumber(unit.healingReceived);
    const kills = finiteNumber(unit.kills);
    const captures = finiteNumber(unit.captures);
    const recruits = finiteNumber(unit.recruits);
    const actions = finiteNumber(unit.actions);
    const survived = unit.survived === true;
    // 抗线承伤需伴随实际输出、治疗或占城才计入正向评分，防止无作为掉血刷榜
    const tankEffectiveness = damageDealt > 0 || healingReceived > 0 || captures > 0
        ? Math.min(damageTaken, 700) * (survived ? 0.28 : 0.16)
        : 0;
    return damageDealt
        + kills * 135
        + captures * 165
        + healingDone * 0.75
        + healingReceived * 0.40
        + tankEffectiveness
        + recruits * 40
        + Math.min(40, actions) * 6
        + (survived ? 70 : 0);
}

export function selectMvpUnits(units, limit = 3) {
    const scored = [...(units || [])]
        // 虚拟机场（空军）与实体战斗单位口径不同（无承伤等维度），不登上 MVP 榜
        .filter(unit => unit?.type !== 'airfield')
        .filter(unit => finiteNumber(unit?.damageDealt)
            + finiteNumber(unit?.kills)
            + finiteNumber(unit?.captures)
            + finiteNumber(unit?.recruits)
            + finiteNumber(unit?.healingDone)
            + finiteNumber(unit?.healingReceived) > 0)
        .map(unit => ({ unit, score: computeUnitMvpScore(unit) }))
        .filter(entry => entry.score > 0)
        .sort((left, right) =>
            right.score - left.score
            || finiteNumber(right.unit?.kills) - finiteNumber(left.unit?.kills)
            || finiteNumber(right.unit?.damageDealt) - finiteNumber(left.unit?.damageDealt)
            || String(left.unit?.id ?? '').localeCompare(String(right.unit?.id ?? ''))
        );
    if (!scored.length || limit <= 0) return [];
    const topScore = scored[0].score;
    const picked = [scored[0]];
    for (let index = 1; index < scored.length && picked.length < limit; index++) {
        const candidate = scored[index];
        const prevScore = picked[picked.length - 1].score;
        // 仅当第二、三名与第一名（>=60%）及紧邻上一名（>=65%）差距不过大时共同上榜
        if (candidate.score >= topScore * 0.60 && candidate.score >= prevScore * 0.65) {
            picked.push(candidate);
        } else {
            break;
        }
    }
    return picked.map(entry => entry.unit);
}

const AIRFIELD_ENTITY_RE = /^airfield:(-?\d+),(-?\d+):([^:]+)$/;

export function makeAirfieldEntityId(q, r, campKey) {
    return `airfield:${q},${r}:${campKey}`;
}

export function parseAirfieldEntityId(unitId) {
    if (typeof unitId !== 'string') return null;
    const match = AIRFIELD_ENTITY_RE.exec(unitId);
    if (!match) return null;
    return { q: Number(match[1]), r: Number(match[2]), campKey: match[3] };
}

function normalizedRound(item) {
    return Math.max(1, Math.floor(finiteNumber(item?.round) || 1));
}

function unitDisplayName(unit) {
    const type = unit?.type;
    if (type === 'airfield') {
        const coords = parseAirfieldEntityId(unit?.id)
            || (Number.isFinite(unit?.q) && Number.isFinite(unit?.r) ? { q: unit.q, r: unit.r } : null);
        return `空军${coords ? ` (${coords.q},${coords.r})` : ''}`;
    }
    const specName = type && unit?.specializationKey
        ? getSpecialization(type, unit.specializationKey)?.name
        : null;
    const typeName = specName || UNIT_TYPE_NAMES[type] || UNIT_CONFIG[type]?.name || type || '未知单位';
    const commanderName = COMMANDER_CONFIG[unit?.commanderId]?.definition?.name
        || unit?.commanderId
        || (unit?.isCommanderUnit ? '未知将领' : null);
    const suffix = commanderName ? ` · ${commanderName}` : '';
    return `${typeName}${suffix}`;
}

function unitCatalogKey(unitId) {
    return unitId == null ? null : String(unitId);
}

function collectUnitCatalog(log) {
    const catalog = new Map();
    const remember = raw => {
        if (!raw?.id) return null;
        const parsedAirfield = parseAirfieldEntityId(raw.id);
        const key = unitCatalogKey(raw.id);
        const previous = catalog.get(key) || {};
        const unit = {
            id: previous.id ?? raw.id,
            type: raw.type || previous.type || (parsedAirfield ? 'airfield' : 'unknown'),
            campKey: raw.campKey || previous.campKey || parsedAirfield?.campKey || null,
            specializationKey: raw.specializationKey ?? previous.specializationKey ?? null,
            commanderId: raw.commanderId ?? previous.commanderId ?? null,
            isCommanderUnit: raw.isCommanderUnit ?? previous.isCommanderUnit ?? false,
            maxHp: parsedAirfield || raw.type === 'airfield' ? 0 : finiteNumber(raw.maxHp || previous.maxHp),
            initialHp: previous.initialHp ?? finiteNumber(raw.hp),
            finalHp: previous.finalHp ?? null
        };
        catalog.set(key, unit);
        return unit;
    };

    for (const unit of log.initialState?.units || []) remember(unit);
    for (const item of log.timeline || []) {
        for (const unit of item.outcome?.changes?.unitsAdded || []) remember(unit);
        for (const unit of item.outcome?.changes?.unitsRemoved || []) remember(unit);
        for (const changed of item.outcome?.changes?.unitState || []) {
            const commanderId = changed.changes?.commanderId?.after;
            const isCommanderUnit = changed.changes?.isCommanderUnit?.after;
            const specializationKey = changed.changes?.specializationKey?.after;
            if (commanderId != null || isCommanderUnit != null || specializationKey != null) {
                remember({ id: changed.unitId, commanderId, isCommanderUnit, specializationKey });
            }
        }
        if (item.kind === 'action' && item.actionType === 'airCommand' && item.accepted !== false) {
            const payload = item.payload || {};
            const airUnitId = payload.sourceUnitId
                || (payload.launcherQ != null && payload.launcherR != null && item.actorCampKey
                    ? makeAirfieldEntityId(payload.launcherQ, payload.launcherR, item.actorCampKey)
                    : null);
            if (airUnitId) {
                remember({
                    id: airUnitId,
                    type: payload.sourceUnitType || (parseAirfieldEntityId(airUnitId) ? 'airfield' : undefined),
                    campKey: item.actorCampKey,
                    commanderId: payload.colonelCommander || undefined,
                    isCommanderUnit: payload.colonelId && payload.colonelId === airUnitId ? true : undefined
                });
            }
            continue;
        }
        if (item.kind !== 'event') continue;
        const payload = item.payload || {};
        if (payload.unitId) remember({
            id: payload.unitId,
            type: payload.unitType,
            campKey: payload.campKey,
            commanderId: payload.commanderId,
            isCommanderUnit: payload.isCommanderUnit
        });
        if (payload.sourceUnitId) remember({
            id: payload.sourceUnitId,
            type: payload.sourceUnitType || (parseAirfieldEntityId(payload.sourceUnitId) ? 'airfield' : undefined),
            campKey: payload.sourceCampKey
        });
        if (payload.killerId) remember({
            id: payload.killerId,
            type: payload.killerType || (parseAirfieldEntityId(payload.killerId) ? 'airfield' : undefined),
            campKey: payload.killerCampKey,
            commanderId: payload.killerCommanderId
        });
    }
    const finalIds = new Set();
    for (const unit of log.finalState?.units || []) {
        const known = remember(unit);
        if (known) {
            known.finalHp = finiteNumber(unit.hp);
            finalIds.add(unitCatalogKey(known.id));
        }
    }
    return { catalog, finalIds };
}

function campSiteCount(sites, campKey, kind) {
    return (sites || []).filter(site => site.campKey === campKey && site.kind === kind).length;
}

function forceSnapshot(units, campKey) {
    const own = (units || []).filter(unit => unit.campKey === campKey);
    return {
        units: own.length,
        totalHp: own.reduce((sum, unit) => sum + finiteNumber(unit.hp), 0)
    };
}

function leader(units, metric) {
    return [...units]
        .filter(unit => finiteNumber(unit[metric]) > 0)
        .sort((left, right) =>
            finiteNumber(right[metric]) - finiteNumber(left[metric])
            || right.kills - left.kills
            || String(left.id).localeCompare(String(right.id))
        )[0] || null;
}

function keyEventLabel(item, participantsByKey) {
    const payload = item.payload || {};
    if (item.eventType === 'unitKilled') {
        const defeated = unitDisplayName({
            type: payload.unitType,
            commanderId: payload.commanderId,
            isCommanderUnit: payload.isCommanderUnit
        });
        const killerCampName = participantsByKey[payload.killerCampKey]?.name;
        const killer = payload.killerType || parseAirfieldEntityId(payload.killerId)
            ? unitDisplayName({
                id: payload.killerId,
                type: payload.killerType || 'airfield',
                commanderId: payload.killerCommanderId
            })
            : null;
        const sourceLabel = killerCampName
            ? `${killerCampName}${killer ? `的${killer}` : '的火力/技能'}`
            : (killer || '战场环境/规则效果');
        return `${sourceLabel}击毁${participantsByKey[payload.campKey]?.name || '未知阵营'}的${defeated}`;
    }
    if (item.eventType === 'cityCaptured') {
        return `${participantsByKey[payload.campKey]?.name || '未知阵营'}攻占行政区${payload.districtId ?? ''}`;
    }
    if (item.eventType === 'objectiveChanged') {
        return payload.title || payload.label || payload.objectiveId || '战役目标发生变化';
    }
    if (item.eventType === 'diplomacyChanged') return '阵营外交关系发生变化';
    if (item.eventType === 'interactionCompleted') return payload.label || payload.interactionId || '完成战役互动';
    if (item.eventType === 'factionSkillActivated') {
        return `${participantsByKey[payload.campKey]?.name || '未知阵营'}发动阵营技能【${payload.skillName || payload.synergyId || '未知'}】`;
    }
    return item.eventType;
}

function percentile(sortedValues, ratio) {
    if (sortedValues.length === 0) return 0;
    const index = (sortedValues.length - 1) * ratio;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sortedValues[lower];
    return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

function parseDistrictIdFromEvent(event) {
    if (event?.districtId != null) return event.districtId;
    const match = typeof event?.label === 'string' ? event.label.match(/行政区(\d+)/) : null;
    return match ? Number(match[1]) : null;
}

export function selectMainBelligerents(byCamp) {
    const entries = Object.entries(byCamp || {})
        .map(([campKey, stats]) => {
            const damageDealt = finiteNumber(stats?.damageDealt);
            const damageTaken = finiteNumber(stats?.damageTaken);
            const kills = finiteNumber(stats?.kills);
            const losses = finiteNumber(stats?.losses);
            const captures = finiteNumber(stats?.captures);
            const involvement = damageDealt + damageTaken;
            const score = involvement > 0 ? involvement : (kills + losses) * 100 + captures * 80;
            return { campKey, damageDealt, damageTaken, kills, losses, captures, involvement, score };
        })
        .filter(entry => entry.score > 0)
        .sort((left, right) =>
            right.score - left.score
            || right.damageDealt - left.damageDealt
            || right.kills - left.kills
        );
    const total = entries.reduce((sum, entry) => sum + entry.score, 0);
    if (!entries.length || total <= 0) return [];
    const top = entries[0];
    return entries.filter((entry, index) => {
        if (index >= 3) return false;
        if (index === 0) return true;
        const share = entry.score / total;
        const ratioToTop = entry.score / top.score;
        // 抓住主要矛盾：次要阵营须达到实质交战比重（第二名>=20%，第三名>=24%且>=榜首55%）才参与对战展示
        if (index === 1) return share >= 0.20;
        return share >= 0.24 && ratioToTop >= 0.55;
    }).map(entry => ({
        ...entry,
        share: Number((entry.score / total).toFixed(3))
    }));
}

function resolveEliminationFinisher(victimCampKey, roundData, capturesList, commanderDeaths, unitKillsInRound) {
    const killCounts = new Map();
    for (const kill of unitKillsInRound || []) {
        if (kill.victimCampKey === victimCampKey && kill.killerCampKey && kill.killerCampKey !== victimCampKey) {
            killCounts.set(kill.killerCampKey, (killCounts.get(kill.killerCampKey) || 0) + 1);
        }
    }
    if (killCounts.size > 0) {
        return [...killCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    const commanderKill = commanderDeaths.find(death => death.campKey === victimCampKey && death.killerCampKey);
    if (commanderKill) return commanderKill.killerCampKey;
    const lostCityCapture = capturesList.find(cap => cap.previousCampKey === victimCampKey && cap.campKey && cap.campKey !== victimCampKey);
    if (lostCityCapture) return lostCityCapture.campKey;
    const enemyCapture = [...capturesList].reverse().find(cap => cap.campKey && cap.campKey !== victimCampKey && cap.campKey !== 'neutral');
    if (enemyCapture) return enemyCapture.campKey;
    const byCampEntries = Object.entries(roundData?.byCamp || {})
        .filter(([campKey]) => campKey !== victimCampKey && campKey !== 'neutral')
        .map(([campKey, s]) => [campKey, finiteNumber(s?.kills) * 200 + finiteNumber(s?.captures) * 250 + finiteNumber(s?.damageDealt)])
        .filter(([, score]) => score > 0)
        .sort((a, b) => b[1] - a[1]);
    return byCampEntries[0]?.[0] || null;
}

function identifyBattleEvents(rounds, context = {}) {
    const controlTimeline = Array.isArray(context.controlTimeline) ? context.controlTimeline : [];
    const commanderDeathEvents = Array.isArray(context.commanderDeathEvents) ? context.commanderDeathEvents : [];
    const keyEvents = Array.isArray(context.keyEvents) ? context.keyEvents : [];
    const unitKillsByRound = context.unitKillsByRound instanceof Map ? context.unitKillsByRound : new Map();

    const deathsByRound = new Map();
    for (const death of commanderDeathEvents) {
        const r = Math.max(1, Math.floor(finiteNumber(death?.round) || 1));
        if (!deathsByRound.has(r)) deathsByRound.set(r, []);
        deathsByRound.get(r).push({
            campKey: death.campKey || null,
            killerCampKey: death.killerCampKey || null,
            commanderId: death.commanderId || null,
            commanderName: death.commanderName || death.commanderId || '将领',
            unitType: death.unitType || null,
            displayName: death.displayName || death.commanderName || '将领单位'
        });
    }

    const capturesByRound = new Map();
    for (const ev of keyEvents) {
        if (ev?.type !== 'cityCaptured') continue;
        const r = Math.max(1, Math.floor(finiteNumber(ev.round) || 1));
        if (!capturesByRound.has(r)) capturesByRound.set(r, []);
        capturesByRound.get(r).push({
            campKey: ev.campKey || null,
            districtId: parseDistrictIdFromEvent(ev),
            previousCampKey: ev.previousCampKey || null,
            label: ev.label || ''
        });
    }

    const roundMap = new Map((rounds || []).map(round => [round.round, round]));
    const elimByRound = new Map();
    const turningByRound = new Map();
    const eliminatedAlready = new Set();

    for (let index = 1; index < controlTimeline.length; index++) {
        const prev = controlTimeline[index - 1];
        const cur = controlTimeline[index];
        const r = Math.floor(finiteNumber(cur?.round));
        if (r <= 0) continue;
        const roundStats = roundMap.get(r);
        const roundEntries = Object.values(roundStats?.byCamp || {});
        const roundCaptures = roundEntries.reduce((sum, s) => sum + finiteNumber(s?.captures), 0);
        const roundLosses = roundEntries.reduce((sum, s) => sum + finiteNumber(s?.losses), 0);
        const roundEngagements = finiteNumber(roundStats?.engagements);

        for (const [campKey, curCamp] of Object.entries(cur?.byCamp || {})) {
            if (campKey === 'neutral' || eliminatedAlready.has(campKey)) continue;
            const prevCamp = prev?.byCamp?.[campKey];
            if (!prevCamp) continue;
            const hadPresence = finiteNumber(prevCamp.units) > 0 || finiteNumber(prevCamp.cities) > 0;
            const cleared = finiteNumber(curCamp.units) === 0 && finiteNumber(curCamp.cities) === 0;
            // 需由当回合真实的占城/灭队战果佐证，避免无时间线对应的残缺终局快照误判为回合灭国战果
            const corroborated = finiteNumber(prevCamp.cities) > 0
                ? roundCaptures > 0
                : (roundLosses > 0 || roundEngagements > 0);
            if (hadPresence && cleared && corroborated) {
                eliminatedAlready.add(campKey);
                if (!elimByRound.has(r)) elimByRound.set(r, []);
                elimByRound.get(r).push(campKey);
            }
        }

        const prevPlayers = Object.entries(prev?.byCamp || {}).filter(([campKey]) => campKey !== 'neutral');
        const curPlayers = Object.entries(cur?.byCamp || {}).filter(([campKey]) => campKey !== 'neutral');
        const unrecordedCityShift = roundCaptures === 0 && Object.entries(cur?.byCamp || {}).some(([campKey, curCamp]) => {
            const prevCamp = prev?.byCamp?.[campKey];
            return prevCamp && finiteNumber(curCamp?.cities) !== finiteNumber(prevCamp?.cities);
        });
        if (prevPlayers.length >= 2 && curPlayers.length >= 2 && !unrecordedCityShift && (roundCaptures > 0 || roundLosses >= 2)) {
            const prevTop = [...prevPlayers].sort((a, b) => finiteNumber(b[1]?.controlShare) - finiteNumber(a[1]?.controlShare))[0];
            const curTop = [...curPlayers].sort((a, b) => finiteNumber(b[1]?.controlShare) - finiteNumber(a[1]?.controlShare))[0];
            const gainers = curPlayers.map(([campKey, s]) => {
                const curShare = finiteNumber(s?.controlShare);
                const prevShare = finiteNumber(prev?.byCamp?.[campKey]?.controlShare);
                return { campKey, curShare, prevShare, delta: curShare - prevShare };
            }).sort((a, b) => b.delta - a.delta);
            const topGainer = gainers[0];
            const leaderChanged = Boolean(prevTop && curTop && prevTop[0] !== curTop[0] && finiteNumber(prevTop[1]?.controlShare) > 0);
            const curLeaderDelta = leaderChanged
                ? finiteNumber(curTop[1]?.controlShare) - finiteNumber(prev?.byCamp?.[curTop[0]]?.controlShare)
                : 0;
            if (topGainer && (topGainer.delta >= 0.12 || (leaderChanged && curLeaderDelta >= 0.08 && r >= 3))) {
                const target = topGainer.delta >= 0.12 ? topGainer : {
                    campKey: curTop[0],
                    curShare: finiteNumber(curTop[1]?.controlShare),
                    prevShare: finiteNumber(prev?.byCamp?.[curTop[0]]?.controlShare),
                    delta: curLeaderDelta
                };
                turningByRound.set(r, {
                    campKey: target.campKey,
                    previousLeaderCampKey: leaderChanged ? prevTop[0] : null,
                    prevShare: Number(target.prevShare.toFixed(3)),
                    curShare: Number(target.curShare.toFixed(3)),
                    delta: Number(target.delta.toFixed(3)),
                    leaderChanged
                });
            }
        }
    }

    const roundNumbers = [...new Set([
        ...(rounds || []).map(round => round.round),
        ...deathsByRound.keys(),
        ...elimByRound.keys()
    ])].filter(r => r > 0).sort((a, b) => a - b);

    const profiles = roundNumbers.map(roundNumber => {
        const round = roundMap.get(roundNumber) || {
            round: roundNumber, sequenceStart: null, sequenceEnd: null,
            engagements: 0, commanderLosses: 0, byCamp: {}
        };
        const campEntries = Object.entries(round.byCamp || {});
        const totalDamage = campEntries.reduce((sum, [, camp]) => sum + finiteNumber(camp.damageTaken), 0);
        const totalLosses = campEntries.reduce((sum, [, camp]) => sum + finiteNumber(camp.losses), 0);
        const captures = campEntries.reduce((sum, [, camp]) => sum + finiteNumber(camp.captures), 0);
        const commanderDeaths = deathsByRound.get(roundNumber) || [];
        const commanderLosses = Math.max(finiteNumber(round.commanderLosses), commanderDeaths.length);
        const capturesList = capturesByRound.get(roundNumber) || [];
        const elimVictims = elimByRound.get(roundNumber) || [];
        const eliminations = elimVictims.map(victimCampKey => ({
            victimCampKey,
            finisherCampKey: resolveEliminationFinisher(
                victimCampKey,
                round,
                capturesList,
                commanderDeaths,
                unitKillsByRound.get(roundNumber)
            )
        }));
        const turningPoint = turningByRound.get(roundNumber) || null;
        // 交战次数只能描述“打得多不多”，不能识别战线崩溃。阵亡、占城与将领
        // 陨落都是不可逆成果，必须比普通对射获得更高权重。
        const battleScore = finiteNumber(round.engagements)
            + totalDamage / 100
            + totalLosses * 2.5
            + captures * 4.5
            + commanderLosses * 3.5;
        return {
            round, campEntries, totalDamage, totalLosses, captures, commanderLosses,
            commanderDeaths, capturesList, eliminations, turningPoint, battleScore
        };
    });

    const activeRounds = profiles.filter(profile => profile.battleScore > 0);
    if (activeRounds.length === 0 && profiles.every(p => p.eliminations.length === 0 && p.commanderDeaths.length === 0)) {
        return [];
    }
    const values = activeRounds.map(profile => profile.battleScore);
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const variance = values.length ? values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length : 0;
    const deviation = Math.sqrt(variance);
    const sorted = [...values].sort((left, right) => left - right);
    const p75 = percentile(sorted, 0.75);
    const p85 = percentile(sorted, 0.85);
    // 兼顾小样本数学上界 (z <= sqrt(n - 1)) 与长局高门槛筛选，只保留少数真正的转折性战役回合。
    const zScale = Math.min(1.15, Math.sqrt(Math.max(1, activeRounds.length - 1)) * 0.72);
    const strictThreshold = Math.max(p85, mean + deviation * zScale);
    const breakthroughThreshold = Math.max(p75, mean + deviation * Math.min(0.7, zScale));
    const peak = values.length ? Math.max(...values) : 1;

    const milestoneRounds = profiles.filter(profile =>
        profile.eliminations.length > 0
        || profile.commanderDeaths.length > 0
        || profile.turningPoint != null
    );
    const milestoneSet = new Set(milestoneRounds.map(profile => profile.round.round));

    const maxCombatEvents = Math.max(1, Math.min(5, Math.round(activeRounds.length * 0.2)));
    const combatCandidates = activeRounds.filter(profile => {
        if (milestoneSet.has(profile.round.round)) return false;
        const majorBreakthrough = (profile.captures >= 2 && profile.totalLosses >= 3)
            || (profile.captures >= 1 && profile.totalLosses >= 5);
        const majorCollapse = profile.totalLosses >= 6 && profile.commanderLosses >= 1;
        if (profile.battleScore <= mean) return false;
        return profile.battleScore >= strictThreshold
            || ((majorBreakthrough || majorCollapse) && profile.battleScore >= breakthroughThreshold);
    });

    // 短中盘若硬里程碑（如1次将领陨落）已占去唯一高分位，仍补充1场最高烈度的非里程碑巅峰决战（仅6回合以上对局）
    let pickedCombat = [...combatCandidates]
        .sort((left, right) => right.battleScore - left.battleScore || left.round.round - right.round.round)
        .slice(0, Math.max(1, maxCombatEvents - Math.floor(milestoneRounds.length * 0.4)));
    if (!pickedCombat.length && milestoneRounds.length > 0 && activeRounds.length >= 6) {
        const bestNonMilestone = activeRounds
            .filter(profile => !milestoneSet.has(profile.round.round) && profile.battleScore > mean * 1.15)
            .sort((left, right) => right.battleScore - left.battleScore || left.round.round - right.round.round)[0];
        if (bestNonMilestone) pickedCombat = [bestNonMilestone];
    }

    const combined = [...milestoneRounds, ...pickedCombat];
    const maxTotal = Math.max(maxCombatEvents, Math.min(9, Math.max(milestoneRounds.length + 2, Math.round(activeRounds.length * 0.35))));
    const selected = combined
        .sort((left, right) => {
            const leftPriority = left.eliminations.length * 3 + left.commanderDeaths.length * 2 + (left.turningPoint ? 1.5 : 0);
            const rightPriority = right.eliminations.length * 3 + right.commanderDeaths.length * 2 + (right.turningPoint ? 1.5 : 0);
            if (leftPriority !== rightPriority) return rightPriority - leftPriority;
            return right.battleScore - left.battleScore || left.round.round - right.round.round;
        })
        .slice(0, maxTotal)
        .sort((left, right) => left.round.round - right.round.round);

    return selected.map(profile => {
        const {
            round, campEntries, totalDamage, totalLosses, captures,
            commanderLosses, commanderDeaths, capturesList, eliminations, turningPoint, battleScore
        } = profile;
        const leading = [...campEntries].sort(([, left], [, right]) =>
            finiteNumber(right.damageDealt) - finiteNumber(left.damageDealt)
            || finiteNumber(right.kills) - finiteNumber(left.kills)
        )[0];
        const belligerents = selectMainBelligerents(round.byCamp);
        const intensity = peak > mean ? (battleScore - mean) / (peak - mean) : 1;

        let eventType = 'pitchedBattle';
        let label = '巅峰决战';
        if (eliminations.length > 0) {
            eventType = 'factionEliminated';
            label = '势力覆灭';
        } else if (commanderDeaths.length > 0 || commanderLosses > 0) {
            eventType = 'commanderFall';
            label = '将领陨落';
        } else if (captures > 0 && (totalLosses >= 2 || captures >= 2)) {
            eventType = 'breakthrough';
            label = '战线突破';
        } else if (turningPoint) {
            eventType = 'turningPoint';
            label = '局势转折';
        }

        return {
            round: round.round,
            sequenceStart: round.sequenceStart,
            sequenceEnd: round.sequenceEnd,
            eventType,
            engagements: finiteNumber(round.engagements),
            totalDamage,
            totalLosses,
            captures,
            commanderLosses,
            battleScore,
            leadingCampKey: leading?.[0] || null,
            leadingDamage: finiteNumber(leading?.[1]?.damageDealt),
            belligerents,
            commanderDeaths,
            capturesList,
            eliminations,
            turningPoint,
            intensity: Math.max(0, Math.min(1, intensity)),
            label
        };
    });
}

function controlSnapshot(round, sequence, units, sites, participants) {
    const campKeys = participants.map(participant => participant.campKey);
    const countedUnits = [...units.values()].filter(unit => campKeys.includes(unit.campKey));
    const countedCities = [...sites.values()].filter(site => site.kind === 'city' && campKeys.includes(site.campKey));
    const totalUnits = countedUnits.length;
    const totalLandUnits = countedUnits.filter(unit => !NAVAL_UNIT_TYPES.has(unit.type)).length;
    const totalNavalUnits = countedUnits.filter(unit => NAVAL_UNIT_TYPES.has(unit.type)).length;
    const totalCities = countedCities.length;
    const byCamp = {};
    for (const campKey of campKeys) {
        const unitCount = countedUnits.filter(unit => unit.campKey === campKey).length;
        const landUnits = countedUnits.filter(unit =>
            unit.campKey === campKey && !NAVAL_UNIT_TYPES.has(unit.type)).length;
        const navalUnits = countedUnits.filter(unit =>
            unit.campKey === campKey && NAVAL_UNIT_TYPES.has(unit.type)).length;
        const cityCount = countedCities.filter(site => site.campKey === campKey).length;
        const unitShare = totalUnits > 0 ? unitCount / totalUnits : 0;
        const cityShare = totalCities > 0 ? cityCount / totalCities : 0;
        byCamp[campKey] = {
            units: unitCount,
            landUnits,
            navalUnits,
            cities: cityCount,
            unitShare,
            landUnitShare: totalUnits > 0 ? landUnits / totalUnits : 0,
            navalUnitShare: totalUnits > 0 ? navalUnits / totalUnits : 0,
            cityShare,
            // 综合控制让单位与城市两个维度等权，避免单位数量天然淹没城市控制变化。
            controlShare: totalUnits > 0 && totalCities > 0
                ? (unitShare + cityShare) / 2
                : (totalUnits > 0 ? unitShare : cityShare)
        };
    }
    return { round, sequence, totalUnits, totalLandUnits, totalNavalUnits, totalCities, byCamp };
}

function buildControlTimeline(log, participants) {
    const units = new Map((log.initialState?.units || []).map(unit => [unitCatalogKey(unit.id), { ...unit }]));
    const sites = new Map((log.initialState?.sites || []).map(site => [site.key, { ...site }]));
    const timeline = [controlSnapshot(0, 0, units, sites, participants)];
    let currentRound = null;
    let lastSequence = 0;

    const applyActionChanges = changes => {
        for (const unit of changes?.unitsAdded || []) units.set(unitCatalogKey(unit.id), { ...unit });
        for (const unit of changes?.unitsRemoved || []) units.delete(unitCatalogKey(unit.id));
        for (const changed of changes?.unitState || []) {
            const unit = units.get(unitCatalogKey(changed.unitId));
            const campKey = changed.changes?.campKey?.after;
            if (unit && campKey) unit.campKey = campKey;
        }
        for (const changed of changes?.sitesChanged || []) {
            const site = sites.get(changed.site);
            const campKey = changed.changes?.campKey?.after;
            if (site && campKey) site.campKey = campKey;
        }
    };
    const closeRound = () => {
        if (currentRound == null) return;
        timeline.push(controlSnapshot(currentRound, lastSequence, units, sites, participants));
    };

    for (const item of log.timeline || []) {
        const itemRound = normalizedRound(item);
        if (currentRound == null) currentRound = itemRound;
        // 延迟伤害/动画事件可能在新回合开始后才以旧 round 入列；不能因此让控制曲线倒退并重复同一回合。
        if (itemRound > currentRound) {
            closeRound();
            currentRound = itemRound;
        }
        if (item.kind === 'action') {
            applyActionChanges(item.outcome?.changes);
        } else if (item.eventType === 'unitKilled' && item.payload?.unitId) {
            units.delete(unitCatalogKey(item.payload.unitId));
        } else if (item.eventType === 'cityCaptured') {
            const payload = item.payload || {};
            const site = [...sites.values()].find(candidate =>
                candidate.kind === 'city'
                && ((candidate.q === payload.q && candidate.r === payload.r)
                    || (payload.districtId != null && candidate.districtId === payload.districtId))
            );
            if (site && payload.campKey) site.campKey = payload.campKey;
        }
        lastSequence = item.sequence || lastSequence;
    }
    closeRound();

    // 结束快照是权威结果；补正任何未经过普通 action diff 的战役脚本变化。
    if (log.finalState) {
        const finalUnits = new Map((log.finalState.units || []).map(unit => [unitCatalogKey(unit.id), { ...unit }]));
        const finalSites = new Map((log.finalState.sites || []).map(site => [site.key, { ...site }]));
        const finalRound = Math.max(1, finiteNumber(log.finalState.round) || currentRound || 1);
        const authoritative = controlSnapshot(finalRound, lastSequence, finalUnits, finalSites, participants);
        const previous = timeline[timeline.length - 1];
        if (previous?.round === finalRound) timeline[timeline.length - 1] = authoritative;
        else timeline.push(authoritative);
    }
    return timeline;
}

export function buildMatchStats(log) {
    if (!log || !Array.isArray(log.timeline)) return null;

    const participants = (log.participants || []).map(participant => ({
        ...participant,
        campKey: participant.campKey ?? participant.id
    }));
    const participantsByKey = Object.fromEntries(participants.map(participant => [participant.campKey, participant]));
    const initialUnits = log.initialState?.units || [];
    const finalUnits = log.finalState?.units || [];
    const initialSites = log.initialState?.sites || [];
    const finalSites = log.finalState?.sites || [];
    const { catalog, finalIds } = collectUnitCatalog(log);

    const campsByKey = {};
    for (const participant of participants) {
        const campKey = participant.campKey;
        campsByKey[campKey] = {
            campKey,
            name: participant.name || campKey,
            controller: participant.controller || 'unknown',
            colorId: participant.colorId || null,
            color: participant.color || null,
            flagEmoji: participant.flagEmoji || null,
            flagPreset: participant.flagPreset || inferHistoricalFlagPreset(participant, log.mode),
            flagUrl: participant.flagUrl || null,
            flagConfig: participant.flagConfig || null,
            ...(participant.neutralThemeId ? {
                neutralThemeId: participant.neutralThemeId,
                neutralThemePeriod: participant.neutralThemePeriod || null,
                flagUrl: participant.flagUrl || null
            } : {}),
            ...emptyCombatStats(),
            initialForce: forceSnapshot(initialUnits, campKey),
            finalForce: forceSnapshot(finalUnits, campKey),
            initialCities: campSiteCount(initialSites, campKey, 'city'),
            finalCities: campSiteCount(finalSites, campKey, 'city'),
            initialGold: finiteNumber((log.initialState?.resources?.[campKey] ?? log.initialState?.camps?.[campKey])?.gold),
            finalGold: finiteNumber((log.finalState?.resources?.[campKey] ?? log.finalState?.camps?.[campKey])?.gold),
            unattributedDamage: 0
        };
    }

    const unitStats = new Map();
    const getUnit = (unitId, fallback = {}) => {
        if (!unitId) return null;
        const parsedAirfield = parseAirfieldEntityId(unitId);
        const key = unitCatalogKey(unitId);
        if (!catalog.has(key)) {
            catalog.set(key, {
                id: unitId,
                type: fallback.type || (parsedAirfield ? 'airfield' : 'unknown'),
                campKey: fallback.campKey || parsedAirfield?.campKey || null,
                commanderId: null,
                isCommanderUnit: false,
                maxHp: 0,
                initialHp: 0,
                finalHp: null
            });
        }
        if (!unitStats.has(key)) {
            const unit = catalog.get(key);
            unitStats.set(key, {
                ...unit,
                displayName: unitDisplayName(unit),
                ...emptyCombatStats(),
                deaths: 0,
                survived: false,
                firstSequence: null,
                lastSequence: null
            });
        }
        return unitStats.get(key);
    };
    for (const unit of catalog.values()) getUnit(unit.id);

    const roundsByNumber = new Map();
    const getRound = item => {
        const round = normalizedRound(item);
        if (!roundsByNumber.has(round)) {
            roundsByNumber.set(round, {
                round,
                sequenceStart: item.sequence || null,
                sequenceEnd: item.sequence || null,
                engagements: 0,
                commanderLosses: 0,
                byCamp: Object.fromEntries(participants.map(participant => [
                    participant.campKey,
                    emptyCombatStats()
                ]))
            });
        }
        const entry = roundsByNumber.get(round);
        entry.sequenceStart ??= item.sequence || null;
        entry.sequenceEnd = item.sequence || entry.sequenceEnd;
        return entry;
    };
    const touchUnit = (unit, item) => {
        if (!unit) return;
        unit.firstSequence ??= item.sequence || null;
        unit.lastSequence = item.sequence || unit.lastSequence;
    };
    const addCampMetric = (campKey, round, metric, amount = 1) => {
        if (!campKey || !campsByKey[campKey]) return;
        campsByKey[campKey][metric] += amount;
        if (round.byCamp[campKey]) round.byCamp[campKey][metric] += amount;
    };

    const liveSites = initialSites.map(site => ({ ...site }));
    const liveSiteByKey = new Map(liveSites.map(site => [site.key, site]));
    const findLiveSite = (payload = {}) => {
        if (payload.site && liveSiteByKey.has(payload.site)) return liveSiteByKey.get(payload.site);
        return liveSites.find(candidate => candidate.kind === 'city'
            && ((payload.q != null && payload.r != null && candidate.q === payload.q && candidate.r === payload.r)
                || (payload.districtId != null && candidate.districtId === payload.districtId))) || null;
    };
    const unitKillsByRound = new Map();
    const keyEvents = [];
    const factionSkillEvents = [];
    const commanderDeathEvents = [];
    for (const item of log.timeline) {
        const round = getRound(item);
        if (item.kind === 'action') {
            if (item.accepted === false) continue;
            addCampMetric(item.actorCampKey, round, 'actions');
            const bucket = ACTION_BUCKETS[item.actionType];
            if (bucket) addCampMetric(item.actorCampKey, round, bucket);
            if (item.actionType === 'attack') round.engagements++;
            const airUnitId = item.actionType === 'airCommand'
                ? (item.payload?.sourceUnitId
                    || (item.payload?.launcherQ != null && item.payload?.launcherR != null && item.actorCampKey
                        ? makeAirfieldEntityId(item.payload.launcherQ, item.payload.launcherR, item.actorCampKey)
                        : null))
                : null;
            const unitId = item.payload?.attackerUnitId || item.payload?.unitId || airUnitId || null;
            const unit = getUnit(unitId, {
                type: item.payload?.attackerType || item.payload?.sourceUnitType || (parseAirfieldEntityId(unitId) ? 'airfield' : undefined),
                campKey: item.actorCampKey
            });
            if (unit) {
                unit.actions++;
                if (bucket) unit[bucket]++;
                if (item.actionType === 'airCommand' && item.payload?.kind === 'airdrop') {
                    unit.recruits++;
                }
                touchUnit(unit, item);
            }
            for (const changed of item.outcome?.changes?.sitesChanged || []) {
                const site = liveSiteByKey.get(changed.site);
                const campKey = changed.changes?.campKey?.after;
                if (site && campKey) site.campKey = campKey;
            }
            continue;
        }

        const payload = item.payload || {};
        if (item.eventType === 'unitHpChanged') {
            const delta = finiteNumber(payload.delta);
            const target = getUnit(payload.unitId, { type: payload.unitType, campKey: payload.campKey });
            const source = getUnit(payload.sourceUnitId, {
                type: payload.sourceUnitType || (parseAirfieldEntityId(payload.sourceUnitId) ? 'airfield' : undefined),
                campKey: payload.sourceCampKey
            });
            touchUnit(target, item);
            touchUnit(source, item);
            if (delta < 0) {
                const damage = -delta;
                if (target) target.damageTaken += damage;
                addCampMetric(payload.campKey, round, 'damageTaken', damage);
                if (payload.sourceCampKey) {
                    if (source) source.damageDealt += damage;
                    addCampMetric(payload.sourceCampKey, round, 'damageDealt', damage);
                } else if (campsByKey[payload.campKey]) {
                    campsByKey[payload.campKey].unattributedDamage += damage;
                }
            } else if (delta > 0) {
                if (target) target.healingReceived += delta;
                addCampMetric(payload.campKey, round, 'healingReceived', delta);
                if (payload.sourceCampKey) {
                    if (source) source.healingDone += delta;
                    addCampMetric(payload.sourceCampKey, round, 'healingDone', delta);
                }
            }
        } else if (item.eventType === 'unitKilled') {
            const defeated = getUnit(payload.unitId, { type: payload.unitType, campKey: payload.campKey });
            const killer = getUnit(payload.killerId, { type: payload.killerType, campKey: payload.killerCampKey });
            if (defeated) {
                defeated.deaths++;
                touchUnit(defeated, item);
            }
            if (killer) {
                killer.kills++;
                touchUnit(killer, item);
            }
            addCampMetric(payload.campKey, round, 'losses');
            if (payload.killerCampKey) addCampMetric(payload.killerCampKey, round, 'kills');
            if (!unitKillsByRound.has(round.round)) unitKillsByRound.set(round.round, []);
            unitKillsByRound.get(round.round).push({
                victimCampKey: payload.campKey || defeated?.campKey || null,
                killerCampKey: payload.killerCampKey || killer?.campKey || null
            });
            if (defeated?.commanderId || payload.commanderId) {
                round.commanderLosses++;
                const commanderId = defeated?.commanderId || payload.commanderId;
                commanderDeathEvents.push({
                    sequence: item.sequence,
                    round: round.round,
                    campKey: payload.campKey || defeated?.campKey || null,
                    unitId: payload.unitId || defeated?.id || null,
                    unitType: payload.unitType || defeated?.type || null,
                    commanderId,
                    commanderName: COMMANDER_CONFIG[commanderId]?.definition?.name || commanderId,
                    displayName: unitDisplayName({
                        type: payload.unitType || defeated?.type,
                        commanderId,
                        isCommanderUnit: true
                    }),
                    killerCampKey: payload.killerCampKey || null
                });
            }
            keyEvents.push({
                sequence: item.sequence,
                round: round.round,
                type: item.eventType,
                campKey: payload.killerCampKey || payload.campKey || null,
                label: keyEventLabel(item, participantsByKey)
            });
        } else if (item.eventType === 'cityCaptured') {
            addCampMetric(payload.campKey, round, 'captures');
            const attacker = getUnit(payload.attackerUnitId, { campKey: payload.campKey });
            if (attacker) {
                attacker.captures++;
                touchUnit(attacker, item);
            }
            const capturedSite = findLiveSite(payload);
            const previousCampKey = capturedSite?.campKey && capturedSite.campKey !== payload.campKey
                ? capturedSite.campKey
                : null;
            if (capturedSite && payload.campKey) capturedSite.campKey = payload.campKey;
            const districtId = payload.districtId ?? capturedSite?.districtId ?? null;
            keyEvents.push({
                sequence: item.sequence,
                round: round.round,
                type: item.eventType,
                campKey: payload.campKey || null,
                ...(districtId != null ? { districtId } : {}),
                ...(previousCampKey ? { previousCampKey } : {}),
                label: keyEventLabel(item, participantsByKey)
            });
        } else if (item.eventType === 'factionSkillActivated') {
            const event = {
                sequence: item.sequence,
                round: round.round,
                campKey: payload.campKey || null,
                synergyId: payload.synergyId || null,
                skillName: payload.skillName || '阵营技能',
                triggerKind: payload.triggerKind || null,
                logoEmoji: payload.logoEmoji || participantsByKey[payload.campKey]?.flagEmoji || '⚑',
                presentationEventId: payload.presentationEventId || null,
                label: keyEventLabel(item, participantsByKey)
            };
            factionSkillEvents.push(event);
            keyEvents.push({ ...event, type: item.eventType });
        } else if (['objectiveChanged', 'diplomacyChanged', 'interactionCompleted'].includes(item.eventType)) {
            keyEvents.push({
                sequence: item.sequence,
                round: round.round,
                type: item.eventType,
                campKey: payload.campKey || null,
                label: keyEventLabel(item, participantsByKey)
            });
        }
    }

    const finalSiteOwnerByCoord = new Map(
        finalSites
            .filter(site => site?.kind === 'city' && Number.isFinite(site.q) && Number.isFinite(site.r))
            .map(site => [`${site.q},${site.r}`, site.campKey || null])
    );
    const units = [...unitStats.values()].map(unit => {
        const parsedAirfield = unit.type === 'airfield' ? parseAirfieldEntityId(unit.id) : null;
        let survived = finalIds.has(unitCatalogKey(unit.id));
        if (parsedAirfield) {
            const coordKey = `${parsedAirfield.q},${parsedAirfield.r}`;
            survived = finalSiteOwnerByCoord.has(coordKey)
                ? finalSiteOwnerByCoord.get(coordKey) === unit.campKey
                : null;
        }
        return {
            ...unit,
            survived,
            finalHp: catalog.get(unitCatalogKey(unit.id))?.finalHp ?? null
        };
    });
    const camps = attachCampRatings(Object.values(campsByKey).map(camp => ({
        ...camp,
        killDeathRatio: camp.losses > 0 ? camp.kills / camp.losses : camp.kills,
        damagePerAttack: camp.attacks > 0 ? camp.damageDealt / camp.attacks : 0,
        forceDelta: camp.finalForce.units - camp.initialForce.units,
        cityDelta: camp.finalCities - camp.initialCities
    })), log.result?.winnerCampKey || null);
    const mvpUnits = selectMvpUnits(units, 3);
    const rounds = [...roundsByNumber.values()].sort((left, right) => left.round - right.round);
    const controlTimeline = buildControlTimeline(log, participants);
    const battleEvents = identifyBattleEvents(rounds, {
        controlTimeline,
        commanderDeathEvents,
        keyEvents,
        unitKillsByRound
    });

    return {
        matchId: log.matchId || null,
        complete: !!log.complete,
        durationMs: resolveDurationMs(log),
        result: log.result || null,
        mode: log.mode || null,
        totalActions: camps.reduce((sum, camp) => sum + camp.actions, 0),
        totalDamage: camps.reduce((sum, camp) => sum + camp.damageTaken, 0),
        totalHealing: camps.reduce((sum, camp) => sum + camp.healingReceived, 0),
        totalKills: camps.reduce((sum, camp) => sum + camp.kills, 0),
        totalLosses: camps.reduce((sum, camp) => sum + camp.losses, 0),
        camps,
        units,
        mvpUnits,
        rounds,
        controlTimeline,
        battleEvents,
        factionSkillEvents,
        commanderDeathEvents,
        keyEvents,
        leaders: {
            kills: leader(units, 'kills'),
            damageDealt: leader(units, 'damageDealt'),
            damageTaken: leader(units, 'damageTaken'),
            healingReceived: leader(units, 'healingReceived'),
            healingDone: leader(units, 'healingDone')
        },
        methodology: {
            damage: '伤害以 unitHpChanged 的实际生命变化计算，不使用攻击面板或动画展示值。',
            attribution: '仅当日志含 sourceUnitId/sourceCampKey 时计入造成伤害；环境与无来源规则伤害只计入承受伤害。',
            healing: '“恢复量”指单位实际获得的生命值，不包含溢出治疗。',
            control: '综合控制为单位占比与城市占比的等权平均；图表可切换查看两个原始口径。',
            unitShare: '单位占比为该回合结束时阵营存活单位数占全场存活单位数的比例；同一阵营以深色（原色）表示陆军、浅色表示海军。',
            cityShare: '城市占比为该回合结束时阵营控制城市数占全场城市数的比例。',
            battleEvents: '战役事件融合势力覆灭、将领陨落、战线突破、局势转折与自适应阈值巅峰决战，聚焦核心交战阵营。'
        }
    };
}

function unitFromReview(unit) {
    if (!unit) return null;
    const id = unit.id ?? unit.unitId;
    const type = unit.type ?? unit.unitType;
    let commanderId = unit.commanderId || null;
    if (!commanderId && typeof unit.displayName === 'string' && unit.displayName.includes(' · ')) {
        const suffixName = unit.displayName.split(' · ').at(-1)?.trim();
        if (suffixName && COMMANDER_NAME_TO_ID[suffixName]) commanderId = COMMANDER_NAME_TO_ID[suffixName];
    }
    const needsRelocalize = !unit.displayName
        || (type && (UNIT_TYPE_NAMES[type] || UNIT_CONFIG[type]?.name) && String(unit.displayName).startsWith(String(type)));
    return {
        ...unit,
        id,
        type,
        commanderId,
        displayName: needsRelocalize
            ? unitDisplayName({
                id,
                type,
                commanderId,
                isCommanderUnit: unit.isCommanderUnit ?? Boolean(commanderId),
                specializationKey: unit.specializationKey
            })
            : unit.displayName
    };
}

export function buildMatchStatsDocument(document) {
    if (!document || typeof document !== 'object') return null;
    if (document.schema === 'blades-of-hex.match-review') {
        if (!document.overview || !Array.isArray(document.controlTimeline) || !Array.isArray(document.roundIndex)) {
            return null;
        }
        const participantsByKey = Object.fromEntries(
            (Array.isArray(document.participants) ? document.participants : []).map(participant => [participant.campKey, participant])
        );
        const camps = attachCampRatings((Array.isArray(document.overview.camps) ? document.overview.camps : []).map(camp => {
            const campKey = camp.campKey ?? camp.id;
            const participant = participantsByKey[campKey];
            const merged = {
                ...camp,
                campKey,
                colorId: camp.colorId || participant?.colorId || null,
                color: camp.color || participant?.color || null,
                flagEmoji: camp.flagEmoji || participant?.flagEmoji || null,
                flagPreset: camp.flagPreset || participant?.flagPreset || null,
                flagUrl: camp.flagUrl || participant?.flagUrl || null,
                flagConfig: camp.flagConfig || participant?.flagConfig || null,
                neutralThemeId: camp.neutralThemeId || participant?.neutralThemeId || null,
                neutralThemePeriod: camp.neutralThemePeriod || participant?.neutralThemePeriod || null
            };
            merged.flagPreset = merged.flagPreset || inferHistoricalFlagPreset(merged, document.mode);
            return merged;
        }), document.result?.winnerCampKey || null);
        const units = (document.unitHighlights || []).map(unitFromReview);
        const mvpUnits = selectMvpUnits(units, 3);
        const hasRoundMetrics = document.roundIndex.some(round => round?.byCamp && Object.keys(round.byCamp).length > 0);
        const battleEvents = hasRoundMetrics
            ? identifyBattleEvents(document.roundIndex, {
                controlTimeline: document.controlTimeline,
                commanderDeathEvents: document.commanderDeathEvents || [],
                keyEvents: document.keyEvents || []
            })
            : (document.battleEvents || []);
        const rawMethodology = document.methodology || {};
        const methodology = {
            ...rawMethodology,
            unitShare: '单位占比为该回合结束时阵营存活单位数占全场存活单位数的比例；同一阵营以深色（原色）表示陆军、浅色表示海军。',
            battleEvents: '战役事件融合势力覆灭、将领陨落、战线突破、局势转折与自适应阈值巅峰决战，聚焦核心交战阵营。'
        };
        return {
            matchId: document.matchId || null,
            complete: !!document.complete,
            durationMs: resolveDurationMs(document),
            result: document.result || null,
            mode: document.mode || null,
            totalActions: finiteNumber(document.overview.totalActions),
            totalDamage: finiteNumber(document.overview.totalDamage),
            totalHealing: finiteNumber(document.overview.totalHealing ?? camps.reduce((sum, camp) => sum + finiteNumber(camp.healingReceived), 0)),
            totalKills: camps.reduce((sum, camp) => sum + finiteNumber(camp.kills), 0),
            totalLosses: finiteNumber(document.overview.totalLosses),
            camps,
            units,
            mvpUnits,
            rounds: document.roundIndex,
            controlTimeline: document.controlTimeline,
            battleEvents,
            factionSkillEvents: document.factionSkillEvents || [],
            commanderDeathEvents: document.commanderDeathEvents || [],
            keyEvents: document.keyEvents || [],
            leaders: Object.fromEntries(Object.entries(document.overview.leaders || {})
                .map(([metric, unit]) => [metric, unitFromReview(unit)])),
            methodology,
            importedFromReview: true
        };
    }
    if (document.schema === 'blades-of-hex.match-log') return buildMatchStats(document);
    return null;
}

export function isReplayableMatchLog(log) {
    return Boolean(
        log
        && log.schema === 'blades-of-hex.match-log'
        && log.initialState
        && Array.isArray(log.timeline)
    );
}
