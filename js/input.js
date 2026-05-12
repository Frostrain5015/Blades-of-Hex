import { HEX_SIZE, canvas, cardCanvas, settings, saveSettings, MORALE_CONFIG, TERRAIN_CONFIG, CAMP, LOGICAL_W, LOGICAL_H, WEATHER_CONFIG, TACTICAL_CARD_CONFIG, CARD_SYSTEM_CONFIG, COMMANDER_CONFIG } from './config.js';
import { getCommander, getCommanderDefenseBonus, getCommanderAuraDefenseBonus, getStallerSnareLayers } from './commanderInterface.js';
import { gameState, clearselection, deselectUnit, updateRecruitButtonStates, saveGame, loadGame, notify, updateStatsPanel, updateRecruitCostDisplay, logMessage, serializeState, showTargetingBanner, hideTargetingBanner } from './state.js';
import { isMyTurn, isNetworkGame, getMyRole, syncCommanderState, sendAction } from './network.js';
import {
    getMovableTiles, getAttackableTiles,
    moveUnit, attackUnit, recruitUnit, endTurn, undoLastAction,
    executeTacticalCard, cancelCardTargeting, recalcAllFlankingMorale, drawCard
} from './gameLogic.js';
import { clearTransientEffects, spawnCommanderSkillEffect } from './effects.js';
import { setCardHoveredIndex, triggerFlyingCard } from './renderer.js';

function _getMyCampInput() {
    if (isNetworkGame()) {
        const role = getMyRole();
        if (role === 'player1') return CAMP.player1;
        if (role === 'player2') return CAMP.player2;
        if (role === 'player3') return CAMP.player3;
        return CAMP.player1;
    }
    return gameState.currentCamp;
}

// Canvas 卡牌堆叠区域点击处理
let _cardFromX = 500, _cardFromY = 375;
function _handleCardCanvasClick(e) {
    if (!cardCanvas) return;
    const rect = cardCanvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const W = cardCanvas.clientWidth, H = cardCanvas.clientHeight;

    const myCamp = _getMyCampInput();
    if (!myCamp) return;
    const campKey = myCamp === CAMP.player1 ? 'player1' : myCamp === CAMP.player2 ? 'player2' : 'player3';
    const hand = gameState.playerHands[campKey] || [];
    const isNeutralTurn = !isNetworkGame() && gameState.currentCamp === CAMP.neutral;
    if (isNeutralTurn) return;

    const cardW = 90, cardH = 130, peekW = 72;
    const pileW = cardW, pileH = cardH, pileX = W - pileW - 8, pileY = 8;

    // draw pile check (top-right corner) — single click to draw
    if (cx >= pileX - 4 && cx <= pileX + pileW + 4 && cy >= pileY - 4 && cy <= pileY + pileH + 4) {
        const isMyTurnLocal = isNetworkGame()
            ? (getMyRole() === 'player1' ? gameState.currentCamp === CAMP.player1 : getMyRole() === 'player2' ? gameState.currentCamp === CAMP.player2 : gameState.currentCamp === CAMP.player3)
            : (gameState.gameMode === 'pve' ? gameState.currentCamp === CAMP.player1 : true);
        if (!isMyTurnLocal || gameState.cardTargeting ||
            hand.length >= CARD_SYSTEM_CONFIG.maxHandSize ||
            gameState.playerGold[campKey] < CARD_SYSTEM_CONFIG.drawCost ||
            gameState.playerDrawsThisTurn[campKey] >= CARD_SYSTEM_CONFIG.maxDrawsPerTurn) {
            return;
        }

        const drawn = drawCard(myCamp);
        if (drawn) {
            const endX = 8 + cardW / 2;
            const endY = H - 120 + cardH / 2;
            triggerFlyingCard(drawn, pileX + pileW / 2, pileY + pileH / 2, endX, endY);
        }
        return;
    }

    const n = hand.length;
    if (n === 0) return;

    const cxBase2 = 8;
    const cyBase2 = H - 120;

    // search from top card down
    for (let i = n - 1; i >= 0; i--) {
        const cfg = TACTICAL_CARD_CONFIG[hand[i]];
        if (!cfg) continue;
        const bx = cxBase2 + (n - 1 - i) * peekW;
        const by = cyBase2;
        if (cx >= bx && cx <= bx + cardW && cy >= by && cy <= by + cardH) {
            const cardId = hand[i];
            const isDeploy = cardId === 'commanderDeploy';
            const alreadyDeployed = isDeploy && (myCamp === CAMP.player1 ? gameState.commanderP1Deployed : myCamp === CAMP.player2 ? gameState.commanderP2Deployed : gameState.commanderP3Deployed);
            if (isDeploy && alreadyDeployed) return;

            // only allow during own turn (network safety)
            const isMyTurnCheck = isNetworkGame()
                ? (getMyRole() === 'player1' ? gameState.currentCamp === CAMP.player1 : getMyRole() === 'player2' ? gameState.currentCamp === CAMP.player2 : gameState.currentCamp === CAMP.player3)
                : (gameState.gameMode === 'pve' ? gameState.currentCamp === CAMP.player1 : gameState.currentCamp === myCamp);
            if (!isMyTurnCheck) return;

            if (gameState.cardTargeting && gameState.cardTargeting.cardId === cardId) {
                cancelCardTargeting();
                return;
            }
            if (gameState.playerUsesThisTurn[campKey] >= CARD_SYSTEM_CONFIG.maxUsesPerTurn) {
                notify('本回合已达到使用上限（2次）', 'error'); return;
            }
            if (gameState.selectedUnit) deselectUnit(); else clearselection();
            hideTooltip();
            gameState.selectedTile = null;
            // capture card hand position in game logical coords for burn animation
            {
                const cardRect = cardCanvas.getBoundingClientRect();
                const gameRect = canvas.getBoundingClientRect();
                const scaleX = LOGICAL_W / gameRect.width;
                const scaleY = LOGICAL_H / gameRect.height;
                const screenX = cardRect.left + bx + cardW / 2;
                const screenY = cardRect.top + by + cardH / 2;
                _cardFromX = (screenX - gameRect.left) * scaleX;
                _cardFromY = (screenY - gameRect.top) * scaleY;
            }
            gameState.cardTargeting = { cardId, targeting: cfg.targeting };
            if (cardId === 'commanderDeploy') {
                const cmdKey = myCamp === CAMP.player1 ? gameState.commanderP1 : myCamp === CAMP.player2 ? gameState.commanderP2 : gameState.commanderP3;
                const cmdCfg = COMMANDER_CONFIG[cmdKey];
                if (cmdCfg) {
                    showTargetingBanner(`选择单位部署【${cmdCfg.name}】`, '再次点击卡片或按 Esc 取消');
                } else {
                    showTargetingBanner(`选择【${cfg.name}】目标`, '再次点击卡片或按 Esc 取消');
                }
            } else {
                showTargetingBanner(`选择【${cfg.name}】目标`, '再次点击卡片或按 Esc 取消');
            }
            return;
        }
    }
}

import { HexTile } from './HexTile.js';
import { Unit } from './Unit.js';

// HTML tooltip 元素
const tooltipEl = document.getElementById('unitTooltip');
const tooltipHeader = document.getElementById('tooltipHeader');
const tooltipHpFill = document.getElementById('tooltipHpFill');
const tooltipHpText = document.getElementById('tooltipHpText');
const tooltipAtk = document.getElementById('tooltipAtk');
const tooltipDef = document.getElementById('tooltipDef');
const tooltipSpd = document.getElementById('tooltipSpd');
const tooltipRng = document.getElementById('tooltipRng');
const tooltipCD = document.getElementById('tooltipCD');
const tooltipSkillInfo = document.getElementById('tooltipSkillInfo');
const tooltipStatus = document.getElementById('tooltipStatus');
const tooltipPassive = document.getElementById('tooltipPassive');
const tooltipMorale = document.getElementById('tooltipMorale');

// 军衔折形图标 canvas（惰性创建，复用）
// 折形比例与部队右下角完全一致：hw=5.5 hh=1.5(略压扁) dy=4 lineWidth=2
let _rankCanvas = null;
function _getOrCreateRankCanvas() {
    if (!_rankCanvas) {
        _rankCanvas = document.createElement('canvas');
        _rankCanvas.style.flexShrink = '0';
        _rankCanvas.style.marginLeft = '4px';
    }
    return _rankCanvas;
}
function _drawRankChevrons(cv, rank) {
    const pad = 2;
    const ctx = cv.getContext('2d');
    if (rank >= 4) {
        const outerR = 7, innerR = outerR * 0.382;
        const extra = 4;
        cv.width = Math.ceil(outerR * 2 + pad * 2 + extra * 2);
        cv.height = cv.width;
        ctx.clearRect(0, 0, cv.width, cv.height);
        const cx = cv.width / 2, cy = cv.height / 2;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const aOut = -Math.PI / 2 + i * 2 * Math.PI / 5;
            const aIn = aOut + Math.PI / 5;
            if (i === 0) ctx.moveTo(cx + outerR * Math.cos(aOut), cy + outerR * Math.sin(aOut));
            else ctx.lineTo(cx + outerR * Math.cos(aOut), cy + outerR * Math.sin(aOut));
            ctx.lineTo(cx + innerR * Math.cos(aIn), cy + innerR * Math.sin(aIn));
        }
        ctx.closePath();
        ctx.fillStyle = '#ffd700';
        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 1.5; ctx.shadowOffsetY = 1;
        ctx.fill();
        ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 2.5; ctx.shadowOffsetY = 0;
        ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        return;
    }
    const hw = 5.5, hh = 1.5, sp = 4; // width-half, height-half(压扁), vertical spacing
    const cw = Math.ceil(hw * 2 + pad * 2);
    const ch = Math.ceil((rank - 1) * sp + hh * 2 + pad * 2 + 2);
    cv.width = cw;
    cv.height = ch;
    ctx.clearRect(0, 0, cw, ch);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const chX = cw / 2;
    const chY = pad + hh;
    for (let lv = 0; lv < rank; lv++) {
        const oy = lv * sp;
        ctx.beginPath();
        ctx.moveTo(chX - hw, chY + hh + oy);
        ctx.lineTo(chX,      chY - hh + oy);
        ctx.lineTo(chX + hw, chY + hh + oy);
        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 1.5; ctx.shadowOffsetY = 1;
        ctx.stroke();
        ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 2.5; ctx.shadowOffsetY = 0;
        ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
}

const PASSIVE_DEFS = {
    infantry: {
        name: '坚守',
        desc: '位于城市时：每回合回复10%生命值，防御+5%，反击伤害大幅提高',
        active: (u) => u.tile.isCity
    },
    cavalry: {
        name: '冲锋',
        desc: '本回合移动至少2格后，造成伤害+25%',
        active: (u) => u.moveDistance >= 2
    },
    archer: {
        name: '远射',
        desc: '山地射程+1（不与风天叠加）；山地时无视敌方5%防御力',
        active: (u) => u.tile.terrain === 'mountain'
    }
};

function showTooltipForTile(tile) {
    const unit = tile.unit;
    const isCity = tile.isCity;
    const tc = TERRAIN_CONFIG[tile.terrain];

    if (unit) {
        const typeNames = { infantry: '步兵', cavalry: '骑兵', archer: '炮兵' };
        let headerText = `${unit.camp.name}·${typeNames[unit.type] || unit.config.name}`;
        if (unit.commander) {
            const cmdCfgHdr = getCommander(unit.commander);
            if (cmdCfgHdr) headerText += ` ${cmdCfgHdr.name}`;
        }
        const headerColor = unit.camp.color;
        tooltipHeader.style.color = headerColor;
        tooltipHeader.style.display = 'flex';
        tooltipHeader.style.alignItems = 'center';
        while (tooltipHeader.firstChild) tooltipHeader.removeChild(tooltipHeader.firstChild);
        tooltipHeader.appendChild(document.createTextNode(headerText));
        if (unit._rank > 0) {
            const rc = _getOrCreateRankCanvas();
            _drawRankChevrons(rc, unit._rank);
            tooltipHeader.appendChild(rc);
        }

        const totalBase = unit.maxHp + (unit._shield > 0 ? unit._shield : 0);
        const hpRatio = unit.hp / totalBase;
        const shieldRatio = unit._shield > 0 ? unit._shield / totalBase : 0;
        const hpColor = (unit.hp / unit.maxHp) > 0.5 ? '#4CAF50' : (unit.hp / unit.maxHp) > 0.25 ? '#FF9800' : '#f44336';
        // HP+shield combined bar: green=HP, blue=shield
        tooltipHpFill.style.width = ((hpRatio + shieldRatio) * 100) + '%';
        if (shieldRatio > 0) {
            tooltipHpFill.style.background = `linear-gradient(to right, ${hpColor} ${(hpRatio/(hpRatio+shieldRatio)*100)}%, #66bbff ${(hpRatio/(hpRatio+shieldRatio)*100)}%)`;
        } else {
            tooltipHpFill.style.background = hpColor;
        }
        const cmdCfgHp = unit.commander ? getCommander(unit.commander) : null;
        const cmdHpBonus = cmdCfgHp ? cmdCfgHp.hpBonus : 0;
        const hpBonusStr = cmdHpBonus > 0 ? `<span style="font-size:9px;color:#ffd700;"> (+${cmdHpBonus})</span>` : '';
        const shieldStr = unit._shield > 0 ? `<span style="color:#66bbff;">+🛡${Math.round(unit._shield)}</span>` : '';
        tooltipHpText.innerHTML = `❤ ${Math.round(unit.hp)}/${unit.maxHp}${hpBonusStr}${shieldStr}`;
        tooltipHpBar.style.display = '';

        const effAtk = unit.getEffectiveAttack();
        const baseAtk = unit.config.attack;
        const atkDelta = effAtk - baseAtk;
        if (atkDelta !== 0) {
            const sign = atkDelta > 0 ? '+' : '';
            const deltaColor = atkDelta > 0 ? '#ffd700' : '#b080e8';
            tooltipAtk.innerHTML = `<span style="color:#ff6;">⚔ ${effAtk}<span style="font-size:10px;color:${deltaColor};">(${sign}${atkDelta})</span></span>`;
        } else {
            tooltipAtk.innerHTML = `<span style="color:#ff6;">⚔ ${effAtk}</span>`;
        }
        const moraleDefBonus = MORALE_CONFIG[unit.morale].defBonus;
        const auraDefBonus = getCommanderAuraDefenseBonus(unit);
        const cmdDefBonus = getCommanderDefenseBonus(unit);
        const cityDefBonus = (unit.type === 'infantry' && isCity) ? 0.05 : 0;
        const terrainDefBonus = TERRAIN_CONFIG[tile.terrain].defenseBonus;
        const rankDefBonus = unit._rankDefBonus || 0;
        const totalDefPct = Math.round(((unit.config.defense || 0) + moraleDefBonus + terrainDefBonus + rankDefBonus + auraDefBonus + cmdDefBonus + cityDefBonus) * 100);
        if (totalDefPct > 0) {
            tooltipDef.innerHTML = `<span style="color:#8fc;">🛡 ${totalDefPct}%</span>`;
        } else if (totalDefPct < 0) {
            tooltipDef.innerHTML = `<span style="color:#f66;">🛡 ${totalDefPct}%</span>`;
        } else {
            tooltipDef.innerHTML = `<span style="color:#888;">🛡 0%</span>`;
        }
        tooltipSpd.innerHTML = `<span style="color:#6cf;">⚡ ${unit.remainingMP}/${unit.config.speed}</span>`;
        tooltipRng.innerHTML = `<span style="color:#f8a;">📡 ${unit.config.range}</span>`;
        // 主动技能冷却剩余 → ⌛ 在属性栏
        const cdRounds = unit.getCooldownRounds();
        if (cdRounds > 0) {
            tooltipCD.innerHTML = `<span style="color:#aac8e0;">⌛ ${cdRounds}</span>`;
            tooltipCD.style.display = '';
        } else {
            tooltipCD.innerHTML = '';
            tooltipCD.style.display = 'none';
        }
        tooltipStats.style.display = '';

        // ==== 主动技能信息（独立行） ====
        // 狂战士等已在技能区显示（⏰N⌛N），此处仅对其他将领显示可用提示
        if (unit.commander && unit.commander !== 'berserker') {
            const cmdSk = getCommander(unit.commander);
            if (cmdSk && cmdSk.activeSkill) {
                if (unit.activeSkillDur <= 0 && unit.activeSkillCD <= 0) {
                    tooltipSkillInfo.innerHTML = `<span style="color:#cf9;">⏱&nbsp;${cmdSk.activeSkill.duration}轮 — 可用</span>`;
                } else {
                    tooltipSkillInfo.innerHTML = '';
                }
            } else {
                tooltipSkillInfo.innerHTML = '';
            }
        } else {
            tooltipSkillInfo.innerHTML = '';
        }

        const statusParts = [];
        if (unit.isNewRecruit) statusParts.push('新招募');
        tooltipStatus.textContent = statusParts.join(' | ');

        // ==== 技能区 ====
        let skillHtml = '';
        const def = PASSIVE_DEFS[unit.type];
        if (def) {
            const isActive = def.active(unit);
            skillHtml = `<span class="${isActive ? 'tooltip-passive-active' : 'tooltip-passive-inactive'}">【${def.name}】${def.desc}</span>`;
        }
        if (unit.commander) {
            const cmdCfg2 = getCommander(unit.commander);
            if (cmdCfg2) {
                let active = true;
                let statusNote = '';
                let cmdDesc = cmdCfg2.tooltipDesc || cmdCfg2.desc;
                let cmdColor = '#ffd700';

                if (unit.commander === 'fallenAngel') {
                    if (unit._fallen) {
                        cmdColor = '#ff6644';
                        cmdDesc = '每回合流失当前生命值的20%，造成的伤害+75%，士气恢复正常时切换至【☆堕天使·白】';
                        statusNote = '【★堕天使·黑】';
                    } else {
                        cmdColor = '#6688ff';
                        cmdDesc = '每回合回复已损失生命值的20%，士气上升或下降时切换至【★堕天使·黑】';
                        statusNote = '【☆堕天使·白】';
                    }
                } else if (unit.commander === 'minister') {
                    active = !!(unit.tile && unit.tile.isCity);
                    statusNote = active ? '（生效中）' : '（未驻扎城市，未生效）';
                } else if (unit.commander === 'martyr') {
                    if (unit._martyrPrimed) {
                        cmdColor = '#ff3300';
                        statusNote = '【★殉道】技能已激活，';
                        cmdDesc = '下回合开始时对2格范围内所有非己方单位造成大量范围伤害';
                    }
                } else if (unit.commander === 'berserker') {
                    if (unit.activeSkillDur > 0) {
                        // 激活中 → 限时效果区显示 buff 详情，此处仅标识
                        cmdDesc = '主动技能已生效';
                    } else if (cmdCfg2.activeSkill) {
                        const sk = cmdCfg2.activeSkill;
                        const bufParts = [];
                        if (sk.buffs) {
                            const b = sk.buffs;
                            if (b.atk) bufParts.push(`攻击力+${b.atk}`);
                            if (b.def) bufParts.push(`防御力+${Math.round(b.def * 100)}%`);
                        }
                        cmdDesc = bufParts.join('，') + `（⏰${sk.duration}⌛${sk.cooldown}）`;
                    }
                }

                const color = active ? cmdColor : '#888';
                const tag = (cmdCfg2.activeSkill && active && unit.activeSkillDur <= 0) ? '（主动技能）' : '';
                const prefix = (unit.commander === 'fallenAngel' || (unit.commander === 'martyr' && unit._martyrPrimed)) ? '' : `【☆${cmdCfg2.skill}】`;
                const cmdLine = `<span style="color:${color};">${prefix}${statusNote}${tag}${cmdDesc}</span>`;
                skillHtml += (skillHtml ? '<br>' : '') + cmdLine;
            }
        }
        tooltipPassive.innerHTML = skillHtml;

        // ==== 效果区 ====
        const timedEffects = unit.getTimedEffects(gameState);
        const hasMoraleTimed = timedEffects.some(fx => fx.label === MORALE_CONFIG[3].name);

        tooltipMorale.innerHTML = '';
        // 基础士气（仅在非限时效果时显示，避免与限时效果重复）
        if (unit.morale !== 2 && !hasMoraleTimed) {
            const mc = MORALE_CONFIG[unit.morale];
            tooltipMorale.innerHTML = `<span style="color:${mc.color};">【${mc.name}】${mc.desc}</span>`;
        }

        // 限时效果 → 格式：【名称】效果描述（⏰剩余轮数）
        for (const fx of timedEffects) {
            const descSuffix = fx.desc ? `${fx.desc}` : '';
            const clockSuffix = (fx.remaining != null && fx.remaining !== '永久') ? `（⏰${fx.remaining}）` : '';
            const line = `<span style="color:${fx.color};">【${fx.label}】${descSuffix}${clockSuffix}</span>`;
            tooltipMorale.innerHTML += (tooltipMorale.innerHTML ? '<br>' : '') + line;
        }

        // 铁卫灵光buff（铁卫自身 + 相邻友军）
        if (auraDefBonus > 0) {
            const auraLine = unit.commander === 'ironGuard'
                ? `<span style="color:#7eb8ff;">【守护灵光】防御力+10%</span>`
                : `<span style="color:#7eb8ff;">【守护灵光】防御力+10%，伤害由铁卫护盾承担</span>`;
            tooltipMorale.innerHTML += (tooltipMorale.innerHTML ? '<br>' : '') + auraLine;
        }

        tooltipEl.style.borderColor = unit.camp.color;
    } else {
        while (tooltipHeader.firstChild) tooltipHeader.removeChild(tooltipHeader.firstChild);
        tooltipHeader.style.color = '';
        tooltipHeader.style.display = '';
        tooltipHpBar.style.display = 'none';
        tooltipStats.style.display = 'none';
        tooltipCD.innerHTML = '';
        tooltipCD.style.display = 'none';
        tooltipStatus.textContent = '';
        tooltipPassive.innerHTML = '';
        tooltipMorale.innerHTML = '';
        tooltipSkillInfo.innerHTML = '';
        tooltipEl.style.borderColor = 'rgba(255,255,255,0.15)';
    }

    // 停滞者缚足debuff（范围内敌军）
    if (unit && unit.commander !== 'staller' && unit.tile) {
        const layers = getStallerSnareLayers(unit.tile, unit.camp, gameState.tileMap);
        if (layers > 0) {
            const cost = Math.floor(layers * 1.5);
            const snareLine = `<span style="color:#c08050;">【缚足】${layers}层 每步消耗+${cost}</span>`;
            tooltipMorale.innerHTML += (tooltipMorale.innerHTML ? '<br>' : '') + snareLine;
        }
    }

    // Terrain info — shown last
    const showTerrain = isCity || tile.terrain !== 'plains';
    if (showTerrain) {
        const terrainName = isCity ? '城市' : tc.name;
        let terrainDesc = '';
        if (isCity) {
            const ownerName = tile.camp === CAMP.player1 ? '红军' : tile.camp === CAMP.player2 ? '蓝军' : tile.camp === CAMP.player3 ? '绿军' : '中立';
            terrainDesc = `由${ownerName}控制`;
            if (tile._cityDisabledUntil > 0 && tile._cityDisabledUntil >= gameState.turnCounter) {
                terrainDesc += ' 🚫 遭到空袭，本回合无法产金或招募';
            }
        } else {
            terrainDesc = `防御+${Math.round(tc.defenseBonus * 100)}%`;
            if (tc.moveDesc) terrainDesc += `，${tc.moveDesc}`;
        }
        const terrainLine = `<span style="color:#fff;">【${terrainName}】${terrainDesc}</span>`;
        if (unit) {
            tooltipMorale.innerHTML += (tooltipMorale.innerHTML ? '<br>' : '') + terrainLine;
        } else {
            tooltipPassive.innerHTML = terrainLine;
        }
    }

    // Weather info — shown last after terrain
    const wc = WEATHER_CONFIG[gameState.weather];
    if (gameState.weather !== 'clear' && wc) {
        let weatherDesc = wc.desc;
        if (unit) {
            const effects = [];
            if (gameState.weather === 'rain') {
                if (unit.type === 'cavalry')  effects.push('每步行动力消耗+1');
                if (unit.type === 'infantry') effects.push('守城回血20%');
            } else if (gameState.weather === 'fog') {
                if (unit.type === 'archer')   effects.push('伤害−25%', '射程−1');
                if (unit.type === 'cavalry')  effects.push('冲锋1格生效 伤害+30%');
            } else if (gameState.weather === 'wind') {
                if (unit.type === 'archer')   effects.push('射程+1', '伤害+15%');
                if (unit.type === 'infantry') effects.push('步兵无法暴击');
            }
            if (effects.length > 0) weatherDesc = effects.join('，');
            else weatherDesc = '无直接影响';
        }
        const weatherLine = `<span style="color:${wc.color};">${wc.icon}【${wc.name}】${weatherDesc}</span>`;
        const target = unit ? tooltipMorale : tooltipPassive;
        target.innerHTML += (target.innerHTML ? '<br>' : '') + weatherLine;
    }

    // ==== 主动技能按钮 ====
    const skillBtn = document.getElementById('tooltipActiveSkill');
    if (unit && unit.commander && unit.camp === gameState.currentCamp) {
        const cmdCfgS = getCommander(unit.commander);
        if (cmdCfgS && cmdCfgS.activeSkill) {
            const skill = cmdCfgS.activeSkill;
            const onCD = unit.activeSkillCD > 0;
            const isActive = unit.activeSkillDur > 0;
            const canUse = !onCD && !isActive && unit.canAct && !unit.isNewRecruit;
            skillBtn.textContent = skill.name;
            skillBtn.style.display = 'block';
            skillBtn.disabled = !canUse;
            skillBtn.className = 'tooltip-skill-btn' + (onCD ? ' on-cooldown' : '');
            skillBtn.dataset.unitId = unit.id;
        } else {
            skillBtn.style.display = 'none';
        }
    } else {
        skillBtn.style.display = 'none';
    }

    if (!unit && !showTerrain) {
        tooltipEl.classList.remove('visible');
        return;
    }
    tooltipEl.classList.add('visible');

    // Position: below stats panel
    const statsPanel = document.getElementById('statsPanel');
    if (statsPanel) {
        const rect = statsPanel.getBoundingClientRect();
        const ttipW = tooltipEl.offsetWidth || 210;
        let left = rect.left + rect.width / 2 - ttipW / 2;
        let top = rect.bottom + 10;
        // 移动端视口边界保护：防止tooltip溢出屏幕或被错误定位
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (left < 4) left = 4;
        if (left + ttipW > vw - 4) left = vw - ttipW - 4;
        if (top + 120 > vh) top = rect.top - 130; // 如果下方空间不足，移到上方
        if (top < 4) top = 4;
        tooltipEl.style.left = left + 'px';
        tooltipEl.style.top = top + 'px';
    }
}

function hideTooltip() {
    tooltipEl.classList.remove('visible');
}

// ==== 像素 → 地块 =====================
function getTileAtPixel(px, py) {
    let result = null;
    let minDistSq = HEX_SIZE * HEX_SIZE;
    for (const tile of gameState.tiles) {
        const dx = px - tile.x;
        const dy = py - tile.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistSq) {
            minDistSq = distSq;
            result = tile;
        }
    }
    return result;
}

// ==== 鼠标输入 =====================
let _inputInitialized = false;
export function initInput() {
    if (_inputInitialized) return;
    _inputInitialized = true;
    function toLogical(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (LOGICAL_W / rect.width),
            y: (e.clientY - rect.top) * (LOGICAL_H / rect.height)
        };
    }

    // 对策卡手牌独立画布交互
    if (cardCanvas) {
        cardCanvas.addEventListener('mousemove', (e) => {
            if (gameState.gameOver) return;
            const rect = cardCanvas.getBoundingClientRect();
            const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
            const W = cardCanvas.clientWidth, H = cardCanvas.clientHeight;
            const myCamp2 = _getMyCampInput();
            if (!myCamp2) return;
            const ck = myCamp2 === CAMP.player1 ? 'player1' : myCamp2 === CAMP.player2 ? 'player2' : 'player3';
            const hand2 = gameState.playerHands[ck] || [];
            const n2 = hand2.length;
            if (n2 === 0) return;
            const cardW2 = 90, cardH2 = 130, peekW2 = 72;
            const cxBase2 = 8;
            const cyBase2 = H - 120;

            // search from top card (highest index) downward
            let found = -1;
            for (let i = n2 - 1; i >= 0; i--) {
                const bx = cxBase2 + (n2 - 1 - i) * peekW2;
                const by = cyBase2;
                if (cx >= bx && cx <= bx + cardW2 && cy >= by && cy <= by + cardH2) {
                    found = i; break;
                }
            }
            setCardHoveredIndex(found);
        });
        cardCanvas.addEventListener('mouseleave', () => {
            setCardHoveredIndex(-1);
        });
        cardCanvas.addEventListener('click', (e) => {
            if (gameState.gameOver) return;
            _handleCardCanvasClick(e);
        });
    }

    canvas.addEventListener('click', (e) => {
        if (gameState.gameOver) return;
        const { x: clickX, y: clickY } = toLogical(e);

        const clickedTile = getTileAtPixel(clickX, clickY);
        if (!clickedTile) {
            if (gameState.cardTargeting) { cancelCardTargeting(); return; }
            if (gameState.cardStackExpanded) { gameState.cardStackExpanded = false; return; }
            clearselection();
            hideTooltip();
            return;
        }

        // 对策卡选择目标模式
        if (gameState.cardTargeting) {
            const ct = gameState.cardTargeting;
            const cfg = TACTICAL_CARD_CONFIG[ct.cardId];
            if (!cfg) { cancelCardTargeting(); return; }

            const myCamp = _getMyCampInput();
            let isValid = false;
            if (ct.targeting === 'enemyGlobal') {
                isValid = clickedTile.unit && clickedTile.unit.camp !== myCamp;
            } else if (ct.targeting === 'friendlyAlive') {
                isValid = clickedTile.unit && clickedTile.unit.camp === myCamp && clickedTile.unit.canAct;
            } else if (ct.targeting === 'friendlyAny') {
                isValid = clickedTile.unit && clickedTile.unit.camp === myCamp;
            } else if (ct.targeting === 'emptyTile') {
                isValid = !clickedTile.unit;
            } else if (ct.targeting === 'emptyFriendlyNonCityNonMountain') {
                isValid = !clickedTile.unit && !clickedTile.isCity
                    && clickedTile.terrain !== 'mountain' && clickedTile.camp === myCamp;
            } else if (ct.targeting === 'emptyFriendlyLandmine') {
                isValid = !clickedTile.unit && !clickedTile.isCity && clickedTile.camp === myCamp;
            } else if (ct.targeting === 'enemyCity') {
                isValid = clickedTile.isCity && clickedTile.camp !== myCamp;
            } else if (ct.targeting === 'shieldTarget') {
                isValid = clickedTile.unit != null;
            }

            if (isValid) {
                executeTacticalCard(ct.cardId, clickedTile, _cardFromX, _cardFromY);
            }
            return;
        }

        // 点选已选中单位/地块 → 取消选中（己方可操作单位有光圈倒放动画）
        if (gameState.selectedTile === clickedTile) {
            if (gameState.selectedUnit) deselectUnit(); else clearselection();
            hideTooltip();
            gameState.selectedTile = null;
            return;
        }

        // 对手回合 / AI 回合：只允许查看，不允许操作
        // 联机对手 → isMyTurn；PVE AI 对手 / 中立 → 独立检查
        const isAIOpponentTurn = gameState.gameMode === 'pve' && gameState.currentCamp === gameState.aiOpponentCamp;
        const isNeutralLocal = !isNetworkGame() && gameState.currentCamp === CAMP.neutral;
        if (!isMyTurn(gameState.currentCamp) || isAIOpponentTurn || isNeutralLocal) {
            clearselection();
            gameState.selectedTile = clickedTile;
            showTooltipForTile(clickedTile);
            return;
        }

        // Action: friendly unit selected, clicking a movable tile → move
        if (gameState.selectedUnit && gameState.movableTiles.includes(clickedTile) && !clickedTile.unit) {
            moveUnit(gameState.selectedUnit, clickedTile);
            gameState.selectedTile = gameState.selectedUnit ? gameState.selectedUnit.tile : clickedTile;
            showTooltipForTile(gameState.selectedTile);
            return;
        }

        // Action: friendly unit selected, clicking an attackable tile → attack
        if (gameState.selectedUnit && gameState.attackableTiles.includes(clickedTile) && clickedTile.unit) {
            const attacker = gameState.selectedUnit;
            attackUnit(attacker, clickedTile.unit);
            // 百夫长乘胜：技能触发后 canAct 仍为 true，保持选中让玩家继续行动
            if (attacker.canAct) {
                gameState.selectedUnit = attacker;
                gameState.selectedTile = attacker.tile;
                showTooltipForTile(attacker.tile);
            } else {
                clearselection();
                gameState.selectedTile = clickedTile;
                showTooltipForTile(clickedTile);
            }
            return;
        }

        // Select: pick any tile
        clearselection();
        gameState.selectedTile = clickedTile;

        const ownActionable = clickedTile.unit && clickedTile.unit.camp === gameState.currentCamp && clickedTile.unit.canAct && !clickedTile.unit.isNewRecruit;
        const ownEmptyCity = clickedTile.isCity && clickedTile.camp === gameState.currentCamp && !clickedTile.unit;

        if (ownActionable) {
            gameState.selectedUnit = clickedTile.unit;
            gameState.movableTiles = getMovableTiles(clickedTile.unit);
            gameState.attackableTiles = getAttackableTiles(clickedTile.unit);
            // 要塞等不可移动单位：若无攻击目标则直接标记为不可行动
            if (gameState.movableTiles.length === 0 && gameState.attackableTiles.length === 0) {
                clickedTile.unit.canAct = false;
                gameState.selectedUnit = null;
                return;
            }
            gameState.selectionTime = performance.now();
        } else if (ownEmptyCity) {
            gameState.selectedCityTile = clickedTile;
        } else if (clickedTile.unit) {
            // 敌方/中立/不可行动单位：可选中查看（tooltip / 作弊控制台用），不显示行动范围
            gameState.selectedUnit = clickedTile.unit;
        }

        updateRecruitButtonStates();
        showTooltipForTile(clickedTile);
    });

    canvas.addEventListener('mouseleave', () => {
        gameState.hoveredTile = null;
        canvas.style.cursor = 'default';
    });

    document.addEventListener('rankUpTooltipRefresh', (e) => {
        if (gameState.hoveredTile === e.detail.tile) {
            showTooltipForTile(gameState.hoveredTile);
        }
    });

    // 对策卡交互已改为 canvas 渲染，不再使用 DOM 事件

    // 对策卡悬浮提示 — 从右侧边界滑出
    const cardTooltip = document.getElementById('cardTooltip');
    document.getElementById('tacticalCardArea').addEventListener('mouseover', (e) => {
        const cardEl = e.target.closest('.tactical-card');
        if (!cardEl || !cardTooltip) return;
        const desc = cardEl.dataset.cardDesc;
        if (!desc) return;
        cardTooltip.textContent = desc;
        cardTooltip.classList.add('visible');
    });
    document.getElementById('tacticalCardArea').addEventListener('mouseleave', () => {
        if (cardTooltip) cardTooltip.classList.remove('visible');
    });

    // 右键取消对策卡选择
    canvas.addEventListener('contextmenu', (e) => {
        if (gameState.cardTargeting) {
            e.preventDefault();
            cancelCardTargeting();
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const { x: mouseX, y: mouseY } = toLogical(e);
        gameState.hoveredTile = getTileAtPixel(mouseX, mouseY);

        const hovered = gameState.hoveredTile;
        if (hovered) {
            const isOwnUnit = hovered.unit && hovered.unit.camp === gameState.currentCamp && hovered.unit.canAct && !hovered.unit.isNewRecruit;
            const isOwnCity = hovered.isCity && hovered.camp === gameState.currentCamp && !hovered.unit && !gameState.selectedUnit;
            const isMovable = gameState.selectedUnit && gameState.movableTiles.includes(hovered) && !hovered.unit;
            const isAttackable = gameState.selectedUnit && gameState.attackableTiles.includes(hovered) && hovered.unit;
            if (isOwnUnit || isOwnCity) canvas.style.cursor = 'pointer';
            else if (isMovable) canvas.style.cursor = 'move';
            else if (isAttackable) canvas.style.cursor = 'crosshair';
            else canvas.style.cursor = 'default';
        } else {
            canvas.style.cursor = 'default';
        }
    });
}

// ==== 键盘快捷键 =====================
let _keyboardInitialized = false;
export function initKeyboard() {
    if (_keyboardInitialized) return;
    _keyboardInitialized = true;
    document.addEventListener('keydown', (e) => {
        // 不拦截输入框的按键
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // ESC 取消对策卡选择
        if (e.key === 'Escape' && gameState.cardTargeting) {
            e.preventDefault();
            cancelCardTargeting();
            return;
        }

        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            undoLastAction();
            return;
        }

        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            if (!isNetworkGame()) saveGame();
            return;
        }

        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            if (!isNetworkGame()) { loadGame(HexTile, Unit); clearTransientEffects(); }
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            if (gameState.selectedUnit) deselectUnit(); else clearselection();
            hideTooltip();
            gameState.selectedTile = null;
            return;
        }

        if (!gameState.gameOver) {
            if (e.key === 'e' || e.key === 'Enter') {
                e.preventDefault();
                if (gameState.currentCamp !== CAMP.neutral && isMyTurn(gameState.currentCamp)) endTurn();
                return;
            }

            if (e.key === '1') {
                e.preventDefault();
                recruitUnit('infantry');
                return;
            }
            if (e.key === '2') {
                e.preventDefault();
                recruitUnit('cavalry');
                return;
            }
            if (e.key === '3') {
                e.preventDefault();
                recruitUnit('archer');
                return;
            }
        }
    });
}

// ==== 设置面板事件 =====================
let _settingsInitialized = false;
export function initSettingsPanel() {
    if (_settingsInitialized) return;
    _settingsInitialized = true;
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsOverlay = document.getElementById('settingsOverlay');
    const settingsClose = document.getElementById('settingsClose');

    if (!settingsBtn || !settingsOverlay || !settingsClose) return;

    const speedBtns = document.querySelectorAll('.speed-btn');
    const exitBtn = document.getElementById('settingsExit');

    function updateSpeedBtns() {
        speedBtns.forEach(b => {
            b.classList.toggle('active', Math.abs(parseFloat(b.dataset.speed) - settings.animationSpeed) < 0.01);
        });
    }

    settingsBtn.addEventListener('click', () => {
        settingsOverlay.classList.add('show');
        updateSpeedBtns();
        document.getElementById('screenShake').checked = settings.screenShake;
        document.getElementById('soundEnabled').checked = settings.soundEnabled;
        // 单人模式显示退出按钮
        exitBtn.style.display = isNetworkGame() ? 'none' : '';
    });

    settingsClose.addEventListener('click', () => {
        settingsOverlay.classList.remove('show');
    });

    settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) {
            settingsOverlay.classList.remove('show');
        }
    });

    speedBtns.forEach(b => {
        b.addEventListener('click', () => {
            settings.animationSpeed = parseFloat(b.dataset.speed);
            updateSpeedBtns();
            saveSettings();
        });
    });

    document.getElementById('screenShake').addEventListener('change', (e) => {
        settings.screenShake = e.target.checked;
        saveSettings();
    });

    document.getElementById('soundEnabled').addEventListener('change', (e) => {
        settings.soundEnabled = e.target.checked;
        saveSettings();
    });

    exitBtn.addEventListener('click', () => {
        settingsOverlay.classList.remove('show');
        window.location.reload();
    });

    // 主动技能按钮
    const activeSkillBtn = document.getElementById('tooltipActiveSkill');
    if (activeSkillBtn && !activeSkillBtn._bound) {
        activeSkillBtn._bound = true;
        activeSkillBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const unitId = parseInt(activeSkillBtn.dataset.unitId);
            if (!unitId || isNaN(unitId)) return;
            const unit = gameState.tiles.reduce((f, t) => f || (t.unit?.id === unitId ? t.unit : null), null);
            if (!unit || !unit.commander || unit.activeSkillCD > 0 || unit.activeSkillDur > 0) return;
            const cmdCfg = getCommander(unit.commander);
            if (!cmdCfg || !cmdCfg.activeSkill) return;
            const skill = cmdCfg.activeSkill;
            skill.onActivate(unit, {
                gameState, logMessage, spawnFx: spawnCommanderSkillEffect
            });
            unit.activeSkillDur = skill.duration;
            unit.activeSkillCD = skill.cooldown;
            recalcAllFlankingMorale();
            showTooltipForTile(unit.tile);
            if (isNetworkGame()) sendAction('activateSkill', serializeState(), { unitId: unit.id });
        });
    }
}
