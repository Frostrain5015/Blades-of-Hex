// 联机房间 AI 席位的纯函数助手（无状态，可单测）。
// AI 席位没有真实 socket：只占位（role + 难度），对局中由房主(player1)客户端代理驱动。

const AI_DIFFICULTY_IDS = new Set(['easy', 'medium', 'hard']);

// AI 席位回合时代理驱动的角色（房主恒为 player1）
const AI_DRIVER_ROLE = 'player1';

function isValidAiDifficulty(value) {
    return AI_DIFFICULTY_IDS.has(value);
}

function aiSlotCount(room) {
    return room && room.aiSlots ? room.aiSlots.size : 0;
}

// 真人席位容量 = 总座位 - AI 占位
function humanCapacity(room) {
    return (room.maxPlayers || 2) - aiSlotCount(room);
}

// 房间满员 = 真人 + AI 达到 maxPlayers（AI 席位视为已就绪）
function isRoomFull(room) {
    return room.players.size + aiSlotCount(room) >= (room.maxPlayers || 2);
}

// 首个未被真人或 AI 占据的角色（player1..playerN）；满则返回 null
function firstFreeRole(maxPlayers, takenRoles) {
    const taken = new Set(takenRoles);
    for (let i = 1; i <= maxPlayers; i++) {
        const role = `player${i}`;
        if (!taken.has(role)) return role;
    }
    return null;
}

// 房间内已被占用的角色集合（真人 + AI）
function takenRoles(room) {
    return [...room.players.values()].map(info => info.role).concat([...(room.aiSlots?.keys() || [])]);
}

module.exports = {
    AI_DIFFICULTY_IDS,
    AI_DRIVER_ROLE,
    isValidAiDifficulty,
    aiSlotCount,
    humanCapacity,
    isRoomFull,
    firstFreeRole,
    takenRoles
};
