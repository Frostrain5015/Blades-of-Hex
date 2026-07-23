// 对局日志的纯数据统计层。
// 不依赖 DOM，也不读取实时 gameState，确保结算页、自动测试和未来的复盘工具使用同一套口径。

const ACTION_BUCKETS = Object.freeze({
    move: 'moves',
    attack: 'attacks',
    recruit: 'recruits',
    reinforce: 'reinforcements',
    repairShip: 'reinforcements',
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
    infantry: '步兵',
    cavalry: '骑兵',
    archer: '炮兵',
    mgNest: '碉堡',
    drone: '天眼哨机',
    shoreBattery: '岸防炮',
    destroyer: '驱逐舰',
    warship: '巡洋舰',
    submarine: '潜艇',
    carrier: '航母'
});

const emptyCombatStats = () => ({
    actions: 0,
    moves: 0,
    attacks: 0,
    recruits: 0,
    reinforcements: 0,
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

function normalizedRound(item) {
    return Math.max(1, Math.floor(finiteNumber(item?.round) || 1));
}

function unitDisplayName(unit) {
    const typeName = UNIT_TYPE_NAMES[unit.type] || unit.type || '未知单位';
    const suffix = unit.isCommanderUnit ? ' · 将领' : '';
    return `${typeName}${suffix}`;
}

function collectUnitCatalog(log) {
    const catalog = new Map();
    const remember = raw => {
        if (!raw?.id) return null;
        const previous = catalog.get(raw.id) || {};
        const unit = {
            id: raw.id,
            type: raw.type || previous.type || 'unknown',
            campKey: raw.campKey || previous.campKey || null,
            commanderId: raw.commanderId ?? previous.commanderId ?? null,
            isCommanderUnit: raw.isCommanderUnit ?? previous.isCommanderUnit ?? false,
            maxHp: finiteNumber(raw.maxHp || previous.maxHp),
            initialHp: previous.initialHp ?? finiteNumber(raw.hp),
            finalHp: previous.finalHp ?? null
        };
        catalog.set(unit.id, unit);
        return unit;
    };

    for (const unit of log.initialState?.units || []) remember(unit);
    for (const item of log.timeline || []) {
        for (const unit of item.outcome?.changes?.unitsAdded || []) remember(unit);
        if (item.kind !== 'event') continue;
        const payload = item.payload || {};
        if (payload.unitId) remember({
            id: payload.unitId,
            type: payload.unitType,
            campKey: payload.campKey
        });
        if (payload.killerId) remember({
            id: payload.killerId,
            type: payload.killerType,
            campKey: payload.killerCampKey
        });
    }
    const finalIds = new Set();
    for (const unit of log.finalState?.units || []) {
        const known = remember(unit);
        if (known) {
            known.finalHp = finiteNumber(unit.hp);
            finalIds.add(known.id);
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
        const defeated = UNIT_TYPE_NAMES[payload.unitType] || payload.unitType || '单位';
        const killer = UNIT_TYPE_NAMES[payload.killerType] || payload.killerType || '未知来源';
        return `${participantsByKey[payload.killerCampKey]?.name || '未知阵营'}的${killer}击毁${participantsByKey[payload.campKey]?.name || '未知阵营'}的${defeated}`;
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

function identifyBattleEvents(rounds) {
    const activeRounds = rounds.filter(round => round.engagements > 0);
    if (activeRounds.length < 2) return [];
    const values = activeRounds.map(round => round.engagements);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
    const deviation = Math.sqrt(variance);
    if (deviation === 0) return [];

    const sorted = [...values].sort((left, right) => left - right);
    const upperQuartile = percentile(sorted, 0.75);
    const threshold = Math.max(upperQuartile, mean + deviation * 0.5);
    const peak = Math.max(...values);
    return activeRounds
        .filter(round => round.engagements >= threshold && round.engagements > mean)
        .map(round => {
            const campEntries = Object.entries(round.byCamp);
            const leading = campEntries.sort(([, left], [, right]) =>
                right.damageDealt - left.damageDealt || right.kills - left.kills
            )[0];
            const totalDamage = campEntries.reduce((sum, [, camp]) => sum + camp.damageTaken, 0);
            const totalLosses = campEntries.reduce((sum, [, camp]) => sum + camp.losses, 0);
            const captures = campEntries.reduce((sum, [, camp]) => sum + camp.captures, 0);
            const intensity = peak > mean ? (round.engagements - mean) / (peak - mean) : 0;
            return {
                round: round.round,
                sequenceStart: round.sequenceStart,
                sequenceEnd: round.sequenceEnd,
                engagements: round.engagements,
                totalDamage,
                totalLosses,
                captures,
                leadingCampKey: leading?.[0] || null,
                intensity: Math.max(0, Math.min(1, intensity)),
                label: intensity >= 0.8 ? '主战役' : '激烈交战'
            };
        });
}

function controlSnapshot(round, sequence, units, sites, participants) {
    const campKeys = participants.map(participant => participant.campKey);
    const countedUnits = [...units.values()].filter(unit => campKeys.includes(unit.campKey));
    const countedCities = [...sites.values()].filter(site => site.kind === 'city' && campKeys.includes(site.campKey));
    const totalUnits = countedUnits.length;
    const totalCities = countedCities.length;
    const byCamp = {};
    for (const campKey of campKeys) {
        const unitCount = countedUnits.filter(unit => unit.campKey === campKey).length;
        const cityCount = countedCities.filter(site => site.campKey === campKey).length;
        const unitShare = totalUnits > 0 ? unitCount / totalUnits : 0;
        const cityShare = totalCities > 0 ? cityCount / totalCities : 0;
        byCamp[campKey] = {
            units: unitCount,
            cities: cityCount,
            unitShare,
            cityShare,
            // 综合控制让单位与城市两个维度等权，避免单位数量天然淹没城市控制变化。
            controlShare: totalUnits > 0 && totalCities > 0
                ? (unitShare + cityShare) / 2
                : (totalUnits > 0 ? unitShare : cityShare)
        };
    }
    return { round, sequence, totalUnits, totalCities, byCamp };
}

function buildControlTimeline(log, participants) {
    const units = new Map((log.initialState?.units || []).map(unit => [unit.id, { ...unit }]));
    const sites = new Map((log.initialState?.sites || []).map(site => [site.key, { ...site }]));
    const timeline = [controlSnapshot(0, 0, units, sites, participants)];
    let currentRound = null;
    let lastSequence = 0;

    const applyActionChanges = changes => {
        for (const unit of changes?.unitsAdded || []) units.set(unit.id, { ...unit });
        for (const unit of changes?.unitsRemoved || []) units.delete(unit.id);
        for (const changed of changes?.unitState || []) {
            const unit = units.get(changed.unitId);
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
            units.delete(item.payload.unitId);
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
        const finalUnits = new Map((log.finalState.units || []).map(unit => [unit.id, { ...unit }]));
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

    const participants = (log.participants || []).map(participant => ({ ...participant }));
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
            flagEmoji: participant.flagEmoji || null,
            ...emptyCombatStats(),
            initialForce: forceSnapshot(initialUnits, campKey),
            finalForce: forceSnapshot(finalUnits, campKey),
            initialCities: campSiteCount(initialSites, campKey, 'city'),
            finalCities: campSiteCount(finalSites, campKey, 'city'),
            initialGold: finiteNumber(log.initialState?.resources?.[campKey]?.gold),
            finalGold: finiteNumber(log.finalState?.resources?.[campKey]?.gold),
            unattributedDamage: 0
        };
    }

    const unitStats = new Map();
    const getUnit = (unitId, fallback = {}) => {
        if (!unitId) return null;
        if (!catalog.has(unitId)) {
            catalog.set(unitId, {
                id: unitId,
                type: fallback.type || 'unknown',
                campKey: fallback.campKey || null,
                commanderId: null,
                isCommanderUnit: false,
                maxHp: 0,
                initialHp: 0,
                finalHp: null
            });
        }
        if (!unitStats.has(unitId)) {
            const unit = catalog.get(unitId);
            unitStats.set(unitId, {
                ...unit,
                displayName: unitDisplayName(unit),
                ...emptyCombatStats(),
                deaths: 0,
                survived: false,
                firstSequence: null,
                lastSequence: null
            });
        }
        return unitStats.get(unitId);
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

    const keyEvents = [];
    const factionSkillEvents = [];
    for (const item of log.timeline) {
        const round = getRound(item);
        if (item.kind === 'action') {
            if (item.accepted === false) continue;
            addCampMetric(item.actorCampKey, round, 'actions');
            const bucket = ACTION_BUCKETS[item.actionType];
            if (bucket) addCampMetric(item.actorCampKey, round, bucket);
            if (item.actionType === 'attack') round.engagements++;
            const unitId = item.payload?.attackerUnitId || item.payload?.unitId || null;
            const unit = getUnit(unitId, {
                type: item.payload?.attackerType,
                campKey: item.actorCampKey
            });
            if (unit) {
                unit.actions++;
                if (bucket) unit[bucket]++;
                touchUnit(unit, item);
            }
            continue;
        }

        const payload = item.payload || {};
        if (item.eventType === 'unitHpChanged') {
            const delta = finiteNumber(payload.delta);
            const target = getUnit(payload.unitId, { type: payload.unitType, campKey: payload.campKey });
            const source = getUnit(payload.sourceUnitId, { campKey: payload.sourceCampKey });
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
            keyEvents.push({
                sequence: item.sequence,
                round: round.round,
                type: item.eventType,
                campKey: payload.campKey || null,
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

    const units = [...unitStats.values()].map(unit => ({
        ...unit,
        survived: finalIds.has(unit.id),
        finalHp: catalog.get(unit.id)?.finalHp ?? null
    }));
    const camps = Object.values(campsByKey).map(camp => ({
        ...camp,
        killDeathRatio: camp.losses > 0 ? camp.kills / camp.losses : camp.kills,
        damagePerAttack: camp.attacks > 0 ? camp.damageDealt / camp.attacks : 0,
        forceDelta: camp.finalForce.units - camp.initialForce.units,
        cityDelta: camp.finalCities - camp.initialCities
    }));
    const rounds = [...roundsByNumber.values()].sort((left, right) => left.round - right.round);
    const controlTimeline = buildControlTimeline(log, participants);
    const battleEvents = identifyBattleEvents(rounds);

    return {
        matchId: log.matchId || null,
        complete: !!log.complete,
        durationMs: finiteNumber(log.durationMs),
        result: log.result || null,
        mode: log.mode || null,
        totalActions: camps.reduce((sum, camp) => sum + camp.actions, 0),
        totalDamage: camps.reduce((sum, camp) => sum + camp.damageTaken, 0),
        totalKills: camps.reduce((sum, camp) => sum + camp.kills, 0),
        totalLosses: camps.reduce((sum, camp) => sum + camp.losses, 0),
        camps,
        units,
        rounds,
        controlTimeline,
        battleEvents,
        factionSkillEvents,
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
            unitShare: '单位占比为该回合结束时阵营存活单位数占全场存活单位数的比例。',
            cityShare: '城市占比为该回合结束时阵营控制城市数占全场城市数的比例。',
            battleEvents: '战役事件阈值由本局各回合交战次数的上四分位数、均值和标准差自适应计算，不使用固定次数。'
        }
    };
}

function unitFromReview(unit) {
    if (!unit) return null;
    return {
        ...unit,
        id: unit.id ?? unit.unitId,
        type: unit.type ?? unit.unitType
    };
}

export function buildMatchStatsDocument(document) {
    if (!document || typeof document !== 'object') return null;
    if (document.schema === 'blades-of-hex.match-review') {
        if (!document.overview || !Array.isArray(document.controlTimeline) || !Array.isArray(document.roundIndex)) {
            return null;
        }
        const camps = Array.isArray(document.overview.camps) ? document.overview.camps : [];
        const units = (document.unitHighlights || []).map(unitFromReview);
        return {
            matchId: document.matchId || null,
            complete: !!document.complete,
            durationMs: finiteNumber(document.durationMs),
            result: document.result || null,
            mode: document.mode || null,
            totalActions: finiteNumber(document.overview.totalActions),
            totalDamage: finiteNumber(document.overview.totalDamage),
            totalKills: camps.reduce((sum, camp) => sum + finiteNumber(camp.kills), 0),
            totalLosses: finiteNumber(document.overview.totalLosses),
            camps,
            units,
            rounds: document.roundIndex,
            controlTimeline: document.controlTimeline,
            battleEvents: document.battleEvents || [],
            factionSkillEvents: document.factionSkillEvents || [],
            keyEvents: document.keyEvents || [],
            leaders: Object.fromEntries(Object.entries(document.overview.leaders || {})
                .map(([metric, unit]) => [metric, unitFromReview(unit)])),
            methodology: document.methodology || {},
            importedFromReview: true
        };
    }
    if (document.schema === 'blades-of-hex.match-log') return buildMatchStats(document);
    return null;
}
