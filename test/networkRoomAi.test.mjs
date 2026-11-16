import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
import { waitFor } from './lib/helpers.mjs';
import roomAi from '../server/roomAi.js';
import { FLAG_PRESETS, getFlagPresetColor } from '../rules/diplomacy.js';

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

test('历史文化房间在真人确认后一次性抽取剩余国旗', { timeout: 15000 }, async t => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const { port } = probe.address();
    await new Promise(resolve => probe.close(resolve));
    const server = spawn(process.execPath, ['server.js'], {
        env: { ...process.env, PORT: String(port), HTTPS_PORT: '0' }, stdio: 'ignore'
    });
    t.after(() => server.kill());
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/discover`)).ok, 5000, '测试服务器');

    async function connect() {
        const client = new WebSocket(`ws://127.0.0.1:${port}`);
        t.after(() => client.terminate());
        const inbox = [];
        client.on('message', raw => inbox.push(JSON.parse(raw.toString())));
        await once(client, 'open');
        return { inbox, send: message => client.send(JSON.stringify(message)) };
    }
    const { inbox, send } = await connect();
    const guest = await connect();
    send({ type: 'createRoom', maxPlayers: 3, factionRuleMode: 'culture', doubleCommanderMode: true });
    await waitFor(() => inbox.some(message => message.type === 'roomCreated'), 5000, '创建历史文化房间');
    const created = inbox.find(message => message.type === 'roomCreated');
    guest.send({ type: 'joinRoom', roomId: created.roomId });
    await waitFor(() => guest.inbox.some(message => message.type === 'roomJoined'), 5000, '真人加入同一房间');
    send({ type: 'addAi', difficultyId: 'hard' });
    await waitFor(() => inbox.some(message => message.type === 'roomUpdate' && message.players.length === 3), 5000, '填满席位');
    send({ type: 'ready' });
    guest.send({ type: 'ready' });
    await waitFor(() => inbox.some(message => message.type === 'start'), 5000, '进入选将');
    const start = inbox.find(message => message.type === 'start');
    assert.equal(start.factionPresets[start.roleAssignments.player3], null);
    const openFlags = Object.keys(FLAG_PRESETS).filter(flag => !Object.values(start.factionPresets).includes(flag));
    const [hostChoice, guestChoice, finalGuestChoice] = openFlags;
    const lastFlags = clientInbox => clientInbox.findLast(message => message.type === 'factionColors');
    const pick = (role, complete = true) => {
        const field = start.roleAssignments[role].replace('player', 'commanderP');
        return {
            type: 'commanderSync', commanderPhase: 'selection',
            [field]: 'engineer', [`${field}Confirmed`]: complete,
            [`${field}Secondary`]: complete ? 'colonel' : null,
            [`${field}SecondaryConfirmed`]: complete
        };
    };
    send({ type: 'factionColor', flagPreset: hostChoice });
    send(pick('player1'));
    await waitFor(() => guest.inbox.some(message => message.type === 'commanderSync'), 5000, '房主锁定');
    assert.equal(lastFlags(guest.inbox).factionPresets.player3, null);

    guest.send({ type: 'factionColor', flagPreset: guestChoice });
    guest.send(pick('player2', false));
    await waitFor(() => inbox.some(message => message.type === 'commanderSync'), 5000, '客人选第一名将领');
    assert.equal(lastFlags(inbox).factionPresets.player3, null);

    guest.send({ type: 'factionColor', flagPreset: finalGuestChoice });
    guest.send(pick('player2'));
    await waitFor(() => !!lastFlags(inbox)?.factionPresets.player3
        && !!lastFlags(guest.inbox)?.factionPresets.player3, 5000, '最后一位真人锁定后同步 AI 国旗');
    const { factionPresets, factionColors } = lastFlags(inbox);
    assert.deepEqual(lastFlags(guest.inbox).factionPresets, factionPresets);
    assert.equal(factionPresets.player1, hostChoice);
    assert.equal(factionPresets.player2, finalGuestChoice);
    assert.ok(Object.hasOwn(FLAG_PRESETS, factionPresets.player3));
    assert.equal(new Set(Object.values(factionPresets)).size, 3);
    assert.deepEqual(factionColors, Object.fromEntries(Object.entries(factionPresets)
        .map(([role, flag]) => [role, getFlagPresetColor(flag)])));

    const updates = inbox.filter(message => message.type === 'factionColors').length;
    guest.send({ type: 'factionColor', flagPreset: guestChoice });
    guest.send({ ...pick('player2'), duplicate: true });
    await waitFor(() => inbox.some(message => message.type === 'commanderSync' && message.duplicate), 5000, '重复确认');
    assert.equal(inbox.filter(message => message.type === 'factionColors').length, updates);
});
