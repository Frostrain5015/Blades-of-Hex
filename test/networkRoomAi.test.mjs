import test from 'node:test';
import assert from 'node:assert/strict';
import roomAi from '../server/roomAi.js';

const { AI_DRIVER_ROLE, isValidAiDifficulty, aiSlotCount, humanCapacity, isRoomFull, firstFreeRole, takenRoles } = roomAi;

// 构造假房间:humanRoles 为真人角色,aiRoles 为 AI 占位角色
function fakeRoom({ maxPlayers = 3, humanRoles = [], aiRoles = [] } = {}) {
    return {
        maxPlayers,
        players: new Map(humanRoles.map(role => [{}, { role }])),
        aiSlots: new Map(aiRoles.map(role => [role, { difficultyId: 'easy' }]))
    };
}

test('AI_DRIVER_ROLE 恒为 player1(房主)', () => {
    assert.equal(AI_DRIVER_ROLE, 'player1');
});

test('firstFreeRole: 无占用返回 player1', () => {
    assert.equal(firstFreeRole(3, []), 'player1');
    assert.equal(firstFreeRole(3, takenRoles(fakeRoom({}))), 'player1');
});

test('firstFreeRole: 跳过真人占用', () => {
    const room = fakeRoom({ humanRoles: ['player1', 'player2'] });
    assert.equal(firstFreeRole(3, takenRoles(room)), 'player3');
});

test('firstFreeRole: 跳过 AI 占用(player2 被 AI 占时返回 player3)', () => {
    const room = fakeRoom({ humanRoles: ['player1'], aiRoles: ['player2'] });
    assert.equal(firstFreeRole(3, takenRoles(room)), 'player3');
});

test('firstFreeRole: 全占返回 null', () => {
    const room = fakeRoom({ humanRoles: ['player1', 'player3'], aiRoles: ['player2'] });
    assert.equal(firstFreeRole(3, takenRoles(room)), null);
    assert.equal(firstFreeRole(2, ['player1', 'player2']), null);
});

test('takenRoles/aiSlotCount: 真人 + AI 角色合并计数', () => {
    const room = fakeRoom({ humanRoles: ['player1'], aiRoles: ['player2', 'player3'] });
    assert.deepEqual(takenRoles(room).sort(), ['player1', 'player2', 'player3']);
    assert.equal(aiSlotCount(room), 2);
    assert.equal(aiSlotCount(fakeRoom({ humanRoles: ['player1'] })), 0);
});

test('isRoomFull/humanCapacity: 3 人房 1 真人 + 1 AI → 不满,humanCapacity=2', () => {
    const room = fakeRoom({ maxPlayers: 3, humanRoles: ['player1'], aiRoles: ['player2'] });
    assert.equal(humanCapacity(room), 2);
    assert.equal(isRoomFull(room), false);
});

test('isRoomFull: 3 人房 2 真人 + 1 AI → 满', () => {
    const room = fakeRoom({ maxPlayers: 3, humanRoles: ['player1', 'player2'], aiRoles: ['player3'] });
    assert.equal(humanCapacity(room), 2);
    assert.equal(isRoomFull(room), true);
});

test('isRoomFull/humanCapacity: 无 AI 时行为与旧逻辑一致(players.size >= maxPlayers)', () => {
    const twoOfThree = fakeRoom({ maxPlayers: 3, humanRoles: ['player1', 'player2'] });
    assert.equal(humanCapacity(twoOfThree), 3);
    assert.equal(isRoomFull(twoOfThree), false);

    const threeOfThree = fakeRoom({ maxPlayers: 3, humanRoles: ['player1', 'player2', 'player3'] });
    assert.equal(isRoomFull(threeOfThree), true);

    const twoOfTwo = fakeRoom({ maxPlayers: 2, humanRoles: ['player1', 'player2'] });
    assert.equal(humanCapacity(twoOfTwo), 2);
    assert.equal(isRoomFull(twoOfTwo), true);
});

test('isValidAiDifficulty: easy/medium/hard 通过,其他拒绝', () => {
    for (const id of ['easy', 'medium', 'hard']) {
        assert.equal(isValidAiDifficulty(id), true, `应通过: ${id}`);
    }
    for (const id of ['', 'EASY', 'Easy', 'nightmare', null, undefined, 0, 'easy ']) {
        assert.equal(isValidAiDifficulty(id), false, `应拒绝: ${String(id)}`);
    }
});
