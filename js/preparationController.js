// Lobby preparation dialog. It owns DOM selection state and delegates game starts to main.js.
import { CAMP } from '../rules/camps.js';
import { COMMANDER_DRAFT } from '../rules/constants.js';
import { gameState } from './state.js';
import { createRoom } from './network.js';

export function createPreparationController({
    beginCommanderPhase,
    beginPVECommanderPhase,
    beginTrainingCommanderPhase,
    showHome,
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
            element.innerHTML = `<div class="prep-option-title">${choice.title}</div><div class="prep-option-desc">${choice.desc}</div>`;
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
                <span class="prep-check-copy"><strong>遭遇战</strong><small>开启战争迷雾与遭遇战专属卡牌</small></span>
            </label>
            <label class="prep-check-option">
                <input type="checkbox" id="prepDoubleCommander" />
                <span class="prep-check-copy"><strong>双将模式</strong><small>随机 ${COMMANDER_DRAFT.dualCandidatesPerPlayer} 名将领，选择 ${COMMANDER_DRAFT.dualCommanderCount} 名分别部署</small></span>
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
        document.getElementById('prepLabel2').textContent = '特殊规则';

        if (action === 'createRoom') {
            title.textContent = '创建房间';
            document.getElementById('prepLabel1').textContent = '对战人数';
            difficultySection.classList.remove('hidden');
            difficultySection.classList.add('collapsed');
            buildOptionRow('prepOptions1', [
                { id: '2p', title: '双人', desc: '1v1 在线对战' },
                { id: '3p', title: '三人', desc: '三方混战' }
            ]);
        } else if (action === 'training') {
            title.textContent = '训练场';
            document.getElementById('prepLabel1').textContent = '对战人数';
            difficultySection.classList.remove('hidden');
            difficultySection.classList.add('collapsed');
            buildOptionRow('prepOptions1', [
                { id: '2p', title: '双人', desc: '红军与蓝军轮流自选将领' },
                { id: '3p', title: '三人', desc: '红、蓝、绿三方依次自选将领' }
            ]);
        } else {
            title.textContent = '本地游戏';
            document.getElementById('prepLabel1').textContent = '对战类型';
            buildOptionRow('prepOptions1', [
                { id: 'pve', title: 'PVE 对战AI', desc: '红军 vs 蓝军AI' },
                { id: 'local', title: '本地双人', desc: '两位玩家轮流' }
            ]);
            buildOptionRow('prepOptionsDiff', [
                { id: 'easy', title: '简单', desc: 'AI 1x 经济' },
                { id: 'medium', title: '中等', desc: 'AI 1.5x 经济' },
                { id: 'hard', title: '困难', desc: 'AI 2x 经济' }
            ]);
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

        if (action === 'createRoom') {
            const maxPlayers = selectedType === '3p' ? 3 : 2;
            gameState.isThreePlayer = maxPlayers === 3;
            gameState.skirmishFog = skirmishFog;
            gameState.doubleCommanderMode = doubleCommanderMode;
            setStatus(`正在创建${maxPlayers}人房间...`);
            createRoom(maxPlayers);
            return;
        }

        if (action === 'training') {
            gameState.gameMode = 'training';
            gameState.isThreePlayer = selectedType === '3p';
            gameState.skirmishFog = skirmishFog;
            gameState.doubleCommanderMode = doubleCommanderMode;
            gameState.aiOpponentCamp = CAMP.player2;
            gameState.aiDifficulty = 1.0;
            beginTrainingCommanderPhase('player1');
            return;
        }

        if (selectedType === 'pve') {
            gameState.gameMode = 'pve';
            gameState.skirmishFog = skirmishFog;
            gameState.doubleCommanderMode = doubleCommanderMode;
            gameState.aiOpponentCamp = CAMP.player2;
            const difficulty = getSelection('prepOptionsDiff');
            gameState.aiDifficulty = difficulty === 'medium' ? 1.5 : difficulty === 'hard' ? 2.0 : 1.0;
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
            if (action === 'createRoom') showMultiplayerLobby();
            else showHome();
        });
        document.getElementById('soloGameBtn').addEventListener('click', () => showPrepDialog('solo'));
        document.getElementById('trainingBtn').addEventListener('click', () => showPrepDialog('training'));
    }

    return { init, showPrepDialog };
}
