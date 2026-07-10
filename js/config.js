// ==== 运行时画布与几何 ====
// 可编辑的游戏数据放在 gameData.js；此文件仅保留运行时代码与兼容导出。
import {
    BOARD_RULES, UNIT_CONFIG, CAMP_DATA, CAMP_FLAG_COLORS, COUNTER_RELATION,
    TERRAIN_CONFIG, FORTIFICATION_CONFIG, MORALE_CONFIG, WEATHER_CONFIG,
    GAME_RULES, TACTICAL_CARD_DATA, COLONEL_CARD_DATA
} from './gameData.js';

export { UNIT_CONFIG, CAMP_FLAG_COLORS, COUNTER_RELATION, TERRAIN_CONFIG, FORTIFICATION_CONFIG, MORALE_CONFIG, WEATHER_CONFIG };

export const HEX_SIZE = BOARD_RULES.hexSize;
export const LOG_LIMIT = BOARD_RULES.logLimit;

export const canvas = document.getElementById('gameCanvas');
export const ctx = canvas.getContext('2d');
export const cardCanvas = document.getElementById('cardCanvas');
export const cardCtx = cardCanvas ? cardCanvas.getContext('2d') : null;

// 逻辑分辨率（所有游戏坐标基于此）
export const LOGICAL_W = BOARD_RULES.logicalWidth;
export const LOGICAL_H = BOARD_RULES.logicalHeight;

let dpr = 1;
export let HEX_WIDTH;
let HEX_HEIGHT;

export function initCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = LOGICAL_W * dpr;
    canvas.height = LOGICAL_H * dpr;
    canvas.style.width  = LOGICAL_W + 'px';
    canvas.style.height = LOGICAL_H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    HEX_WIDTH  = Math.sqrt(3) * HEX_SIZE;
    HEX_HEIGHT = 2 * HEX_SIZE;
}

export let boardDirty = true;
export function invalidateBoard() { boardDirty = true; }

// Shared frame timestamp so we don't call Date.now() dozens of times per frame
export const frameInfo = { now: performance.now() };

// ==== 工具函数 ====================

export function hexToRgb(hex) {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
        : { r: 0, g: 0, b: 0 };
}

export function rgbToHex(r, g, b) {
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Precomputed unit-hex vertex offsets (normalized, multiplied by size at call site)
const _HV = (() => {
    const v = [];
    for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * (i + 0.5);
        v.push({ x: Math.cos(a), y: Math.sin(a) });
    }
    return v;
})();

export function hexPath(ctx2d, cx, cy, size) {
    ctx2d.beginPath();
    const sx = _HV[0].x * size, sy = _HV[0].y * size;
    ctx2d.moveTo(cx + sx, cy + sy);
    for (let i = 1; i < 6; i++) {
        ctx2d.lineTo(cx + _HV[i].x * size, cy + _HV[i].y * size);
    }
    ctx2d.closePath();
}

// Return the two endpoints for a single hex edge (index 0..5)
export function hexEdge(cx, cy, size, edgeIdx) {
    const v0 = _HV[edgeIdx];
    const v1 = _HV[(edgeIdx + 1) % 6];
    return {
        x0: cx + v0.x * size, y0: cy + v0.y * size,
        x1: cx + v1.x * size, y1: cy + v1.y * size
    };
}

export function drawHexagonOutline(ctx2d, centerX, centerY, size, strokeStyle, lineWidth) {
    hexPath(ctx2d, centerX, centerY, size);
    ctx2d.strokeStyle = strokeStyle;
    ctx2d.lineWidth = lineWidth;
    ctx2d.stroke();
}

export function pulseSine(t, freq = 0.0025) { return (Math.sin(t * freq) + 1) / 2; }

export function roundRectPath(ctx2d, x, y, w, h, r) {
    ctx2d.beginPath();
    ctx2d.moveTo(x + r, y);
    ctx2d.lineTo(x + w - r, y);
    ctx2d.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx2d.lineTo(x + w, y + h - r);
    ctx2d.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx2d.lineTo(x + r, y + h);
    ctx2d.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx2d.lineTo(x, y + r);
    ctx2d.quadraticCurveTo(x, y, x + r, y);
    ctx2d.closePath();
}

export function hexDistance(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.s - b.s)) / 2;
}

// ==== 回合计数 =====================
// turnCounter 每切换一个阵营 +1（步）。1 回合 = 所有阵营各行动一次。
// factionCount 含中立：双人 3、三人 4。
// getFactionCount(): 一回合包含的阵营数（步数）
// getRound(): 当前回合数，1-indexed（用于 UI/文案/尚书产出等）
// getRoundIndex(): 当前回合数，0-indexed（用于内部到期比较）
export function getFactionCount(gameState) {
    return gameState.isThreePlayer ? 4 : 3;
}
export function getRoundIndex(gameState) {
    return Math.floor(gameState.turnCounter / getFactionCount(gameState));
}
export function getRound(gameState) {
    return getRoundIndex(gameState) + 1;
}

// Axial hex neighbor offsets (q, r)
export const HEX_NEIGHBORS = BOARD_RULES.hexNeighbors;

// 阵营对象在启动期创建一次，其他模块仍可按引用比较 CAMP.player1 等。
export const CAMP = CAMP_DATA;

export function campToKey(camp, mode = 'full') {
    if (camp === CAMP.player1) return mode === 'short' ? 'p1' : 'player1';
    if (camp === CAMP.player2) return mode === 'short' ? 'p2' : 'player2';
    if (camp === CAMP.player3) return mode === 'short' ? 'p3' : 'player3';
    return 'neutral';
}

// 兵种、旗帜、克制、地形与工事均从 gameData.js 兼容导出。


// ==== 村庄 ====================
export const VILLAGE_GOLD = GAME_RULES.villageGold;
export const VILLAGE_MIN_DIST = GAME_RULES.villageMinDistance;

// ==== 经济 ====================
// 收入公式：1城=4, 2城=4+3, 3城+=4+3+2*(n-2)
export function calcIncome(cityCount) {
    const income = GAME_RULES.income;
    if (cityCount >= 3) return income.firstCityGold + income.secondCityGold + (cityCount - 2) * income.additionalCityGold;
    if (cityCount === 2) return income.firstCityGold + income.secondCityGold;
    if (cityCount === 1) return income.firstCityGold;
    return 0;
}

// 选将洗牌换将成本：换将后初始资金置为$1（而非$4），洗过的不再扣钱
export const COMMANDER_REROLL_COST = GAME_RULES.commanderRerollCost;

// ==== 对策卡配置 ====================
export const TACTICAL_CARD_CONFIG = {
    heal: {
        ...TACTICAL_CARD_DATA.heal,
        execute(targetTile, gameState, helpers) {
            const unit = targetTile.unit;
            const healAmt = Math.round(unit.maxHp * TACTICAL_CARD_DATA.heal.balance.healMaxHpPct);
            const oldHp = unit.hp;
            const maxHeal = Math.min(unit.maxHp - oldHp, healAmt);
            return { healAmt: maxHeal, targetTile };
        }
    },
    lightning: {
        ...TACTICAL_CARD_DATA.lightning,
        execute(targetTile, gameState, helpers) {
            const balance = TACTICAL_CARD_DATA.lightning.balance;
            let dmg = gameState.rng
                ? gameState.rng.between(balance.minDamage, balance.maxDamage)
                : balance.minDamage + Math.floor(Math.random() * (balance.maxDamage - balance.minDamage + 1));
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
            const dmgBase = gameState.rng
                ? gameState.rng.between(balance.minDamage, balance.maxDamage)
                : balance.minDamage + Math.floor(Math.random() * (balance.maxDamage - balance.minDamage + 1));
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
            targetTile._mineCampKey = helpers.getMyCamp ? (helpers.getMyCamp() === CAMP.player1 ? 'p1' : helpers.getMyCamp() === CAMP.player2 ? 'p2' : 'p3') : 'p1';
            return { landmine: true, tileQ: targetTile.q, tileR: targetTile.r };
        }
    },
    commanderDeploy: {
        ...TACTICAL_CARD_DATA.commanderDeploy,
        execute(targetTile, gameState, helpers) {
            const unitCamp = targetTile.unit.camp;
            const primaryKey = unitCamp === CAMP.player1 ? 'commanderP1' : unitCamp === CAMP.player2 ? 'commanderP2' : 'commanderP3';
            const secondaryKey = `${primaryKey}Secondary`;
            const cmdKey = helpers.deployCommanderId || gameState[primaryKey];
            if (!cmdKey || targetTile.unit.commander) return { deployed: false, commander: cmdKey };
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
};

// ==== E4 空军上校专属对策卡 ====================

// 空军卡金币消耗（取代旧燃料机制）
export const COLONEL_CARD_GOLD = COLONEL_CARD_DATA.goldCost;

// 找到某阵营存活的空军上校单位（空军卡伤害以其攻击力为基准走标准管线）
function _findColonel(gameState, camp) {
    for (const t of gameState.tiles) {
        if (t.unit && t.unit.commander === 'colonel' && t.unit.camp === camp && t.unit.hp > 0) return t.unit;
    }
    return null;
}

export const COLONEL_CARDS = {
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
};

// ==== 对策卡牌堆组成 ====================
export const DECK_COMPOSITION = GAME_RULES.deckComposition;

// 遭遇战模式专用卡
export const SKIRMISH_EXTRAS = GAME_RULES.skirmishExtras;

// ==== 对策卡系统参数 ====================
export const CARD_SYSTEM_CONFIG = GAME_RULES.cardSystem;

export const WEATHER_CYCLE = GAME_RULES.weatherCycle;

// ==== 设置（通过 localStorage 持久化） ====================
const SETTINGS_KEY = 'bladesOfHex_settings';

const DEFAULT_SETTINGS = {
    animationSpeed: 1.0,
    particleDensity: 1.0,
    screenShake: true,
    turnFlash: true,
    soundEnabled: true,
    soundVolume: 0.7
};

export let settings = { ...DEFAULT_SETTINGS };

export function loadSettings() {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) {
            settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
        }
    } catch (e) {
        settings = { ...DEFAULT_SETTINGS };
    }
}

export function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { /* ignore */ }
}
