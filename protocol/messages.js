// Shared browser/server WebSocket protocol contract.
// Deliberately dependency-free so it can run in browsers and Node alike.
export const PROTOCOL_VERSION = 1;

export const ACTION_TYPES = new Set([
    'deployDone',
    'move',
    'attack',
    'endTurn',
    'recruit',
    'reinforce',
    'surrender',
    'activateSkill',
    'droneDeploy',
    'droneSuicide',
    'engineerTrench',
    'engineerFlak',
    'engineerBunkerStart',
    'tacticalCard'
]);

const CAMP_KEYS = new Set(['p1', 'p2', 'p3', 'neutral']);
const MAX_ACTION_BYTES = 1024 * 1024;
const MAX_TILES = 256;

export function roleToCampKey(role) {
    if (role === 'player1') return 'p1';
    if (role === 'player2') return 'p2';
    if (role === 'player3') return 'p3';
    return null;
}

export function buildActionMessage(actionType, state, effects, baseRevision) {
    const message = {
        type: 'action',
        protocolVersion: PROTOCOL_VERSION,
        actionType,
        state,
        baseRevision
    };
    if (effects) message.effects = effects;
    return message;
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function hasValidTiles(snapshot) {
    if (!Array.isArray(snapshot.tiles) || snapshot.tiles.length === 0 || snapshot.tiles.length > MAX_TILES) return false;
    return snapshot.tiles.every((tile) => tile
        && Number.isInteger(tile.q)
        && Number.isInteger(tile.r)
        && typeof tile.id === 'number'
        && CAMP_KEYS.has(tile.campKey));
}

export function isValidSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
    if (!CAMP_KEYS.has(snapshot.currentCampKey) || !hasValidTiles(snapshot)) return false;
    if (!snapshot.playerGold || typeof snapshot.playerGold !== 'object') return false;
    if (!['player1', 'player2', 'player3', 'neutral'].every((key) => Object.hasOwn(snapshot.playerGold, key))) return false;
    if (!Object.values(snapshot.playerGold).every(isFiniteNumber)) return false;
    if (!Number.isInteger(snapshot.turnCounter) || snapshot.turnCounter < 0) return false;
    return true;
}

export function validateActionMessage(message) {
    if (!message || typeof message !== 'object') return { ok: false, reason: '无效的操作消息' };
    if (message.protocolVersion !== PROTOCOL_VERSION) return { ok: false, reason: '客户端协议版本不兼容' };
    if (!ACTION_TYPES.has(message.actionType)) return { ok: false, reason: '不支持的操作类型' };
    if (!Number.isInteger(message.baseRevision) || message.baseRevision < 0) return { ok: false, reason: '缺少操作版本号' };
    if (!isValidSnapshot(message.state)) return { ok: false, reason: '无效的对局快照' };
    try {
        if (JSON.stringify(message).length > MAX_ACTION_BYTES) return { ok: false, reason: '操作消息过大' };
    } catch {
        return { ok: false, reason: '操作消息无法序列化' };
    }
    return { ok: true };
}

export function isSetupAction(actionType, snapshot) {
    return snapshot.commanderPhase !== 'done'
        || actionType === 'deployDone';
}
