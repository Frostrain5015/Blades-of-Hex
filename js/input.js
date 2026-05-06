import { HEX_SIZE, canvas, settings, saveSettings, MORALE_CONFIG, TERRAIN_CONFIG, CAMP, LOGICAL_W, LOGICAL_H } from './config.js';
import { gameState, clearselection, updateRecruitButtonStates, saveGame, loadGame } from './state.js';
import { isMyTurn, isNetworkGame } from './network.js';
import {
    getMovableTiles, getAttackableTiles,
    moveUnit, attackUnit, recruitUnit, endTurn, undoLastAction
} from './gameLogic.js';
import { clearTransientEffects } from './effects.js';
import { HexTile } from './HexTile.js';
import { Unit } from './Unit.js';

// HTML tooltip 元素
const tooltipEl = document.getElementById('unitTooltip');
const tooltipHeader = document.getElementById('tooltipHeader');
const tooltipHpFill = document.getElementById('tooltipHpFill');
const tooltipHpText = document.getElementById('tooltipHpText');
const tooltipAtk = document.getElementById('tooltipAtk');
const tooltipSpd = document.getElementById('tooltipSpd');
const tooltipRng = document.getElementById('tooltipRng');
const tooltipStatus = document.getElementById('tooltipStatus');
const tooltipPassive = document.getElementById('tooltipPassive');
const tooltipMorale = document.getElementById('tooltipMorale');

let _mouseX = 0, _mouseY = 0;

const PASSIVE_DEFS = {
    infantry: {
        name: '坚守',
        desc: '位于城市时：每回合回复10%生命值，受到伤害−30%，反击暴击率提高至50%',
        active: (u) => u.tile.isCity
    },
    cavalry: {
        name: '冲锋',
        desc: '本回合移动至少2格后，造成伤害+25%',
        active: (u) => u.moveDistance >= 2
    },
    archer: {
        name: '远射',
        desc: '攻击时不会触发敌方反击',
        active: () => true
    }
};

function showTooltipForTile(tile) {
    const unit = tile.unit;
    const isCity = tile.isCity;
    const tc = TERRAIN_CONFIG[tile.terrain];

    if (unit) {
        const typeNames = { infantry: '步兵', cavalry: '骑兵', archer: '炮兵' };
        tooltipHeader.textContent = `${unit.camp.name}·${typeNames[unit.type] || unit.config.name}`;
        tooltipHeader.style.color = unit.camp.color;

        const hpRatio = unit.hp / unit.maxHp;
        const hpColor = hpRatio > 0.5 ? '#4CAF50' : hpRatio > 0.25 ? '#FF9800' : '#f44336';
        tooltipHpFill.style.width = (hpRatio * 100) + '%';
        tooltipHpFill.style.backgroundColor = hpColor;
        tooltipHpText.textContent = `❤ ${Math.round(unit.hp)}/${unit.maxHp}`;
        tooltipHpBar.style.display = '';

        const effAtk = unit.getEffectiveAttack();
        const baseAtk = unit.config.attack;
        const atkDelta = effAtk - baseAtk;
        if (atkDelta !== 0) {
            const sign = atkDelta > 0 ? '+' : '';
            const deltaColor = atkDelta > 0 ? '#ffd700' : '#ff8800';
            tooltipAtk.innerHTML = `<span style="color:#ff6;">⚔ ${effAtk}<span style="font-size:10px;color:${deltaColor};">(${sign}${atkDelta})</span></span>`;
        } else {
            tooltipAtk.innerHTML = `<span style="color:#ff6;">⚔ ${effAtk}</span>`;
        }
        tooltipSpd.innerHTML = `<span style="color:#6cf;">⚡ ${Math.round(unit.displaySpeed)}/${unit.config.speed}</span>`;
        tooltipRng.innerHTML = `<span style="color:#f8a;">📡 ${unit.config.range}</span>`;
        tooltipStats.style.display = '';

        const statusParts = [];
        if (unit.isNewRecruit) statusParts.push('新招募');
        tooltipStatus.textContent = statusParts.join(' | ');

        const def = PASSIVE_DEFS[unit.type];
        if (def) {
            const isActive = def.active(unit);
            tooltipPassive.innerHTML = `<span class="${isActive ? 'tooltip-passive-active' : 'tooltip-passive-inactive'}">【${def.name}】${def.desc}</span>`;
        } else {
            tooltipPassive.innerHTML = '';
        }

        if (unit.morale !== 2) {
            const mc = MORALE_CONFIG[unit.morale];
            const cls = unit.morale === 3 ? 'tooltip-morale-high' : 'tooltip-morale-debuff';
            tooltipMorale.innerHTML = `<span class="${cls}">【${mc.name}】${mc.desc}</span>`;
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

    // Terrain info — same 【】 style as skills; plains shown only for cities
    const showTerrain = isCity || tile.terrain !== 'plains';
    if (showTerrain) {
        const terrainName = isCity ? '城市' : tc.name;
        let terrainDesc = '';
        if (isCity) {
            const ownerName = tile.camp === CAMP.player1 ? '红军' : tile.camp === CAMP.player2 ? '蓝军' : '中立';
            terrainDesc = `由${ownerName}控制`;
        } else {
            terrainDesc = `受到伤害−${Math.round(tc.defenseBonus * 100)}%`;
            if (tc.moveDesc) terrainDesc += `，${tc.moveDesc}`;
        }
        const terrainLine = `<span style="color:#fff;">【${terrainName}】${terrainDesc}</span>`;
        if (unit) {
            tooltipMorale.innerHTML += (tooltipMorale.innerHTML ? '<br>' : '') + terrainLine;
        } else {
            tooltipPassive.innerHTML = terrainLine;
        }
    }

    if (!unit && !showTerrain) {
        tooltipEl.classList.remove('visible');
        return;
    }
    tooltipEl.classList.add('visible');

    // Position: avoid mouse cursor (convert logical coords to CSS pixels)
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / LOGICAL_W;
    const sy = rect.height / LOGICAL_H;
    const cssX = rect.left + tile.x * sx;
    const cssY = rect.top + tile.y * sy;
    const toRight = _mouseX < cssX;
    let left = toRight
        ? cssX + HEX_SIZE * sx + 12
        : cssX - 210 - HEX_SIZE * sx - 8;
    if (left < 0) left = 8;
    if (left + 210 > window.innerWidth) left = window.innerWidth - 210 - 8;
    let top = cssY - 40;
    if (top < 0) top = 8;
    if (top + 200 > window.innerHeight) top = window.innerHeight - 200;
    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';
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
export function initInput() {
    function toLogical(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (LOGICAL_W / rect.width),
            y: (e.clientY - rect.top) * (LOGICAL_H / rect.height)
        };
    }

    canvas.addEventListener('click', (e) => {
        if (gameState.gameOver) return;
        if (!isMyTurn(gameState.currentCamp)) return;
        const { x: clickX, y: clickY } = toLogical(e);
        _mouseX = e.clientX;
        _mouseY = e.clientY;

        const clickedTile = getTileAtPixel(clickX, clickY);
        if (!clickedTile) {
            clearselection();
            gameState.selectedTile = null;
            hideTooltip();
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
        }

        updateRecruitButtonStates();
        showTooltipForTile(clickedTile);
    });

    canvas.addEventListener('mouseleave', () => {
        gameState.hoveredTile = null;
        canvas.style.cursor = 'default';
    });

    canvas.addEventListener('mousemove', (e) => {
        _mouseX = e.clientX;
        _mouseY = e.clientY;
        const { x: mouseX, y: mouseY } = toLogical(e);
        gameState.hoveredTile = getTileAtPixel(mouseX, mouseY);

        // Reposition tooltip if visible
        if (tooltipEl.classList.contains('visible') && gameState.selectedTile) {
            const tile = gameState.selectedTile;
            const rect2 = canvas.getBoundingClientRect();
            const sx2 = rect2.width / LOGICAL_W;
            const sy2 = rect2.height / LOGICAL_H;
            const cssX2 = rect2.left + tile.x * sx2;
            const toRight = _mouseX < cssX2;
            let left = toRight
                ? cssX2 + HEX_SIZE * sx2 + 12
                : cssX2 - 210 - HEX_SIZE * sx2 - 8;
            if (left < 0) left = 8;
            if (left + 210 > window.innerWidth) left = window.innerWidth - 210 - 8;
            tooltipEl.style.left = left + 'px';
        }

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
export function initKeyboard() {
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
            clearselection();
            return;
        }

        if (!gameState.gameOver) {
            if (e.key === 'e' || e.key === 'Enter') {
                e.preventDefault();
                endTurn();
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
export function initSettingsPanel() {
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
