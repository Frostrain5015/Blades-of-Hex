import { HEX_SIZE, canvas, cardCanvas, settings, saveSettings, MORALE_CONFIG, TERRAIN_CONFIG, FORTIFICATION_CONFIG, LOGICAL_W, LOGICAL_H, WEATHER_CONFIG, TACTICAL_CARD_CONFIG, CARD_SYSTEM_CONFIG, UNIT_CONFIG, COLONEL_CARDS, COLONEL_CARD_GOLD, getRoundIndex, getFactionCount, getFlagColors, hexDistance } from './config.js';
import { allCommanders as COMMANDER_CONFIG } from '../commander/index.js';
import { getCommander, getCommanderDefenseBonus, getCommanderAuraDefenseBonus, getStallerSnareLayers } from './commanderInterface.js';
import { gameState, clearselection, deselectUnit, updateRecruitButtonStates, updateRecruitCostDisplay, notify, logMessage, serializeState, showTargetingBanner, hideTargetingBanner, getViewingCamp, updateUI, setInspectionTarget } from './state.js';
import { on, emit } from './eventBus.js';
import { isTileVisible } from './fogOfWar.js';
import { isMyTurn, isNetworkGame, getMyRole, syncCommanderState, sendAction } from './network.js';
import { campaignValidateCanvasClick, campaignValidateCardClick, campaignValidateAction } from './campaignController.js';
import { getFaction, getRelation, getRoleCamp, getViewingCampKey, RELATION_META } from '../rules/diplomacy.js';
import { isMechanicEnabled } from '../rules/mechanics.js';
import {
    getMovableTiles, getAttackableTiles,
    moveUnit, attackUnit, recruitUnit, endTurn,
    executeTacticalCard, executeDroneDeploy, executeDroneSuicide, executeEngineerTrench, executeEngineerFlak, executeEngineerBunkerConstruction, cancelCardTargeting, recalcAllFlankingMorale, drawCard, reinforceUnit
} from './gameLogic.js';
import { spawnCommanderSkillEffect, spawnPaladinOrbitBeams, spawnAstrologerEffect } from './effects.js';
import { setCardHoveredIndex, triggerFlyingCard } from './renderer.js';
import { setMasterVolume, setMuted } from './audio.js';
import { canDeployDrone, DRONE_DEPLOY_COST } from '../commander/tianyan.js';
import { COMMANDER_CONFIG as COMMANDER_BALANCE_CONFIG } from '../rules/commanders.js';
import { COMBAT_BALANCE } from '../rules/constants.js';
import { EMOJI_FONT_STACK } from '../rules/symbols.js';
import { FRONTEND_TEXT } from '../rules/uiText.js';
import { campToKey } from '../rules/camps.js';
import { campFromKey } from '../rules/diplomacy.js';
import { getFactionKeys } from '../rules/diplomacy.js';
import { resolveTargetingPreview, isResolvedTargetingCandidate } from '../rules/targeting.js';
import { RECRUITMENT_OPTIONS } from './recruitmentUi.js';
import { VITE_RUNTIME_AVAILABLE } from './rendering/viteRuntime.js';

const BOARD_ACTION_THEMES = {
    default: {
        background: 'linear-gradient(135deg, #d4380d, #ad2102)',
        hover: 'linear-gradient(135deg, #e8471a, #c4250a)',
        border: '#ff6b3d'
    },
    paladin: {
        background: 'linear-gradient(135deg, #bb7a12, #84510a)',
        hover: 'linear-gradient(135deg, #d99a24, #a9680e)',
        border: '#f5cb62'
    },
    priest: {
        background: 'linear-gradient(135deg, #15836f, #0d5d50)',
        hover: 'linear-gradient(135deg, #22a68b, #147666)',
        border: '#76e4bf'
    },
    astrologer: {
        background: 'linear-gradient(135deg, #3869ae, #28467b)',
        hover: 'linear-gradient(135deg, #4e86d3, #355b9d)',
        border: '#9ac8ff'
    },
    tianyan: {
        background: 'linear-gradient(135deg, #087b9e, #07526f)',
        hover: 'linear-gradient(135deg, #0ca5cb, #08748f)',
        border: '#79dbef'
    },
    engineer: {
        background: 'linear-gradient(135deg, #947026, #665019)',
        hover: 'linear-gradient(135deg, #b68b32, #7d6020)',
        border: '#e2c56e'
    },
    drone: {
        background: 'linear-gradient(135deg, #337fae, #235879)',
        hover: 'linear-gradient(135deg, #469fcc, #2f7197)',
        border: '#86d1f2'
    },
    reinforce: {
        background: 'linear-gradient(135deg, #3a8a54, #28623d)',
        hover: 'linear-gradient(135deg, #51aa6d, #347b4d)',
        border: '#9ae2aa'
    }
};

const boardActionQueue = new Map();
const boardPassiveQueue = new Map();
const boardEffectQueue = new Map();
let _lastBoardActionSignature = null;
let _lastPassiveSignature = null;
let _lastEffectSignature = null;
let _lastHudSignature = null;
let _lastHudSelectionKey = null;
let _detailCloseTimer = null;
let _boardDetailState = null;

const selectionHudEl = document.getElementById('selectionHud');
const selectionHudTitle = document.getElementById('selectionHudTitle');
const selectionHudHp = document.getElementById('selectionHudHp');
const selectionHudHpFill = document.getElementById('selectionHudHpFill');
const selectionHudHpText = document.getElementById('selectionHudHpText');
const selectionHudStats = document.getElementById('selectionHudStats');
const selectionEffectButtons = document.getElementById('selectionEffectButtons');
const boardDetailPopover = document.getElementById('boardDetailPopover');
const boardDetailKicker = document.getElementById('boardDetailKicker');
const boardDetailTitle = document.getElementById('boardDetailTitle');
const boardDetailDesc = document.getElementById('boardDetailDesc');
const boardDetailStatus = document.getElementById('boardDetailStatus');

function _getMyCampInput() {
    if (gameState.campaignMode && gameState.localPlayerCampKey) return _campFromKeyInput(gameState.localPlayerCampKey);
    if (isNetworkGame()) {
        return getRoleCamp(gameState, getMyRole());
    }
    if (gameState.gameMode === 'pve' && gameState.aiOpponentCamp) {
        return Object.values(gameState.factions || {}).find(faction => faction.controller === 'human') || gameState.currentCamp;
    }
    return gameState.currentCamp;
}

function _campKeyInput(camp) {
    if (!camp) return null;
    const key = campToKey(camp);
    return gameState.factions?.[key] ? key : null;
}

function _campFromKeyInput(key) {
    return gameState.factions?.[key] ? campFromKey(key, gameState) : null;
}

function _sameCampInput(a, b) {
    const ak = _campKeyInput(a);
    return ak !== null && ak === _campKeyInput(b);
}

let _inputTargetingPreviewCache = null;
function _getInputTargetingPreview(cardTargeting, myCamp) {
    const campKey = campToKey(myCamp);
    if (_inputTargetingPreviewCache?.cardTargeting === cardTargeting
        && _inputTargetingPreviewCache.campKey === campKey) {
        return _inputTargetingPreviewCache.preview;
    }
    const preview = resolveTargetingPreview(gameState, cardTargeting, {
        myCamp,
        hoveredTile: null,
        isTileVisible
    });
    _inputTargetingPreviewCache = { cardTargeting, campKey, preview };
    return preview;
}

function _isLocalActionTurn() {
    if (gameState.gameOver || campToKey(gameState.currentCamp) === 'neutral') return false;
    const myCamp = _getMyCampInput();
    if (!myCamp) return false;
    if (isNetworkGame()) return _sameCampInput(gameState.currentCamp, myCamp) && isMyTurn(gameState.currentCamp);
    if (gameState.gameMode === 'pve' && gameState.aiOpponentCamp) return _sameCampInput(gameState.currentCamp, myCamp);
    return true;
}

function _isLocalActionCamp(camp) {
    return _isLocalActionTurn() && _sameCampInput(camp, _getMyCampInput());
}

function _isLocalActionUnit(unit) {
    return !!unit && unit.hp > 0 && _isLocalActionCamp(unit.camp);
}

function _canUseDroneSkill(unit) {
    return _isLocalActionUnit(unit);
}

function _hasDroneSuicideTarget(unit) {
    return !!unit?.tile && gameState.tiles.some(tile =>
        tile.unit && !_sameCampInput(tile.unit.camp, unit.camp) && hexDistance(unit.tile, tile) <= 3
    );
}

function _canUseDroneSuicide(unit) {
    return _canUseDroneSkill(unit) && _hasDroneSuicideTarget(unit);
}

function _canUseCommanderActiveSkill(unit) {
    if (!_isLocalActionUnit(unit) || !unit.commander) return false;
    const cmdCfg = getCommander(unit.commander);
    const hasActiveSkill = !!(cmdCfg && (cmdCfg.activeSkill || (Array.isArray(cmdCfg.activeSkills) && cmdCfg.activeSkills.length > 0)));
    if (!hasActiveSkill || unit._engineerConstruction) return false;
    if (cmdCfg.activeSkill && (unit.activeSkillCD > 0 || unit.activeSkillDur > 0)) return false;
    const noFaith = unit.commander === 'paladin' && unit._faith < 1 && !unit._smiteReady;
    const noFaithUpgrade = unit.commander === 'paladin' && unit._smiteReady && !unit._smiteCharged && unit._faith < 1;
    const smiteFull = unit.commander === 'paladin' && unit._smiteReady && unit._smiteCharged;
    return !unit.isNewRecruit && !noFaith && !noFaithUpgrade && !smiteFull;
}

function _hasTianyanDeployTarget(unit) {
    return !!unit?.tile && gameState.tiles.some(tile =>
        !tile.unit && !tile.isCity && tile.terrain !== 'mountain' && hexDistance(unit.tile, tile) <= 1
    );
}

function _hasEngineerBunkerTarget(unit) {
    return !!unit?.tile && gameState.tiles.some(tile =>
        !tile.unit && !tile.isCity && !tile.isVillage
        && hexDistance(unit.tile, tile) <= 1
        && (!gameState.skirmishFog || isTileVisible(tile, unit.camp, gameState))
    );
}

function _getCommanderSkillAvailability(unit, skillId = '') {
    if (!_canUseCommanderActiveSkill(unit)) return { canUse: false, reason: '当前不可用' };

    if (unit.commander === 'priest' && unit._healingAura > 0) {
        return { canUse: false, reason: '持续' + unit._healingAura + '回合' };
    }
    if (unit.commander === 'tianyan') {
        if (!canDeployDrone(unit, gameState)) return { canUse: false, reason: '金币不足或本回合部署次数已满' };
        if (!_hasTianyanDeployTarget(unit)) return { canUse: false, reason: '周围没有可部署的空地' };
    }
    if (unit.commander === 'engineer') {
        const cmdCfg = getCommander(unit.commander);
        const skill = cmdCfg?.activeSkills?.find(item => item.id === skillId);
        const campKey = _campKeyInput(unit.camp);
        if (!skill || !campKey || (gameState.playerGold[campKey] || 0) < skill.goldCost) {
            return { canUse: false, reason: '金币不足' };
        }
        if ((skillId === 'trench' || skillId === 'flak') && unit.tile.fortification) {
            return { canUse: false, reason: '当前地块已有工事' };
        }
        if (skillId === 'bunker') {
            if ((unit._engineerBunkerCD || 0) > 0) {
                return { canUse: false, reason: `冷却${unit._engineerBunkerCD}回合` };
            }
            if (!_hasEngineerBunkerTarget(unit)) {
                return { canUse: false, reason: '没有可施工的目标地块' };
            }
        }
    }
    return { canUse: true, reason: '' };
}

function _applyBoardActionTheme(button, commanderId) {
    const theme = BOARD_ACTION_THEMES[commanderId] || BOARD_ACTION_THEMES.default;
    button.style.setProperty('--board-action-background', theme.background);
    button.style.setProperty('--board-action-hover', theme.hover);
    button.style.setProperty('--board-action-border', theme.border);
}

function _findUnitById(unitId) {
    return gameState.tiles.reduce((found, tile) => found || (tile.unit?.id === unitId ? tile.unit : null), null);
}

function _canReinforceUnit(unit) {
    return _isLocalActionUnit(unit)
        && unit.tile && (unit.tile.isCity || unit.tile.isVillage)
        && unit.hp < unit.maxHp
        && !unit.tile._reinforcedThisTurn;
}

function _getReinforcementAction(unit) {
    if (!unit || !_isLocalActionCamp(unit.camp) || !unit.tile || (!unit.tile.isCity && !unit.tile.isVillage)) return null;

    if (unit.tile._reinforcedThisTurn) {
        return {
            key: `reinforce:${unit.id}`,
            buttonId: 'boardReinforce',
            kind: 'reinforce',
            unitId: unit.id,
            icon: '📯',
            label: '本回合已补员',
            canUse: false,
            reason: '该地块本回合已补员',
            theme: 'reinforce'
        };
    }
    if (unit.hp >= unit.maxHp) {
        return {
            key: `reinforce:${unit.id}`,
            buttonId: 'boardReinforce',
            kind: 'reinforce',
            unitId: unit.id,
            icon: '📯',
            label: '无需补员',
            canUse: false,
            reason: '单位生命值已满',
            theme: 'reinforce'
        };
    }

    const healAmt = Math.min(Math.floor(unit.maxHp * 0.50), unit.maxHp - unit.hp);
    const cost = Math.max(1, Math.ceil(unit.config.cost * (healAmt / unit.maxHp)));
    const campKey = _campKeyInput(unit.camp);
    const hasGold = !!campKey && (gameState.playerGold[campKey] || 0) >= cost;
    return {
        key: `reinforce:${unit.id}`,
        buttonId: 'boardReinforce',
        kind: 'reinforce',
        unitId: unit.id,
        icon: '📯',
        goldCost: cost,
        label: `🪙 补充兵员 $${cost}`,
        canUse: _canReinforceUnit(unit) && hasGold,
        reason: hasGold ? '' : '金币不足',
        theme: 'reinforce'
    };
}

function _getCommanderActionIcon(commanderId, skillId) {
    if (commanderId === 'engineer') return skillId === 'bunker' ? '🏰' : skillId === 'flak' ? '🔫' : '🚧';
    if (commanderId === 'paladin') return '⚔️';
    if (commanderId === 'priest') return '🙏';
    if (commanderId === 'astrologer') return '🔮';
    if (commanderId === 'tianyan') return '🛰️';
    if (commanderId === 'berserker') return '🩸';
    return '✦';
}

function _collectBoardActions(unit) {
    const actions = [];
    if (!unit) return actions;

    const isControllable = _isLocalActionCamp(unit.camp);
    const unavailableReason = _sameCampInput(unit.camp, _getMyCampInput())
        ? '当前不是你的行动回合'
        : '非己方单位，无法施放';
    if (unit._isDrone) {
        actions.push({
            key: `droneSuicide:${unit.id}`,
            buttonId: 'boardActiveSkill',
            kind: 'droneSuicide',
            unitId: unit.id,
            icon: '💥',
            label: '自爆',
            canUse: isControllable && _canUseDroneSuicide(unit),
            reason: isControllable
                ? (_hasDroneSuicideTarget(unit) ? '当前不可用' : '3格内没有敌方单位')
                : unavailableReason,
            theme: 'drone'
        });
    } else if (unit.commander) {
        const cmdCfg = getCommander(unit.commander);
        const skills = cmdCfg?.activeSkills?.length
            ? cmdCfg.activeSkills
            : cmdCfg?.activeSkill ? [{ id: '', name: cmdCfg.activeSkill.name }] : [];
        skills.forEach((skill, index) => {
            const skillId = skill.id || '';
            const availability = isControllable
                ? _getCommanderSkillAvailability(unit, skillId)
                : { canUse: false, reason: unavailableReason };
            const skillName = unit.commander === 'paladin' && unit._smiteReady && !unit._smiteCharged
                ? '至圣斩·誓约' : skill.name;
            // 牧师的技能持续以治愈灵光剩余回合计；碉堡走独立冷却，其余走通用主动技能冷却/持续
            const duration = unit.commander === 'priest'
                ? Math.max(0, unit._healingAura || 0)
                : (cmdCfg?.activeSkill && unit.activeSkillDur > 0 ? unit.activeSkillDur : 0);
            const cooldown = skillId === 'bunker'
                ? (unit._engineerBunkerCD || 0)
                : (cmdCfg?.activeSkill ? unit.getCooldownRounds() : 0);
            actions.push({
                key: `commander:${unit.id}:${skillId || 'default'}`,
                buttonId: index === 0 ? 'boardActiveSkill' : index === 1 ? 'boardSecondarySkill' : `boardCommanderSkill${index}`,
                kind: 'commanderSkill',
                unitId: unit.id,
                skillId,
                icon: _getCommanderActionIcon(unit.commander, skillId),
                label: skillName,
                goldCost: skill.goldCost || (unit.commander === 'tianyan' ? DRONE_DEPLOY_COST : 0),
                duration,
                cooldown,
                canUse: availability.canUse,
                reason: availability.reason,
                theme: unit.commander
            });
        });
    }

    const reinforcement = _getReinforcementAction(unit);
    if (reinforcement) actions.push(reinforcement);
    return actions;
}

function _formatBoardActionTitle(action) {
    const hasEmbeddedCost = action.goldCost && action.label.includes(`$${action.goldCost}`);
    const cost = action.goldCost && !hasEmbeddedCost ? ` $${action.goldCost}` : '';
    return action.reason ? `${action.label}${cost} - ${action.reason}` : `${action.label}${cost}`;
}

function _animateAbilityGroup(container, selectionKey) {
    const nextKey = selectionKey || '';
    if (container.dataset.selectionKey === nextKey) return;
    container.dataset.selectionKey = nextKey;
    container.classList.remove('is-swapping');
    void container.offsetWidth;
    container.classList.add('is-swapping');
}

function _renderBoardActionQueue(actions) {
    const container = document.getElementById('canvasActionButtons');
    if (!container) return;

    const signature = actions.map(action => [
        action.key,
        action.icon,
        action.label,
        action.goldCost || 0,
        action.duration || 0,
        action.cooldown || 0,
        action.canUse,
        action.reason,
        action.theme
    ].join(':')).join('|');
    if (signature === _lastBoardActionSignature) return;
    _lastBoardActionSignature = signature;

    boardActionQueue.clear();
    const buttons = Array.from(container.querySelectorAll('button'));
    actions.forEach((action, index) => {
        let button = buttons[index];
        if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            container.appendChild(button);
        }

        boardActionQueue.set(action.key, action);
        button.id = action.buttonId;
        button.className = 'canvas-action-button';
        // 保持禁用技能可悬浮查看，因此使用语义禁用并在执行层拦截点击。
        button.disabled = false;
        button.classList.toggle('is-disabled', !action.canUse);
        button.setAttribute('aria-disabled', action.canUse ? 'false' : 'true');
        button.removeAttribute('title');
        button.setAttribute('aria-label', _formatBoardActionTitle(action));
        button.dataset.boardActionKey = action.key;
        _applyBoardActionTheme(button, action.theme);

        const icon = document.createElement('span');
        icon.className = 'canvas-action-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = action.icon || '✦';
        button.replaceChildren(icon);
        if (action.goldCost) {
            const cost = document.createElement('span');
            cost.className = 'canvas-action-cost';
            cost.textContent = `$${action.goldCost}`;
            button.appendChild(cost);
        }
        // 持续优先于冷却：技能生效期间展示剩余持续，之后展示剩余冷却
        const timeRounds = action.duration || action.cooldown || 0;
        if (timeRounds > 0) {
            const time = document.createElement('span');
            time.className = 'canvas-action-time';
            time.textContent = `⏳${timeRounds}`;
            button.appendChild(time);
        }
    });
    for (let index = actions.length; index < buttons.length; index++) buttons[index].remove();
    container.classList.toggle('visible', actions.length > 0);
    container.setAttribute('aria-hidden', actions.length > 0 ? 'false' : 'true');
    document.getElementById('canvasPassiveButtons')?.classList.toggle('has-actions', actions.length > 0);
    _animateAbilityGroup(container, actions[0]?.unitId);
}

export function syncBoardActionBar() {
    const tile = gameState.selectedTile || gameState.selectedUnit?.tile || null;
    _syncSelectionHud(tile);
    const inFog = gameState.skirmishFog && tile && !isTileVisible(tile, getViewingCamp(), gameState);
    const unit = !gameState.cardTargeting && !inFog ? tile?.unit || null : null;
    _renderBoardActionQueue(_collectBoardActions(unit));
    _renderPassiveQueue(!gameState.cardTargeting && !inFog ? _buildPassiveItems(unit) : []);
}

function _activateBoardAction(action) {
    const unit = _findUnitById(action.unitId);
    if (!unit) return;

    if (action.kind === 'droneSuicide') {
        if (!_canUseDroneSuicide(unit)) return;
        if (gameState.cardTargeting?.cardId === 'drone_suicide' && gameState.cardTargeting.droneId === unit.id) {
            cancelCardTargeting();
            return;
        }
        showTargetingBanner('请选择目标');
        gameState.cardTargeting = { cardId: 'drone_suicide', targeting: 'anyTileGlobal', handIndex: -1, droneId: unit.id, startedAt: performance.now() };
        updateUI();
        return;
    }

    if (action.kind === 'reinforce') {
        const reinforcement = _getReinforcementAction(unit);
        if (!reinforcement?.canUse) return;
        reinforceUnit(unit);
        showSelectionHudForTile(unit.tile);
        return;
    }

    if (action.kind !== 'commanderSkill') return;
    const availability = _getCommanderSkillAvailability(unit, action.skillId);
    if (!availability.canUse) return;

    if (unit.commander === 'engineer') {
        if (action.skillId === 'trench') {
            if (executeEngineerTrench(unit)) showSelectionHudForTile(unit.tile);
        } else if (action.skillId === 'flak') {
            if (executeEngineerFlak(unit)) showSelectionHudForTile(unit.tile);
        } else if (action.skillId === 'bunker') {
            _beginEngineerBunkerTargeting(unit);
        }
        return;
    }

    const cmdCfg = getCommander(unit.commander);
    if (!cmdCfg?.activeSkill) return;
    const skill = cmdCfg.activeSkill;
    const activated = skill.onActivate(unit, {
        gameState, logMessage,
        spawnFx: spawnCommanderSkillEffect,
        spawnOrbitBeams: spawnPaladinOrbitBeams
    });
    if (unit._pendingWeatherChoice) {
        unit._pendingWeatherChoice = false;
        _showWeatherChoice(unit);
        return;
    }
    if (unit._pendingDroneDeploy) {
        unit._pendingDroneDeploy = false;
        clearselection();
        showTargetingBanner('请选择目标');
        gameState.cardTargeting = { cardId: 'drone_deploy', targeting: 'emptyTile', handIndex: -1, startedAt: performance.now() };
        updateUI();
        return;
    }
    unit.activeSkillDur = skill.duration;
    unit.activeSkillCD = skill.cooldown;
    recalcAllFlankingMorale();
    showSelectionHudForTile(unit.tile);
    if (activated !== false) emit('input:commanderSkillUsed', { unit, skillId: action.skillId || '', skillName: skill.name });
    if (isNetworkGame()) sendAction('activateSkill', serializeState(), { unitId: unit.id });
}

function _beginEngineerBunkerTargeting(unit) {
    const availability = _getCommanderSkillAvailability(unit, 'bunker');
    if (!availability.canUse) {
        notify(availability.reason, 'error');
        return;
    }

    if (gameState.cardTargeting?.cardId === 'engineer_bunker' && gameState.cardTargeting.engineerUnitId === unit.id) {
        cancelCardTargeting();
        return;
    }

    clearselection();
    showTargetingBanner('请选择目标');
    gameState.cardTargeting = { cardId: 'engineer_bunker', targeting: 'emptyTile', handIndex: -1, engineerUnitId: unit.id, startedAt: performance.now() };
    updateUI();
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
    const campKey = _campKeyInput(myCamp);
    const hand = gameState.playerHands[campKey] || [];
    const isNeutralTurn = !isNetworkGame() && campToKey(gameState.currentCamp) === 'neutral';
    if (isNeutralTurn) return;

    const cardW = 90, cardH = 130, peekW = 72;
    const pileW = cardW, pileH = cardH, pileX = W - pileW - 8, pileY = 8;

    // draw pile / fuel purchase check (top-right corner)
    // E4 空军上校：右上角无抽牌/无燃料
    if (cx >= pileX - 4 && cx <= pileX + pileW + 4 && cy >= pileY - 4 && cy <= pileY + pileH + 4) {
        const isMyTurnLocal = _isLocalActionTurn();
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
            const primaryKey = campToKey(myCamp) === 'player1' ? 'commanderP1' : campToKey(myCamp) === 'player2' ? 'commanderP2' : 'commanderP3';
            const deployCommanderId = isDeploy && typeof cardEntry === 'object' ? cardEntry.commanderId : null;
            const deployedKey = deployCommanderId && gameState[`${primaryKey}Secondary`] === deployCommanderId
                ? `${primaryKey}SecondaryDeployed`
                : `${primaryKey}Deployed`;
            const alreadyDeployed = isDeploy && gameState[deployedKey];
            if (isDeploy && alreadyDeployed) return;

            // only allow during own turn (network safety)
            const isMyTurnCheck = _isLocalActionTurn();
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
            hideSelectionHud();
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
            gameState.cardTargeting = { cardId, targeting: cfg.targeting, handIndex: i, commanderId: deployCommanderId, startedAt: performance.now() };
            if (cardId === 'commanderDeploy') {
                const cmdKey = deployCommanderId || gameState[primaryKey];
                const cmdCfg = COMMANDER_CONFIG[cmdKey];
                if (cmdCfg) {
                    showTargetingBanner('请选择目标');
                } else {
                    showTargetingBanner('请选择目标');
                }
            } else {
                showTargetingBanner('请选择目标');
            }
            return;
        }
    }
}

const PASSIVE_DEFS = {
    infantry: { ...FRONTEND_TEXT.unitPassives.infantry, active: (u) => u.tile.isCity },
    cavalry: { ...FRONTEND_TEXT.unitPassives.cavalry, active: (u) => u.moveDistance >= 1 },
    archer: { ...FRONTEND_TEXT.unitPassives.archer, active: (u) => u.tile.terrain === 'mountain' }
};

// 军衔折形沿用战场单位的图形语言：1–3 阶为折形，4 阶及以上为金色星章。
let _hudRankCanvas = null;
function _getHudRankCanvas() {
    if (!_hudRankCanvas) {
        _hudRankCanvas = document.createElement('canvas');
        _hudRankCanvas.className = 'selection-hud-rank';
    }
    return _hudRankCanvas;
}

function _drawHudRank(cv, rank) {
    const pad = 2;
    const ctx = cv.getContext('2d');
    if (rank >= 4) {
        const outerRadius = 7;
        const innerRadius = outerRadius * 0.382;
        const extra = 4;
        cv.width = Math.ceil(outerRadius * 2 + pad * 2 + extra * 2);
        cv.height = cv.width;
        ctx.clearRect(0, 0, cv.width, cv.height);
        const centerX = cv.width / 2;
        const centerY = cv.height / 2;
        ctx.beginPath();
        for (let index = 0; index < 5; index++) {
            const outerAngle = -Math.PI / 2 + index * 2 * Math.PI / 5;
            const innerAngle = outerAngle + Math.PI / 5;
            if (index === 0) ctx.moveTo(centerX + outerRadius * Math.cos(outerAngle), centerY + outerRadius * Math.sin(outerAngle));
            else ctx.lineTo(centerX + outerRadius * Math.cos(outerAngle), centerY + outerRadius * Math.sin(outerAngle));
            ctx.lineTo(centerX + innerRadius * Math.cos(innerAngle), centerY + innerRadius * Math.sin(innerAngle));
        }
        ctx.closePath();
        ctx.fillStyle = '#ffd700';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 1.5;
        ctx.shadowOffsetY = 1;
        ctx.fill();
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 2.5;
        ctx.shadowOffsetY = 0;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        return;
    }

    const halfWidth = 5.5;
    const halfHeight = 1.5;
    const spacing = 4;
    cv.width = Math.ceil(halfWidth * 2 + pad * 2);
    cv.height = Math.ceil((rank - 1) * spacing + halfHeight * 2 + pad * 2 + 2);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const centerX = cv.width / 2;
    const centerY = pad + halfHeight;
    for (let level = 0; level < rank; level++) {
        const offsetY = level * spacing;
        ctx.beginPath();
        ctx.moveTo(centerX - halfWidth, centerY + halfHeight + offsetY);
        ctx.lineTo(centerX, centerY - halfHeight + offsetY);
        ctx.lineTo(centerX + halfWidth, centerY + halfHeight + offsetY);
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 1.5;
        ctx.shadowOffsetY = 1;
        ctx.stroke();
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 2.5;
        ctx.shadowOffsetY = 0;
        ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
}

function _setHudTitle(text, rank = 0, relationEmoji = '', faction = null) {
    const children = [];
    if (faction) {
        if (faction.flagUrl) {
            const flag = document.createElement('img');
            flag.className = 'selection-hud-flag';
            flag.src = faction.flagUrl;
            flag.alt = faction.flagAlt || `${faction.name || '阵营'}旗帜`;
            children.push(flag);
        } else {
            const flag = document.createElement('span');
            const colors = getFlagColors(faction.colorId || faction.color);
            flag.className = 'selection-hud-flag selection-hud-flag-color';
            flag.style.background = `linear-gradient(135deg, ${colors.light}, ${colors.main} 55%, ${colors.dark})`;
            flag.setAttribute('aria-label', `${faction.name || '阵营'}纯色旗帜`);
            children.push(flag);
        }
    }
    children.push(document.createTextNode(text));
    selectionHudTitle.replaceChildren(...children);
    if (rank > 0) {
        const rankCanvas = _getHudRankCanvas();
        _drawHudRank(rankCanvas, rank);
        selectionHudTitle.appendChild(rankCanvas);
    }
    if (relationEmoji) selectionHudTitle.appendChild(document.createTextNode(relationEmoji));
}

const UNIT_TYPE_NAMES = {
    infantry: '步兵',
    cavalry: '骑兵',
    archer: '炮兵',
    mgNest: '碉堡',
    drone: '天眼哨机'
};

const PASSIVE_ICONS = FRONTEND_TEXT.icons.unitPassive;
const COMMANDER_ICONS = FRONTEND_TEXT.icons.commander;
const SKILL_ICONS = FRONTEND_TEXT.icons.skill;
const EFFECT_ICONS = FRONTEND_TEXT.icons.effect;

function _commanderSkillIcon(commanderId, skillName) {
    return SKILL_ICONS[skillName] || COMMANDER_ICONS[commanderId] || '✦';
}

function _getUnitPassiveRuntimeState(unit, passive) {
    const active = passive.active(unit);
    const presentation = {
        desc: passive.desc,
        color: active ? '#7de89a' : '#7b8790',
        status: active ? '当前生效' : '当前未生效',
        count: '',
        active,
        intensity: active ? 1 : 0
    };

    if (unit.type === 'cavalry') {
        const stacks = Math.min(COMBAT_BALANCE.cavalry.maxChargeSteps, Math.max(0, unit.moveDistance || 0));
        presentation.count = '';
        presentation.active = stacks > 0;
        presentation.intensity = stacks / COMBAT_BALANCE.cavalry.maxChargeSteps;
        presentation.status = presentation.active
            ? '当前生效 造成的伤害提高' + (stacks * COMBAT_BALANCE.cavalry.normalChargeDamagePerStep * 100) + '%'
            : '当前未生效';
    } else if (unit.type === 'infantry') {
        presentation.status = unit.tile?.isCity ? '当前生效' : '当前未生效';
        presentation.active = !!unit.tile?.isCity;
        presentation.intensity = presentation.active ? 1 : 0;
    } else if (unit.type === 'archer') {
        const mountain = unit.tile?.terrain === 'mountain';
        const wind = gameState.weather === 'wind';
        presentation.color = mountain || wind ? '#7de89a' : '#7b8790';
        presentation.active = mountain || wind;
        presentation.intensity = presentation.active ? 1 : 0;
        presentation.status = mountain
            ? '当前生效 山地射程 +1'
            : wind ? '当前生效 风天射程 +1' : '当前未生效';
    }
    return presentation;
}

function _getPassiveRuntimeState(unit, skill) {
    const presentation = {
        desc: skill.desc,
        color: '#88ccff',
        status: '当前生效',
        count: '',
        active: true,
        intensity: 1
    };

    if (unit.commander === 'paladin' && skill.name === '誓言') {
        const balance = COMMANDER_BALANCE_CONFIG.paladin.balance;
        const faith = Math.max(0, unit._faith || 0);
        const charged = unit._smiteReady
            ? (unit._smiteCharged ? ' 至圣斩已满蓄力' : ' 至圣斩已蓄力')
            : '';
        presentation.count = '';
        presentation.active = faith > 0;
        presentation.intensity = faith / balance.faithMax;
        presentation.status = '当前生效 防御力提高' + (faith * balance.defensePerFaith * 100) + '%' + charged;
    }

    if (unit.commander === 'martyr' && skill.name === '挽歌') {
        const balance = COMMANDER_BALANCE_CONFIG.martyr.balance;
        const bonus = Math.min(balance.elegyAttackCap, unit._elegyBonus || 0);
        const stacks = Math.floor(bonus / balance.elegyAttackPerDeath);
        presentation.count = '';
        presentation.active = stacks > 0;
        presentation.intensity = stacks / (balance.elegyAttackCap / balance.elegyAttackPerDeath);
        presentation.status = '当前生效 攻击力提高' + bonus;
    }

    if (unit.commander === 'martyr' && skill.name === '殉道' && unit._martyrPrimed) {
        const balance = COMMANDER_BALANCE_CONFIG.martyr.balance;
        presentation.desc = '生命锁定为' + balance.triggerHp + '，下回合开始时对' + balance.explosionRange + '格范围内所有非己方单位造成基于攻击力的真实伤害。';
        presentation.color = '#ff5533';
        presentation.status = '已进入倒计时';
        presentation.active = true;
        presentation.intensity = 1;
    }

    if (unit.commander === 'magician' && skill.name === '幻形') {
        const balance = COMMANDER_BALANCE_CONFIG.magician.balance;
        const stacks = Math.min(balance.maxStacks, unit._phantomStacks || 0);
        presentation.count = '';
        presentation.active = stacks > 0;
        presentation.intensity = stacks / balance.maxStacks;
        presentation.status = '当前生效 造成的伤害提高' + (stacks * balance.damagePerStack * 100) + '%，暴击率提高' + (stacks * balance.critPerStack * 100) + '%';
        if (stacks > 0) presentation.color = '#d79cff';
    }

    if (unit.commander === 'ironGuard' && skill.name === '守护') {
        const balance = COMMANDER_BALANCE_CONFIG.ironGuard.balance;
        const shield = Math.max(0, unit._shield || 0);
        presentation.active = shield > 0;
        presentation.intensity = shield / balance.shieldMax;
        presentation.status = '当前生效 护盾 ' + shield;
        if (shield <= 0) presentation.color = '#7b8790';
    }

    if (unit.commander === 'ironGuard' && skill.name === '守护灵光') {
        const shield = Math.max(0, unit._shield || 0);
        presentation.status = shield > 0 ? '当前生效' : '护盾耗尽 当前失效';
        presentation.active = shield > 0;
        presentation.intensity = presentation.active ? 1 : 0;
        if (shield <= 0) presentation.color = '#7b8790';
    }

    if (unit.commander === 'centurion' && skill.name === '乘胜') {
        presentation.status = unit._centurionTriggered ? '本回合已触发' : '当前生效 本回合可触发';
        presentation.active = !unit._centurionTriggered;
        presentation.intensity = presentation.active ? 1 : 0;
        if (unit._centurionTriggered) presentation.color = '#f5ca67';
    }

    if (unit.commander === 'colonel' && skill.name === '制空') {
        presentation.status = '常驻生效';
    }
    if (unit.commander === 'colonel' && skill.name === '老练') {
        const balance = COMMANDER_BALANCE_CONFIG.colonel.balance;
        const stacks = Math.min(balance.maxAirDamageStacks, gameState._colonelAirStacks?.[_campKeyInput(unit.camp)] || 0);
        presentation.count = stacks || '';
        presentation.active = stacks > 0;
        presentation.intensity = stacks / balance.maxAirDamageStacks;
        presentation.status = stacks > 0
            ? '当前生效 空军伤害提高' + (stacks * balance.airDamagePerStack * 100) + '%'
            : '当前未生效';
        if (stacks > 0) presentation.color = '#94cdf8';
    }

    if (unit.commander === 'necromancer') {
        const balance = COMMANDER_BALANCE_CONFIG.necromancer.balance;
        const campKey = _campKeyInput(unit.camp);
        const marks = (gameState._soulMarks || []).filter(mark => mark.campKey === campKey).length;
        const soulMinions = gameState.tiles.filter(tile => tile.unit?._isSoulMinion && _sameCampInput(tile.unit.camp, unit.camp)).length;
        if (skill.name === '留魂') {
            presentation.count = marks || '';
            presentation.active = marks > 0;
            presentation.intensity = presentation.active ? 1 : 0;
            presentation.status = '当前生效 场上亡魂 ' + marks + ' 个';
        } else if (skill.name === '回魂') {
            presentation.count = soulMinions || '';
            presentation.active = soulMinions > 0;
            presentation.intensity = soulMinions / balance.maxSoulMinions;
            presentation.status = '当前生效 场上魂卒 ' + soulMinions + ' 名';
        }
    }

    if (unit.commander === 'fallenAngel') {
        const form = unit._fallen ? '堕天使·黑' : '堕天使·白';
        presentation.status = '当前生效 处于' + form;
        presentation.color = unit._fallen ? '#ff6644' : '#6688ff';
    }

    if (unit.commander === 'diplomat') {
        const override = gameState._cardOverrides?.[_campKeyInput(unit.camp)];
        if (skill.name === '合纵') {
            presentation.status = override ? '当前生效' : '尚未部署';
            presentation.active = !!override;
            presentation.intensity = presentation.active ? 1 : 0;
            if (!override) presentation.color = '#7b8790';
        } else if (skill.name === '连横') {
            const active = unit.tile && !_sameCampInput(unit.tile.camp, unit.camp);
            presentation.status = active ? '当前生效 位于非己方行政区' : '当前未生效';
            presentation.active = !!active;
            presentation.intensity = presentation.active ? 1 : 0;
            presentation.color = active ? '#ffd27a' : '#7b8790';
        }
    }

    // 状态栏只描述当前效果：标题已标明“将领被动”，不再重复显示该分类。
    // “本回合已触发”是已结算的历史状态，保留以提示本回合不能再次触发。
    if (!presentation.active && presentation.status !== '本回合已触发') {
        presentation.status = '当前未生效';
        presentation.color = '#7b8790';
    }
    return presentation;
}

function _getTerrainEffect(tile) {
    const terrain = TERRAIN_CONFIG[tile.terrain];
    if (tile.isCity) {
        const ownerName = getFaction(gameState, tile.camp)?.name || tile.camp?.name || '中立';
        let desc = '由' + ownerName + '控制';
        if (tile._cityDisabledUntil > getRoundIndex(gameState)) {
            desc += '。遭到空袭，暂时无法产出资源或招募部队';
        }
        return {
            key: 'terrain:city:' + tile.q + ':' + tile.r,
            icon: '🏙️',
            label: '城市',
            desc,
            color: tile.camp?.color || '#ffffff',
            kind: 'effect'
        };
    }

    // 平原没有额外修正，不占用效果栏注意力。
    if (tile.terrain === 'plains') return null;

    let desc = '防御力提高' + Math.round((terrain.defenseBonus || 0) * 100) + '%';
    if (tile.terrain === 'forest') desc += '，远程单位额外提高15%';
    if (terrain.moveDesc) desc += '，' + terrain.moveDesc;
    return {
        key: 'terrain:' + tile.terrain + ':' + tile.q + ':' + tile.r,
        icon: terrain.icon || '🌾',
        iconFont: terrain.iconFont || EMOJI_FONT_STACK,
        label: terrain.name,
        desc,
        color: '#e6dfc8',
        kind: 'effect'
    };
}

function _getWeatherEffect(unit) {
    const weather = WEATHER_CONFIG[gameState.weather];
    if (!weather || gameState.weather === 'clear') return null;
    if (!unit) return null;
    let desc = weather.desc;
    const details = [];
    if (gameState.weather === 'rain') {
        if (unit.tile.isCity) details.push('每回合回复' + (COMBAT_BALANCE.weather.rainCityHealPct * 100) + '%最大生命值');
        if (unit.type === 'infantry' && unit.tile.isCity) details.push('驻守城市时防御提高' + (COMBAT_BALANCE.defense.rainCityInfantryBonus * 100) + '%');
        if (unit.type === 'cavalry') details.push('每步移动消耗+' + COMBAT_BALANCE.weather.rainCavalryMovementCost);
    } else if (gameState.weather === 'fog') {
        if (unit.type === 'archer') details.push('射程' + COMBAT_BALANCE.weather.fogArcherRangeDelta);
        if (unit.type === 'cavalry') details.push('伤害提高' + (COMBAT_BALANCE.cavalry.fogDamageBonus * 100) + '%，每格冲锋伤害额外提高' + ((COMBAT_BALANCE.cavalry.fogChargeDamagePerStep - COMBAT_BALANCE.cavalry.normalChargeDamagePerStep) * 100) + '%');
    } else if (gameState.weather === 'wind') {
        if (unit.type === 'archer') details.push('射程+' + COMBAT_BALANCE.weather.windArcherRangeDelta + '，伤害提高' + (COMBAT_BALANCE.weather.windArcherDamageBonus * 100) + '%');
        if (unit.type === 'infantry') details.push('防御降低' + (COMBAT_BALANCE.defense.windInfantryPenalty * 100) + '%');
    }
    // 天气未对当前单位产生修正时，不显示为该单位的效果。
    if (!details.length) return null;
    desc = details.join('；');
    return {
        key: 'weather:' + gameState.weather,
        icon: weather.icon,
        label: weather.name + '天',
        desc,
        color: weather.color,
        kind: 'effect'
    };
}

function _buildEffectItems(tile, unit) {
    if (!tile) return [];
    const terrainEffect = _getTerrainEffect(tile);
    const items = terrainEffect ? [terrainEffect] : [];
    const fortification = tile.fortification ? FORTIFICATION_CONFIG[tile.fortification] : null;
    if (fortification) {
        items.push({
            key: 'fortification:' + tile.fortification,
            icon: EFFECT_ICONS[fortification.name] || '🛡️',
            label: fortification.name,
            desc: fortification.desc,
            color: '#e8c477',
            kind: 'effect'
        });
    }

    const weather = _getWeatherEffect(unit);
    if (weather) {
        // 夜观星光护体：若该单位在友方占星者3格内，标记天气效果为被免疫
        if (gameState.tileMap) {
            const astroDef = getCommander('astrologer');
            if (astroDef && astroDef.isInWeatherShield && astroDef.isInWeatherShield(tile, unit.camp, gameState.tileMap)) {
                weather._isShielded = true;
                weather.desc += '（【夜观】免疫）';
            }
        }
        items.push(weather);
    }
    if (!unit) return items;

    const timedEffects = unit.getTimedEffects(gameState);
    const hasMoraleTimed = timedEffects.some(fx => fx.label === MORALE_CONFIG[unit.morale]?.name);
    if (unit.morale !== 2 && !hasMoraleTimed) {
        const morale = MORALE_CONFIG[unit.morale];
        items.push({
            key: 'morale:' + unit.morale,
            icon: morale.badgeIcon || morale.icon || '●',
            iconFont: EMOJI_FONT_STACK,
            label: morale.name,
            desc: morale.desc,
            color: morale.color,
            kind: 'effect'
        });
    }

    timedEffects.forEach((effect, index) => {
        const remaining = effect.remaining != null && effect.remaining !== '永久' ? effect.remaining : '';
        items.push({
            key: 'timed:' + effect.label + ':' + index,
            icon: EFFECT_ICONS[effect.label] || '✦',
            label: effect.label,
            desc: effect.desc || '效果生效中',
            color: effect.color || '#8fcfff',
            count: remaining !== '' ? '⏳' + remaining : '',
            status: effect.status || (remaining !== '' ? '持续' + remaining + '回合' : '持续生效'),
            kind: 'effect'
        });
    });

    if (unit._isDrone && unit._droneSignalDisabled) {
        items.push({
            key: 'tianyan:signal-lost',
            icon: '📡',
            label: '信号失联',
            desc: '超出天眼5格信号范围，当前无法行动；回到信号范围后恢复。',
            color: '#ff9b72',
            kind: 'effect'
        });
    }

    const auraDefBonus = getCommanderAuraDefenseBonus(unit);
    if (auraDefBonus > 0) {
        items.push({
            key: 'aura:ironGuard',
            icon: '🛡️',
            label: '守护灵光',
            desc: unit.commander === 'ironGuard'
                ? FRONTEND_TEXT.effectDescriptions.guardianSelf
                : FRONTEND_TEXT.effectDescriptions.guardianAlly,
            color: '#7eb8ff',
            kind: 'effect'
        });
    }

    // 夜观星光护体：移除独立徽章，改为在天气效果上叠加星标 + 描述标注

    if (unit.commander !== 'staller' && unit.tile) {
        const layers = getStallerSnareLayers(unit.tile, unit.camp, gameState.tileMap);
        if (layers > 0) {
            items.push({
                key: 'staller:snare',
                icon: '🕸️',
                label: '缚足',
                desc: '每层使得当前单位每步行动力消耗提高' + COMMANDER_BALANCE_CONFIG.staller.balance.movementCostPerLayer + '点',
                color: '#c08050',
                status: '当前生效 每步行动力消耗提高' + (layers * COMMANDER_BALANCE_CONFIG.staller.balance.movementCostPerLayer),
                kind: 'effect'
            });
        }
    }

    if (unit._engineerConstruction) {
        const remain = unit._engineerConstruction.turnsRemaining || 1;
        items.push({
            key: 'engineer:constructing',
            icon: '🚧',
            label: '施工中',
            desc: '碉堡还需' + remain + '回合建成',
            color: '#e8c477',
            count: '⏳' + remain,
            status: '持续' + remain + '回合',
            kind: 'effect'
        });
    }
    if (unit._engineerScaffold) {
        const remain = unit._engineerScaffold.turnsRemaining || 1;
        items.push({
            key: 'engineer:scaffold',
            icon: '🏗️',
            label: '脚手架',
            desc: '还需' + remain + '回合建成碉堡，可被攻击摧毁',
            color: '#e8c477',
            count: '⏳' + remain,
            status: '持续' + remain + '回合',
            kind: 'effect'
        });
    }
    // 战役触发器施加的效果
    if (unit && Array.isArray(unit._campaignEffects) && unit._campaignEffects.length) {
        for (const eff of unit._campaignEffects) {
            items.push({
                key: "campaign:" + eff.name + ":" + eff.id,
                icon: eff.emoji || "✨",
                label: eff.name,
                desc: (eff.desc || "战役效果") + (eff.duration ? " · 剩余" + eff.duration + "回合" : ""),
                color: "#ffd866",
                count: eff.duration ? "⏳" + eff.duration : "",
                status: eff.duration ? "持续" + eff.duration + "回合" : "持续生效",
                kind: "effect"
            });
        }
    }
    return items;
}

function _buildPassiveItems(unit) {
    if (!unit) return [];
    const items = [];
    if (unit._isDrone) {
        items.push({
            key: 'unit:' + unit.id + ':drone',
            icon: '✈',
            label: '无人机',
            desc: 'HP ' + unit.maxHp + ' / ATK ' + unit.config.attack + ' / MP ' + unit.config.speed
                + ' / 射程 ' + unit.config.range + '。行动力消耗2，无视地形。',
            color: '#88ccff',
            status: '单位特性',
            kicker: '兵种被动',
            active: true,
            intensity: 1,
            kind: 'passive'
        });
        return items;
    }

    const unitPassive = PASSIVE_DEFS[unit.type];
    if (unitPassive) {
        const runtime = _getUnitPassiveRuntimeState(unit, unitPassive);
        items.push({
            key: 'unit:' + unit.id + ':' + unit.type,
            icon: PASSIVE_ICONS[unit.type] || '✦',
            label: unitPassive.name,
            desc: runtime.desc,
            color: runtime.color,
            status: runtime.status,
            count: runtime.count,
            kicker: '兵种被动',
            active: runtime.active,
            intensity: runtime.intensity,
            kind: 'passive'
        });
    }

    if (!unit.commander) return items;
    const commander = getCommander(unit.commander);
    if (!commander) return items;

    if (unit.commander === 'fallenAngel') {
        const fallen = !!unit._fallen;
        items.push({
            key: 'commander:' + unit.id + ':fallenAngel',
            icon: fallen ? '🖤' : '🤍',
            label: fallen ? '堕天使·黑' : '堕天使·白',
            desc: fallen
                ? '每回合流失当前生命值的20%，攻击力提高30点，暴击率提高60%；士气恢复正常时切换至白形态。'
                : '每回合回复已损失生命值的30%；士气上升或下降时切换至黑形态。',
            color: fallen ? '#ff6644' : '#6688ff',
            status: '当前生效 处于' + (fallen ? '堕天使·黑' : '堕天使·白'),
            kicker: '将领被动',
            active: true,
            intensity: 1,
            kind: 'passive'
        });
        return items;
    }

    if (Array.isArray(commander.skills) && commander.skills.length) {
        commander.skills.filter(skill => skill.type !== 'active').forEach((skill, index) => {
            const runtime = _getPassiveRuntimeState(unit, skill);
            items.push({
                key: 'commander:' + unit.id + ':passive:' + index,
                icon: _commanderSkillIcon(unit.commander, skill.name),
                label: skill.name,
                desc: runtime.desc,
                color: runtime.color,
            status: runtime.status,
            count: runtime.count,
            kicker: '将领被动',
            active: runtime.active,
            intensity: runtime.intensity,
            kind: 'passive'
            });
        });
        return items;
    }

    let desc = commander.tooltipDesc || commander.desc || '';
    let color = '#ffd700';
    let status = '当前生效';
    let count = '';
    let active = true;
    let intensity = 1;
    if (unit.commander === 'minister') {
        active = !!unit.tile?.isCity;
        status = active ? '当前生效' : '当前未生效';
        color = active ? '#ffd700' : '#7b8790';
        intensity = active ? 1 : 0;
    } else if (unit.commander === 'martyr' && unit._martyrPrimed) {
        desc = '下回合开始时对2格范围内所有非己方单位造成大量范围伤害。';
        status = '当前生效 即将触发';
        color = '#ff3300';
        active = true;
        intensity = 1;
    } else if (unit.commander === 'berserker') {
        const balance = COMMANDER_BALANCE_CONFIG.berserker.balance;
        const hpLostRatio = (unit.maxHp - unit.hp) / unit.maxHp;
        const stacks = Math.min(balance.maxStacks, Math.floor(hpLostRatio / balance.hpLossPerStackPct));
        count = '';
        color = stacks > 0 ? '#ff7b5c' : '#7b8790';
        active = stacks > 0;
        intensity = stacks / balance.maxStacks;
        status = '当前生效 攻击力提高' + (stacks * balance.statBonusPerStackPct * 100) + '%，防御力提高' + (stacks * balance.statBonusPerStackPct * 100) + '%';
    }
    if (!active) status = '当前未生效';
    if (commander.skill) {
        items.push({
            key: 'commander:' + unit.id + ':legacy',
            icon: _commanderSkillIcon(unit.commander, commander.skill),
            label: commander.skill,
            desc,
            color,
            status,
            count,
            kicker: '将领被动',
            active,
            intensity,
            kind: 'passive'
        });
    }
    return items;
}

function _describeBoardAction(action) {
    const unit = _findUnitById(action.unitId);
    if (!unit) return null;
    let desc = '';
    let kicker = '单位操作';
    let color = (BOARD_ACTION_THEMES[action.theme] || BOARD_ACTION_THEMES.default).border;
    if (action.kind === 'commanderSkill') {
        kicker = '主动技能';
        const commander = getCommander(unit.commander);
        const activeDefs = commander?.skills?.filter(skill => skill.type === 'active') || [];
        if (commander?.activeSkills?.length) {
            const activeIndex = commander.activeSkills.findIndex(skill => skill.id === action.skillId);
            desc = activeDefs[activeIndex]?.desc || '';
        }
        if (!desc && commander?.activeSkill) desc = commander.activeSkill.desc || '';
        if (!desc) desc = '该将领的主动技能。';
    } else if (action.kind === 'droneSuicide') {
        kicker = '单位技能';
        desc = '选择3格内的敌方单位后自爆，对目标造成伤害。';
    } else if (action.kind === 'reinforce') {
        kicker = '单位操作';
        desc = '在城市或村庄消耗金币补充兵员，最多恢复至满生命。';
    }

    const statusParts = [];
    if (action.goldCost) statusParts.push('消耗 $' + action.goldCost);
    if (unit.commander === 'tianyan' && action.kind === 'commanderSkill') {
        const droneCount = gameState.tiles.filter(tile => tile.unit?._isDrone && _sameCampInput(tile.unit.camp, unit.camp)).length;
        statusParts.push('当前哨机 ' + droneCount + '/2');
    }
    const timeParts = [];
    if (action.duration > 0) timeParts.push('持续' + action.duration + '回合');
    if (action.cooldown > 0) timeParts.push('冷却' + action.cooldown + '回合');
    statusParts.push(...timeParts);
    // 冷却/持续本身即不可用原因时，不再重复笼统的"当前不可用"
    const reasonText = action.canUse ? '可施放' : (action.reason || '当前不可用');
    if (action.canUse || !(timeParts.includes(reasonText) || (timeParts.length && reasonText === '当前不可用'))) {
        statusParts.push(reasonText);
    }
    return {
        key: action.key,
        icon: action.icon,
        label: action.label,
        desc,
        color,
        status: statusParts.join(' '),
        kicker,
        kind: 'action',
        action
    };
}

function _renderIconQueue(container, queue, items, className, iconClass, signaturePrefix) {
    if (!container) return;
    const signature = items.map(item => [
        item.key, item.icon, item.iconFont || '', item.label, item.desc, item.color, item.count || '', item.status || '', item.active, item.intensity
    ].join(':')).join('|');
    const signatureProp = signaturePrefix === 'passive' ? '_lastPassiveSignature' : '_lastEffectSignature';
    if (signatureProp === '_lastPassiveSignature' && signature === _lastPassiveSignature) return;
    if (signatureProp === '_lastEffectSignature' && signature === _lastEffectSignature) return;
    if (signatureProp === '_lastPassiveSignature') _lastPassiveSignature = signature;
    else _lastEffectSignature = signature;

    queue.clear();
    const buttons = Array.from(container.querySelectorAll('button'));
    items.forEach((item, index) => {
        let button = buttons[index];
        if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            container.appendChild(button);
        }
        queue.set(item.key, item);
        button.className = className;
        button.dataset.abilityKey = item.key;
        button.style.setProperty('--ability-color', item.color || '#8fcfff');
        const intensity = Math.max(0, Math.min(1, Number.isFinite(item.intensity) ? item.intensity : (item.active ? 1 : 0)));
        button.style.setProperty('--ability-fill', item.active ? String(0.18 + intensity * 0.36) : '0');
        button.style.setProperty('--ability-emphasis', item.active ? String(0.45 + intensity * 0.55) : '0');
        button.style.setProperty('--ability-icon-scale', item.active ? String(1.025 + intensity * 0.045) : '1');
        button.classList.toggle('is-active', item.active === true);
        button.removeAttribute('title');
        button.setAttribute('aria-label', item.label + (item.status ? '，' + item.status : ''));
        const icon = document.createElement('span');
        icon.className = iconClass;
        icon.setAttribute('aria-hidden', 'true');
        icon.style.fontFamily = item.iconFont || EMOJI_FONT_STACK;
        icon.textContent = item.icon || '✦';
        button.replaceChildren(icon);
        if (item._isShielded) {
            const starOverlay = document.createElement('span');
            starOverlay.className = 'ability-star-overlay';
            starOverlay.textContent = '🌟';
            button.appendChild(starOverlay);
        }
        if (item.count !== undefined && item.count !== null && item.count !== '') {
            const count = document.createElement('span');
            count.className = 'ability-badge-count';
            count.textContent = String(item.count);
            button.appendChild(count);
        }
    });
    for (let index = items.length; index < buttons.length; index++) buttons[index].remove();
}

function _renderPassiveQueue(items) {
    const container = document.getElementById('canvasPassiveButtons');
    if (!container) return;
    _renderIconQueue(container, boardPassiveQueue, items, 'canvas-passive-button', 'canvas-passive-icon', 'passive');
    container.classList.toggle('visible', items.length > 0);
    container.setAttribute('aria-hidden', items.length > 0 ? 'false' : 'true');
    _animateAbilityGroup(container, items[0]?.key.split(':')[1]);
}

function _renderEffectQueue(items, selectionKey) {
    _renderIconQueue(selectionEffectButtons, boardEffectQueue, items, 'selection-effect-button', 'selection-effect-icon', 'effect');
    _animateAbilityGroup(selectionEffectButtons, selectionKey);
}

function _syncSelectionHud(tile) {
    if (!selectionHudEl) return;
    if (!tile || (gameState.skirmishFog && !isTileVisible(tile, getViewingCamp(), gameState))) {
        selectionHudEl.classList.remove('visible', 'is-effects-only');
        _renderEffectQueue([], '');
        if (_boardDetailState) _closeBoardDetail();
        _lastHudSignature = null;
        _lastHudSelectionKey = null;
        return;
    }

    const unit = tile.unit;
    const effects = _buildEffectItems(tile, unit);
    const selectionKey = unit ? 'unit:' + unit.id : 'tile:' + tile.q + ':' + tile.r;

    // 攻防按当前值直接参与签名：任何修正来源（幻形/挽歌/制空/灵光等）变化都会触发刷新
    let attack = 0;
    let defense = 0;
    let hoverMoveCost = 0;
    if (unit) {
        attack = unit.getEffectiveAttack();
        const moraleDefBonus = MORALE_CONFIG[unit.morale].defBonus;
        const auraDefBonus = getCommanderAuraDefenseBonus(unit);
        const commanderDefBonus = getCommanderDefenseBonus(unit);
        const cityDefBonus = unit.type === 'infantry' && tile.isCity ? 0.10 : 0;
        const terrainDefBonus = TERRAIN_CONFIG[tile.terrain].defenseBonus;
        const fortificationDefBonus = tile.fortification ? (FORTIFICATION_CONFIG[tile.fortification]?.defenseBonus || 0) : 0;
        const rankDefBonus = unit._rankDefBonus || 0;
        const campaignDefBonus = unit.getCampaignDefenseBonus?.() || 0;
        defense = Math.round(((unit.config.defense || 0) + moraleDefBonus + terrainDefBonus
            + fortificationDefBonus + rankDefBonus + auraDefBonus + commanderDefBonus + cityDefBonus + campaignDefBonus) * 100);
        // 悬浮可走地块时预览本次移动的行动力消耗
        if (gameState.selectedUnit === unit && gameState.hoveredTile && !gameState.hoveredTile.unit
            && gameState.movableTiles.includes(gameState.hoveredTile)) {
            const entry = gameState.moveParents?.get(gameState.hoveredTile);
            if (entry) hoverMoveCost = Math.max(0, unit.remainingMP - entry.remaining);
        }
    }

    const signature = selectionKey + '|' + effects.map(effect => effect.key + ':' + (effect.count || '') + ':' + effect.desc).join('|')
        + '|' + (unit ? [
            unit.hp, unit.maxHp, unit._shield || 0, unit.remainingMP, unit.canAct,
            unit._faith || 0, unit.moralePenaltyUntil || 0, unit._rank || 0,
            attack, defense, hoverMoveCost, getRelation(gameState, getViewingCampKey(gameState), unit.camp)
        ].join(':') : '');
    if (signature === _lastHudSignature) return;
    const selectionChanged = _lastHudSelectionKey && _lastHudSelectionKey !== selectionKey;
    _lastHudSignature = signature;
    _lastHudSelectionKey = selectionKey;
    if (selectionChanged) {
        _closeBoardDetail();
        selectionHudEl.classList.remove('is-swapping');
        void selectionHudEl.offsetWidth;
        selectionHudEl.classList.add('is-swapping');
    }

    if (unit) {
        const commander = unit.commander ? getCommander(unit.commander) : null;
        const typeName = unit._isDrone ? '无人机' : (UNIT_TYPE_NAMES[unit.type] || unit.config.name);
        const faction = getFaction(gameState, unit.camp);
        const relation = getRelation(gameState, getViewingCampKey(gameState), unit.camp);
        const relationMeta = RELATION_META[relation] || RELATION_META.unknown;
        _setHudTitle(`${faction?.name || unit.camp.name} ${typeName}`, unit._rank || 0, relationMeta.emoji, faction || unit.camp);
        selectionHudEl.style.setProperty('--selection-camp-color', getFlagColors(faction?.color || unit.camp?.color).main);
        selectionHudEl.style.setProperty('--selection-relation-color', relationMeta.color);
        selectionHudHp.hidden = false;
        // 血条长度正比于 maxHp + 护盾 × 0.5（最小 80px），护盾适当撑宽但不过度
        const barTotal = unit.maxHp + Math.max(0, (unit._shield || 0) * 0.5);
        selectionHudHp.style.width = Math.max(80, barTotal * 1.1) + 'px';
        const total = unit.maxHp + Math.max(0, unit._shield || 0);
        const hpRatio = total ? unit.hp / total : 0;
        const shieldRatio = total ? Math.max(0, unit._shield || 0) / total : 0;
        const hpColor = unit.hp / unit.maxHp > 0.5 ? '#4caf50' : unit.hp / unit.maxHp > 0.25 ? '#ff9800' : '#f44336';
        selectionHudHpFill.style.width = Math.min(100, Math.max(0, (hpRatio + shieldRatio) * 100)) + '%';
        selectionHudHpFill.style.background = shieldRatio > 0
            ? 'linear-gradient(to right, ' + hpColor + ' ' + (hpRatio / (hpRatio + shieldRatio) * 100) + '%, #66bbff ' + (hpRatio / (hpRatio + shieldRatio) * 100) + '%)'
            : hpColor;
        const hpBonus = commander ? Math.round(unit.config.hp * (commander.hpBonusPct || 0)) : 0;
        selectionHudHpText.textContent = '❤ ' + Math.round(unit.hp) + '/' + unit.maxHp
            + (hpBonus > 0 ? ' (+' + hpBonus + ')' : '') + (unit._shield > 0 ? '  +🛡' + Math.round(unit._shield) : '');

        const attackDelta = attack - unit.config.attack;
        const mpText = '⚡ ' + unit.remainingMP
            + (hoverMoveCost > 0 ? '(-' + hoverMoveCost + ')' : '') + '/' + (unit.getEffectiveSpeed?.() ?? unit.config.speed);
        selectionHudStats.replaceChildren(
            _textSpan('⚔ ' + attack + (attackDelta ? ' (' + (attackDelta > 0 ? '+' : '') + attackDelta + ')' : ''), attackDelta > 0 ? '#ffe875' : '#ffdf70'),
            _textSpan('🛡 ' + defense + '%(' + (defense + _calcAADefense(tile, unit) * 25) + '%)', defense > 0 ? '#9be5df' : defense < 0 ? '#ff8f96' : '#b3b3b3'),
            _textSpan(mpText, '#87d5ff'),
            _textSpan('📡 ' + unit.config.range, '#f4a8d4')
        );
    } else {
        _setHudTitle('');
        selectionHudHp.hidden = true;
        selectionHudStats.replaceChildren();
    }

    // 空地块只需展示地形、城防等效果队列，不应额外包一层半透明单位信息卡。
    selectionHudEl.classList.toggle('is-effects-only', !unit && effects.length > 0);
    selectionHudEl.classList.toggle('visible', !!unit || effects.length > 0);
    _renderEffectQueue(effects, selectionKey);
}

// 计算该地块的防空层数（0~2，与 Unit.js 防空逻辑一致：友军AA单位2格内 + 己方高射机枪）
function _calcAADefense(tile, unit) {
    if (!gameState.tileMap) return 0;
    let aaCount = 0;
    const dirs = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
    const dirs2 = [[2,0],[2,-1],[2,-2],[1,-2],[1,1],[0,2],[0,-2],[-1,2],[-1,-1],[-2,0],[-2,1],[-2,2]];
    for (const [dq, dr] of [...dirs, ...dirs2]) {
        const nb = gameState.tileMap.get(`${tile.q + dq},${tile.r + dr}`);
        if (!nb || !nb.unit || nb.unit.camp !== unit.camp) continue;
        if (nb.unit.type === 'archer' || nb.unit.type === 'mgNest' || nb.unit.commander === 'staller') {
            if (++aaCount >= 2) break;
        }
    }
    // 高射机枪工事：为站在其上的单位额外提供自身1层防空
    if (aaCount < 2 && tile.fortification) {
        const fc = FORTIFICATION_CONFIG[tile.fortification];
        if (fc && fc.providesSelfAA) aaCount++;
    }
    return Math.min(aaCount, 2);
}

function _textSpan(text, color) {
    const span = document.createElement('span');
    span.textContent = text;
    span.style.color = color;
    return span;
}

function _clearDetailCloseTimer() {
    if (_detailCloseTimer) window.clearTimeout(_detailCloseTimer);
    _detailCloseTimer = null;
}

function _positionBoardDetail(source) {
    if (!boardDetailPopover) return;
    boardDetailPopover.classList.remove('from-left', 'from-right', 'from-hud');
    boardDetailPopover.style.removeProperty('top');
    boardDetailPopover.style.removeProperty('right');
    boardDetailPopover.style.removeProperty('bottom');
    boardDetailPopover.style.removeProperty('left');
    if (source === 'action') {
        boardDetailPopover.classList.add('from-right');
        boardDetailPopover.style.right = '64px';
        boardDetailPopover.style.bottom = '14px';
    } else if (source === 'passive') {
        boardDetailPopover.classList.add('from-left');
        boardDetailPopover.style.left = '14px';
        boardDetailPopover.style.bottom = '64px';
    } else {
        boardDetailPopover.classList.add('from-hud');
        boardDetailPopover.style.left = '14px';
        boardDetailPopover.style.top = Math.min(selectionHudEl.offsetTop + selectionHudEl.offsetHeight + 8, 160) + 'px';
    }
}

function _openBoardDetail(item, source, pinned = false) {
    if (!boardDetailPopover || !item) return;
    _clearDetailCloseTimer();
    _boardDetailState = { key: item.key, source, pinned, item };
    boardDetailPopover.style.setProperty('--detail-color', item.color || '#8fcfff');
    boardDetailPopover.dataset.kind = item.kind || '';
    boardDetailPopover.dataset.active = item.active === true ? 'true' : item.active === false ? 'false' : '';
    boardDetailKicker.textContent = item.kicker || (item.kind === 'passive' ? '被动技能' : item.kind === 'effect' ? '效果' : '主动技能');
    boardDetailTitle.textContent = (item.icon ? item.icon + ' ' : '') + item.label;
    boardDetailDesc.textContent = item.desc || '';
    boardDetailDesc.classList.toggle('is-shielded', !!item._isShielded);
    boardDetailStatus.textContent = item.status || '';
    _positionBoardDetail(source);
    boardDetailPopover.classList.add('visible');
    boardDetailPopover.setAttribute('aria-hidden', 'false');
}

function _closeBoardDetail() {
    _clearDetailCloseTimer();
    _boardDetailState = null;
    if (!boardDetailPopover) return;
    boardDetailPopover.classList.remove('visible');
    boardDetailPopover.setAttribute('aria-hidden', 'true');
}

function _scheduleBoardDetailClose() {
    if (_boardDetailState?.pinned) return;
    _clearDetailCloseTimer();
    _detailCloseTimer = window.setTimeout(() => {
        if (!_boardDetailState?.pinned) _closeBoardDetail();
    }, 140);
}

function _previewBoardDetail(item, source) {
    if (_boardDetailState?.pinned) return;
    _openBoardDetail(item, source, false);
}

function _toggleBoardDetail(item, source) {
    if (_boardDetailState?.pinned && _boardDetailState.key === item.key) {
        _closeBoardDetail();
        return;
    }
    _openBoardDetail(item, source, true);
}

export function showSelectionHudForTile(tile) {
    // 所有单位信息均由棋盘 HUD 呈现。
    setInspectionTarget(tile || null);
    _syncSelectionHud(tile || null);
    syncBoardActionBar();
}

function hideSelectionHud() {
    setInspectionTarget(null);
    _syncSelectionHud(null);
    _renderBoardActionQueue([]);
    _renderPassiveQueue([]);
    _closeBoardDetail();
}

// 收到对手操作时，state 只恢复本地观察目标；HUD 由输入层重新绘制，避免状态层反向依赖 DOM。
on('client:inspectionRestored', (tile) => {
    if (tile) showSelectionHudForTile(tile);
    else hideSelectionHud();
});
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
function _bindDetailQueue(containerId, queue, source, itemForKey, keyAttribute = 'abilityKey', onDoubleActivate = null) {
    const container = document.getElementById(containerId);
    if (!container || container._detailBound) return;
    container._detailBound = true;
    let singleClickTimer = null;

    const getButton = (target) => {
        if (!(target instanceof HTMLElement)) return null;
        const button = target.closest('button');
        return button && container.contains(button) ? button : null;
    };
    const getItem = (button) => {
        if (!button) return null;
        const key = button.dataset[keyAttribute];
        return key ? itemForKey(key) : null;
    };

    container.addEventListener('pointerover', (e) => {
        const item = getItem(getButton(e.target));
        if (item) _previewBoardDetail(item, source);
    });
    container.addEventListener('pointerout', (e) => {
        const button = getButton(e.target);
        if (!button) return;
        const next = getButton(e.relatedTarget);
        if (next === button) return;
        _scheduleBoardDetailClose();
    });
    container.addEventListener('focusin', (e) => {
        const item = getItem(getButton(e.target));
        if (item) _previewBoardDetail(item, source);
    });
    container.addEventListener('focusout', () => _scheduleBoardDetailClose());
    container.addEventListener('click', (e) => {
        const button = getButton(e.target);
        const item = getItem(button);
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        if (onDoubleActivate) {
            if (singleClickTimer) return;
            singleClickTimer = window.setTimeout(() => {
                singleClickTimer = null;
                _toggleBoardDetail(item, source);
            }, 230);
            return;
        }
        _toggleBoardDetail(item, source);
    });
    if (onDoubleActivate) {
        container.addEventListener('dblclick', (e) => {
            const button = getButton(e.target);
            const item = getItem(button);
            if (!item) return;
            e.preventDefault();
            e.stopPropagation();
            if (singleClickTimer) {
                window.clearTimeout(singleClickTimer);
                singleClickTimer = null;
            }
            onDoubleActivate(item);
        });
    }
}

function _bindBoardAbilityControls() {
    _bindDetailQueue(
        'canvasActionButtons',
        boardActionQueue,
        'action',
        key => {
            const action = boardActionQueue.get(key);
            return action ? _describeBoardAction(action) : null;
        },
        'boardActionKey',
        item => {
            const action = item.action;
            if (!action?.canUse) return;
            // 战役/教程输入白名单校验
            if (gameState.tutorialMode && gameState.tutorialStep) {
                if (gameState.campaignMode && !isMechanicEnabled(gameState, 'commanderSkills')) { notify('本关尚未开放将领主动技', 'info'); return; }
                if (gameState.campaignMode && !campaignValidateAction(action.key)) return;
            }
            _activateBoardAction(action);
            _closeBoardDetail();
        }
    );
    _bindDetailQueue('canvasPassiveButtons', boardPassiveQueue, 'passive', key => boardPassiveQueue.get(key));
    _bindDetailQueue('selectionEffectButtons', boardEffectQueue, 'effect', key => boardEffectQueue.get(key));

    if (!boardDetailPopover || boardDetailPopover._bound) return;
    boardDetailPopover._bound = true;
    boardDetailPopover.addEventListener('pointerenter', _clearDetailCloseTimer);
    boardDetailPopover.addEventListener('pointerleave', _scheduleBoardDetailClose);
    document.getElementById('boardDetailClose')?.addEventListener('click', () => _closeBoardDetail());
}

let _inputInitialized = false;
export function rebindInputEvents() { _inputInitialized = false; initInput(); }
export function initInput() {
    if (_inputInitialized) return;
    _inputInitialized = true;
    _bindBoardAbilityControls();
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
            const ck = _campKeyInput(myCamp2);
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
            if (found >= 0) {
                const cardEntry = hand2[found];
                if (!cardEntry) { if (_boardDetailState?.key?.startsWith('card:')) _closeBoardDetail(); return; }
                const cardId = typeof cardEntry === 'object' ? cardEntry.id : cardEntry;
                const cfg = TACTICAL_CARD_CONFIG[cardId] || COLONEL_CARDS[cardId];
                if (cfg) {
                    const usesLeft = CARD_SYSTEM_CONFIG.maxUsesPerTurn - (gameState.playerUsesThisTurn?.[ck] || 0);
                    const rawDesc = cfg.desc || '';
                    const cleanDesc = rawDesc.replace(/^【[^】]+】\s*\n?/, '');
                    _openBoardDetail({
                        key: 'card:' + cardId,
                        icon: cfg.icon || '🃏',
                        label: cfg.name,
                        desc: cleanDesc,
                        kicker: '对策卡',
                        status: usesLeft > 0 ? '可用' : '使用次数已达到上限',
                        active: true,
                        color: COLONEL_CARDS[cardId] ? '#94cdf8' : '#b8d4e8'
                    }, 'passive', false);
                }
            } else {
                if (_boardDetailState?.key?.startsWith('card:')) _closeBoardDetail();
            }
        });
        cardCanvas.addEventListener('mouseleave', () => {
            setCardHoveredIndex(-1);
            if (_boardDetailState?.key?.startsWith('card:')) _closeBoardDetail();
        });
        cardCanvas.addEventListener('click', (e) => {
            if (gameState.gameOver) return;
            // 战役输入白名单校验
            if (gameState.tutorialMode && gameState.tutorialStep && gameState.campaignMode) {
                const rect = cardCanvas.getBoundingClientRect();
                const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
                const W = cardCanvas.clientWidth, H = cardCanvas.clientHeight;
                const myCamp2 = _getMyCampInput();
                if (myCamp2) {
                    const ck = _campKeyInput(myCamp2);
                    const hand2 = gameState.playerHands[ck] || [];
                    for (let i = hand2.length - 1; i >= 0; i--) {
                        const cardEntry = hand2[i];
                        const cardId = typeof cardEntry === 'object' ? cardEntry.id : cardEntry;
                        const cardW = 90, cardH = 130, peekW = 72;
                        const bx = 8 + (hand2.length - 1 - i) * peekW;
                        const by = H - 120;
                        if (cx >= bx && cx <= bx + cardW && cy >= by && cy <= by + cardH) {
                            if (!isMechanicEnabled(gameState, 'tacticalCards')) { notify('本关尚未开放对策卡', 'info'); return; }
                            if (!campaignValidateCardClick(cardId)) return;
                            break;
                        }
                    }
                }
            }
            _handleCardCanvasClick(e);
        });
    }

    canvas.addEventListener('click', (e) => {
        if (gameState.gameOver) return;
        const { x: clickX, y: clickY } = toLogical(e);

        const clickedTile = getTileAtPixel(clickX, clickY);

        // 战役输入白名单校验
        if (gameState.tutorialMode && gameState.tutorialStep && gameState.campaignMode) {
            if (!campaignValidateCanvasClick(clickedTile)) return;
        }
        if (!clickedTile) {
            if (gameState.cardTargeting) { cancelCardTargeting(); return; }
            if (gameState.cardStackExpanded) { gameState.cardStackExpanded = false; return; }
            clearselection();
            hideSelectionHud();
            return;
        }

        // 对策卡选择目标模式
        if (gameState.cardTargeting) {
            const ct = gameState.cardTargeting;
            const myCamp = _getMyCampInput();
            const targetingPreview = _getInputTargetingPreview(ct, myCamp);
            // E4 空运第二段：直接执行空运（不取消，_executeAirliftDest 内部会清理）
            if (ct.cardId === 'airlift_dest') {
                if (!isResolvedTargetingCandidate(targetingPreview, clickedTile)) return;
                executeTacticalCard('airlift_dest', clickedTile);
                return;
            }
            // 天眼无人机部署：跳过 cfg 检查（非真实卡牌）
            if (ct.cardId === 'drone_deploy') {
                const tianyanUnit = gameState.tiles.reduce((f, t) => f || (t.unit && t.unit.commander === 'tianyan' && _sameCampInput(t.unit.camp, myCamp) && t.unit.hp > 0 ? t.unit : null), null);
                if (!tianyanUnit) { notify('天眼已阵亡', 'error'); cancelCardTargeting(); return; }
                if (!isResolvedTargetingCandidate(targetingPreview, clickedTile)) return;
                const drone = executeDroneDeploy(tianyanUnit, clickedTile);
                if (drone) {
                    gameState.cardTargeting = null;
                    hideTargetingBanner();
                }
                return;
            }
            // 无人机自爆
            if (ct.cardId === 'drone_suicide') {
                const drone = gameState.tiles.reduce((f, t) => f || (t.unit && t.unit.id === ct.droneId ? t.unit : null), null);
                if (!drone || !drone._isDrone) { notify('无人机无效', 'error'); cancelCardTargeting(); return; }
                if (!isResolvedTargetingCandidate(targetingPreview, clickedTile)) return;
                if (executeDroneSuicide(drone, clickedTile)) {
                    gameState.cardTargeting = null;
                    hideTargetingBanner();
                }
                return;
            }
            if (ct.cardId === 'engineer_bunker') {
                const engineer = gameState.tiles.reduce((found, tile) => found || (tile.unit && tile.unit.id === ct.engineerUnitId ? tile.unit : null), null);
                if (!engineer || engineer.commander !== 'engineer') {
                    notify('工程师无效，无法建造碉堡', 'error');
                    cancelCardTargeting();
                    return;
                }
                if (gameState.skirmishFog && !isTileVisible(clickedTile, myCamp, gameState)) {
                    notify('目标不在视野范围内', 'error');
                    return;
                }
                if (!isResolvedTargetingCandidate(targetingPreview, clickedTile)) return;
                if (executeEngineerBunkerConstruction(engineer, clickedTile)) {
                    gameState.cardTargeting = null;
                    hideTargetingBanner();
                    showSelectionHudForTile(engineer.tile);
                }
                return;
            }
            const cfg = TACTICAL_CARD_CONFIG[ct.cardId] || COLONEL_CARDS[ct.cardId];
            if (!cfg) { cancelCardTargeting(); return; }
            if (isResolvedTargetingCandidate(targetingPreview, clickedTile)) {
                executeTacticalCard(ct.cardId, clickedTile, _cardFromX, _cardFromY);
            }
            return;
        }

        // 点选已选中单位/地块 → 取消选中（己方可操作单位有光圈倒放动画）
        if (gameState.selectedTile === clickedTile) {
            if (gameState.selectedUnit) deselectUnit(); else clearselection();
            hideSelectionHud();
            gameState.selectedTile = null;
            return;
        }

        // 对手回合 / AI 回合：只允许查看可见地块，不允许操作
        if (!_isLocalActionTurn()) {
            clearselection();
            gameState.selectedTile = clickedTile;
            showSelectionHudForTile(clickedTile);
            return;
        }

        // Action: friendly unit selected, clicking a movable tile → move
        if (gameState.selectedUnit && gameState.movableTiles.includes(clickedTile) && !clickedTile.unit) {
            moveUnit(gameState.selectedUnit, clickedTile);
            gameState.selectedTile = gameState.selectedUnit ? gameState.selectedUnit.tile : clickedTile;
            showSelectionHudForTile(gameState.selectedTile);
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
                showSelectionHudForTile(attacker.tile);
            } else {
                clearselection();
                gameState.selectedTile = clickedTile;
                showSelectionHudForTile(clickedTile);
            }
            return;
        }

        // Select: pick any tile
        clearselection();
        gameState.selectedTile = clickedTile;

        const isOwnUnit = clickedTile.unit && _isLocalActionCamp(clickedTile.unit.camp) && !clickedTile.unit.isNewRecruit;
        const ownActionable = isOwnUnit && clickedTile.unit.canAct;
        const ownEmptyCity = clickedTile.isCity && _isLocalActionCamp(clickedTile.camp) && !clickedTile.unit;
        const ownEmptyVillage = clickedTile.isVillage && _isLocalActionCamp(clickedTile.camp) && !clickedTile.unit;

        if (isOwnUnit) {
            gameState.selectedUnit = clickedTile.unit;
            if (ownActionable) {
                gameState.movableTiles = getMovableTiles(clickedTile.unit);
                gameState.attackableTiles = getAttackableTiles(clickedTile.unit);
                // 碉堡等不可移动单位：若无攻击目标则直接标记为不可行动
                if (gameState.movableTiles.length === 0 && gameState.attackableTiles.length === 0) {
                    clickedTile.unit.canAct = false;
                    gameState.selectedUnit = null;
                    return;
                }
                gameState.selectionTime = performance.now();
            } else {
                gameState.movableTiles = [];
                gameState.attackableTiles = [];
            }
        } else if (ownEmptyCity || ownEmptyVillage) {
            gameState.selectedCityTile = clickedTile;
        } else if (clickedTile.unit) {
            // 敌方/中立/不可行动单位：可选中查看 HUD 信息，不显示行动范围
            gameState.selectedUnit = clickedTile.unit;
        }

        updateRecruitButtonStates();
        updateRecruitCostDisplay();
        showSelectionHudForTile(clickedTile);
        emit('input:tileSelected', { tile: clickedTile, unit: clickedTile.unit || null });
    });

    canvas.addEventListener('mouseleave', () => {
        gameState.hoveredTile = null;
        canvas.style.cursor = 'default';
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
            if (gameState.cardTargeting) {
                const myCamp = _getMyCampInput();
                const preview = _getInputTargetingPreview(gameState.cardTargeting, myCamp);
                canvas.style.cursor = isResolvedTargetingCandidate(preview, hovered) ? 'crosshair' : 'not-allowed';
                return;
            }
            const isOwnUnit = hovered.unit && _isLocalActionCamp(hovered.unit.camp) && !hovered.unit.isNewRecruit;
            const isOwnCity = hovered.isCity && _isLocalActionCamp(hovered.camp) && !hovered.unit && !gameState.selectedUnit;
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
            hideSelectionHud();
            gameState.selectedTile = null;
            return;
        }

        if (!gameState.gameOver) {
            if (e.key === 'e' || e.key === 'Enter') {
                e.preventDefault();
                if (_isLocalActionTurn()) endTurn();
                return;
            }

            const recruitmentOption = RECRUITMENT_OPTIONS.find(option => option.shortcut === e.key);
            if (recruitmentOption) {
                e.preventDefault();
                recruitUnit(recruitmentOption.type);
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
    const factionBtn = document.getElementById('factionListBtn');
    const factionOverlay = document.getElementById('factionListOverlay');
    const factionClose = document.getElementById('factionListClose');
    const factionBody = document.getElementById('factionListBody');

    if (!settingsBtn || !settingsOverlay || !settingsClose) return;

    function renderFactionList() {
        if (!factionBody) return;
        const viewer = getViewingCampKey(gameState);
        factionBody.replaceChildren();
        for (const key of getFactionKeys(gameState)) {
            const faction = getFaction(gameState, key);
            if (!faction || faction.active === false) continue;
            const relation = getRelation(gameState, viewer, key);
            const meta = RELATION_META[relation] || RELATION_META.unknown;
            const row = document.createElement('div');
            row.className = 'faction-list-row';
            const flagMain = getFlagColors(faction.color).main;
            row.style.setProperty('--flag-main', flagMain);
            row.style.setProperty('--relation-color', meta.color);
            const flag = document.createElement('span'); flag.className = 'faction-list-flag';
            if (faction.flagUrl) {
                const image = document.createElement('img');
                image.className = 'faction-list-flag-image';
                image.src = faction.flagUrl;
                image.alt = faction.flagAlt || `${faction.name}旗帜`;
                flag.appendChild(image);
            } else if (faction.flag) {
                const emblem = document.createElement('span');
                emblem.className = 'faction-list-flag-emblem';
                emblem.textContent = faction.flag;
                flag.appendChild(emblem);
            }
            const copy = document.createElement('div');
            const name = document.createElement('div'); name.className = 'faction-list-name'; name.textContent = faction.name;
            copy.appendChild(name);
            if (faction.note) {
                const detail = document.createElement('div');
                detail.className = 'faction-list-meta';
                detail.textContent = faction.note;
                copy.appendChild(detail);
            }
            const badge = document.createElement('span'); badge.className = 'faction-list-relation'; badge.textContent = `${meta.emoji} ${meta.label}`;
            row.append(flag, copy, badge); factionBody.appendChild(row);
        }
    }
    const closeFactionList = () => { factionOverlay?.classList.remove('show'); factionOverlay?.setAttribute('aria-hidden', 'true'); };
    factionBtn?.addEventListener('click', () => { renderFactionList(); factionOverlay?.classList.add('show'); factionOverlay?.setAttribute('aria-hidden', 'false'); });
    factionClose?.addEventListener('click', closeFactionList);
    factionOverlay?.addEventListener('click', event => { if (event.target === factionOverlay) closeFactionList(); });
    on('campaign:mechanicsChanged', () => { if (factionOverlay?.classList.contains('show')) renderFactionList(); });
    on('match:diplomacyChanged', () => { if (factionOverlay?.classList.contains('show')) renderFactionList(); });

    const speedBtns = document.querySelectorAll('.speed-btn');
    const exitBtn = document.getElementById('settingsExit');
    const rendererBackend = document.getElementById('rendererBackend');
    const performanceProfile = document.getElementById('performanceProfile');
    const reducedMotion = document.getElementById('reducedMotion');
    const showGrid = document.getElementById('showGrid');

    function notifyRendererSettingsChanged(changed) {
        window.dispatchEvent(new CustomEvent('battlefield-renderer-settings-changed', {
            detail: { changed, settings: { ...settings } }
        }));
    }

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
        if (rendererBackend) {
            const pixiOption = rendererBackend.querySelector('option[value="pixi-webgl"]');
            if (pixiOption) {
                pixiOption.disabled = !VITE_RUNTIME_AVAILABLE;
                pixiOption.title = VITE_RUNTIME_AVAILABLE ? '' : '需要通过 Vite 开发服务器或生产构建运行';
            }
            rendererBackend.value = VITE_RUNTIME_AVAILABLE
                ? (settings.rendererBackend || 'canvas2d')
                : 'canvas2d';
        }
        if (performanceProfile) performanceProfile.value = settings.performanceProfile || 'auto';
        if (reducedMotion) reducedMotion.checked = Boolean(settings.reducedMotion);
        if (showGrid) showGrid.checked = settings.showGrid !== false;
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

    rendererBackend?.addEventListener('change', event => {
        settings.rendererBackend = event.target.value;
        saveSettings();
        notifyRendererSettingsChanged('rendererBackend');
    });

    performanceProfile?.addEventListener('change', event => {
        settings.performanceProfile = event.target.value;
        saveSettings();
        notifyRendererSettingsChanged('performanceProfile');
    });

    reducedMotion?.addEventListener('change', event => {
        settings.reducedMotion = event.target.checked;
        saveSettings();
        notifyRendererSettingsChanged('reducedMotion');
    });

    showGrid?.addEventListener('change', event => {
        settings.showGrid = event.target.checked;
        saveSettings();
        notifyRendererSettingsChanged('showGrid');
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

    // HUD 动作队列：所有按钮均由当前描述数组渲染，并由此处统一分发。
    // E1 占星者星移天气选择按钮
    const weatherBtns = document.querySelectorAll('.weather-card');
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
    overlay.classList.add('show');
    overlay._astrologerUnitId = unit ? unit.id : null;
}

// E1 占星者：应用天气选择
function _applyWeatherChoice(chosenWeather) {
    const overlay = document.getElementById('weatherChoiceOverlay');
    if (!overlay) return;
    overlay.classList.remove('show');
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

    // 设置持续与冷却（duration=2→按钮显示「持续」，结束后进入冷却）
    const cmdCfg = getCommander(unit.commander);
    if (cmdCfg && cmdCfg.activeSkill) {
        unit.activeSkillDur = cmdCfg.activeSkill.duration;
        unit.activeSkillCD = cmdCfg.activeSkill.cooldown;
    }
    recalcAllFlankingMorale();
    // 强制刷新 HUD 天气显示 + 全图单位天气效果徽章
    _lastHudSignature = null;
    _lastHudSelectionKey = null;
    _lastEffectSignature = null;
    showSelectionHudForTile(unit.tile);
    updateUI();
    if (isNetworkGame()) sendAction('activateSkill', serializeState(), { unitId: unit.id });
}
