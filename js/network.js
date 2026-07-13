import { gameState } from './state.js';
import { buildActionMessage } from '../protocol/messages.js';
import { campToKey } from '../rules/camps.js';
import { getFactionRole, getRoleCamp } from '../rules/diplomacy.js';

let _ws = null;
let _myRole = null;   // 'player1' | 'player2' | 'player3' | null
let _myRoomId = null;
let _revision = 0;
let _matchSeed = null;

// 自动重连
let _reconnectUrl = null;
let _reconnectTimer = null;
let _reconnectAttempts = 0;
let _intentionalClose = false;
let _lastRoomId = null; // 断线前所在房间

// 远程消息队列：防止并发处理导致的状态不一致
let _actionQueue = [];
let _processingQueue = false;
async function _drainActionQueue() {
    if (_processingQueue) return;
    _processingQueue = true;
    while (_actionQueue.length > 0) {
        const msg = _actionQueue.shift();
        try {
            await _cb.onRemoteAction?.(msg);
        } catch (e) {
            console.warn('Remote action handler error:', e);
        }
    }
    _processingQueue = false;
}
function _enqueueRemoteAction(msg) {
    _actionQueue.push(msg);
    _drainActionQueue();
}

// 客户端唯一标识（隧道场景下区分不同用户）
// 存 sessionStorage 保证每个标签页独立：同机多开时各标签页ID不同，
// 避免服务器按 clientId 找回断线角色时错配到同浏览器的另一名玩家；
// 页面刷新/闪断重连仍保留同一ID，不影响对局恢复。
const CLIENT_ID_KEY = 'bladesOfHex_clientId';
let _clientId = null;
try { _clientId = localStorage.getItem(CLIENT_ID_KEY); } catch (e) { /* ignore */ }
if (!_clientId) {
    _clientId = 'u' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { localStorage.setItem(CLIENT_ID_KEY, _clientId); } catch (e) { /* ignore */ }
}
export function getClientId() { return _clientId; }

const _cb = {};

export function setNetworkCallbacks(callbacks) {
    Object.assign(_cb, callbacks);
}

export function getMyRole() { return _myRole; }
export function getMyRoomId() { return _myRoomId; }
export function getMatchRevision() { return _revision; }
export function getMatchSeed() { return _matchSeed; }
export function isNetworkGame() { return _myRole !== null; }

export function isMyTurn(currentCamp) {
    if (!isNetworkGame()) return true;
    return campToKey(currentCamp) === campToKey(getRoleCamp(gameState, _myRole));
}

export function connectToServer(url) {
    _intentionalClose = false;
    _reconnectUrl = url;
    return new Promise((resolve, reject) => {
        try {
            _ws = new WebSocket(url);
        } catch {
            return reject(new Error('无效的地址'));
        }

        const timer = setTimeout(() => {
            _ws.close();
            reject(new Error('连接超时（8秒）'));
        }, 8000);

        _ws.onopen = () => {
            clearTimeout(timer);
            // 清除上一次连接的残留队列
            _actionQueue = [];
            _processingQueue = false;
            // 向服务器注册客户端ID
            _ws.send(JSON.stringify({ type: 'hello', clientId: _clientId }));
            _cb.onConnected?.();
            resolve();
        };

        _ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error('无法连接到服务器'));
        };

        _ws.onmessage = ({ data }) => {
            let msg;
            try { msg = JSON.parse(data); } catch { return; }
            switch (msg.type) {
                case 'roomCreated':
                    _myRoomId = msg.roomId;
                    _myRole = msg.role;
                    _cb.onRoomCreated?.(msg.roomId, msg.role, msg.maxPlayers || 2, msg.playerCount || 1);
                    break;
                case 'roomJoined':
                    _myRoomId = msg.roomId;
                    _myRole = msg.role;
                    _cb.onRoomJoined?.(msg.roomId, msg.role, msg.maxPlayers || 2, msg.playerCount || 2);
                    break;
                case 'roomList':
                    _cb.onRoomList?.(msg.rooms);
                    break;
                case 'roomLeft':
                    _myRoomId = null;
                    _myRole = null;
                    _revision = 0;
                    _matchSeed = null;
                    _cb.onRoomLeft?.();
                    break;
                case 'opponentJoined':
                    _cb.onOpponentJoined?.(msg.role);
                    break;
                case 'opponentLeft':
                    _cb.onOpponentLeft?.(msg.role || null);
                    break;
                case 'opponentReady':
                    _cb.onOpponentReady?.();
                    break;
                case 'opponentUnready':
                    _cb.onOpponentUnready?.();
                    break;
                case 'reconnected':
                    _myRole = msg.role;
                    _myRoomId = msg.roomId;
                    _cb.onReconnected?.(msg.role);
                    break;
                case 'opponentReconnected':
                    _cb.onOpponentReconnected?.(msg.role);
                    break;
                case 'start':
                    _myRole = msg.role;
                    _revision = Number.isInteger(msg.revision) ? msg.revision : 0;
                    _matchSeed = Number.isInteger(msg.matchSeed) ? msg.matchSeed : null;
                    _cb.onStart?.(msg.role, msg.isThreePlayer, msg.skirmishFog, msg.doubleCommanderMode, _matchSeed, {
                        turnOrder: msg.turnOrder,
                        turnOrderRolls: msg.turnOrderRolls,
                        factionColors: msg.factionColors,
                        factionEmojis: msg.factionEmojis,
                        roleAssignments: msg.roleAssignments
                    });
                    break;
                case 'factionColors':
                    _cb.onFactionColors?.(msg.factionColors || {}, msg.factionEmojis || {});
                    break;
                case 'error':
                    _cb.onError?.(msg.message);
                    break;
                case 'roomClosed':
                    _myRole = null;
                    _myRoomId = null;
                    _cb.onRoomClosed?.(msg.reason);
                    break;
                case 'banned':
                    _myRole = null;
                    _myRoomId = null;
                    _cb.onBanned?.(msg.message);
                    break;
                case 'action':
                    if (Number.isInteger(msg.revision)) _revision = msg.revision;
                    _enqueueRemoteAction(msg);
                    break;
                case 'actionAccepted':
                    if (Number.isInteger(msg.revision)) _revision = msg.revision;
                    break;
                case 'rematchPending':
                    _cb.onRematchPending?.();
                    break;
                case 'commanderSync':
                    _cb.onCommanderSync?.(msg);
                    break;
                case 'toast':
                    _cb.onToast?.(msg.text, msg.toastType);
                    break;
                case 'chat':
                    _cb.onChatMessage?.(msg);
                    break;
            }
        };

        _ws.onclose = () => {
            if (_myRole) _cb.onOpponentLeft?.();
            _lastRoomId = _myRoomId;
            _myRole = null;
            _myRoomId = null;
            _revision = 0;
            _matchSeed = null;
            _cb.onDisconnected?.();
            if (!_intentionalClose && _reconnectUrl) {
                _startAutoReconnect();
            }
        };
    });
}

function _startAutoReconnect() {
    _clearReconnectTimer();
    _reconnectAttempts++;
    // 指数退避：1s → 2s → 4s → 8s → 16s → 封顶 30s
    const delay = Math.min(1000 * Math.pow(2, _reconnectAttempts - 1), 30000);
    _cb.onReconnecting?.(_reconnectAttempts);
    _reconnectTimer = setTimeout(() => {
        connectToServer(_reconnectUrl).then(() => {
            _reconnectAttempts = 0;
            _cb.onSocketReconnected?.();
            if (_lastRoomId) {
                sendMessage({ type: 'joinRoom', roomId: _lastRoomId });
                _lastRoomId = null;
            }
        }).catch(() => {
            // 继续重连，不封顶
            _startAutoReconnect();
        });
    }, delay);
}

function _clearReconnectTimer() {
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
}

export function manualReconnect() {
    _clearReconnectTimer();
    _reconnectAttempts = 0;
    if (_reconnectUrl) {
        connectToServer(_reconnectUrl).then(() => {
            _cb.onSocketReconnected?.();
        }).catch(() => {
            _startAutoReconnect();
        });
    }
}

export function disconnect() {
    _intentionalClose = true;
    _clearReconnectTimer();
    _reconnectAttempts = 0;
    _reconnectUrl = null;
    _myRole = null;
    _myRoomId = null;
    _revision = 0;
    _matchSeed = null;
    if (_ws) { try { _ws.close(); } catch(e) {}; _ws = null; }
}

// ==== 房间操作 ====

export function createRoom(maxPlayers = 2) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify({
        type: 'createRoom',
        maxPlayers,
        skirmishFog: gameState.skirmishFog || false,
        doubleCommanderMode: gameState.doubleCommanderMode || false
    }));
}

export function joinRoom(roomId) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify({ type: 'joinRoom', roomId }));
}

export function listRooms() {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify({ type: 'listRooms' }));
}

export function leaveRoom() {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify({ type: 'leaveRoom' }));
}

export function sendReady() {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify({ type: 'ready' }));
}

export function sendUnready() {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify({ type: 'unready' }));
}

// ==== 游戏操作 ====

export function sendAction(actionType, serializedState, effectData = null) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) {
        console.warn(`[WS] sendAction(${actionType}) skipped: socket not open (readyState=${_ws ? _ws.readyState : 'null'})`);
        return;
    }
    const msg = buildActionMessage(actionType, serializedState, effectData, _revision);
    try {
        _ws.send(JSON.stringify(msg));
    } catch (e) {
        console.warn(`[WS] sendAction(${actionType}) failed:`, e.message);
    }
}

export function sendMessage(msg) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify(msg));
}

export function sendChatMessage(channel, text, targetRole = null) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return false;
    const msg = { type: 'chat', channel, text };
    if (targetRole) msg.targetRole = targetRole;
    try {
        _ws.send(JSON.stringify(msg));
        return true;
    } catch (e) {
        console.warn('[WS] sendChatMessage failed:', e.message);
        return false;
    }
}

export function roleToCamp(role) {
    return getRoleCamp(gameState, role);
}

export function campToRole(camp) {
    return getFactionRole(gameState, campToKey(camp));
}

export function syncCommanderState(poolP1, poolP2, cmdP1, cmdP2, p1Confirmed, p2Confirmed, p1Deployed, p2Deployed, phase, deployedUnitP1 = null, deployedUnitP2 = null, poolP3 = [], cmdP3 = null, p3Confirmed = false, p3Deployed = false, deployedUnitP3 = null, commanderDeployment = null) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify({
        type: 'commanderSync',
        commanderPoolP1: poolP1,
        commanderPoolP2: poolP2,
        commanderPoolP3: poolP3,
        commanderP1: cmdP1,
        commanderP2: cmdP2,
        commanderP3: cmdP3,
        commanderP1Secondary: gameState.commanderP1Secondary,
        commanderP2Secondary: gameState.commanderP2Secondary,
        commanderP3Secondary: gameState.commanderP3Secondary,
        commanderP1Confirmed: p1Confirmed,
        commanderP2Confirmed: p2Confirmed,
        commanderP3Confirmed: p3Confirmed,
        commanderP1SecondaryConfirmed: gameState.commanderP1SecondaryConfirmed,
        commanderP2SecondaryConfirmed: gameState.commanderP2SecondaryConfirmed,
        commanderP3SecondaryConfirmed: gameState.commanderP3SecondaryConfirmed,
        commanderP1Deployed: p1Deployed,
        commanderP2Deployed: p2Deployed,
        commanderP3Deployed: p3Deployed,
        commanderP1SecondaryDeployed: gameState.commanderP1SecondaryDeployed,
        commanderP2SecondaryDeployed: gameState.commanderP2SecondaryDeployed,
        commanderP3SecondaryDeployed: gameState.commanderP3SecondaryDeployed,
        commanderPhase: phase,
        deployedUnitP1: deployedUnitP1,
        deployedUnitP2: deployedUnitP2,
        deployedUnitP3: deployedUnitP3,
        commanderDeployment,
        commanderRerolledP1: (gameState.commanderRerolled && gameState.commanderRerolled.player1) || false,
        commanderRerolledP2: (gameState.commanderRerolled && gameState.commanderRerolled.player2) || false,
        commanderRerolledP3: (gameState.commanderRerolled && gameState.commanderRerolled.player3) || false,
        skirmishFog: gameState.skirmishFog || false,
        doubleCommanderMode: gameState.doubleCommanderMode || false,
        gameMode: gameState.gameMode || 'local'
    }));
}
