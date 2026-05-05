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
                case 'opponentLeft': _cb.onOpponentLeft?.(); break;
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
