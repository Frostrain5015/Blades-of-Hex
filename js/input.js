import { HEX_SIZE, canvas, settings, saveSettings, MORALE_CONFIG, TERRAIN_CONFIG, CAMP, LOGICAL_W, LOGICAL_H, WEATHER_CONFIG } from './config.js';
import { getCommander, getCommanderDefenseBonus } from './commanderInterface.js';
import { gameState, clearselection, deselectUnit, updateRecruitButtonStates, saveGame, loadGame, notify, updateStatsPanel, updateRecruitCostDisplay, finalizeDeployment } from './state.js';
import { isMyTurn, isNetworkGame, getMyRole, syncCommanderState } from './network.js';
import {
    getMovableTiles, getAttackableTiles,
    moveUnit, attackUnit, recruitUnit, endTurn, undoLastAction
} from './gameLogic.js';
import { clearTransientEffects, spawnCommanderSkillEffect } from './effects.js';
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
const tooltipStatus = document.getElementById('tooltipStatus');
const tooltipPassive = document.getElementById('tooltipPassive');
const tooltipMorale = document.getElementById('tooltipMorale');

const PASSIVE_DEFS = {
    infantry: {
        name: '坚守',
        desc: '位于城市时：每回合回复10%生命值，防御+20%，反击暴击率提高至50%',
        active: (u) => u.tile.isCity
    },
    cavalry: {
        name: '冲锋',
        desc: '本回合移动至少2格后，造成伤害+25%',
        active: (u) => u.moveDistance >= 2
    },
    archer: {
        name: '远射',
        desc: '攻击不触发反击；山地射程+1（不与风天叠加）；无视敌方10%防御力',
        active: () => true
    }
};

function showTooltipForTile(tile) {
    const unit = tile.unit;
    const isCity = tile.isCity;
    const tc = TERRAIN_CONFIG[tile.terrain];

    if (unit) {
        const typeNames = { infantry: '步兵', cavalry: '骑兵', archer: '炮兵' };
        const deployHint = (gameState.commanderPhase === 'deployment' && unit.camp === gameState.currentCamp) ? ' — 点击挂载将领' : '';
        let headerText = `${unit.camp.name}·${typeNames[unit.type] || unit.config.name}`;
        if (unit.commander) {
            const cmdCfgHdr = getCommander(unit.commander);
            if (cmdCfgHdr) headerText += ` ${cmdCfgHdr.name}`;
        }
        tooltipHeader.textContent = headerText + deployHint;
        tooltipHeader.style.color = gameState.commanderPhase === 'deployment' ? '#ffd700' : unit.camp.color;

        const hpRatio = unit.hp / unit.maxHp;
        const hpColor = hpRatio > 0.5 ? '#4CAF50' : hpRatio > 0.25 ? '#FF9800' : '#f44336';
        tooltipHpFill.style.width = (hpRatio * 100) + '%';
        tooltipHpFill.style.backgroundColor = hpColor;
        const cmdCfgHp = unit.commander ? getCommander(unit.commander) : null;
        const cmdHpBonus = cmdCfgHp ? cmdCfgHp.hpBonus : 0;
        const hpBonusStr = cmdHpBonus > 0 ? `<span style="font-size:9px;color:#ffd700;"> (+${cmdHpBonus})</span>` : '';
        tooltipHpText.innerHTML = `❤ ${Math.round(unit.hp)}/${unit.maxHp}${hpBonusStr}`;
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
        let auraDefBonus = 0;
        if (unit.commander !== 'ironGuard' && unit._findAdjacentFriendlyIronGuard && unit._findAdjacentFriendlyIronGuard()) {
            auraDefBonus = 0.10;
        }
        const cmdDefBonus = getCommanderDefenseBonus(unit);
        const totalDefPct = Math.round(((unit.config.defense || 0) + moraleDefBonus + auraDefBonus + cmdDefBonus) * 100);
        if (totalDefPct > 0) {
            tooltipDef.innerHTML = `<span style="color:#8fc;">🛡 ${totalDefPct}%</span>`;
        } else if (totalDefPct < 0) {
            tooltipDef.innerHTML = `<span style="color:#f66;">🛡 ${totalDefPct}%</span>`;
        } else {
            tooltipDef.innerHTML = `<span style="color:#888;">🛡 0%</span>`;
        }
        tooltipSpd.innerHTML = `<span style="color:#6cf;">⚡ ${Math.round(unit.displaySpeed)}/${unit.config.speed}</span>`;
        tooltipRng.innerHTML = `<span style="color:#f8a;">📡 ${unit.config.range}</span>`;
        tooltipStats.style.display = '';

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
                if (unit.commander === 'minister') {
                    active = !!(unit.tile && unit.tile.isCity);
                    statusNote = active ? '（生效中）' : '（未驻扎城市，未生效）';
                }
                const color = active ? '#ffd700' : '#888';
                const cmdLine = `<span style="color:${color};">【☆${cmdCfg2.skill}】${cmdCfg2.desc}${statusNote}</span>`;
                skillHtml += (skillHtml ? '<br>' : '') + cmdLine;
            }
        }
        tooltipPassive.innerHTML = skillHtml;

        // ==== 效果区 ====
        if (unit.morale !== 2) {
            const mc = MORALE_CONFIG[unit.morale];
            tooltipMorale.innerHTML = `<span style="color:${mc.color};">【${mc.name}】${mc.desc}</span>`;
        } else {
            tooltipMorale.innerHTML = '';
        }

        tooltipEl.style.borderColor = unit.camp.color;
    } else {
        tooltipHeader.textContent = '';
        tooltipHeader.style.color = '';
        tooltipHpBar.style.display = 'none';
        tooltipStats.style.display = 'none';
        tooltipStatus.textContent = '';
        tooltipPassive.innerHTML = '';
        tooltipMorale.innerHTML = '';
        tooltipEl.style.borderColor = 'rgba(255,255,255,0.15)';
    }

    // 铁卫灵光buff（所有友军，不含铁卫自身）
    if (unit && unit.commander !== 'ironGuard' && unit._findAdjacentFriendlyIronGuard && unit._findAdjacentFriendlyIronGuard()) {
        const auraLine = `<span style="color:#7eb8ff;">【守护灵光】防御+10%，50%伤害转由铁卫承担</span>`;
        tooltipMorale.innerHTML += (tooltipMorale.innerHTML ? '<br>' : '') + auraLine;
    }

    // 停滞者缚足debuff（范围内敌军）
    if (unit && unit.commander !== 'staller') {
        let inStallerZone = false;
        if (unit.tile) {
            const tile = unit.tile;
            if (tile.unit && tile.unit.commander === 'staller' && tile.unit.camp !== unit.camp) inStallerZone = true;
            else {
                const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
                for (const [dq, dr] of dirs) {
                    const n = gameState.tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                    if (n && n.unit && n.unit.commander === 'staller' && n.unit.camp !== unit.camp) {
                        inStallerZone = true; break;
                    }
                }
            }
        }
        if (inStallerZone) {
            const snareLine = `<span style="color:#b08050;">🪤 缚足：移动消耗+3</span>`;
            tooltipMorale.innerHTML += (tooltipMorale.innerHTML ? '<br>' : '') + snareLine;
        }
    }

    // Terrain info — shown last
    const showTerrain = isCity || tile.terrain !== 'plains';
    if (showTerrain) {
        const terrainName = isCity ? '城市' : tc.name;
        let terrainDesc = '';
        if (isCity) {
            const ownerName = tile.camp === CAMP.player1 ? '红军' : tile.camp === CAMP.player2 ? '蓝军' : '中立';
            terrainDesc = `由${ownerName}控制`;
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
                if (unit.type === 'infantry') effects.push('暴击率≤5%');
            }
            if (effects.length > 0) weatherDesc = effects.join('，');
            else weatherDesc = '无直接影响';
        }
        const weatherLine = `<span style="color:${wc.color};">${wc.icon}【${wc.name}】${weatherDesc}</span>`;
        const target = unit ? tooltipMorale : tooltipPassive;
        target.innerHTML += (target.innerHTML ? '<br>' : '') + weatherLine;
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

    canvas.addEventListener('click', (e) => {
        if (gameState.gameOver) return;
        const { x: clickX, y: clickY } = toLogical(e);

        const clickedTile = getTileAtPixel(clickX, clickY);
        if (!clickedTile) {
            clearselection();
            hideTooltip();
            return;
        }

        // 部署阶段：将领挂载到单位
        if (gameState.commanderPhase === 'deployment') {
            const myCamp = isNetworkGame() ? (getMyRole() === 'player1' ? CAMP.player1 : CAMP.player2) : gameState.currentCamp;
            // 已部署则锁定画布
            const iAmDeployed = myCamp === CAMP.player1 ? gameState.commanderP1Deployed : gameState.commanderP2Deployed;
            if (iAmDeployed) return;
            const isOwn = clickedTile.unit && clickedTile.unit.camp === myCamp;
            if (!isOwn) return;
            if (gameState.selectedUnit === clickedTile.unit) {
                // 二次点击确认部署（统一单机/联机处理）
                const myCamp = isNetworkGame() ? (getMyRole() === 'player1' ? CAMP.player1 : CAMP.player2) : gameState.currentCamp;
                const cmdKey = myCamp === CAMP.player1 ? gameState.commanderP1 : gameState.commanderP2;
                clickedTile.unit.commander = cmdKey;
                const cmdCfg = getCommander(cmdKey);
                if (cmdCfg) {
                    clickedTile.unit.hp += cmdCfg.hpBonus;
                    clickedTile.unit.maxHp += cmdCfg.hpBonus;
                    clickedTile.unit.displayHp = clickedTile.unit.hp;
                    clickedTile.unit._atkBonus = cmdCfg.atkBonus;
                    clickedTile.unit.remainingMP += cmdCfg.spdBonus;
                    clickedTile.unit.displaySpeed += cmdCfg.spdBonus;
                }
                spawnCommanderSkillEffect(clickedTile.x, clickedTile.y);
                // 标记当前阵营已部署
                if (myCamp === CAMP.player1) {
                    gameState.commanderP1Deployed = true;
                } else {
                    gameState.commanderP2Deployed = true;
                }
                notify(`${myCamp.name}将领已部署到${clickedTile.unit.config.name}兵`);
                // 单机模式：切换到对方部署
                if (!isNetworkGame() && !(gameState.commanderP1Deployed && gameState.commanderP2Deployed)) {
                    gameState.currentCamp = (myCamp === CAMP.player1) ? CAMP.player2 : CAMP.player1;
                    updateButtonColors();
                    updateUI();
                    notify(`请${gameState.currentCamp.name}选择目标单位部署将领（选中后二次点击确认）`);
                } else if (isNetworkGame()) {
                    // 联机：同步部署状态（含将领挂载的单位ID，对方需要知道）
                    const depUnitP1 = myCamp === CAMP.player1 ? clickedTile.unit.id : null;
                    const depUnitP2 = myCamp === CAMP.player2 ? clickedTile.unit.id : null;
                    syncCommanderState(
                        gameState.commanderPoolP1, gameState.commanderPoolP2,
                        gameState.commanderP1, gameState.commanderP2,
                        gameState.commanderP1Confirmed, gameState.commanderP2Confirmed,
                        gameState.commanderP1Deployed, gameState.commanderP2Deployed,
                        gameState.commanderPhase,
                        depUnitP1, depUnitP2
                    );
                }
                clearselection();
                hideTooltip();
                gameState.selectedTile = null;
                // 双方都已部署 → 统一收尾
                if (gameState.commanderP1Deployed && gameState.commanderP2Deployed) {
                    finalizeDeployment();
                }
                return;
            } else {
                // 首次点击：预选目标单位
                gameState.selectedUnit = clickedTile.unit;
                gameState.selectedTile = clickedTile;
                showTooltipForTile(clickedTile);
                return;
            }
        }

        // 点选已选中单位/地块 → 取消选中（己方可操作单位有光圈倒放动画）
        if (gameState.selectedTile === clickedTile) {
            if (gameState.selectedUnit) deselectUnit(); else clearselection();
            hideTooltip();
            gameState.selectedTile = null;
            return;
        }

        // 对手回合 / AI 回合：只允许查看，不允许操作
        if (!isMyTurn(gameState.currentCamp)) {
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
            attackUnit(gameState.selectedUnit, clickedTile.unit);
            clearselection();
            gameState.selectedTile = clickedTile;
            showTooltipForTile(clickedTile);
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
            gameState.selectionTime = Date.now();
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
                if (gameState.currentCamp !== CAMP.neutral) endTurn();
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

    settingsBtn.addEventListener('click', () => {
        settingsOverlay.classList.add('show');
        // 同步控件值
        document.getElementById('animSpeed').value = settings.animationSpeed;
        document.getElementById('animSpeedVal').textContent = settings.animationSpeed.toFixed(1) + 'x';
        document.getElementById('particleDensity').value = settings.particleDensity;
        document.getElementById('particleDensityVal').textContent = Math.round(settings.particleDensity * 100) + '%';
        document.getElementById('screenShake').checked = settings.screenShake;
        document.getElementById('turnFlash').checked = settings.turnFlash;
        document.getElementById('soundEnabled').checked = settings.soundEnabled;
    });

    settingsClose.addEventListener('click', () => {
        settingsOverlay.classList.remove('show');
    });

    settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) {
            settingsOverlay.classList.remove('show');
        }
    });

    document.getElementById('animSpeed').addEventListener('input', (e) => {
        settings.animationSpeed = parseFloat(e.target.value);
        document.getElementById('animSpeedVal').textContent = settings.animationSpeed.toFixed(1) + 'x';
        saveSettings();
    });

    document.getElementById('particleDensity').addEventListener('input', (e) => {
        settings.particleDensity = parseFloat(e.target.value) / 100;
        document.getElementById('particleDensityVal').textContent = e.target.value + '%';
        saveSettings();
    });

    document.getElementById('screenShake').addEventListener('change', (e) => {
        settings.screenShake = e.target.checked;
        saveSettings();
    });

    document.getElementById('turnFlash').addEventListener('change', (e) => {
        settings.turnFlash = e.target.checked;
        saveSettings();
    });

    document.getElementById('soundEnabled').addEventListener('change', (e) => {
        settings.soundEnabled = e.target.checked;
        saveSettings();
    });
}
