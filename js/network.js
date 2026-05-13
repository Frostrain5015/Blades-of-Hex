import { CAMP } from './config.js';

let _ws = null;
let _myRole = null;   // 'player1' | 'player2' | 'player3' | null
let _myRoomId = null;

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
const CLIENT_ID_KEY = 'bladesOfHex_clientId';
let _clientId = localStorage.getItem(CLIENT_ID_KEY);
if (!_clientId) {
    _clientId = 'u' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(CLIENT_ID_KEY, _clientId);
}
export function getClientId() { return _clientId; }

const _cb = {};

export function setNetworkCallbacks(callbacks) {
    Object.assign(_cb, callbacks);
}

export function getMyRole() { return _myRole; }
export function getMyRoomId() { return _myRoomId; }
export function isNetworkGame() { return _myRole !== null; }

export function isMyTurn(currentCamp) {
    if (!isNetworkGame()) return true;
    if (_myRole === 'player1') return currentCamp === CAMP.player1;
    if (_myRole === 'player2') return currentCamp === CAMP.player2;
    if (_myRole === 'player3') return currentCamp === CAMP.player3;
    return false;
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
                    _cb.onRoomLeft?.();
                    break;
                case 'opponentJoined':
                    _cb.onOpponentJoined?.(msg.role);
                    break;
                case 'opponentLeft':
                    _myRole = null;
                    _cb.onOpponentLeft?.();
                    break;
                case 'opponentReady':
                    _cb.onOpponentReady?.();
                    break;
                case 'opponentUnready':
                    _cb.onOpponentUnready?.();
                    break;
                case 'reconnected':
                    console.log('[重连] 收到 reconnected，role=', msg.role, 'roomId=', msg.roomId);
                    _myRole = msg.role;
                    _myRoomId = msg.roomId;
                    console.log('[重连] _myRole 已恢复为', _myRole, '_myRoomId=', _myRoomId);
                    _cb.onReconnected?.(msg.role);
                    break;
                case 'opponentReconnected':
                    console.log('[重连] 收到 opponentReconnected，role=', msg.role);
                    if (msg.role) _myRole = msg.role;
                    console.log('[重连] _myRole 恢复为', _myRole);
                    _cb.onOpponentReconnected?.();
                    break;
                case 'start':
                    _myRole = msg.role;
                    _cb.onStart?.(msg.role, msg.isThreePlayer);
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
                    if (msg.actionType === 'stateSync') console.log('[重连] 收到 action(stateSync) 消息，_myRole=' + _myRole);
                    _enqueueRemoteAction(msg);
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
            }
        };

        _ws.onclose = () => {
            console.log('[重连] WebSocket onclose 触发，_myRole=' + _myRole + '，_myRoomId=' + _myRoomId + '，_intentionalClose=' + _intentionalClose);
            if (_myRole) _cb.onOpponentLeft?.();
            _lastRoomId = _myRoomId;
            _myRole = null;
            _myRoomId = null;
            _cb.onDisconnected?.();
            // 非主动断开 → 自动重连
            if (!_intentionalClose && _reconnectUrl) {
                console.log('[重连] 触发自动重连，_reconnectUrl=' + _reconnectUrl + '，_lastRoomId=' + _lastRoomId);
                _startAutoReconnect();
            } else {
                console.log('[重连] 跳过自动重连（_intentionalClose=' + _intentionalClose + '，_reconnectUrl=' + !!_reconnectUrl + '）');
            }
        };
    });
}

function _startAutoReconnect() {
    _clearReconnectTimer();
    _reconnectAttempts++;
    console.log('[重连] 自动重连 第' + _reconnectAttempts + '次，_lastRoomId=' + _lastRoomId);
    _cb.onReconnecting?.(_reconnectAttempts);
    if (_reconnectAttempts > 2) {
        console.log('[重连] 超过最大重连次数，放弃');
        _cb.onReconnectFailed?.();
        return;
    }
    _reconnectTimer = setTimeout(() => {
        console.log('[重连] 尝试建立WebSocket连接...');
        connectToServer(_reconnectUrl).then(() => {
            console.log('[重连] WebSocket连接成功，_lastRoomId=' + _lastRoomId);
            _reconnectAttempts = 0;
            _cb.onSocketReconnected?.();
            // 若之前在对局中，自动重加入房间
            if (_lastRoomId) {
                console.log('[重连] 发送 joinRoom，roomId=' + _lastRoomId);
                sendMessage({ type: 'joinRoom', roomId: _lastRoomId });
                _lastRoomId = null;
            } else {
                console.log('[重连] _lastRoomId 为空，无法加入房间');
            }
        }).catch(() => {
            console.log('[重连] WebSocket连接失败');
        });
    }, 3000);
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
    if (_ws) { try { _ws.close(); } catch(e) {}; _ws = null; }
}

// ==== 房间操作 ====

export function createRoom(maxPlayers = 2) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify({ type: 'createRoom', maxPlayers }));
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
    const msg = { type: 'action', actionType, state: serializedState };
    if (effectData) msg.effects = effectData;
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

export function syncCommanderState(poolP1, poolP2, cmdP1, cmdP2, p1Confirmed, p2Confirmed, p1Deployed, p2Deployed, phase, deployedUnitP1 = null, deployedUnitP2 = null, poolP3 = [], cmdP3 = null, p3Confirmed = false, p3Deployed = false, deployedUnitP3 = null) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify({
        type: 'commanderSync',
        commanderPoolP1: poolP1,
        commanderPoolP2: poolP2,
        commanderPoolP3: poolP3,
        commanderP1: cmdP1,
        commanderP2: cmdP2,
        commanderP3: cmdP3,
        commanderP1Confirmed: p1Confirmed,
        commanderP2Confirmed: p2Confirmed,
        commanderP3Confirmed: p3Confirmed,
        commanderP1Deployed: p1Deployed,
        commanderP2Deployed: p2Deployed,
        commanderP3Deployed: p3Deployed,
        commanderPhase: phase,
        deployedUnitP1: deployedUnitP1,
        deployedUnitP2: deployedUnitP2,
        deployedUnitP3: deployedUnitP3
    }));
}
