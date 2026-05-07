import { CAMP } from './config.js';

let _ws = null;
let _myRole = null;   // 'player1' | 'player2' | null

const _cb = {};

export function setNetworkCallbacks(callbacks) {
    Object.assign(_cb, callbacks);
}

export function getMyRole() { return _myRole; }
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

        _ws.onopen = () => { clearTimeout(timer); resolve(); };
        _ws.onerror = () => { clearTimeout(timer); reject(new Error('无法连接到服务器')); };

        _ws.onmessage = ({ data }) => {
            let msg;
            try { msg = JSON.parse(data); } catch { return; }
            switch (msg.type) {
                case 'assigned':     _cb.onAssigned?.(); break;
                case 'waiting':      _cb.onWaiting?.(); break;
                case 'start':        _myRole = msg.role; _cb.onStart?.(msg.role); break;
                case 'action':       _cb.onRemoteAction?.(msg); break;
                case 'opponentJoined':  _myRole = msg.role; _cb.onOpponentJoined?.(msg.role); break;
                case 'opponentLeft':    _cb.onOpponentLeft?.(); break;
                case 'rematchPending': _cb.onRematchPending?.(); break;
                case 'commanderSync':  _cb.onCommanderSync?.(msg); break;
            }
        };

        _ws.onclose = () => { if (_myRole) _cb.onOpponentLeft?.(); };
    });
}

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
