import { gameState, notify, updateUI } from './state.js';
import { isNetworkGame } from './network.js';
import { CAMP, MORALE_CONFIG, WEATHER_CONFIG } from './config.js';
import { Unit } from './Unit.js';
import { spawnMoraleEffect } from './effects.js';

const consoleEl = document.getElementById('cheatConsole');
const inputEl = document.getElementById('cheatInput');
const suggestEl = document.getElementById('cheatSuggest');
let active = false;

const COMMANDS = [
    { cmd: '/kill',     desc: '击杀选中单位', subs: null },
    { cmd: '/heal',     desc: '选中单位血量回满', subs: null },
    { cmd: '/morale',   desc: '设置士气', subs: [
        { cmd: 'high',   desc: '士气上升' },
        { cmd: 'normal', desc: '正常' },
        { cmd: 'low',    desc: '士气下降' },
        { cmd: 'chaos',  desc: '混乱' },
    ]},
    { cmd: '/god',      desc: '切换无敌状态', subs: null },
    { cmd: '/gold',     desc: '加金币 <数量>', subs: null },
    { cmd: '/spawn',    desc: '招募单位', subs: [
        { cmd: '步', desc: '步兵' },
        { cmd: '骑', desc: '骑兵' },
        { cmd: '炮', desc: '炮兵' },
    ]},
    { cmd: '/weather',  desc: '切换天气', subs: [
        { cmd: 'clear', desc: '晴天' },
        { cmd: 'rain',  desc: '雨天' },
        { cmd: 'fog',   desc: '雾天' },
        { cmd: 'wind',  desc: '风天' },
    ]},
];

function toggle() {
    active = !active;
    consoleEl.style.display = active ? 'block' : 'none';
    suggestEl.style.display = 'none';
    if (active) {
        inputEl.value = '';
        inputEl.focus();
    }
}

function showSuggestions(filter) {
    const parts = filter.trim().split(/\s+/);
    const prefix = parts[0].toLowerCase();
    const hasSpace = filter.endsWith(' ') || parts.length > 1;

    // Check if we should show sub-options
    if (hasSpace && parts.length >= 1) {
        const parent = COMMANDS.find(c => c.cmd === prefix);
        if (parent && parent.subs) {
            const rest = parts.slice(1).join(' ').toLowerCase();
            const matches = rest
                ? parent.subs.filter(s => s.cmd.startsWith(rest) || s.desc.includes(rest))
                : parent.subs;
            if (matches.length > 0) {
                suggestEl.style.display = 'flex';
                suggestEl.innerHTML = matches.map(s =>
                    `<span class="cheat-suggest-item" data-cmd="${parent.cmd} ${s.cmd}">${s.cmd} — ${s.desc}</span>`
                ).join('');
                suggestEl.querySelectorAll('.cheat-suggest-item').forEach(el => {
                    el.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        inputEl.value = el.dataset.cmd + ' ';
                        suggestEl.style.display = 'none';
                        inputEl.focus();
                    });
                });
                return;
            }
        }
    }

    // Show top-level command suggestions
    const matches = prefix
        ? COMMANDS.filter(c => c.cmd.startsWith(prefix))
        : COMMANDS;
    if (matches.length === 0) {
        suggestEl.style.display = 'none';
        return;
    }
    suggestEl.style.display = 'flex';
    suggestEl.innerHTML = matches.map(c =>
        `<span class="cheat-suggest-item" data-cmd="${c.cmd}">${c.cmd} — ${c.desc}</span>`
    ).join('');
    suggestEl.querySelectorAll('.cheat-suggest-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            inputEl.value = el.dataset.cmd + ' ';
            suggestEl.style.display = 'none';
            inputEl.focus();
        });
    });
}

inputEl.addEventListener('input', () => {
    const val = inputEl.value;
    if (val.startsWith('/')) {
        showSuggestions(val);
    } else {
        suggestEl.style.display = 'none';
    }
});

function exec(cmd) {
    const args = cmd.trim().split(/\s+/);
    const op = args[0].toLowerCase();
    const unit = gameState.selectedUnit;
    const campKey = gameState.currentCamp === CAMP.player1 ? 'player1' : 'player2';

    switch (op) {
        case '/kill':
            if (!unit) { notify('请先选中一个单位', 'error'); break; }
            unit.hp = 0;
            unit.tile.unit = null;
            notify(`已击杀 ${unit.camp.name} ${unit.config.name}兵`);
            break;

        case '/heal':
            if (!unit) { notify('请先选中一个单位', 'error'); break; }
            unit.hp = unit.maxHp;
            notify(`${unit.camp.name} ${unit.config.name}兵 血量已回满`);
            break;

        case '/morale':
            if (!unit) { notify('请先选中一个单位', 'error'); break; }
            {
                const map = { high: 3, normal: 2, low: 1, chaos: 0, '3': 3, '2': 2, '1': 1, '0': 0 };
                if (!args[1] || !(args[1] in map)) {
                    notify('用法: /morale <high|normal|low|chaos>', 'error');
                    break;
                }
                unit.morale = map[args[1]];
                if (unit.morale === 0) unit.canAct = false;
                spawnMoraleEffect(unit);
                notify(`${unit.camp.name} ${unit.config.name}兵 士气设为 ${MORALE_CONFIG[unit.morale].name}`);
            }
            break;

        case '/god':
            if (!unit) { notify('请先选中一个单位', 'error'); break; }
            unit.godMode = !unit.godMode;
            notify(`${unit.camp.name} ${unit.config.name}兵 无敌: ${unit.godMode ? 'ON' : 'OFF'}`);
            break;

        case '/gold':
            if (!args[1] || isNaN(args[1])) { notify('用法: /gold <数量>', 'error'); break; }
            gameState.playerGold[campKey] += parseInt(args[1]);
            notify(`金币 +${args[1]}，现有 ${gameState.playerGold[campKey]}`);
            break;

        case '/weather':
            if (!args[1] || !WEATHER_CONFIG[args[1]]) {
                notify('用法: /weather <clear|rain|fog|wind>', 'error');
                break;
            }
            gameState.weather = args[1];
            gameState.lastWeather = args[1] === 'clear' ? gameState.lastWeather : args[1];
            updateUI();
            notify(`天气已切换为 ${WEATHER_CONFIG[args[1]].icon} ${WEATHER_CONFIG[args[1]].name}`);
            break;

        case '/spawn':
            if (!args[1] || !{'步':'infantry','骑':'cavalry','炮':'archer'}[args[1]]) {
                notify('用法: /spawn <步|骑|炮>', 'error');
                break;
            }
            { const tile = gameState.selectedCityTile || unit?.tile;
            if (!tile) { notify('请先选中一个单位或城市', 'error'); break; }
            if (tile.unit) { notify('目标地块已有单位', 'error'); break; }
            const type = {'步':'infantry','骑':'cavalry','炮':'archer'}[args[1]];
            new Unit(type, gameState.currentCamp, tile, true);
            notify(`已招募 ${args[1]}兵`); }
            break;

        default:
            notify(`未知命令: ${op}`, 'error');
    }
}

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        if (isNetworkGame()) { notify('联机模式下不可用', 'error'); return; }
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
        if (cmd) exec(cmd);
        inputEl.value = '';
        suggestEl.style.display = 'none';
    }
});
