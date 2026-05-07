import { CAMP } from './config.js';

let _ws = null;
let _myRole = null;   // 'player1' | 'player2' | null
let _myRoomId = null;

const _cb = {};

export function setNetworkCallbacks(callbacks) {
    Object.assign(_cb, callbacks);
}

export function getMyRole() { return _myRole; }
export function getMyRoomId() { return _myRoomId; }
export function isNetworkGame() { return _myRole !== null; }

export function isMyTurn(currentCamp) {
    if (!isNetworkGame()) return true;
    return _myRole === 'player1'
        ? currentCamp === CAMP.player1
        : currentCamp === CAMP.player2;
}

export function connectToServer(url) {
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
                    _cb.onRoomCreated?.(msg.roomId, msg.role);
                    break;
                case 'roomJoined':
                    _myRoomId = msg.roomId;
                    _myRole = msg.role;
                    _cb.onRoomJoined?.(msg.roomId, msg.role);
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
                    _myRole = msg.role;
                    _myRoomId = msg.roomId;
                    _cb.onReconnected?.(msg.role);
                    break;
                case 'opponentReconnected':
                    _cb.onOpponentReconnected?.();
                    break;
                case 'start':
                    // 防止对局中途角色被意外重新分配
                    if (_myRole) break;
                    _myRole = msg.role;
                    _cb.onStart?.(msg.role);
                    break;
                case 'error':
                    _cb.onError?.(msg.message);
                    break;
                case 'action':
                    _cb.onRemoteAction?.(msg);
                    break;
                case 'rematchPending':
                    _cb.onRematchPending?.();
                    break;
                case 'commanderSync':
                    _cb.onCommanderSync?.(msg);
                    break;
            }
        };

        _ws.onclose = () => {
            if (_myRole) _cb.onOpponentLeft?.();
            _myRole = null;
            _myRoomId = null;
            _cb.onDisconnected?.();
        };
    });
}

// ==== 房间操作 ====

export function createRoom() {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify({ type: 'createRoom' }));
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
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    const msg = { type: 'action', actionType, state: serializedState };
    if (effectData) msg.effects = effectData;
    _ws.send(JSON.stringify(msg));
}

export function sendMessage(msg) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify(msg));
}

export function syncCommanderState(poolP1, poolP2, cmdP1, cmdP2, p1Confirmed, p2Confirmed, p1Deployed, p2Deployed, phase, deployedUnitP1 = null, deployedUnitP2 = null) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify({
        type: 'commanderSync',
        commanderPoolP1: poolP1,
        commanderPoolP2: poolP2,
        commanderP1: cmdP1,
        commanderP2: cmdP2,
        commanderP1Confirmed: p1Confirmed,
        commanderP2Confirmed: p2Confirmed,
        commanderP1Deployed: p1Deployed,
        commanderP2Deployed: p2Deployed,
        commanderPhase: phase,
        deployedUnitP1: deployedUnitP1,
        deployedUnitP2: deployedUnitP2
    }));
}
