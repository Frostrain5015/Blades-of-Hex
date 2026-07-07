import { HEX_SIZE, canvas, cardCanvas, settings, saveSettings, MORALE_CONFIG, TERRAIN_CONFIG, CAMP, LOGICAL_W, LOGICAL_H, WEATHER_CONFIG, TACTICAL_CARD_CONFIG, CARD_SYSTEM_CONFIG, UNIT_CONFIG, COLONEL_CARDS, COLONEL_CARD_GOLD, getRoundIndex, getFactionCount } from './config.js';
import { allCommanders as COMMANDER_CONFIG } from '../commander/index.js';
import { getCommander, getCommanderDefenseBonus, getCommanderAuraDefenseBonus, getStallerSnareLayers } from './commanderInterface.js';
import { gameState, clearselection, deselectUnit, updateRecruitButtonStates, updateRecruitCostDisplay, notify, logMessage, serializeState, showTargetingBanner, hideTargetingBanner, getViewingCamp, updateUI } from './state.js';
import { isTileVisible } from './fogOfWar.js';
import { isMyTurn, isNetworkGame, getMyRole, syncCommanderState, sendAction } from './network.js';
import {
    getMovableTiles, getAttackableTiles,
    moveUnit, attackUnit, recruitUnit, endTurn,
    executeTacticalCard, cancelCardTargeting, recalcAllFlankingMorale, drawCard, reinforceUnit,
    isColonelTargetBlocked
} from './gameLogic.js';
import { spawnCommanderSkillEffect, spawnPaladinOrbitBeams, spawnAstrologerEffect } from './effects.js';
import { setCardHoveredIndex, triggerFlyingCard } from './renderer.js';
import { setMasterVolume, setMuted } from './audio.js';

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

    // draw pile / fuel purchase check (top-right corner)
    // E4 空军上校：右上角无抽牌/无燃料
    if (cx >= pileX - 4 && cx <= pileX + pileW + 4 && cy >= pileY - 4 && cy <= pileY + pileH + 4) {
        const isMyTurnLocal = isNetworkGame()
            ? (getMyRole() === 'player1' ? gameState.currentCamp === CAMP.player1 : getMyRole() === 'player2' ? gameState.currentCamp === CAMP.player2 : gameState.currentCamp === CAMP.player3)
            : (gameState.gameMode === 'pve' ? gameState.currentCamp === CAMP.player1 : true);
        if (!isMyTurnLocal || gameState.cardTargeting) return;

        // 空军上校无普通抽牌（专属空军卡为金币消耗、常驻手牌）→ 右上角点击无操作
        const isColonel = gameState['commander' + (campKey === 'player1' ? 'P1' : campKey === 'player2' ? 'P2' : 'P3')] === 'colonel';
        if (isColonel) return;

        // 普通抽牌（E3 纵横家合纵：手牌上限覆盖）
        const _dcCost = gameState.playerDrawsThisTurn[campKey] === 0 ? CARD_SYSTEM_CONFIG.drawCost : CARD_SYSTEM_CONFIG.drawCost * 2;
        const handSizeBonus = (gameState._cardOverrides && gameState._cardOverrides[campKey]) ? gameState._cardOverrides[campKey].handSizeBonus || 0 : 0;
        if (hand.length >= CARD_SYSTEM_CONFIG.maxHandSize + handSizeBonus ||
            gameState.playerGold[campKey] < _dcCost ||
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
        const cardEntry0 = hand[i];
        const cardId0 = typeof cardEntry0 === 'object' ? cardEntry0.id : cardEntry0;
        const cfg = TACTICAL_CARD_CONFIG[cardId0] || COLONEL_CARDS[cardId0];
        if (!cfg) continue;
        const bx = cxBase2 + (n - 1 - i) * peekW;
        const by = cyBase2;
        if (cx >= bx && cx <= bx + cardW && cy >= by && cy <= by + cardH) {
            const cardEntry = hand[i];
            const cardId = typeof cardEntry === 'object' ? cardEntry.id : cardEntry;
            const isCopyCard = typeof cardEntry === 'object' && cardEntry._copy;
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
            // E3 纵横家合纵：用卡次数上限覆盖
            const useBonus = (gameState._cardOverrides && gameState._cardOverrides[campKey]) ? gameState._cardOverrides[campKey].useBonus || 0 : 0;
            if (gameState.playerUsesThisTurn[campKey] >= CARD_SYSTEM_CONFIG.maxUsesPerTurn + useBonus) {
                notify('本回合已达到使用上限', 'error'); return;
            }
            // E4 空军上校：进入选目标前先校验部署/金币/雾天，避免卡在选目标态
            if (COLONEL_CARDS[cardId]) {
                if (!gameState._colonelDeployed || !gameState._colonelDeployed[campKey]) { notify('请先部署空军上校', 'error'); return; }
                const goldCost = COLONEL_CARD_GOLD[cardId] || 0;
                if ((gameState.playerGold[campKey] || 0) < goldCost) { notify('金币不足', 'error'); return; }
                if (gameState.weather === 'fog') { notify('雾天停飞，无法使用空军卡', 'error'); return; }
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
            gameState.cardTargeting = { cardId, targeting: cfg.targeting, handIndex: i };
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
        desc: '位于城市时：每回合回复10%生命值，防御力+10%，攻击/反击造成的伤害提高15%，反击浮动更高',
        active: (u) => u.tile.isCity
    },
    cavalry: {
        name: '冲锋',
        desc: '势能：本回合每移动1格，造成的伤害提高10%（上限30%），回合结束消失',
        active: (u) => u.moveDistance >= 1
    },
    archer: {
        name: '远射',
        desc: '山地射程+1（不与风天叠加）；风天射程+1且无视敌人15%防御力',
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
        const cmdHpBonus = cmdCfgHp ? Math.round(unit.config.hp * (cmdCfgHp.hpBonusPct || 0)) : 0;
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
        const cityDefBonus = (unit.type === 'infantry' && isCity) ? 0.10 : 0;
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
                // 堕天使使用动态形态显示（保留特殊逻辑）
                if (unit.commander === 'fallenAngel') {
                    let faColor, faStatus, faDesc;
                    if (unit._fallen) {
                        faColor = '#ff6644';
                        faDesc = '每回合流失当前生命值的20%，攻击力+30、暴击率+60%，士气恢复正常时切换至【☆堕天使·白】';
                        faStatus = '【★堕天使·黑】';
                    } else {
                        faColor = '#6688ff';
                        faDesc = '每回合回复已损失生命值的30%，士气上升或下降时切换至【★堕天使·黑】';
                        faStatus = '【☆堕天使·白】';
                    }
                    const faLine = `<span style="color:${faColor};">${faStatus}${faDesc}</span>`;
                    skillHtml += (skillHtml ? '<br>' : '') + faLine;
                } else if (cmdCfg2.skills && cmdCfg2.skills.length) {
                    // 新多技能分段显示
                    for (const sk of cmdCfg2.skills) {
                        const skColor = sk.type === 'active' ? '#ff9944' : '#88ccff';
                        const skLine = `<span style="color:${skColor};">【${sk.name}】${sk.desc}</span>`;
                        skillHtml += (skillHtml ? '<br>' : '') + skLine;
                    }
                } else {
                    // 旧版单技能格式
                    let active = true;
                    let statusNote = '';
                    let cmdDesc = cmdCfg2.tooltipDesc || cmdCfg2.desc;
                    let cmdColor = '#ffd700';

                    if (unit.commander === 'minister') {
                        active = !!(unit.tile && unit.tile.isCity);
                        statusNote = active ? '（生效中）' : '（未驻扎城市，未生效）';
                    } else if (unit.commander === 'martyr') {
                        if (unit._martyrPrimed) {
                            cmdColor = '#ff3300';
                            statusNote = '【★殉道】技能已激活，';
                            cmdDesc = '下回合开始时对2格范围内所有非己方单位造成大量范围伤害';
                        }
                    } else if (unit.commander === 'berserker') {
                        const hpLostPct = ((unit.maxHp - unit.hp) / unit.maxHp) * 100;
                        const stacks = Math.min(40, Math.floor(hpLostPct / 2.0));
                        if (stacks > 0) {
                            cmdDesc = `当前加成：+${stacks}% 攻击力、+${stacks}% 防御力`;
                        } else {
                            cmdDesc = '未触发（满血状态）';
                        }
                    }

                    const color = active ? cmdColor : '#888';
                    const tag = (cmdCfg2.activeSkill && active && unit.activeSkillDur <= 0) ? '（主动技能）' : '';
                    const prefix = (unit.commander === 'martyr' && unit._martyrPrimed) ? '' : `【☆${cmdCfg2.skill}】`;
                    const cmdLine = `<span style="color:${color};">${prefix}${statusNote}${tag}${cmdDesc}</span>`;
                    skillHtml += (skillHtml ? '<br>' : '') + cmdLine;
                }
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

        // E2 亡灵法师留魂数量
        if (unit.commander === 'necromancer' && gameState._soulMarks) {
            const campKey = unit.camp === CAMP.player1 ? 'player1' : unit.camp === CAMP.player2 ? 'player2' : 'player3';
            const myMarks = gameState._soulMarks.filter(m => m.campKey === campKey).length;
            if (myMarks > 0) {
                tooltipMorale.innerHTML += (tooltipMorale.innerHTML ? '<br>' : '') +
                    `<span style="color:#44ff88;">亡魂标记：${myMarks}个（回合开始牵引最近1个）</span>`;
            }
        }

        // E3 纵横家合纵状态
        if (unit.commander === 'diplomat' && gameState._cardOverrides) {
            const campKey = unit.camp === CAMP.player1 ? 'player1' : unit.camp === CAMP.player2 ? 'player2' : 'player3';
            const co = gameState._cardOverrides[campKey];
            if (co) {
                let dipText = `<span style="color:#ffd700;">【合纵】手牌上限+${co.handSizeBonus}、用卡次数+${co.useBonus}</span>`;
                if (unit.tile && unit.tile.camp !== unit.camp) {
                    dipText += `<br><span style="color:#ffaa44;">【连横】处于敌方行政区，35%概率复制对方对策卡</span>`;
                }
                tooltipMorale.innerHTML += (tooltipMorale.innerHTML ? '<br>' : '') + dipText;
            }
        }

        // E1 占星者星光护体状态
        if (unit.commander !== 'astrologer' && gameState.tileMap) {
            const astroDef = getCommander('astrologer');
            if (astroDef && astroDef.isInWeatherShield &&
                astroDef.isInWeatherShield(unit.tile, unit.camp, gameState.tileMap)) {
                tooltipMorale.innerHTML += (tooltipMorale.innerHTML ? '<br>' : '') +
                    `<span style="color:#aabbff;">✦ 星光护体（天气免疫）</span>`;
            }
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
            if (tile._cityDisabledUntil > 0 && tile._cityDisabledUntil > getRoundIndex(gameState)) {
                terrainDesc += ' 🚫 遭到空袭，无法产金或招募';
            }
        } else {
            terrainDesc = `防御+${Math.round(tc.defenseBonus * 100)}%`;
            if (tile.terrain === 'forest') terrainDesc += '（对炮兵/要塞/空军额外+15%）';
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
                if (unit.tile.isCity)         effects.push('每回合回血15%');
                if (unit.type === 'infantry' && unit.tile.isCity) effects.push('守城防御+10%');
            } else if (gameState.weather === 'fog') {
                if (unit.type === 'archer')   effects.push('射程−1');
                if (unit.type === 'cavalry')  effects.push('增伤+20%', '冲锋15%/格');
            } else if (gameState.weather === 'wind') {
                if (unit.type === 'archer')   effects.push('射程+1', '增伤+20%');
                if (unit.type === 'infantry') effects.push('防御-15%');
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
            const noFaith = unit.commander === 'paladin' && unit._faith < 1 && !unit._smiteReady;
            const noFaithUpgrade = unit.commander === 'paladin' && unit._smiteReady && !unit._smiteCharged && unit._faith < 1;
            const smiteFull = unit.commander === 'paladin' && unit._smiteReady && unit._smiteCharged;
            const canUse = !onCD && !isActive && unit.canAct && !unit.isNewRecruit && !noFaith && !noFaithUpgrade && !smiteFull;
            // 按钮文字：已蓄1层时显示「至圣斩·誓约」引导玩家升级
            if (unit.commander === 'paladin' && unit._smiteReady && !unit._smiteCharged) {
                skillBtn.textContent = '至圣斩·誓约';
            } else {
                skillBtn.textContent = skill.name;
            }
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

    // ==== E5 补员按钮 ====
    const reinforceBtn = document.getElementById('tooltipReinforce');
    if (reinforceBtn) {
        const canReinforce = unit && unit.camp === gameState.currentCamp
            && unit.tile && (unit.tile.isCity || unit.tile.isVillage)
            && unit.hp < unit.maxHp && !unit.tile._reinforcedThisTurn
            && (!isNetworkGame() || isMyTurn(gameState.currentCamp));
        if (canReinforce) {
            const healAmt = Math.min(Math.floor(unit.maxHp * 0.50), unit.maxHp - unit.hp);
            const cost = Math.max(1, Math.ceil(unit.config.cost * (healAmt / unit.maxHp)));
            reinforceBtn.textContent = `🪙 补充兵员 $${cost}`;
            reinforceBtn.style.display = 'block';
            reinforceBtn.disabled = false;
            reinforceBtn.className = 'tooltip-skill-btn';
            reinforceBtn.dataset.unitId = unit.id;
        } else if (unit && unit.camp === gameState.currentCamp && unit.tile
                   && (unit.tile.isCity || unit.tile.isVillage)
                   && unit.tile._reinforcedThisTurn) {
            reinforceBtn.textContent = '本回合已补员';
            reinforceBtn.style.display = 'block';
            reinforceBtn.disabled = true;
            reinforceBtn.className = 'tooltip-skill-btn on-cooldown';
        } else {
            reinforceBtn.style.display = 'none';
        }
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
export function rebindInputEvents() { _inputInitialized = false; initInput(); }
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
            const myCamp = _getMyCampInput();
            // E4 空运第二段：直接执行空运（不取消，_executeAirliftDest 内部会清理）
            if (ct.cardId === 'airlift_dest') {
                if (isColonelTargetBlocked(clickedTile, myCamp)) return; // 超出上校航程禁降
                executeTacticalCard('airlift_dest', clickedTile);
                return;
            }
            const cfg = TACTICAL_CARD_CONFIG[ct.cardId] || COLONEL_CARDS[ct.cardId];
            if (!cfg) { cancelCardTargeting(); return; }

            let isValid = false;
            if (ct.targeting === 'enemyGlobal') {
                isValid = clickedTile.unit && clickedTile.unit.camp !== myCamp;
            } else if (ct.targeting === 'friendlyAlive') {
                isValid = clickedTile.unit && clickedTile.unit.camp === myCamp && clickedTile.unit.canAct;
            } else if (ct.targeting === 'friendlyAny') {
                isValid = clickedTile.unit && clickedTile.unit.camp === myCamp
                    // E4 空运：不能运送上校自己，且被禁锢的单位不可被空运
                    && !(ct.cardId === 'airlift' && (clickedTile.unit.commander === 'colonel' || clickedTile.unit._imprisoned));
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
            } else if (ct.targeting === 'anyUnit') {
                isValid = clickedTile.unit != null;
            } else if (ct.targeting === 'anyTileGlobal') {
                isValid = true; // 侦察卡：全图任意地块均可选
            }

            // E4 上校空军卡：目标须在上校6格航程内（含空运拾取/落点；防空区不阻挡，仅降伤）
            if (isValid && COLONEL_CARDS[ct.cardId] && isColonelTargetBlocked(clickedTile, myCamp)) {
                isValid = false;
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
        const ownEmptyVillage = clickedTile.isVillage && clickedTile.camp === gameState.currentCamp && !clickedTile.unit;

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
        } else if (ownEmptyCity || ownEmptyVillage) {
            gameState.selectedCityTile = clickedTile;
        } else if (clickedTile.unit) {
            // 敌方/中立/不可行动单位：可选中查看（tooltip / 作弊控制台用），不显示行动范围
            gameState.selectedUnit = clickedTile.unit;
        }

        updateRecruitButtonStates();
        updateRecruitCostDisplay();
        // 遭遇战迷雾：仅视野内地块显示 tooltip
        if (!gameState.skirmishFog || isTileVisible(clickedTile, getViewingCamp(), gameState)) {
            showTooltipForTile(clickedTile);
        }
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
export function rebindKeyboardEvents() { _keyboardInitialized = false; initKeyboard(); }
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
        document.getElementById('soundVolume').value = Math.round((settings.soundVolume ?? 0.7) * 100);
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
        setMuted(!e.target.checked);
        saveSettings();
        // 同步大厅静音按钮
        const muteBtn = document.getElementById('lobbyMuteBtn');
        if (muteBtn) {
            muteBtn.textContent = e.target.checked ? '🔊' : '🔇';
            muteBtn.classList.toggle('muted', !e.target.checked);
        }
    });

    document.getElementById('soundVolume').addEventListener('input', (e) => {
        const vol = parseInt(e.target.value) / 100;
        settings.soundVolume = vol;
        setMasterVolume(vol);
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
                gameState, logMessage,
                spawnFx: spawnCommanderSkillEffect,
                spawnOrbitBeams: spawnPaladinOrbitBeams
            });
            // E1 占星者星移：显示天气选择界面
            if (unit._pendingWeatherChoice) {
                unit._pendingWeatherChoice = false;
                _showWeatherChoice(unit);
                return; // 天气选择完成后再设置CD和广播
            }
            unit.activeSkillDur = skill.duration;
            unit.activeSkillCD = skill.cooldown;
            recalcAllFlankingMorale();
            showTooltipForTile(unit.tile);
            if (isNetworkGame()) sendAction('activateSkill', serializeState(), { unitId: unit.id });
        });
    }

    // E5 补员按钮
    const reinforceBtn = document.getElementById('tooltipReinforce');
    if (reinforceBtn && !reinforceBtn._bound) {
        reinforceBtn._bound = true;
        reinforceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const unitId = parseInt(reinforceBtn.dataset.unitId);
            if (!unitId || isNaN(unitId)) return;
            const unit = gameState.tiles.reduce((f, t) => f || (t.unit?.id === unitId ? t.unit : null), null);
            if (!unit) return;
            reinforceUnit(unit);
            showTooltipForTile(unit.tile);
        });
    }

    // E1 占星者星移天气选择按钮
    const weatherBtns = document.querySelectorAll('.weather-choice-btn');
    weatherBtns.forEach(btn => {
        if (!btn._bound) {
            btn._bound = true;
            btn.addEventListener('click', () => {
                const weather = btn.dataset.weather;
                _applyWeatherChoice(weather);
            });
        }
    });
}

// E1 占星者：显示天气选择覆盖层（存 unit.id 而非引用，防序列化后悬空指针）
function _showWeatherChoice(unit) {
    const overlay = document.getElementById('weatherChoiceOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    overlay._astrologerUnitId = unit ? unit.id : null;
}

// E1 占星者：应用天气选择
function _applyWeatherChoice(chosenWeather) {
    const overlay = document.getElementById('weatherChoiceOverlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    // 通过 ID 重新查找 unit，防止网络同步后引用悬空
    let unit = null;
    if (overlay._astrologerUnitId != null) {
        for (const t of gameState.tiles) {
            if (t.unit && t.unit.id === overlay._astrologerUnitId) { unit = t.unit; break; }
        }
    }
    overlay._astrologerUnitId = null;
    if (!unit) return;

    // 锁定天气：不覆盖 lastWeather（让自然天气循环在锁定结束后干净恢复），设 resume 标记
    gameState.weather = chosenWeather;
    gameState._starlightResume = true;
    gameState.weatherLockUntil = getRoundIndex(gameState) + 2;

    logMessage(`占星者【星移】：天气强制为${chosenWeather === 'clear' ? '晴' : chosenWeather === 'rain' ? '雨' : chosenWeather === 'fog' ? '雾' : '风'}，锁定2回合`);
    spawnAstrologerEffect(unit.tile.x, unit.tile.y);

    // 设置CD
    const cmdCfg = getCommander(unit.commander);
    if (cmdCfg && cmdCfg.activeSkill) {
        unit.activeSkillCD = cmdCfg.activeSkill.cooldown;
    }
    unit.activeSkillDur = 0;
    recalcAllFlankingMorale();
    showTooltipForTile(unit.tile);
    if (isNetworkGame()) sendAction('activateSkill', serializeState(), { unitId: unit.id });
}
