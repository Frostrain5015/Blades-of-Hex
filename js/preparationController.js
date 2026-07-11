// Lobby preparation dialog. It owns DOM selection state and delegates game starts to main.js.
import { CAMP } from '../rules/camps.js';
import { COMMANDER_DRAFT } from '../rules/constants.js';
import { gameState } from './state.js';
import { createRoom } from './network.js';

export function createPreparationController({
    beginCommanderPhase,
    beginPVECommanderPhase,
    beginTrainingCommanderPhase,
    beginTutorial,
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
                <span class="prep-check-copy"><strong>遭遇战</strong><small>开启战争迷雾</small></span>
            </label>
            <label class="prep-check-option">
                <input type="checkbox" id="prepDoubleCommander" />
                <span class="prep-check-copy"><strong>双将模式</strong><small>可部署两名将领</small></span>
            </label>
            ${action === 'training' ? `
            <label class="prep-check-option prep-tutorial-option">
                <input type="checkbox" id="prepTutorial" />
                <span class="prep-check-copy"><strong>教程</strong><small>学习游戏基本操作</small></span>
            </label>` : ''}
        `;

        const tutorial = document.getElementById('prepTutorial');
        if (!tutorial) return;
        const typeOptions = document.getElementById('prepOptions1');
        const skirmish = document.getElementById('prepSkirmish');
        const doubleCommander = document.getElementById('prepDoubleCommander');
        const syncTutorialLock = () => {
            const locked = tutorial.checked;
            if (skirmish) skirmish.disabled = locked;
            if (doubleCommander) doubleCommander.disabled = locked;
            typeOptions?.classList.toggle('prep-options-locked', locked);
            if (locked) {
                if (skirmish) skirmish.checked = false;
                if (doubleCommander) doubleCommander.checked = false;
                typeOptions?.querySelectorAll('.prep-option').forEach((option, index) => {
                    option.classList.toggle('selected', index === 0);
                    option.setAttribute('aria-disabled', 'true');
                });
            } else {
                typeOptions?.querySelectorAll('.prep-option').forEach(option => option.removeAttribute('aria-disabled'));
            }
        };
        tutorial.addEventListener('change', syncTutorialLock);
        syncTutorialLock();
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
            title.textContent = '本地游戏';
            document.getElementById('prepLabel1').textContent = '对战类型';
            buildOptionRow('prepOptions1', [
                { id: 'pve', title: 'PVE' },
                { id: 'local', title: '本地热座', desc: '玩家轮流操作' }
            ]);
            buildOptionRow('prepOptionsDiff', [
                { id: 'easy', title: '简单' },
                { id: 'medium', title: '中等' },
                { id: 'hard', title: '困难' }
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
        const tutorialMode = action === 'training' && (document.getElementById('prepTutorial')?.checked || false);

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
            if (tutorialMode) {
                beginTutorial();
                return;
            }
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
