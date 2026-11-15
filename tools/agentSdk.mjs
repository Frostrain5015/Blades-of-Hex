import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { engine } from '../core/headless.js';
import * as net from '../js/network.js';
import {
    attackCityTile, executeAirCommand, executeBanzaiCharge, executeGuerrillaConcealment,
    executeHeavyCannonStance, getFogSafeMovableTiles, grantTurnStartIncome, repairShipAtPort, resumeNeutralTurnIfNeeded
} from '../js/gameLogic.js';
import { aiSelectCommander, aiSelectCommanderPair, configureAiRuntime } from '../js/ai.js';
import { campToKey } from '../rules/camps.js';
import { canAttack, setPlayerFactionColor, setPlayerFactionFlagEmoji, setPlayerFactionFlagPreset, setPlayerFactionName } from '../rules/diplomacy.js';
import { isTileVisible, updateFogOfWar } from '../js/fogOfWar.js';
import { isUnitVisibleToCamp, isSubmarineTargetableBy } from '../rules/visibility.js';
import { getRecruitmentOptionsForTile, canRecruitTypeAtSelectedSite } from '../js/recruitmentUi.js';
import { getCommanderRecruitCost } from '../js/commanderInterface.js';
import { UNIT_CONFIG, getSpecializationOptions } from '../rules/units.js';
import { getHistoricalRecruitCost, getGuerrillaConcealmentReason, getBanzaiCooldown, getHeavyCannonStanceCooldown } from '../rules/cultures.js';
import { getBanzaiChargePath, resolveTargetingPreview } from '../rules/targeting.js';
import { TACTICAL_CARD_CONFIG, getCardMeta } from '../rules/cards.js';
import { isCityDisabled } from '../rules/citySiege.js';
import { canReinforceAtTile } from '../rules/healing.js';
import { canRepairShipAtPort } from '../rules/naval.js';
import {
    getVisibleAirCommandKinds, getAirCommandAvailability, getAirCommandCost, getAirCommandRange,
    canAirCommandAirdropAt, canTargetWithSingleAirCommand
} from '../rules/airCommands.js';
import { hexDistance } from '../rules/hex.js';
import { getRound } from '../rules/turns.js';
import { isValidSnapshot, neutralDriverRole } from '../protocol/messages.js';

const state = engine.gameState;
const MAX_ACTIONS = 48;
const SLOTS = ['P1', 'P2', 'P3'];
const coord = ({ q, r }) => [q, r];
const cardId = card => typeof card === 'string' ? card : card?.id;
const boardTile = (q, r) => Number.isInteger(q) && Number.isInteger(r) ? state.tileMap.get(`${q},${r}`) : null;
const unitVisible = (unit, camp) => !!unit && isUnitVisibleToCamp(unit, camp, state)
    && isSubmarineTargetableBy(unit, camp, state);
const tileVisible = (tile, camp) => !!tile && isTileVisible(tile, camp, state);
const supportedCard = id => Object.hasOwn(TACTICAL_CARD_CONFIG, id) && !getCardMeta(id).delayed;
const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, 500);

function movePreview(unit) {
    return state.skirmishFog ? getFogSafeMovableTiles(unit) : engine.getMovableTiles(unit);
}

function recruitmentCost(type, camp) {
    if (!Object.hasOwn(UNIT_CONFIG, type)) return Infinity;
    return getCommanderRecruitCost(getHistoricalRecruitCost(UNIT_CONFIG[type].cost, state, camp, type), state, camp);
}

function airTargets(kind, launcher, camp) {
    const range = getAirCommandRange(launcher);
    return state.tiles.filter(tile => hexDistance(launcher, tile) <= range && (kind === 'recon' || tileVisible(tile, camp))
        && (kind === 'airdrop' ? canAirCommandAirdropAt(tile)
            : kind === 'strafe' || kind === 'stukaDiveBomb'
                ? (!tile.unit || unitVisible(tile.unit, camp))
                    && canTargetWithSingleAirCommand(tile, camp, state, kind === 'stukaDiveBomb')
                : true));
}

function cardTargets(card, camp) {
    const id = cardId(card);
    if (!supportedCard(id)) return [];
    return resolveTargetingPreview(state, {
        cardId: id, targeting: TACTICAL_CARD_CONFIG[id].targeting, commanderId: card?.commanderId
    }, { myCamp: camp, isTileVisible }).candidateTiles;
}

export function buildObservation(camp) {
    const campKey = campToKey(camp);
    const visible = state.tiles.filter(tile => tileVisible(tile, camp));
    const own = visible.filter(tile => tile.unit?.camp === camp).map(tile => tile.unit);
    const legal = own.map(unit => ({
        unitId: unit.id,
        move: unit.canAct && !unit.isNewRecruit ? movePreview(unit).map(coord) : [],
        attack: unit.canAct && !unit.isNewRecruit ? engine.getAttackableTiles(unit).map(coord) : [],
        reinforce: canReinforceAtTile(unit, state) && !unit.tile._reinforcedThisTurn && unit.hp < unit.maxHp,
        repair: canRepairShipAtPort(unit, state) && !unit.tile._reinforcedThisTurn && unit.hp < unit.maxHp,
        specialization: unit.pendingSpecialization ? getSpecializationOptions(unit).map(option => option.key) : [],
        conceal: unit.type === 'cpc_guerrilla' && !getGuerrillaConcealmentReason(unit, state),
        stance: unit.type === 'fr_heavy_cannon' && unit.canAct && !unit.isNewRecruit && getHeavyCannonStanceCooldown(unit, state) === 0,
        charge: unit.type === 'jp_samurai' && getBanzaiCooldown(unit, state) === 0
            ? visible.filter(tile => unitVisible(tile.unit, camp) && getBanzaiChargePath(unit, tile, state)).map(coord) : []
    }));
    return {
        you: campKey, round: getRound(state), weather: state.weather, fog: state.skirmishFog,
        map: state.standardMapId, mode: state.factionRuleMode, gold: state.playerGold[campKey],
        // Coordinate columns are public. Unseen terrain, occupants and facilities are omitted.
        tiles: state.tiles.map(tile => {
            const { q, r, surface, terrain, isCity, isPort, isVillage, hp, fortification, installation } = tile;
            if (!tileVisible(tile, camp)) return [q, r];
            return [q, r, surface, terrain, campToKey(tile.camp),
                isCity ? 'city' : isPort ? 'port' : isVillage ? 'village' : null,
                isCity ? hp : null, fortification || null, installation?.status || null];
        }),
        units: visible.filter(tile => unitVisible(tile.unit, camp)).map(({ unit, q, r }) =>
            [unit.id, campToKey(unit.camp), unit.type, q, r, unit.hp, unit.maxHp, unit.activeShield,
                unit.morale, unit.commander, unit.getEffectiveAttack(), unit.getEffectiveRange(),
                unit.camp === camp ? unit.remainingMP : null, unit.isEmbarked]),
        legal,
        recruits: visible.filter(tile => tile.camp === camp && (tile.isCity || tile.isPort) && !tile.unit && !isCityDisabled(tile))
            .map(tile => [...coord(tile), getRecruitmentOptionsForTile(tile, state, camp)
                .filter(option => canRecruitTypeAtSelectedSite(option.type, tile, state, camp))
                .map(option => [option.type, recruitmentCost(option.type, camp)])]),
        air: visible.filter(tile => tile.isCity && tile.camp === camp && tile.installation?.status === 'ready')
            .flatMap(launcher => getVisibleAirCommandKinds(launcher, state)
                .filter(kind => getAirCommandAvailability(kind, launcher, state).available)
                .map(kind => [kind, ...coord(launcher), getAirCommandCost(kind, launcher, state), airTargets(kind, launcher, camp).map(coord)])),
        cards: (state.playerHands[campKey] || []).flatMap((card, index) =>
            supportedCard(cardId(card)) ? [[index, cardId(card), card?.commanderId || null, cardTargets(card, camp).map(coord)]] : [])
    };
}

export const SYSTEM_PROMPT = readFileSync(new URL('./agentPrompt.md', import.meta.url), 'utf8').trim();

export function parsePlan(content) {
    const plan = typeof content === 'string'
        ? JSON.parse(content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1')) : content;
    if (typeof plan?.summary !== 'string' || !Array.isArray(plan.actions)) throw new Error('计划缺少 summary 或 actions');
    return { summary: clean(plan.summary), actions: plan.actions.slice(0, MAX_ACTIONS) };
}

async function requestPlan(planTurn, turn) {
    const { signal } = turn;
    signal.throwIfAborted();
    let abort;
    const cancelled = new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
    });
    try {
        return parsePlan(await Promise.race([Promise.resolve().then(() => planTurn(turn)), cancelled]));
    } finally {
        signal.removeEventListener('abort', abort);
    }
}

function applyAction(action, camp, originalHand, usedCards) {
    if (!action || typeof action !== 'object' || state.currentCamp !== camp || state.gameOver) return false;
    const tile = boardTile(action.q, action.r);
    const unit = Number.isInteger(action.unitId)
        ? state.tiles.find(item => item.unit?.id === action.unitId && item.unit.camp === camp)?.unit : null;
    switch (action.type) {
        case 'move':
            if (!unit?.canAct || unit.isNewRecruit || !tile || !engine.getMovableTiles(unit).includes(tile)) return false;
            engine.moveUnit(unit, tile);
            break;
        case 'attack':
            if (!unit?.canAct || unit.isNewRecruit || !tile || !engine.getAttackableTiles(unit).includes(tile)) return false;
            if (tile.unit && unitVisible(tile.unit, camp) && canAttack(state, camp, tile.unit.camp)) engine.attackUnit(unit, tile.unit);
            else if (!tile.unit) attackCityTile(unit, tile);
            else return false;
            break;
        case 'recruit':
            if (typeof action.unitType !== 'string' || !tileVisible(tile, camp)
                || !canRecruitTypeAtSelectedSite(action.unitType, tile, state, camp)
                || isCityDisabled(tile) || recruitmentCost(action.unitType, camp) > state.playerGold[campToKey(camp)]) return false;
            state.selectedCityTile = tile;
            engine.recruitUnit(action.unitType);
            state.selectedCityTile = null;
            break;
        case 'reinforce':
            if (!unit || !canReinforceAtTile(unit, state)) return false;
            engine.reinforceUnit(unit);
            break;
        case 'repair':
            if (!unit || !canRepairShipAtPort(unit, state)) return false;
            repairShipAtPort(unit);
            break;
        case 'charge':
            if (!unit || !tileVisible(tile, camp) || !unitVisible(tile.unit, camp)) return false;
            return executeBanzaiCharge(unit, tile);
        case 'conceal': return !!unit && executeGuerrillaConcealment(unit);
        case 'stance': return !!unit && executeHeavyCannonStance(unit);
        case 'specialize':
            if (typeof action.key !== 'string' || !unit?.pendingSpecialization || !unit.chooseSpecialization(action.key, true)) return false;
            return net.sendAction('chooseSpecialization', engine.serializeState(), {
                unitId: unit.id, type: unit.type, rank: unit._rank, specializationKey: unit.specializationKey
            });
        case 'air': {
            const launcher = boardTile(action.fromQ, action.fromR);
            if (launcher?.camp !== camp || !getVisibleAirCommandKinds(launcher, state).includes(action.kind)
                || !getAirCommandAvailability(action.kind, launcher, state).available
                || !airTargets(action.kind, launcher, camp).includes(tile)) return false;
            return executeAirCommand(action.kind, launcher, tile);
        }
        case 'card': {
            const hand = state.playerHands[campToKey(camp)] || [];
            if (!Number.isInteger(action.index) || usedCards.has(action.index)) return false;
            const card = originalHand[action.index];
            const handIndex = hand.indexOf(card);
            const id = cardId(card);
            if (handIndex < 0 || !tile || !cardTargets(card, camp).includes(tile)) return false;
            state.cardTargeting = { cardId: id, handIndex, commanderId: card?.commanderId };
            try { engine.executeTacticalCard(id, tile); } finally { state.cardTargeting = null; }
            break;
        }
        default: return false;
    }
    return true;
}

function sendDraft() {
    net.syncCommanderState(state.commanderPoolP1, state.commanderPoolP2, state.commanderP1, state.commanderP2,
        state.commanderP1Confirmed, state.commanderP2Confirmed, false, false, 'selection', null, null,
        state.commanderPoolP3, state.commanderP3, state.commanderP3Confirmed, false, null);
}

function ownsNeutralTurn(role) {
    if (campToKey(state.currentCamp) !== 'neutral') return false;
    const driver = neutralDriverRole({
        turnOrder: state.turnOrder, roleAssignments: state.roleAssignments,
        surrenderedCampKeys: state.surrenderedCamps.map(campToKey)
    });
    const camp = state.factions[state.roleAssignments[driver]];
    return role === (camp?.controller === 'ai' ? 'player1' : driver);
}

let connected = false;

export async function joinAgent({ server = 'ws://127.0.0.1:3000', room, token, planTurn, onEvent = () => {},
    timeoutMs = 120000, startDelayMs = 6200, output = console } = {}) {
    if (connected) throw new Error('每个 Node 进程支持一个对战会话');
    if (!room || typeof planTurn !== 'function') throw new Error('请提供 room 和 planTurn');
    const serverUrl = new URL(server);
    if (!['ws:', 'wss:'].includes(serverUrl.protocol)) throw new Error('游戏地址需要使用 ws:// 或 wss://');
    if (token) serverUrl.searchParams.set('token', token);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647
        || !Number.isInteger(startDelayMs) || startDelayMs < 0 || startDelayMs > 60000) throw new Error('等待时间无效');
    connected = true;
    globalThis.WebSocket = WebSocket;
    const restoreAi = configureAiRuntime({ delayScale: 0 });
    let closed = false;
    let started = false;
    let readySent = false;
    let bootTimer;
    let active = false;
    let epoch = 0;
    let request;
    let lastPlanTurn = null;
    let attempts = 0;
    let picked = false;
    let playing = false;
    let finish;
    let fail;
    const done = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    // A failure during connection can precede the caller receiving done.
    done.catch(() => {});
    const stop = error => {
        if (closed) return;
        closed = true;
        clearTimeout(bootTimer);
        request?.abort();
        net.disconnect();
        restoreAi();
        connected = false;
        if (error) fail(error); else finish();
    };

    async function waitForAcknowledgments(revision, expectedEpoch) {
        const until = Date.now() + 12000;
        while (net.hasPendingActions() && epoch === expectedEpoch && !closed) {
            if (Date.now() >= until) throw new Error('等待游戏服务器确认超时');
            await delay(15);
        }
        return !closed && epoch === expectedEpoch && net.getMatchRevision() > revision;
    }

    async function pump() {
        if (active || !playing || closed || !net.getMyRole() || state.commanderPhase !== 'done') return;
        if (state.gameOver) {
            output.log(`对局结束，胜方 ${clean(campToKey(state.victoryCamp) || state.victoryCamp)}`);
            stop();
            return;
        }
        const role = net.getMyRole();
        const camp = net.roleToCamp(role);
        const turnEpoch = epoch;
        const wasNeutral = campToKey(state.currentCamp) === 'neutral';
        active = true;
        try {
            if (wasNeutral) {
                if (!ownsNeutralTurn(role)) return;
                const revision = net.getMatchRevision();
                await resumeNeutralTurnIfNeeded();
                await waitForAcknowledgments(revision, turnEpoch);
                return;
            }
            if (!camp || state.currentCamp !== camp) return;
            const turn = state.turnCounter;
            if (lastPlanTurn !== turn) { lastPlanTurn = turn; attempts = 0; }
            const originalHand = [...(state.playerHands[campToKey(camp)] || [])];
            const usedCards = new Set();
            let plan = { summary: '', actions: [] };
            const turnId = randomUUID();
            if (attempts++ < 2) {
                request = new AbortController();
                const signal = timeoutMs ? AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]) : request.signal;
                output.log(`第 ${getRound(state)} 回合，等待本地 Agent 提交计划…`);
                try {
                    if (state.skirmishFog) updateFogOfWar(state, camp);
                    plan = await requestPlan(planTurn, { turnId, prompt: SYSTEM_PROMPT, observation: buildObservation(camp), signal });
                } catch (error) {
                    if (epoch !== turnEpoch || closed) return;
                    const message = error instanceof SyntaxError ? '计划 JSON 无效' : clean(error?.message ?? error);
                    onEvent({ type: 'planError', turnId, message });
                    output.error(`Agent 计划失败（${message}），本回合跳过`);
                } finally {
                    request = null;
                }
            }
            if (epoch !== turnEpoch || closed) return;
            if (plan.summary) {
                onEvent({ type: 'summary', turnId, summary: plan.summary });
                output.log(`战术摘要  ${plan.summary}`);
            }
            for (const action of plan.actions) {
                if (epoch !== turnEpoch || closed || state.gameOver) break;
                if (action?.type === 'endTurn') break;
                const revision = net.getMatchRevision();
                const applied = applyAction(action, camp, originalHand, usedCards);
                const accepted = applied && await waitForAcknowledgments(revision, turnEpoch);
                if (epoch !== turnEpoch || closed) return;
                if (accepted && action.type === 'card') usedCards.add(action.index);
                onEvent({ type: 'actionResult', turnId, action, accepted: Boolean(accepted) });
                output.log(`${accepted ? '已确认' : '跳过'}  ${clean(JSON.stringify(action))}`);
            }
            if (epoch === turnEpoch && !closed && !state.gameOver && state.currentCamp === camp) {
                const revision = net.getMatchRevision();
                if (!await engine.advanceAutomatedTurn() || !await waitForAcknowledgments(revision, turnEpoch)) {
                    if (epoch === turnEpoch && !closed) throw new Error('服务器未确认结束回合');
                } else onEvent({ type: 'turnEnded', turnId });
            }
        } catch (error) {
            stop(error);
        } finally {
            active = false;
            if (!closed && (state.gameOver || epoch !== turnEpoch || (!wasNeutral && ownsNeutralTurn(role)))) queueMicrotask(pump);
        }
    }

    net.setNetworkCallbacks({
        onRoomJoined(room, role) {
            onEvent({ type: 'joined', room, role });
            output.log(`已加入房间 ${clean(room)}，席位 ${clean(role)}`);
        },
        onRoomUpdate(players, maxPlayers) {
            if (!started && !readySent && players.length === maxPlayers) {
                readySent = true;
                net.sendReady();
                output.log('已准备，等待房主开局');
            }
        },
        onStart(role, threePlayers, fog, doubleCommander, seed, setup) {
            clearTimeout(bootTimer);
            epoch++;
            request?.abort();
            started = true;
            playing = false;
            picked = false;
            lastPlanTurn = null;
            engine.resetGameState();
            engine.configureSkirmishState({
                playerCount: threePlayers ? 3 : 2, colors: setup.factionColors, flagEmojis: setup.factionEmojis,
                flagPresets: setup.factionPresets, factionNames: setup.factionNames,
                controllers: Object.fromEntries(SLOTS.slice(0, threePlayers ? 3 : 2)
                    .map((_, i) => [`player${i + 1}`, setup.aiSeats?.[`player${i + 1}`] ? 'ai' : 'human']))
            });
            Object.assign(state, {
                standardMapId: setup.standardMapId, factionRuleMode: setup.factionRuleMode, skirmishFog: fog,
                doubleCommanderMode: doubleCommander, turnOrder: setup.turnOrder, turnOrderRolls: setup.turnOrderRolls,
                roleAssignments: setup.roleAssignments, aiDifficultyByCamp: setup.aiSeats, commanderPhase: 'selection'
            });
            engine.seedMatchRng(seed);
            output.log(`开局，执棋阵营 ${clean(state.roleAssignments[role])}`);
        },
        onCommanderSync(message) {
            if (!started || playing || state.commanderPhase !== 'selection') return;
            const seats = SLOTS.slice(0, state.isThreePlayer ? 3 : 2);
            const own = campToKey(net.roleToCamp(net.getMyRole()))?.replace('player', 'P');
            for (const slot of seats) {
                state[`commanderPool${slot}`] = message[`commanderPool${slot}`] || state[`commanderPool${slot}`];
                if (slot === own && picked) continue;
                for (const field of ['', 'Secondary', 'Confirmed', 'SecondaryConfirmed']) {
                    state[`commander${slot}${field}`] = message[`commander${slot}${field}`];
                }
            }
            if (!own) return;
            const pool = state[`commanderPool${own}`];
            if (!picked && pool?.length) {
                const choices = state.doubleCommanderMode ? aiSelectCommanderPair(pool) : [aiSelectCommander(pool)];
                if (!choices[0] || (state.doubleCommanderMode && !choices[1])) return;
                [state[`commander${own}`], state[`commander${own}Secondary`]] = [choices[0], choices[1] || null];
                state[`commander${own}Confirmed`] = true;
                state[`commander${own}SecondaryConfirmed`] = state.doubleCommanderMode;
                picked = true;
                sendDraft();
                output.log(`已选将  ${choices.join('、')}`);
            } else if (picked && !message[`commander${own}Confirmed`]) sendDraft();
            if (!picked || bootTimer || !seats.every(slot => state[`commander${slot}Confirmed`]
                && (!state.doubleCommanderMode || state[`commander${slot}SecondaryConfirmed`]))) return;
            bootTimer = setTimeout(() => {
                bootTimer = null;
                try {
                    state.commanderPhase = 'done';
                    state.currentCamp = state.factions[state.turnOrder[0]];
                    engine.initMap();
                    grantTurnStartIncome(state.currentCamp);
                    playing = true;
                    output.log('棋盘已就绪');
                    void pump();
                } catch (error) { stop(error); }
            }, startDelayMs);
        },
        onFactionColors(colors, emojis, presets, names) {
            if (!started || playing) return;
            for (const [values, setter] of [[emojis, setPlayerFactionFlagEmoji], [presets, setPlayerFactionFlagPreset],
                [colors, setPlayerFactionColor], [names, setPlayerFactionName]]) {
                for (const [role, value] of Object.entries(values || {})) setter(state, state.roleAssignments[role] || role, value);
            }
        },
        onRemoteAction(message) {
            if (!isValidSnapshot(message.state)) return;
            clearTimeout(bootTimer);
            bootTimer = null;
            epoch++;
            request?.abort();
            try {
                engine.deserializeState(message.state, engine.HexTile, engine.Unit, { preserveClientUi: true });
                playing = state.commanderPhase === 'done';
                void pump();
            } catch (error) { stop(error); }
        },
        onDisconnected() {
            if (closed) return;
            playing = false;
            epoch++;
            request?.abort();
            output.error('连接断开，等待重连和服务器快照');
        },
        onOpponentLeft() {
            readySent = false;
            if (playing && !net.hasPendingActions()) net.sendMessage({ type: 'saveState', state: engine.serializeState() });
        },
        onError(message) {
            if (!started) stop(new Error(clean(message)));
            else output.error(clean(message));
        },
        onRoomClosed(reason) { stop(new Error(clean(reason) || '房间已关闭')); },
        onBanned(message) { stop(new Error(clean(message) || '服务器拒绝连接')); }
    });
    try {
        await net.connectToServer(serverUrl.href);
        net.joinRoom(String(room));
        return { done, close: () => stop() };
    } catch (error) {
        stop(error);
        throw error;
    }
}

function readOptions(argv) {
    const { values } = parseArgs({ args: argv, options: {
        server: { type: 'string', default: 'ws://127.0.0.1:3000' },
        room: { type: 'string' }, 'timeout-ms': { type: 'string', default: '120000' },
        'start-delay-ms': { type: 'string', default: '6200' },
        help: { type: 'boolean', short: 'h' }
    } });
    if (values.help) return null;
    return { server: values.server, room: values.room, token: process.env.BOH_GAME_TOKEN,
        timeoutMs: Number(values['timeout-ms']), startDelayMs: Number(values['start-delay-ms']) };
}

async function main() {
    const options = readOptions(process.argv.slice(2));
    if (!options) {
        console.log('node tools/agentSdk.mjs --server=ws://127.0.0.1:3000 --room=1 [--timeout-ms=120000]');
        console.log('标准输入 / 输出使用 JSONL。游戏登录令牌可通过 BOH_GAME_TOKEN 注入。');
        return;
    }
    for (const level of ['log', 'info', 'debug', 'dir', 'table']) console[level] = console.error.bind(console);
    const emit = event => process.stdout.write(`${JSON.stringify(event)}\n`);
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let pending;
    let agent;
    let closing = false;
    const close = () => { closing = true; agent?.close(); };
    lines.once('close', close);
    lines.on('line', line => {
        try {
            const message = JSON.parse(line);
            if (message?.type !== 'plan' || !pending || message.turnId !== pending.turnId) {
                throw new Error('请提交当前 turnId 对应的 plan');
            }
            pending.resolve(parsePlan(message));
            pending = null;
        } catch (error) {
            emit({ type: 'inputError', message: clean(error.message) });
        }
    });
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    try {
        agent = await joinAgent({ ...options, onEvent: emit,
            planTurn: ({ turnId, prompt, observation, signal }) => new Promise((resolve, reject) => {
                const abort = () => {
                    if (pending?.turnId === turnId) pending = null;
                    emit({ type: 'turnCancelled', turnId });
                    reject(signal.reason);
                };
                pending = { turnId, resolve: plan => { signal.removeEventListener('abort', abort); resolve(plan); } };
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted) abort();
                else emit({ type: 'turn', turnId, prompt, observation });
            })
        });
        if (closing) close();
        await agent.done;
    } finally {
        lines.close();
        process.off('SIGINT', close);
        process.off('SIGTERM', close);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => { console.error(clean(error.message)); process.exitCode = 1; });
}
