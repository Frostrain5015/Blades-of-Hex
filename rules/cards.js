// rules/cards.js — 对策卡与空军上校专属卡：文字、图标、目标类型、平衡数值与执行逻辑。
// 卡牌的数值说明由 balance 派生，禁止在描述里重复写伤害、回合或金币数字。
// 执行函数只操作传入的对局状态（targetTile/gameState/helpers），不访问 DOM。

import { deepFreeze } from './freeze.js';
import { percent, rangeText } from './format.js';
import { EMOJI } from './symbols.js';
import { UNIT_CONFIG } from './units.js';
import { campToKey } from './camps.js';
import { getRoundIndex } from './turns.js';
import { isWaterTile } from './surfaces.js';

export const TACTICAL_CARD_DATA = (() => {
    const cards = {
        heal: { id: 'heal', name: '疗愈', icon: EMOJI.cards.heal, targeting: 'anyUnit', balance: { healMaxHpPct: 0.40 } },
        lightning: { id: 'lightning', name: '雷击', icon: EMOJI.cards.lightning, targeting: 'enemyGlobal', balance: { minDamage: 40, maxDamage: 60, rainMultiplier: 1.5 } },
        mgNest: { id: 'mgNest', name: '碉堡', icon: EMOJI.cards.mgNest, targeting: 'emptyFriendlyNonCity' },
        airdrop: { id: 'airdrop', name: '空降', icon: EMOJI.cards.airdrop, targeting: 'emptyTile', balance: { infantryHp: 100 } },
        imprison: { id: 'imprison', name: '禁锢', icon: EMOJI.cards.imprison, targeting: 'enemyGlobal', desc: '【禁锢】\n对指定敌方单位释放，使其下回合无法移动' },
        forceMarch: { id: 'forceMarch', name: '强行军', icon: EMOJI.cards.forceMarch, targeting: 'friendlyAny', balance: { movementPoints: 2 } },
        scout: { id: 'scout', name: '侦察', icon: EMOJI.cards.scout, targeting: 'anyTileGlobal', balance: { duration: 3 } },
        airstrike: { id: 'airstrike', name: '空袭', icon: EMOJI.cards.airstrike, targeting: 'enemyGlobal', balance: { minDamage: 35, maxDamage: 50, forestMultiplier: 0.8, cityDisableRounds: 2 } },
        shield: { id: 'shield', name: '护盾', icon: EMOJI.cards.shield, targeting: 'shieldTarget', balance: { shield: 50, duration: 3 } },
        landmine: { id: 'landmine', name: '地雷', icon: EMOJI.cards.landmine, targeting: 'emptyFriendlyLandmine', desc: '【地雷】\n在己方空地部署地雷，敌方单位经过时触发造成伤害' },
        poison: { id: 'poison', name: '投毒', icon: '☣️', targeting: 'anyUnit', balance: { ticks: 3, damageMaxHpPct: 0.15 } },
        commanderDeploy: { id: 'commanderDeploy', name: '部署将领', icon: EMOJI.cards.commanderDeploy, targeting: 'friendlyAny', desc: '【部署将领】\n将所选将领挂载到指定己方单位上' }
    };
    cards.heal.desc = `【疗愈】\n对指定单位释放，立即恢复其${percent(cards.heal.balance.healMaxHpPct)}最大生命值`;
    cards.lightning.desc = `【雷击】\n对指定敌方单位造成${rangeText(cards.lightning.balance.minDamage, cards.lightning.balance.maxDamage)}真实伤害，雨天伤害提高${percent(cards.lightning.balance.rainMultiplier - 1)}`;
    cards.mgNest.desc = `【碉堡】\n在指定己方行政区空地部署一座碉堡\nHP=${UNIT_CONFIG.mgNest.hp} ATK=${UNIT_CONFIG.mgNest.attack} 射程=${UNIT_CONFIG.mgNest.range} 不可移动`;
    cards.airdrop.desc = `【空降】\n在指定空地投放一支${cards.airdrop.balance.infantryHp}生命值的空降步兵`;
    cards.forceMarch.desc = `【强行军】\n对指定己方单位释放，立即回复${cards.forceMarch.balance.movementPoints}点行动力`;
    cards.scout.desc = `【侦察】\n对指定位置释放，揭示目标及其周围6格区域的战争迷雾，持续${cards.scout.balance.duration}回合`;
    cards.airstrike.desc = `【空袭】\n对指定敌方目标及周边6格造成${rangeText(cards.airstrike.balance.minDamage, cards.airstrike.balance.maxDamage)}范围伤害，命中城市时其${cards.airstrike.balance.cityDisableRounds}回合内无法产出资源或招募部队`;
    cards.shield.desc = `【护盾】\n对指定目标释放，使其获得${cards.shield.balance.shield}点护盾值，持续${cards.shield.balance.duration}回合`;
    cards.poison.desc = `【投毒】\n使任意可见单位中毒；在其所属阵营回合开始流失${percent(cards.poison.balance.damageMaxHpPct)}最大生命，持续${cards.poison.balance.ticks}次并会传播至相邻单位`;
    return deepFreeze(cards);
})();

export const COLONEL_CARD_DATA = (() => {
    const data = {
        goldCost: { diveStrafe: 3, carpetBomb: 4, airlift: 4 },
        range: 6,
        antiairRadius: 2,
        airDamagePerStack: 0.05,
        maxAirDamageStacks: 6,
        diveStrafe: {
            id: 'diveStrafe', name: '扫射', icon: EMOJI.cards.diveStrafe, targeting: 'enemyGlobal',
            balance: { attackMultiplier: 1.5, missingHpToAttackPct: 0.10, maxMissingHpAttack: 15 }
        },
        carpetBomb: {
            id: 'carpetBomb', name: '轰炸', icon: EMOJI.cards.carpetBomb, targeting: 'enemyGlobal',
            balance: { centerMultiplier: 1, splashMultiplier: 0.6, ignoreDefense: 0.10 }
        },
        airlift: { id: 'airlift', name: '空运', icon: EMOJI.cards.airlift, targeting: 'friendlyAny' }
    };
    data.diveStrafe.desc = `【扫射】$${data.goldCost.diveStrafe}\n对指定单体目标造成伤害；附加等同于目标已损生命值${percent(data.diveStrafe.balance.missingHpToAttackPct)}的攻击力（最多+${data.diveStrafe.balance.maxMissingHpAttack}），再按标准伤害流程结算`;
    data.carpetBomb.desc = `【轰炸】$${data.goldCost.carpetBomb}\n对指定单体目标及相邻6格造成范围伤害（中心${percent(data.carpetBomb.balance.centerMultiplier)}/溅射${percent(data.carpetBomb.balance.splashMultiplier)}，破甲${percent(data.carpetBomb.balance.ignoreDefense)}）`;
    data.airlift.desc = `【空运】$${data.goldCost.airlift}\n运送一名自己以外的友军单位至已探索空地`;
    return deepFreeze(data);
})();

/** 空军卡金币消耗（取代旧燃料机制）。 */
export const COLONEL_CARD_GOLD = COLONEL_CARD_DATA.goldCost;

// ==== 标准对策卡执行逻辑 ====================
export const TACTICAL_CARD_CONFIG = deepFreeze({
    heal: {
        ...TACTICAL_CARD_DATA.heal,
        execute(targetTile, gameState, helpers) {
            const unit = targetTile.unit;
            const healAmt = Math.round(unit.maxHp * TACTICAL_CARD_DATA.heal.balance.healMaxHpPct);
            const oldHp = unit.hp;
            const maxHeal = Math.min(unit.maxHp - oldHp, healAmt);
            return { healAmt: maxHeal, purifiedPoison: !!unit._poison, targetTile };
        }
    },
    lightning: {
        ...TACTICAL_CARD_DATA.lightning,
        execute(targetTile, gameState, helpers) {
            const balance = TACTICAL_CARD_DATA.lightning.balance;
            let dmg = gameState.rng.between(balance.minDamage, balance.maxDamage);
            if (gameState.weather === 'rain') dmg = Math.floor(dmg * balance.rainMultiplier);
            // 预演扣血：调用方随即回滚，真正结算延迟走 Unit.applyDamage（勿改用 applyDamage，否则击杀无法回滚）
            targetTile.unit.hp = Math.max(0, targetTile.unit.hp - dmg);
            return { dmg, targetTile };
        }
    },
    mgNest: {
        ...TACTICAL_CARD_DATA.mgNest,
        execute(targetTile, gameState, helpers) {
            const myCamp = helpers.getMyCamp();
            const UnitClass = helpers.Unit;
            const nest = new UnitClass('mgNest', myCamp, targetTile, false);
            nest.hp = UNIT_CONFIG.mgNest.hp; nest.maxHp = UNIT_CONFIG.mgNest.hp; nest.displayHp = UNIT_CONFIG.mgNest.hp;
            nest._isImmobile = true;
            nest.canAct = false; // cannot act on deploy turn
            return { deployed: true, tileQ: targetTile.q, tileR: targetTile.r };
        }
    },
    airdrop: {
        ...TACTICAL_CARD_DATA.airdrop,
        execute(targetTile, gameState, helpers) {
            const myCamp = helpers.getMyCamp();
            const { applyAADropHP } = helpers;
            const UnitClass = helpers.Unit;
            const inf = new UnitClass('infantry', myCamp, targetTile, false);
            const hp = TACTICAL_CARD_DATA.airdrop.balance.infantryHp;
            inf.maxHp = hp; inf.hp = hp; inf.displayHp = hp;
            // 通用防空接口：每层-25%当前生命值（上限不变）
            applyAADropHP(inf, targetTile, myCamp, gameState.tileMap);
            inf.canAct = false; // cannot act on drop turn
            return { deployed: true, tileQ: targetTile.q, tileR: targetTile.r };
        }
    },
    imprison: {
        ...TACTICAL_CARD_DATA.imprison,
        execute(targetTile, gameState, helpers) {
            targetTile.unit._imprisoned = true;
            return { imprisoned: true, targetTile };
        }
    },
    forceMarch: {
        ...TACTICAL_CARD_DATA.forceMarch,
        execute(targetTile, gameState, helpers) {
            targetTile.unit.remainingMP += TACTICAL_CARD_DATA.forceMarch.balance.movementPoints;
            targetTile.unit.canAct = true;
            return { forceMarch: true, targetTile };
        }
    },
    scout: {
        ...TACTICAL_CARD_DATA.scout,
        execute(targetTile, gameState, helpers) {
            return { scoutQ: targetTile.q, scoutR: targetTile.r };
        }
    },
    airstrike: {
        ...TACTICAL_CARD_DATA.airstrike,
        execute(targetTile, gameState, helpers) {
            const balance = TACTICAL_CARD_DATA.airstrike.balance;
            const dmgBase = gameState.rng.between(balance.minDamage, balance.maxDamage);
            const results = [];
            const { applyAADefense } = helpers;
            const dirs = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
            for (const [dq, dr] of dirs) {
                const ht = gameState.tileMap.get(`${targetTile.q + dq},${targetTile.r + dr}`);
                if (!ht) continue;
                const isCity = ht === targetTile;
                let dmg = dmgBase;
                // 森林掩蔽：对空军+20%防御
                if (ht.terrain === 'forest') dmg = Math.round(dmg * balance.forestMultiplier);
                // 通用防空接口：每层减伤25%
                dmg = applyAADefense(dmg, ht, helpers.getMyCamp(), gameState.tileMap);
                if (ht.unit) {
                    // 预演扣血（含护盾）：调用方随即回滚，真正结算延迟走 Unit.applyDamage
                    // （勿改用 applyDamage，否则击杀无法回滚）
                    let remaining = dmg;
                    if (ht.unit._shield > 0) {
                        const absorbed = Math.min(ht.unit._shield, remaining);
                        ht.unit._shield -= absorbed;
                        remaining -= absorbed;
                    }
                    ht.unit.hp = Math.max(0, ht.unit.hp - remaining);
                    results.push({ q: ht.q, r: ht.r, dmg, killed: ht.unit.hp <= 0 });
                }
                if (isCity) {
                    // 城市瘫痪 2 回合：存储到期回合数(0-indexed)，active 判定 > 当前回合
                    ht._cityDisabledUntil = getRoundIndex(gameState) + balance.cityDisableRounds;
                }
            }
            return { airstrike: true, targetTile, results, dmgBase };
        }
    },
    shield: {
        ...TACTICAL_CARD_DATA.shield,
        execute(targetTile, gameState, helpers) {
            targetTile.unit._shield += TACTICAL_CARD_DATA.shield.balance.shield;
            targetTile.unit._shieldMax = Math.max(targetTile.unit._shieldMax, targetTile.unit._shield);
            targetTile.unit._shieldTurns = TACTICAL_CARD_DATA.shield.balance.duration;
            return { shielded: true, targetTile };
        }
    },
    landmine: {
        ...TACTICAL_CARD_DATA.landmine,
        execute(targetTile, gameState, helpers) {
            targetTile._minePlanted = true;
            targetTile._mineCampKey = helpers.getMyCamp ? campToKey(helpers.getMyCamp()) : 'player1';
            // surface 的合法值是 land/shallowWater/deepWater，不能与 'water' 直接比较
            targetTile._mineType = isWaterTile(targetTile) ? 'water' : 'land';
            return { landmine: true, mineType: targetTile._mineType, tileQ: targetTile.q, tileR: targetTile.r };
        }
    },
    poison: {
        ...TACTICAL_CARD_DATA.poison,
        execute(targetTile, gameState, helpers) {
            const target = targetTile.unit;
            if (!target || target._poison) return { poisoned: false, targetTile };
            target._poison = {
                remainingTicks: TACTICAL_CARD_DATA.poison.balance.ticks,
                sourceCampKey: helpers.getMyCamp ? campToKey(helpers.getMyCamp()) : null,
                infectedAtTurnCounter: gameState.turnCounter,
                lastResolvedTurnCounter: null
            };
            return { poisoned: true, targetTile };
        }
    },
    commanderDeploy: {
        ...TACTICAL_CARD_DATA.commanderDeploy,
        execute(targetTile, gameState, helpers) {
            const unitCamp = targetTile.unit.camp;
            const campKey = campToKey(unitCamp);
            const primaryKey = campKey === 'player1' ? 'commanderP1' : campKey === 'player2' ? 'commanderP2' : 'commanderP3';
            const secondaryKey = `${primaryKey}Secondary`;
            const cmdKey = helpers.deployCommanderId || gameState[primaryKey];
            if (!cmdKey || (targetTile.unit.isCommanderUnit ?? Boolean(targetTile.unit.commander))) return { deployed: false, commander: cmdKey };
            targetTile.unit.commander = cmdKey;
            targetTile.unit._cmdrAssignedAt = performance.now();
            const cmdCfg = helpers.getCommander(cmdKey);
            if (cmdCfg) {
                const u = targetTile.unit;
                const hpFlat = Math.round(u.config.hp * (cmdCfg.hpBonusPct || 0));
                const atkFlat = Math.round(u.config.attack * (cmdCfg.atkBonusPct || 0));
                u.hp += hpFlat;
                u.maxHp += hpFlat;
                u.displayHp = u.hp;
                u._atkBonus = (u._atkBonus || 0) + atkFlat;
                u.remainingMP += cmdCfg.spdBonus || 0;
                u.displaySpeed += cmdCfg.spdBonus || 0;
            }
            if (cmdCfg && cmdCfg.onDeploy) {
                cmdCfg.onDeploy(targetTile.unit, gameState, helpers);
            }
            const deployedKey = gameState[secondaryKey] === cmdKey
                ? `${secondaryKey}Deployed`
                : `${primaryKey}Deployed`;
            gameState[deployedKey] = true;
            return { deployed: true, commander: cmdKey };
        }
    }
});

// ==== E4 空军上校专属对策卡 ====================

// 找到某阵营存活的空军上校单位（空军卡伤害以其攻击力为基准走标准管线）
function _findColonel(gameState, camp) {
    for (const t of gameState.tiles) {
        if (t.unit && t.unit.commander === 'colonel' && t.unit.camp === camp && t.unit.hp > 0) return t.unit;
    }
    return null;
}

export const COLONEL_CARDS = deepFreeze({
    diveStrafe: {
        ...COLONEL_CARD_DATA.diveStrafe,
        execute(targetTile, gameState, helpers) {
            const colonel = _findColonel(gameState, helpers.getMyCamp());
            const target = targetTile.unit;
            if (!colonel || !target) return { dmg: 0, diveStrafe: true, targetTile };
            // 预演值：最终伤害由 gameLogic.executeTacticalCard 按通用空军增伤与已损生命攻击加成重算覆盖
            const r = colonel._resolveDamage(colonel, target, COLONEL_CARD_DATA.diveStrafe.balance.attackMultiplier, 0, false, false, true);
            return { dmg: Math.round(r.dmg), isCrit: r.isCrit, diveStrafe: true, targetTile };
        }
    },
    carpetBomb: {
        ...COLONEL_CARD_DATA.carpetBomb,
        execute(targetTile, gameState, helpers) {
            const colonel = _findColonel(gameState, helpers.getMyCamp());
            const dirs = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
            const results = [];
            for (const [dq, dr] of dirs) {
                const ht = gameState.tileMap ? gameState.tileMap.get(`${targetTile.q + dq},${targetTile.r + dr}`) : null;
                if (!ht || !ht.unit || !colonel) continue;
                const isCenter = dq === 0 && dr === 0;
                // 对群骚扰：中心50%、溅射35%攻击力，走标准管线
                const balance = COLONEL_CARD_DATA.carpetBomb.balance;
                const r = colonel._resolveDamage(colonel, ht.unit, isCenter ? balance.centerMultiplier : balance.splashMultiplier, 0, false, false, true);
                results.push({ q: ht.q, r: ht.r, dmg: Math.round(r.dmg), isCrit: r.isCrit, killed: false });
            }
            return { carpetBomb: true, targetTile, results };
        }
    },
    airlift: {
        ...COLONEL_CARD_DATA.airlift,
        execute(targetTile, gameState, helpers) {
            return { airlift: true, targetTile };
        }
    }
});
