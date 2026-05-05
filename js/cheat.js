import { gameState, logMessage, notify } from './state.js';
import { isNetworkGame } from './network.js';
import { CAMP } from './config.js';
import { Unit } from './Unit.js';

const consoleEl = document.getElementById('cheatConsole');
const inputEl = document.getElementById('cheatInput');
let active = false;

function toggle() {
    active = !active;
    consoleEl.style.display = active ? 'block' : 'none';
    if (active) {
        inputEl.value = '';
        inputEl.focus();
    }
}

function exec(cmd) {
    const args = cmd.trim().split(/\s+/);
    const op = args[0].toLowerCase();
    const unit = gameState.selectedUnit;
    const campKey = gameState.currentCamp === CAMP.player1 ? 'player1' : 'player2';

    switch (op) {
        case '/help':
            logMessage('/kill 击杀选中单位 | /heal 回满血量 | /morale <high|normal|low|chaos> 设置士气');
            logMessage('/god 无敌切换 | /gold <数量> 加金币 | /spawn <步|骑|炮> 在当前选中格招募单位');
            break;

        case '/kill':
            if (!unit) { logMessage('请先选中一个单位'); break; }
            unit.hp = 0;
            unit.tile.unit = null;
            logMessage(`已击杀 ${unit.camp.name} ${unit.config.name}兵`);
            break;

        case '/heal':
            if (!unit) { logMessage('请先选中一个单位'); break; }
            unit.hp = unit.maxHp;
            logMessage(`${unit.camp.name} ${unit.config.name}兵 血量已回满`);
            break;

        case '/morale':
            if (!unit) { logMessage('请先选中一个单位'); break; }
            if (!args[1] || !['high','normal','low','chaos'].includes(args[1])) {
                logMessage('用法: /morale <high|normal|low|chaos>');
                break;
            }
            unit.morale = args[1];
            if (args[1] === 'chaos') unit.canAct = false;
            logMessage(`${unit.camp.name} ${unit.config.name}兵 士气设为 ${args[1]}`);
            break;

        case '/god':
            if (!unit) { logMessage('请先选中一个单位'); break; }
            unit.godMode = !unit.godMode;
            logMessage(`${unit.camp.name} ${unit.config.name}兵 无敌模式: ${unit.godMode ? '开启' : '关闭'}`);
            break;

        case '/gold':
            if (!args[1] || isNaN(args[1])) { logMessage('用法: /gold <数量>'); break; }
            gameState.playerGold[campKey] += parseInt(args[1]);
            logMessage(`当前阵营金币 +${args[1]}，现有 ${gameState.playerGold[campKey]}`);
            break;

        case '/spawn':
            if (!args[1] || !{'步':'infantry','骑':'cavalry','炮':'archer'}[args[1]]) {
                logMessage('用法: /spawn <步|骑|炮>');
                break;
            }
            { const tile = gameState.selectedCityTile || unit?.tile;
            if (!tile) { logMessage('请先选中一个单位或城市'); break; }
            if (tile.unit) { logMessage('目标地块已有单位'); break; }
            const type = {'步':'infantry','骑':'cavalry','炮':'archer'}[args[1]];
            new Unit(type, gameState.currentCamp, tile, true);
            logMessage(`已在 (${tile.q},${tile.r}) 招募 ${args[1]}兵`); }
            break;

        default:
            logMessage(`未知命令: ${op}，输入 /help 查看列表`);
    }
}

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        if (isNetworkGame()) { notify('作弊控制台仅在单机模式下可用', 'error'); return; }
        toggle();
        return;
    }
    if (!active) return;
    if (e.key === 'Escape') {
        toggle();
        return;
    }
    if (e.key === 'Enter') {
        const cmd = inputEl.value.trim();
        if (cmd) {
            logMessage(`> ${cmd}`);
            exec(cmd);
        }
        inputEl.value = '';
    }
});
