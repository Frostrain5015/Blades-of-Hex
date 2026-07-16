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
    'chooseSpecialization',
    'droneDeploy',
    'droneSuicide',
    'engineerTrench',
    'engineerFlak',
    'engineerBunkerStart',
    'buildFortification',
    'buildBunker',
    'buildAirfield',
    'fieldRepair',
    'airCommand',
    'tacticalCard'
]);

const MAX_ACTION_BYTES = 1024 * 1024;
const MAX_TILES = 512;
const BOARD_LAYOUTS = new Set(['hex', 'borderless']);
const SURFACES = new Set(['land', 'shallowWater', 'deepWater']);
const WATER_SURFACES = new Set(['shallowWater', 'deepWater']);
const RIVER_WIDTHS = new Set(['stream', 'river']);
const CROSSING_KINDS = new Set(['ford', 'bridge']);
const HEX_NEIGHBORS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const RIVER_VERTEX_OFFSETS = [[1, 1], [0, 2], [-1, 1], [-1, -1], [0, -2], [1, -1]];

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
    const coordinates = new Set();
    for (const tile of snapshot.tiles) {
        if (!tile
            || !Number.isInteger(tile.q)
            || !Number.isInteger(tile.r)
            || typeof tile.id !== 'number'
            || tile.renderOnly === true
            || tile.playable === false) return false;
        const key = `${tile.q},${tile.r}`;
        if (coordinates.has(key)) return false;
        coordinates.add(key);
        const surface = tile.surface ?? 'land';
        if (!SURFACES.has(surface)) return false;
        if (WATER_SURFACES.has(surface)) {
            const controlledPort = tile.isPort === true;
            if (controlledPort) {
                if (surface !== 'shallowWater' || !factionKeys.has(tile.campKey) || !Number.isInteger(tile.districtId)) return false;
            } else if (tile.campKey !== null || tile.districtId != null) return false;
            if (tile.isCity || tile.isUrban || tile.isVillage
                || tile.fortification || tile.minePlanted) return false;
        } else if (!factionKeys.has(tile.campKey)) return false;
    }
    return true;
}

function canonicalRiverVertex(point) {
    const [dx, dy] = RIVER_VERTEX_OFFSETS[point.vertex];
    const x = 2 * point.q + point.r + dx;
    const y = 3 * point.r + dy;
    return { x, y, key: `${x},${y}` };
}

function canonicalRiverSegmentKey(left, right) {
    const before = left.x < right.x || (left.x === right.x && left.y <= right.y);
    const first = before ? left : right;
    const second = before ? right : left;
    return `${first.key}|${second.key}`;
}

function areCanonicalRiverVerticesAdjacent(left, right) {
    const dx = Math.abs(left.x - right.x);
    const dy = Math.abs(left.y - right.y);
    return (dx === 1 && dy === 1) || (dx === 0 && dy === 2);
}

function hasValidBoardMetadata(snapshot) {
    if (snapshot.boardLayout != null && !BOARD_LAYOUTS.has(snapshot.boardLayout)) return false;
    const tileByKey = new Map(snapshot.tiles.map(tile => [`${tile.q},${tile.r}`, tile]));

    if (snapshot.rivers != null && !Array.isArray(snapshot.rivers)) return false;
    const riverSegmentsById = new Map();
    const globalRiverSegments = new Set();
    for (const river of snapshot.rivers || []) {
        if (!river || typeof river.id !== 'string'
            || !/^[a-z][a-z0-9_-]{0,63}$/i.test(river.id)
            || riverSegmentsById.has(river.id)) return false;
        if (!RIVER_WIDTHS.has(river.width)) return false;
        if (!Array.isArray(river.points) || river.points.length < 2) return false;
        const canonicalPoints = [];
        const seenVertices = new Set();
        for (const point of river.points) {
            if (!Number.isInteger(point?.q) || !Number.isInteger(point?.r)
                || !Number.isInteger(point?.vertex) || point.vertex < 0 || point.vertex > 5
                || !tileByKey.has(`${point.q},${point.r}`)) return false;
            const canonical = canonicalRiverVertex(point);
            if (seenVertices.has(canonical.key)) return false;
            seenVertices.add(canonical.key);
            canonicalPoints.push(canonical);
        }
        for (let index = 0; index < canonicalPoints.length - 1; index++) {
            const from = canonicalPoints[index];
            const to = canonicalPoints[index + 1];
            if (!areCanonicalRiverVerticesAdjacent(from, to)) return false;
            const segmentKey = canonicalRiverSegmentKey(from, to);
            if (globalRiverSegments.has(segmentKey)) return false;
            globalRiverSegments.add(segmentKey);
        }
        riverSegmentsById.set(river.id, river.points.length - 1);
    }

    const validateCrossings = (crossings) => {
        if (crossings == null) return '';
        if (!Array.isArray(crossings)) return null;
        const seen = new Map();
        for (const crossing of crossings) {
            const segmentCount = riverSegmentsById.get(crossing?.riverId);
            const key = `${crossing?.riverId}:${crossing?.segmentIndex}`;
            if (segmentCount == null
                || !Number.isInteger(crossing.segmentIndex)
                || crossing.segmentIndex < 0
                || crossing.segmentIndex >= segmentCount
                || !CROSSING_KINDS.has(crossing.kind)
                || seen.has(key)) return null;
            seen.set(key, crossing.kind);
        }
        return [...seen.entries()].map(([key, kind]) => `${key}:${kind}`).sort().join('|');
    };
    const crossingsSignature = validateCrossings(snapshot.crossings);
    const legacyCrossingsSignature = validateCrossings(snapshot.riverCrossings);
    if (crossingsSignature == null || legacyCrossingsSignature == null) return false;
    if (snapshot.crossings != null && snapshot.riverCrossings != null
        && crossingsSignature !== legacyCrossingsSignature) return false;

    if (snapshot.ports != null && !Array.isArray(snapshot.ports)) return false;
    const seenPorts = new Set();
    for (const port of snapshot.ports || []) {
        if (!Number.isInteger(port?.q) || !Number.isInteger(port?.r) || !Number.isInteger(port?.districtId)
            || !Number.isInteger(port?.landQ) || !Number.isInteger(port?.landR)) return false;
        const key = `${port.q},${port.r}`;
        const tile = tileByKey.get(key);
        if (!tile || tile.surface !== 'shallowWater' || tile.isPort !== true
            || tile.districtId !== port.districtId || seenPorts.has(key)) return false;
        const adjacentLand = HEX_NEIGHBORS.some(([dq, dr]) => {
            const neighbor = tileByKey.get(`${port.q + dq},${port.r + dr}`);
            return !!neighbor && !WATER_SURFACES.has(neighbor.surface ?? 'land');
        });
        if (!adjacentLand) return false;
        const anchor = tileByKey.get(`${port.landQ},${port.landR}`);
        const anchorAdjacent = HEX_NEIGHBORS.some(([dq, dr]) => port.q + dq === port.landQ && port.r + dr === port.landR);
        if (!anchor || WATER_SURFACES.has(anchor.surface ?? 'land') || !anchorAdjacent || anchor.districtId !== port.districtId) return false;
        seenPorts.add(key);
    }
    for (const tile of snapshot.tiles) {
        if (tile.isPort !== true) continue;
        if (tile.surface !== 'shallowWater' || !seenPorts.has(`${tile.q},${tile.r}`)) return false;
        const adjacentLand = HEX_NEIGHBORS.some(([dq, dr]) => {
            const neighbor = tileByKey.get(`${tile.q + dq},${tile.r + dr}`);
            return !!neighbor && !WATER_SURFACES.has(neighbor.surface ?? 'land');
        });
        if (!adjacentLand) return false;
    }
    return true;
}

export function isValidSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
    if (!snapshot.factions || typeof snapshot.factions !== 'object' || Array.isArray(snapshot.factions)) return false;
    const keys = Object.keys(snapshot.factions);
    if (!keys.length || !keys.every(key => /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(key))) return false;
    const factionKeys = new Set(keys);
    if (!factionKeys.has(snapshot.currentCampKey)
        || !hasValidTiles(snapshot, factionKeys)
        || !hasValidBoardMetadata(snapshot)) return false;
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
