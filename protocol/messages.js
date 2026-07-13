// Shared browser/server WebSocket protocol contract.
// Deliberately dependency-free so it can run in browsers and Node alike.
export const PROTOCOL_VERSION = 2;

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

const MAX_ACTION_BYTES = 1024 * 1024;
const MAX_TILES = 256;

export function roleToCampKey(role, snapshot = null) {
    if (typeof role !== 'string' || !role) return null;
    const assigned = snapshot?.roleAssignments?.[role];
    if (assigned && snapshot?.factions?.[assigned]) return assigned;
    return snapshot?.factions?.[role] ? role : null;
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

function hasValidTiles(snapshot, factionKeys) {
    if (!Array.isArray(snapshot.tiles) || snapshot.tiles.length === 0 || snapshot.tiles.length > MAX_TILES) return false;
    return snapshot.tiles.every((tile) => tile
        && Number.isInteger(tile.q)
        && Number.isInteger(tile.r)
        && typeof tile.id === 'number'
        && factionKeys.has(tile.campKey));
}

export function isValidSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
    if (!snapshot.factions || typeof snapshot.factions !== 'object' || Array.isArray(snapshot.factions)) return false;
    const keys = Object.keys(snapshot.factions);
    if (!keys.length || !keys.every(key => /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(key))) return false;
    const factionKeys = new Set(keys);
    if (!factionKeys.has(snapshot.currentCampKey) || !hasValidTiles(snapshot, factionKeys)) return false;
    if (!Array.isArray(snapshot.turnOrder) || !snapshot.turnOrder.length || snapshot.turnOrder.some(key => !factionKeys.has(key))) return false;
    if (!snapshot.roleAssignments || typeof snapshot.roleAssignments !== 'object') return false;
    if (Object.values(snapshot.roleAssignments).some(key => !factionKeys.has(key))) return false;
    if (!snapshot.playerGold || typeof snapshot.playerGold !== 'object') return false;
    if (!keys.every((key) => Object.hasOwn(snapshot.playerGold, key))) return false;
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

// 中立回合的驱动方：回合顺序上紧邻中立之前的存活玩家（即最后一个未投降的人类阵营）。
// 中立 AI 没有自己的客户端，由该玩家的客户端代为执行并广播；服务器据此放行其操作。
// 纯函数、双端共用（server.js 校验 / 客户端判断是否由自己接管）。
export function neutralDriverRole(snapshot) {
    const order = (snapshot.turnOrder || []).filter(key => key !== 'neutral');
    const surrendered = new Set(snapshot.surrenderedCampKeys || []);
    const alive = order.filter((key) => !surrendered.has(key));
    if (alive.length === 0) return null;
    const campKey = alive[alive.length - 1];
    return Object.entries(snapshot.roleAssignments || {}).find(([, key]) => key === campKey)?.[0] || null;
}
