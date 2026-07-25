// 卡牌层 —— 卡牌不是孤立的"有就打"，而是带预算与剧本的资源分配。
//
// 从真人录像归纳的三条纪律：
//   1. 稀缺伤害卡（雷击/禁锢）优先给"能占城的近战"，守钟姿态下只给占城威胁；
//   2. 多回合剧本：禁锢 → 下回合集火；强行军 → 当回合兑现夺城；
//   3. 抽牌要看机会成本：金币优先保证招募与紧急预留，答案缺口才值得抽。
//
// 输出分两组：setup（伤害/控制，先于攻击结算）与 sustain（恢复/防御，攻击后结算）。

import { TACTICAL_CARD_DATA } from '../../rules/cards.js';
import { W, hpGold, residualGold } from './weights.js';
import { enemyCapturerPremium } from './tactics.js';

const BAL = TACTICAL_CARD_DATA;

function expectedLightningDamage(weather) {
    const base = (BAL.lightning.balance.minDamage + BAL.lightning.balance.maxDamage) / 2;
    return weather === 'rain' ? base * BAL.lightning.balance.rainMultiplier : base;
}

function enemyValueOfTarget(world, target, extraDamage = 0) {
    const kills = extraDamage >= target.hp + (target._shield || 0);
    let value = extraDamage * hpGold(target);
    if (kills) value += residualGold(target) * W.killPremiumRatio + (target.commander ? W.commanderKillBonus : 0);
    return { value, kills };
}

/** 守钟姿态：控制/伤害卡是否允许打在该目标上。全场没有占城威胁时回退普通政策，
 * 否则对策卡会烂在手里（回归局：终局捏着碉堡水雷没用出去）。 */
function allowedByPolicy(world, strategy, target) {
    if (strategy.cardPolicy !== 'reserve-cc-for-capturers') return true;
    const anyCapturerVisible = world.rivalUnits.some(u => world.isCapturable(u));
    if (!anyCapturerVisible) return true;
    return world.isCapturable(target) && enemyCapturerPremium(world, target) > 0;
}

function visibleEnemies(world) {
    return [...world.rivalUnits, ...world.neutralUnits].filter(u => u.tile && u.hp > 0);
}

export function planCards(world, strategy, missionsCtx) {
    const setup = [];
    const sustain = [];
    if (world.cardUsesLeft <= 0) return { setup, sustain };
    let usesLeft = world.cardUsesLeft;
    const hand = [...world.hand];
    const has = card => hand.includes(card);
    const spend = (bucket, action) => {
        if (usesLeft <= 0) return false;
        bucket.push(action);
        usesLeft--;
        return true;
    };
    const enemies = visibleEnemies(world);
    const missionCriticalIds = new Set();
    for (const mission of missionsCtx.missions) {
        if (mission.occupierId != null) missionCriticalIds.add(mission.occupierId);
        if (mission.kind === 'siege') for (const id of mission.escortIds || []) missionCriticalIds.add(id);
    }
    // 反拆门规则：伤害卡打在无攻城任务的城市守军身上 = 替下一个路过的对手开门。
    const siegeTargets = new Set(missionsCtx.missions
        .filter(m => m.kind === 'siege')
        .map(m => `${m.targetQ},${m.targetR}`));
    const giftedDoor = target => {
        if (!target?.tile) return false;
        const city = world.cities.find(c => c.tile === target.tile);
        return !!city && city.hostile && !siegeTargets.has(`${target.tile.q},${target.tile.r}`);
    };

    // ── 雷击：占城威胁 > 斩杀 > 高价值 ─────────────────────────
    if (has('lightning')) {
        const damage = expectedLightningDamage(world.weather);
        let best = null;
        for (const target of enemies) {
            if (!allowedByPolicy(world, strategy, target) || giftedDoor(target)) continue;
            const { value, kills } = enemyValueOfTarget(world, target, damage);
            const premium = enemyCapturerPremium(world, target)
                + (target.commander ? 25 : 0)
                + ((target._rank || 0) >= 3 ? 40 : 0)
                + (kills ? 0 : -8);
            if (!best || value + premium > best.score) best = { target, score: value + premium };
        }
        if (best && best.score > 26) {
            spend(setup, { type: 'tacticalCard', cardId: 'lightning', targetId: best.target.id });
        }
    }

    // ── 投毒：打集群，期望含传播 ───────────────────────────────
    if (has('poison')) {
        let best = null;
        for (const target of enemies) {
            if (target._poison || giftedDoor(target)) continue;
            const perTick = Math.round(target.maxHp * BAL.poison.balance.damageMaxHpPct);
            let total = perTick * BAL.poison.balance.ticks * hpGold(target);
            let spread = 0;
            for (const other of enemies) {
                if (other.id === target.id) continue;
                if (world.helpers.hexDistance(other.tile, target.tile) <= 1) spread++;
            }
            total *= 1 + spread * 0.6;
            if (!best || total > best.score) best = { target, score: total };
        }
        if (best && best.score > 30) {
            spend(setup, { type: 'tacticalCard', cardId: 'poison', targetId: best.target.id });
        }
    }

    // ── 禁锢：守钟锁占城者；进攻锁"下回合要集火的王牌" ─────────
    if (has('imprison')) {
        let best = null;
        for (const target of enemies) {
            if (target._imprisoned || !allowedByPolicy(world, strategy, target)) continue;
            let score = enemyCapturerPremium(world, target) * 1.2;
            if (target.commander) score += 30;
            score += residualGold(target) * 0.3;
            if (!best || score > best.score) best = { target, score };
        }
        if (best && best.score > 30) {
            spend(setup, { type: 'tacticalCard', cardId: 'imprison', targetId: best.target.id });
        }
    }

    // ── 空袭/天基：打集群与高价值 ──────────────────────────────
    if (has('airstrike')) {
        const damage = (BAL.airstrike.balance.minDamage + BAL.airstrike.balance.maxDamage) / 2;
        let best = null;
        for (const target of enemies) {
            if (giftedDoor(target)) continue;
            let score = damage * hpGold(target);
            for (const other of enemies) {
                if (other.id !== target.id && world.helpers.hexDistance(other.tile, target.tile) <= 1) {
                    score += damage * hpGold(other);
                }
            }
            if (!best || score > best.score) best = { target, score };
        }
        if (best && best.score > 34) {
            spend(setup, { type: 'tacticalCard', cardId: 'airstrike', targetId: best.target.id });
        }
    }
    if (has('orbitalStrike')) {
        let best = null;
        for (const target of enemies) {
            if (giftedDoor(target)) continue;
            let score = BAL.orbitalStrike.balance.centerAttack * hpGold(target) * 0.8;
            if (target.commander) score += 40;
            for (const other of enemies) {
                if (other.id !== target.id && world.helpers.hexDistance(other.tile, target.tile) <= 1) {
                    score += BAL.orbitalStrike.balance.splashAttack * hpGold(other) * 0.6;
                }
            }
            if (!best || score > best.score) best = { target, score };
        }
        if (best && best.score > 30) {
            spend(setup, { type: 'tacticalCard', cardId: 'orbitalStrike', targetId: best.target.id });
        }
    }

    // ── 强行军：优先兑现夺城（占领者差一步进城），其次给任务关键单位 ──
    if (has('forceMarch')) {
        let best = null;
        for (const mission of missionsCtx.missions) {
            if (mission.kind !== 'siege') continue;
            const occupier = world.myUnits.find(u => u.id === mission.occupierId);
            const city = world.cities.find(c => c.tile.q === mission.targetQ && c.tile.r === mission.targetR);
            if (!occupier || !city || occupier.canAct) continue;
            if (!city.garrison && city.hp <= 0) {
                best = { unit: occupier, score: mission.cityValue };
                break;
            }
        }
        if (!best) {
            const exhausted = world.myUnits
                .filter(u => !u.canAct && (missionCriticalIds.has(u.id) || u.commander || u.type === 'cavalry'))
                .sort((a, b) => (missionCriticalIds.has(b.id) ? 200 : 0) + residualGold(b)
                    - ((missionCriticalIds.has(a.id) ? 200 : 0) + residualGold(a)));
            if (exhausted[0]) best = { unit: exhausted[0], score: 30 };
        }
        if (best) {
            spend(setup, { type: 'tacticalCard', cardId: 'forceMarch', targetId: best.unit.id });
        }
    }

    // ── 空降：死斗姿态的空降夺城/应急守城 ──────────────────────
    if (has('airdrop')) {
        let play = null;
        if (strategy.posture === 'allin') {
            for (const mission of missionsCtx.missions) {
                if (mission.kind !== 'siege') continue;
                const city = world.cities.find(c => c.tile.q === mission.targetQ && c.tile.r === mission.targetR);
                if (city && !city.garrison && city.hp <= 0) {
                    // 直接空投进空城 —— 当回合翻城。
                    play = { tileId: city.tile.id, score: mission.cityValue };
                    break;
                }
            }
        }
        if (!play) {
            const emptyHome = world.myCities.find(city => !city.unit && world.threatAt(city, null) > 0);
            if (emptyHome) play = { tileId: emptyHome.id, score: 55 };
        }
        if (play) {
            spend(setup, { type: 'tacticalCard', cardId: 'airdrop', targetId: play.tileId });
        }
    }

    // ── 侦察：信息龄期超阈值时揭示敌方最后已知区域 ─────────────
    if (has('scout') && world.fog && world.stalestRivalAge >= 3) {
        let best = null;
        for (const tile of world.tiles) {
            if (world.explored(tile)) continue;
            let unknown = 0;
            for (const [dq, dr] of world.helpers.HEX_NEIGHBORS) {
                const neighbor = world.tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                if (neighbor && !world.explored(neighbor)) unknown++;
            }
            if (!best || unknown > best.unknown) best = { tile, unknown };
        }
        if (best && best.unknown >= 3) {
            spend(setup, { type: 'tacticalCard', cardId: 'scout', targetId: best.tile.id });
        }
    }

    // ── 地雷/碉堡：守钟与防御姿态的航道封锁 ────────────────────
    if (has('landmine') && (strategy.posture === 'hold' || strategy.posture === 'defend')) {
        let best = null;
        for (const city of world.myCities) {
            for (const [dq, dr] of world.helpers.HEX_NEIGHBORS) {
                const tile = world.tileMap.get(`${city.q + dq},${city.r + dr}`);
                if (!tile || tile.unit || tile._minePlanted) continue;
                const threat = world.threatAt(tile, null);
                if (threat > 0 && (!best || threat > best.threat)) best = { tile, threat };
            }
        }
        if (best) {
            spend(sustain, { type: 'tacticalCard', cardId: 'landmine', targetId: best.tile.id });
        }
    }
    if (has('mgNest') && (strategy.posture === 'hold' || strategy.posture === 'defend')) {
        const city = world.myCities.find(c => world.threatAt(c, c.unit) > 20);
        const spot = city && world.helpers.HEX_NEIGHBORS
            .map(([dq, dr]) => world.tileMap.get(`${city.q + dq},${city.r + dr}`))
            .find(tile => tile && !tile.unit && !tile.isCity && !tile.isVillage);
        if (spot) {
            spend(sustain, { type: 'tacticalCard', cardId: 'mgNest', targetId: spot.id });
        }
    }

    // ── 疗愈/护盾：任务关键单位与旗舰优先 ──────────────────────
    if (has('heal')) {
        let best = null;
        for (const unit of world.myUnits) {
            const missing = unit.maxHp - unit.hp;
            if (missing < unit.maxHp * 0.25 && !unit._poison) continue;
            const healAmount = Math.min(missing, Math.round(unit.maxHp * BAL.heal.balance.healMaxHpPct));
            let score = healAmount * hpGold(unit);
            if (unit._poison) score += 30;
            if (missionCriticalIds.has(unit.id)) score += 40;
            if (unit.commander) score += 20;
            if (!best || score > best.score) best = { unit, score };
        }
        if (best && best.score > 22) {
            spend(sustain, { type: 'tacticalCard', cardId: 'heal', targetId: best.unit.id });
        }
    }
    if (has('shield')) {
        let best = null;
        for (const unit of world.myUnits) {
            const incoming = world.threatAt(unit.tile, unit);
            if (incoming < 15 && !missionCriticalIds.has(unit.id)) continue;
            let score = Math.min(BAL.shield.balance.shield, incoming * 2) * hpGold(unit);
            if (missionCriticalIds.has(unit.id)) score += 30;
            if (unit.commander) score += 18;
            if (!best || score > best.score) best = { unit, score };
        }
        if (best && best.score > 18) {
            spend(sustain, { type: 'tacticalCard', cardId: 'shield', targetId: best.unit.id });
        }
    }

    // ── 上校空军卡（有上校且付得起金币）────────────────────────
    const hasColonel = world.myUnits.some(u => u.commander === 'colonel');
    if (hasColonel && world.gold >= 3) {
        if (has('diveStrafe')) {
            let best = null;
            for (const target of enemies) {
                const damage = 45 * 1.5 + Math.min(15, (target.maxHp - target.hp) * 0.10);
                const { value } = enemyValueOfTarget(world, target, damage);
                const score = value + enemyCapturerPremium(world, target);
                if (!best || score > best.score) best = { target, score };
            }
            if (best && best.score > 30) {
                spend(setup, { type: 'tacticalCard', cardId: 'diveStrafe', targetId: best.target.id });
            }
        }
        if (has('carpetBomb') && world.gold >= 4) {
            let best = null;
            for (const target of enemies) {
                let score = 0;
                for (const other of enemies) {
                    const distance = world.helpers.hexDistance(other.tile, target.tile);
                    if (distance === 0) score += 45 * hpGold(other);
                    else if (distance === 1) score += 27 * hpGold(other);
                }
                if (!best || score > best.score) best = { target, score };
            }
            if (best && best.score > 40) {
                spend(setup, { type: 'tacticalCard', cardId: 'carpetBomb', targetId: best.target.id });
            }
        }
    }

    return { setup, sustain };
}

/** 抽牌决策：金币先保证招募与紧急预留，答案缺口（中毒无疗愈等）降低门槛。 */
export function shouldDrawCard(world, strategy, plannedRecruitSpend = 0) {
    if (world.cardDrawsLeft <= 0 || world.handFull) return false;
    const drawsDone = (world.cardConfig.maxDrawsPerTurn || 2) - world.cardDrawsLeft;
    const cost = (world.cardConfig.drawCost || 4) * (1 + drawsDone);
    const affordable = world.gold - cost - plannedRecruitSpend - strategy.reserve >= 0;
    if (!affordable) return false;
    const needsAnswer = (world.myUnits.some(u => u._poison) && !world.hand.includes('heal'))
        || (strategy.posture === 'hold' && !world.hand.some(c => c === 'lightning' || c === 'imprison'))
        || (strategy.posture === 'allin' && world.hand.length === 0);
    if (needsAnswer) return true;
    return world.gold - cost - plannedRecruitSpend - strategy.reserve >= 6;
}
