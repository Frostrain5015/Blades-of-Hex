// Lobby preparation dialog. It owns DOM selection state and delegates game starts to main.js.
import { COMMANDER_DRAFT } from '../rules/constants.js';
import { gameState } from './state.js';
import { createRoom } from './network.js';
import { STANDARD_MAP_FAMILIES } from '../rules/standardMaps.js';
// 难度选项直接从人格脚本的 meta 派生，避免「改了档名、准备页还显示旧名」。
// 这里只取三份轻量 meta，不经过 js/ai.js，那条链会把整个战斗执行层拖进大厅。
import { meta as optioMeta } from '../ai/optio.js';
import { meta as legatusMeta } from '../ai/legatus.js';
import { meta as imperatorMeta } from '../ai/imperator.js';

// 顺序即强度阶梯；id 仍是 easy/medium/hard，用于存档与 aiDifficulty 数值兼容。
const AI_DIFFICULTY_CHOICES = [optioMeta, legatusMeta, imperatorMeta].map(meta => ({
    id: meta.difficultyId,
    title: meta.name
}));

export function createPreparationController({
    beginCommanderPhase,
    beginPVECommanderPhase,
    beginTrainingCommanderPhase,
    showMultiplayerLobby,
    setStatus,
    switchLobbyView
}) {
    let action = null;

    function buildOptionRow(containerId, choices) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        const selected = choices[0].id;
        for (const choice of choices) {
            const element = document.createElement('div');
            element.className = 'prep-option' + (choice.id === selected ? ' selected' : '');
            element.dataset.value = choice.id;
            element.innerHTML = `<div class="prep-option-title">${choice.title}</div>${choice.desc ? `<div class="prep-option-desc">${choice.desc}</div>` : ''}`;
            element.addEventListener('click', () => {
                container.querySelectorAll('.prep-option').forEach((option) => option.classList.remove('selected'));
                element.classList.add('selected');
            });
            container.appendChild(element);
        }
    }

    function getSelection(containerId) {
        const selected = document.querySelector(`#${containerId} .prep-option.selected`);
        return selected ? selected.dataset.value : null;
    }

    function buildRuleOptions() {
        const container = document.getElementById('prepOptions2');
        container.className = 'prep-options prep-checkboxes';
        container.innerHTML = `
            <label class="prep-check-option">
                <input type="checkbox" id="prepSkirmish" />
                <span class="prep-check-copy"><strong>遭遇战</strong><small>开启战争迷雾</small></span>
            </label>
            <label class="prep-check-option">
                <input type="checkbox" id="prepDoubleCommander" />
                <span class="prep-check-copy"><strong>双将模式</strong><small>可部署两名将领</small></span>
            </label>
        `;
    }

    function showPrepDialog(nextAction) {
        action = nextAction;
        const title = document.getElementById('prepTitle');
        const typeSection = document.getElementById('prepSectionType');
        const difficultySection = document.getElementById('prepSectionDiff');
        typeSection.classList.remove('collapsed');
        difficultySection.classList.remove('collapsed');
        buildRuleOptions();
        buildOptionRow('prepOptionsMap', STANDARD_MAP_FAMILIES.map(map => ({
            id: map.id,
            title: map.name,
            desc: map.description
        })));
        document.getElementById('prepLabel2').textContent = '特殊规则';

        if (action === 'createRoom') {
            title.textContent = '创建房间';
            document.getElementById('prepLabel1').textContent = '对战人数';
            difficultySection.classList.remove('hidden');
            difficultySection.classList.add('collapsed');
            buildOptionRow('prepOptions1', [
                { id: '2p', title: '双人' },
                { id: '3p', title: '三人' }
            ]);
        } else if (action === 'training') {
            title.textContent = '训练场';
            document.getElementById('prepLabel1').textContent = '对战人数';
            difficultySection.classList.remove('hidden');
            difficultySection.classList.add('collapsed');
            buildOptionRow('prepOptions1', [
                { id: '2p', title: '双人' },
                { id: '3p', title: '三人' }
            ]);
        } else {
            title.textContent = '标准对局';
            document.getElementById('prepLabel1').textContent = '对战类型';
            buildOptionRow('prepOptions1', [
                { id: 'pve', title: 'PVE' },
                { id: 'local', title: '本地热座', desc: '玩家轮流操作' }
            ]);
            buildOptionRow('prepOptionsDiff', AI_DIFFICULTY_CHOICES);
            difficultySection.classList.remove('hidden', 'collapsed');
            const updateDifficulty = () => {
                difficultySection.classList.toggle('hidden', getSelection('prepOptions1') !== 'pve');
            };
            document.getElementById('prepOptions1').addEventListener('click', () => setTimeout(updateDifficulty, 50));
            updateDifficulty();
        }

        switchLobbyView('prepContent');
        document.getElementById('prepConfirm').onclick = executeChoice;
    }

    function executeChoice() {
        const selectedType = getSelection('prepOptions1');
        const skirmishFog = document.getElementById('prepSkirmish')?.checked || false;
        const doubleCommanderMode = document.getElementById('prepDoubleCommander')?.checked || false;
        gameState.standardMapId = getSelection('prepOptionsMap') || STANDARD_MAP_FAMILIES[0].id;

        if (action === 'createRoom') {
            const maxPlayers = selectedType === '3p' ? 3 : 2;
            gameState.isThreePlayer = maxPlayers === 3;
            gameState.skirmishFog = skirmishFog;
            gameState.doubleCommanderMode = doubleCommanderMode;
            setStatus(`正在创建房间...`);
            createRoom(maxPlayers);
            return;
        }

        if (action === 'training') {
            gameState.gameMode = 'training';
            gameState.isThreePlayer = selectedType === '3p';
            gameState.skirmishFog = skirmishFog;
            gameState.doubleCommanderMode = doubleCommanderMode;
            gameState.aiOpponentCamp = null;
            gameState.aiDifficulty = 1.0;
            gameState.aiDifficultyId = 'easy';
            beginTrainingCommanderPhase('player1');
            return;
        }

        if (selectedType === 'pve') {
            gameState.gameMode = 'pve';
            gameState.skirmishFog = skirmishFog;
            gameState.doubleCommanderMode = doubleCommanderMode;
            gameState.aiOpponentCamp = null;
            const difficulty = getSelection('prepOptionsDiff');
            gameState.aiDifficulty = difficulty === 'medium' ? 1.5 : difficulty === 'hard' ? 2.0 : 1.0;
            gameState.aiDifficultyId = difficulty === 'medium' || difficulty === 'hard' ? difficulty : 'easy';
            beginPVECommanderPhase('player1');
            return;
        }

        gameState.gameMode = skirmishFog ? 'skirmish' : 'local';
        gameState.skirmishFog = skirmishFog;
        gameState.doubleCommanderMode = doubleCommanderMode;
        gameState.aiOpponentCamp = null;
        beginCommanderPhase();
    }

    function init() {
        document.getElementById('prepBackBtn').addEventListener('click', () => {
            // 标准对局/训练场均由“单人游戏”二级菜单进入 → 返回上级菜单
            if (action === 'createRoom') showMultiplayerLobby();
            else switchLobbyView('soloLobbyContent');
        });
        document.getElementById('standardGameBtn').addEventListener('click', () => showPrepDialog('solo'));
        document.getElementById('trainingBtn').addEventListener('click', () => showPrepDialog('training'));
    }

    return { init, showPrepDialog };
}
