// ==== 核心配置与常量 ====
export const HEX_SIZE = 30;
export const LOG_LIMIT = 20;

export const canvas = document.getElementById('gameCanvas');
export const ctx = canvas.getContext('2d');
export const cardCanvas = document.getElementById('cardCanvas');
export const cardCtx = cardCanvas ? cardCanvas.getContext('2d') : null;

// 逻辑分辨率（所有游戏坐标基于此）
export const LOGICAL_W = 1000;
export const LOGICAL_H = 750;

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
export const HEX_NEIGHBORS = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]
];

// ==== 兵种配置 ====================
export const UNIT_CONFIG = {
    infantry: { name: '步', hp: 200, attack: 40, defense: 0.05, speed: 5, range: 1, cost: 8,  color: '#0a0a0a' },
    cavalry:  { name: '骑', hp: 150, attack: 50, defense: 0.05, speed: 8, range: 1, cost: 10, color: '#0a0a0a' },
    archer:   { name: '炮', hp: 100, attack: 60, defense: 0,    speed: 3, range: 2, cost: 12, color: '#0a0a0a' },
    mgNest:   { name: '碉堡', hp: 200, attack: 40, defense: 0.05, speed: 0, range: 2, cost: 0, color: '#8B7355' },
    drone:    { name: '无人机', hp: 75, attack: 30, defense: 0, speed: 8, range: 2, cost: 0, color: '#6bbcff' }
};

// ==== 阵营配置 ====================
export const CAMP = {
    player1: { name: '红军', color: '#ffaaaa', flag: '🔴' },
    player2: { name: '蓝军', color: '#aaaaff', flag: '🔵' },
    player3: { name: '绿军', color: '#aaffaa', flag: '🟢' },
    neutral: { name: '中立', color: '#c0c0c0', flag: '⚫' }
};

export function campToKey(camp, mode = 'full') {
    if (camp === CAMP.player1) return mode === 'short' ? 'p1' : 'player1';
    if (camp === CAMP.player2) return mode === 'short' ? 'p2' : 'player2';
    if (camp === CAMP.player3) return mode === 'short' ? 'p3' : 'player3';
    return 'neutral';
}

// Saturated flag colors shared by unit & city flags
export const CAMP_FLAG_COLORS = {
    p1: { main: '#d44040', dark: '#8b1a1a', light: '#f06060' },
    p2: { main: '#4060d0', dark: '#1a2a80', light: '#6080f0' },
    p3: { main: '#40a040', dark: '#1a601a', light: '#60d060' },
    neu: { main: '#777', dark: '#444', light: '#999' }
};

// ==== 克制关系 ====================
export const COUNTER_RELATION = {
    infantry: { archer: 0.75, cavalry: 1.25, infantry: 1, mgNest: 0.75, drone: 1 },
    archer:   { cavalry: 0.75, infantry: 1.25, archer: 1, mgNest: 1.25, drone: 1 },
    cavalry:  { infantry: 0.75, archer: 1.25, cavalry: 1, mgNest: 0.75, drone: 1 },
    mgNest:   { infantry: 1.25, archer: 0.75, cavalry: 1.25, mgNest: 1, drone: 1 },
    drone:    { infantry: 1.25, archer: 1, cavalry: 1, mgNest: 1, drone: 1 }
};

// ==== 地形配置 ====================
export const TERRAIN_CONFIG = {
    plains:   { name: '平原', defenseBonus: 0,    stepCost: 2, moveDesc: '',          icon: '',   iconFont: '' },
    forest:   { name: '森林', defenseBonus: 0.05, stepCost: 3, moveDesc: '部队移动较慢', icon: '🌲', iconFont: '13px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif' },
    mountain: { name: '山地', defenseBonus: 0.05, stepCost: 6, moveDesc: '部队移动缓慢', icon: '⛰', iconFont: '15px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif' }
};

// ==== 工事配置 ==============================================================
// 工事与基础地形叠加，不改变原有的移动消耗、森林掩蔽或城市/村庄功能。
export const FORTIFICATION_CONFIG = {
    trench: {
        name: '战壕',
        defenseBonus: 0.25,
        appliesTo: 'melee',            // 仅对近战攻击（步兵/骑兵）生效
        desc: '对近战攻击防御力提高25%',
        icon: '🚧',
        iconFont: '14px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'
    },
    flak: {
        name: '高射机枪',
        defenseBonus: 0.25,
        appliesTo: 'ranged',           // 对远程攻击（炮兵/碉堡）生效
        providesSelfAA: true,          // 遭空军攻击时视为拥有1层防空（仅覆盖自身1格）
        desc: '对远程攻击防御力提高25%',
        icon: '🔫',
        iconFont: '14px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'
    }
};


// ==== 村庄 ====================
export const VILLAGE_GOLD = 2;
export const VILLAGE_MIN_DIST = 3;

// ==== 经济 ====================
// 收入公式：1城=4, 2城=4+3, 3城+=4+3+2*(n-2)
export function calcIncome(cityCount) {
    if (cityCount >= 3) return 4 + 3 + (cityCount - 2) * 2;
    if (cityCount === 2) return 7;
    if (cityCount === 1) return 4;
    return 0;
}

// 选将洗牌换将成本：消耗全部初始资金（约首回合城市产出总额），首回合收入结算时清零封顶
export const COMMANDER_REROLL_COST = 10;

// ==== 士气配置 ====================
// 士气等级: 3=上升 2=正常 1=下降 0=混乱
// 士气增伤改为影响暴击浮动倍率（见 _calcFloat），防御力影响降低至5%
export const MORALE_CONFIG = {
    3: { name: '士气上升', dmgBonus: 0,     defBonus: 0.05,  icon: '▲', color: '#ffd700', desc: '暴击率提高15%，防御力提高5%' },
    2: { name: '正常',     dmgBonus: 0,     defBonus: 0,     icon: '',   color: '#aaa',    desc: '' },
    1: { name: '士气下降', dmgBonus: 0,     defBonus: -0.05, icon: '▼', color: '#b080e8', desc: '暴击率降低10%，防御力降低5%' },
    0: { name: '混乱',     dmgBonus: 0,     defBonus: -0.20, icon: '？', color: '#666',    desc: '无法行动，暴击率降低10%，防御力降低20%' }
};


// ==== 天气配置 ====================
export const WEATHER_CONFIG = {
    clear: { name: '晴', icon: '☀️', color: '#ffd700', desc: '无特殊效果' },
    rain:  { name: '雨',   icon: '🌧', color: '#5588cc', desc: '守城单位每回合恢复15%最大生命值 · 步兵守城防御+10% · 雷击伤害1.5倍 · 骑兵步耗+1、末步豁免失效' },
    fog:   { name: '雾',   icon: '🌫', color: '#bbccdd', desc: '炮兵射程−1 · 骑兵增伤+20% · 骑兵冲锋15%/格' },
    wind:  { name: '风',   icon: '💨', color: '#aaccaa', desc: '炮兵射程+1 · 炮兵增伤+20% · 步兵防御-15%' }
};

// ==== 对策卡配置 ====================
export const TACTICAL_CARD_CONFIG = {
    heal: {
        id: 'heal', name: '疗愈', icon: '💚',
        desc: '【疗愈】\n对指定单位释放，立即恢复其40%最大生命值',
        targeting: 'anyUnit',
        execute(targetTile, gameState, helpers) {
            const unit = targetTile.unit;
            const healAmt = Math.round(unit.maxHp * 0.4);
            const oldHp = unit.hp;
            const maxHeal = Math.min(unit.maxHp - oldHp, healAmt);
            return { healAmt: maxHeal, targetTile };
        }
    },
    lightning: {
        id: 'lightning', name: '雷击', icon: '⚡',
        desc: '【雷击】\n对指定敌方单位造成40~60真实伤害，雨天伤害提高100%',
        targeting: 'enemyGlobal',
        execute(targetTile, gameState, helpers) {
            let dmg = gameState.rng ? gameState.rng.between(40, 60) : 40 + Math.floor(Math.random() * 21);
            if (gameState.weather === 'rain') dmg = Math.floor(dmg * 1.5);
            // 预演扣血：调用方随即回滚，真正结算延迟走 Unit.applyDamage（勿改用 applyDamage，否则击杀无法回滚）
            targetTile.unit.hp = Math.max(0, targetTile.unit.hp - dmg);
            return { dmg, targetTile };
        }
    },
    mgNest: {
        id: 'mgNest', name: '碉堡', icon: '🏰',
        desc: '【碉堡】\n在指定己方行政区空地部署一座碉堡\nHP=200 ATK=40 射程=2 不可移动\n',
        targeting: 'emptyFriendlyNonCity',
        execute(targetTile, gameState, helpers) {
            const myCamp = helpers.getMyCamp();
            const UnitClass = helpers.Unit;
            const nest = new UnitClass('mgNest', myCamp, targetTile, false);
            nest.hp = 200; nest.maxHp = 200; nest.displayHp = 200;
            nest._isImmobile = true;
            nest.canAct = false; // cannot act on deploy turn
            return { deployed: true, tileQ: targetTile.q, tileR: targetTile.r };
        }
    },
    airdrop: {
        id: 'airdrop', name: '空降', icon: '🪂',
        desc: '【空降】\n在指定空地投放一支空降步兵\n',
        targeting: 'emptyTile',
        execute(targetTile, gameState, helpers) {
            const myCamp = helpers.getMyCamp();
            const { applyAADropHP } = helpers;
            const UnitClass = helpers.Unit;
            const inf = new UnitClass('infantry', myCamp, targetTile, false);
            inf.maxHp = 100; inf.hp = 100; inf.displayHp = 100;
            // 通用防空接口：每层-25%当前生命值（上限不变）
            applyAADropHP(inf, targetTile, myCamp, gameState.tileMap);
            inf.canAct = false; // cannot act on drop turn
            return { deployed: true, tileQ: targetTile.q, tileR: targetTile.r };
        }
    },
    imprison: {
        id: 'imprison', name: '禁锢', icon: '🔗',
        desc: '【禁锢】\n对指定敌方单位释放，使其下回合无法移动',
        targeting: 'enemyGlobal',
        execute(targetTile, gameState, helpers) {
            targetTile.unit._imprisoned = true;
            return { imprisoned: true, targetTile };
        }
    },
    forceMarch: {
        id: 'forceMarch', name: '强行军', icon: '🏃',
        desc: '【强行军】\n对指定己方单位释放，立即回复2点行动力',
        targeting: 'friendlyAny',
        execute(targetTile, gameState, helpers) {
            targetTile.unit.remainingMP += 2;
            targetTile.unit.canAct = true;
            return { forceMarch: true, targetTile };
        }
    },
    scout: {
        id: 'scout', name: '侦察', icon: '🔭',
        desc: '【侦察】\n对指定位置释放，\n揭示目标及其周围6格区域的战争迷雾，持续1回合',
        targeting: 'anyTileGlobal',
        execute(targetTile, gameState, helpers) {
            return { scoutQ: targetTile.q, scoutR: targetTile.r };
        }
    },
    airstrike: {
        id: 'airstrike', name: '空袭', icon: '✈️',
        desc: '【空袭】\n对指定敌方目标及周边6格造成35~50范围伤害，命中城市时其2回合内无法产出资源或招募部队',
        targeting: 'enemyGlobal',
        execute(targetTile, gameState, helpers) {
            const dmgBase = gameState.rng ? gameState.rng.between(35, 50) : 35 + Math.floor(Math.random() * 16);
            const results = [];
            const { applyAADefense } = helpers;
            const dirs = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
            for (const [dq, dr] of dirs) {
                const ht = gameState.tileMap.get(`${targetTile.q + dq},${targetTile.r + dr}`);
                if (!ht) continue;
                const isCity = ht === targetTile;
                let dmg = dmgBase;
                // 森林掩蔽：对空军+20%防御
                if (ht.terrain === 'forest') dmg = Math.round(dmg * 0.8);
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
                    ht._cityDisabledUntil = getRoundIndex(gameState) + 2;
                }
            }
            return { airstrike: true, targetTile, results, dmgBase };
        }
    },
    shield: {
        id: 'shield', name: '护盾', icon: '🛡️',
        desc: '【护盾】\n对指定目标释放，使其获得50点护盾值，持续3回合',
        targeting: 'shieldTarget',
        execute(targetTile, gameState, helpers) {
            targetTile.unit._shield += 50;
            targetTile.unit._shieldMax = Math.max(targetTile.unit._shieldMax, targetTile.unit._shield);
            targetTile.unit._shieldTurns = 3;
            return { shielded: true, targetTile };
        }
    },
    landmine: {
        id: 'landmine', name: '地雷', icon: '💣',
        desc: '【地雷】\n在己方空地部署地雷，敌方单位经过时触发造成伤害',
        targeting: 'emptyFriendlyLandmine',
        execute(targetTile, gameState, helpers) {
            targetTile._minePlanted = true;
            targetTile._mineCampKey = helpers.getMyCamp ? (helpers.getMyCamp() === CAMP.player1 ? 'p1' : helpers.getMyCamp() === CAMP.player2 ? 'p2' : 'p3') : 'p1';
            return { landmine: true, tileQ: targetTile.q, tileR: targetTile.r };
        }
    },
    commanderDeploy: {
        id: 'commanderDeploy', name: '部署将领', icon: '🎖️',
        desc: '【部署将领】\n将所选将领挂载到指定己方单位上\n',
        targeting: 'friendlyAny',
        execute(targetTile, gameState, helpers) {
            const unitCamp = targetTile.unit.camp;
            const cmdKey = unitCamp === CAMP.player1 ? gameState.commanderP1 : unitCamp === CAMP.player2 ? gameState.commanderP2 : gameState.commanderP3;
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
            if (unitCamp === CAMP.player1) gameState.commanderP1Deployed = true;
            else if (unitCamp === CAMP.player2) gameState.commanderP2Deployed = true;
            else gameState.commanderP3Deployed = true;
            return { deployed: true, commander: cmdKey };
        }
    }
};

// ==== E4 空军上校专属对策卡 ====================

// 空军卡金币消耗（取代旧燃料机制）
export const COLONEL_CARD_GOLD = { diveStrafe: 3, carpetBomb: 4, airlift: 4 };

// 找到某阵营存活的空军上校单位（空军卡伤害以其攻击力为基准走标准管线）
function _findColonel(gameState, camp) {
    for (const t of gameState.tiles) {
        if (t.unit && t.unit.commander === 'colonel' && t.unit.camp === camp && t.unit.hp > 0) return t.unit;
    }
    return null;
}

export const COLONEL_CARDS = {
    diveStrafe: {
        id: 'diveStrafe', name: '扫射', icon: '💥',
        desc: '【扫射】$3\n对指定单体目标造成伤害；目标生命值低于50%时额外无视其25%防御力',
        targeting: 'enemyGlobal',
        execute(targetTile, gameState, helpers) {
            const colonel = _findColonel(gameState, helpers.getMyCamp());
            const target = targetTile.unit;
            if (!colonel || !target) return { dmg: 0, diveStrafe: true, targetTile };
            // 预演值：最终伤害由 gameLogic.executeTacticalCard 按 通用空军增伤+条件破甲 重算覆盖
            const r = colonel._resolveDamage(colonel, target, 1.5, 0, false, false, true);
            return { dmg: Math.round(r.dmg), isCrit: r.isCrit, diveStrafe: true, targetTile };
        }
    },
    carpetBomb: {
        id: 'carpetBomb', name: '轰炸', icon: '💣',
        desc: '【轰炸】$4\n对指定单体目标及相邻6格造成范围伤害（中心60%/溅射35%，破甲10%）',
        targeting: 'enemyGlobal',
        execute(targetTile, gameState, helpers) {
            const colonel = _findColonel(gameState, helpers.getMyCamp());
            const dirs = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
            const results = [];
            for (const [dq, dr] of dirs) {
                const ht = gameState.tileMap ? gameState.tileMap.get(`${targetTile.q + dq},${targetTile.r + dr}`) : null;
                if (!ht || !ht.unit || !colonel) continue;
                const isCenter = dq === 0 && dr === 0;
                // 对群骚扰：中心50%、溅射35%攻击力，走标准管线
                const r = colonel._resolveDamage(colonel, ht.unit, isCenter ? 0.5 : 0.35, 0, false, false, true);
                results.push({ q: ht.q, r: ht.r, dmg: Math.round(r.dmg), isCrit: r.isCrit, killed: false });
            }
            return { carpetBomb: true, targetTile, results };
        }
    },
    airlift: {
        id: 'airlift', name: '空运', icon: '🪂',
        desc: '【空运】$4\n运送一名自己以外的的友军单位至已探索空地',
        targeting: 'friendlyAny',
        execute(targetTile, gameState, helpers) {
            return { airlift: true, targetTile };
        }
    }
};

// ==== 对策卡牌堆组成 ====================
export const DECK_COMPOSITION = [
    'heal', 'heal', 'heal', 'heal',
    'lightning', 'lightning', 'lightning',
    'airstrike', 'airstrike',
    'airdrop', 'airdrop',
    'mgNest',
    'shield', 'shield',
    'landmine', 'landmine',
    'imprison', 'imprison',
    'forceMarch', 'forceMarch'
];

// 遭遇战模式专用卡
export const SKIRMISH_EXTRAS = ['scout', 'scout', 'scout', 'scout', 'scout'];

// ==== 对策卡系统参数 ====================
export const CARD_SYSTEM_CONFIG = {
    drawCost: 4,
    maxHandSize: 3,
    maxDrawsPerTurn: 2,
    maxUsesPerTurn: 2
};

export const WEATHER_CYCLE = {
    warmupRounds:   2,
    weatherDuration: 2,
    clearDuration:   1
};

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
