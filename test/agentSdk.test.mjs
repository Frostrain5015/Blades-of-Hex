import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import WebSocket from 'ws';
import { engine } from '../core/headless.js';
import { grantTurnStartIncome } from '../js/gameLogic.js';
import { buildActionMessage } from '../protocol/messages.js';
import { buildObservation, joinAgent, parsePlan, SYSTEM_PROMPT } from '../tools/agentSdk.mjs';
import { updateFogOfWar } from '../js/fogOfWar.js';

async function listen(server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return server.address().port;
}

async function waitFor(read, label, diagnostic = () => '') {
    for (let i = 0; i < 200; i++) {
        const result = await read();
        if (result) return result;
        await delay(50);
    }
    assert.fail(`${label}超时\n${diagnostic()}`);
}

test('模型计划只接受 JSON 动作格式，并截断异常长的序列', () => {
    assert.throws(() => parsePlan('攻击！'));
    assert.throws(() => parsePlan('{"actions":[]}'));
    const plan = parsePlan(JSON.stringify({ summary: '推进\n', actions: Array(100).fill({ type: 'endTurn' }) }));
    assert.equal(plan.summary, '推进 ');
    assert.equal(plan.actions.length, 48);
    assert.deepEqual(parsePlan({ summary: '', actions: [] }), { summary: '', actions: [] });
});

test('导入 SDK 时可以读取完整提示词，连接前校验回调配置', async () => {
    assert.match(SYSTEM_PROMPT, /如何读局势/);
    assert.match(SYSTEM_PROMPT, /如何制定计划/);
    await assert.rejects(joinAgent({ room: '1' }), /planTurn/);
});

test('迷雾观察只发送己方可见单位，不发送敌方手牌与 RNG', () => {
    const state = engine.gameState;
    engine.resetGameState();
    engine.configureSkirmishState({ playerCount: 2 });
    state.skirmishFog = true;
    engine.seedMatchRng(142);
    engine.initMap();
    const camp = state.factions.player1;
    updateFogOfWar(state, camp);
    const board = buildObservation(camp);
    const unknown = state.tiles.find(tile => tile.unit?.camp === state.factions.player2 && !state.visibleTiles.player1.has(`${tile.q},${tile.r}`));
    assert.ok(unknown);
    assert.ok(!board.units.some(unit => unit[0] === unknown.unit.id));
    assert.deepEqual(board.tiles.find(tile => tile[0] === unknown.q && tile[1] === unknown.r), [unknown.q, unknown.r]);
    assert.equal(Object.hasOwn(board, 'playerHands'), false);
    assert.equal(Object.hasOwn(board, 'rng'), false);
});

test('本地 Agent 经 JSONL 和真实 WebSocket 入房选将、提交动作与交接回合', { timeout: 25000 }, async t => {
    const portProbe = createServer();
    const port = await listen(portProbe);
    await new Promise(resolve => portProbe.close(resolve));
    const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), HTTPS_PORT: '0' } });
    let serverLog = '';
    t.after(() => server.kill());
    server.stdout.on('data', chunk => { serverLog += chunk; });
    server.stderr.on('data', chunk => { serverLog += chunk; });
    await waitFor(async () => {
        try { return (await fetch(`http://127.0.0.1:${port}/discover`)).ok; } catch { return false; }
    }, '游戏服务器', () => serverLog);

    const endpoint = `ws://127.0.0.1:${port}`;
    const host = new WebSocket(endpoint);
    t.after(() => host.terminate());
    const inbox = [];
    host.on('message', raw => inbox.push(JSON.parse(raw.toString())));
    await once(host, 'open');
    const send = message => host.send(JSON.stringify(message));
    send({ type: 'hello', clientId: randomUUID() });
    send({ type: 'createRoom', maxPlayers: 2, standardMapId: 'crown-ring' });
    const room = await waitFor(() => inbox.find(message => message.type === 'roomCreated'), '创建房间', () => serverLog);
    const client = spawn(process.execPath, [
        'tools/agentSdk.mjs', `--server=${endpoint}`, `--room=${room.roomId}`, '--start-delay-ms=0'
    ], { env: { ...process.env, BOH_GAME_TOKEN: '' } });
    t.after(() => client.kill());
    let agentLog = '';
    client.stderr.on('data', chunk => { agentLog += chunk; });
    const events = [];
    const nonJsonOutput = [];
    const lines = createInterface({ input: client.stdout });
    lines.on('line', line => {
        try { events.push(JSON.parse(line)); } catch { nonJsonOutput.push(line); }
    });
    const diagnostic = () => `${agentLog}\n${serverLog}`;
    await waitFor(() => inbox.some(message => message.type === 'opponentReady'), 'Agent 自动准备', diagnostic);
    send({ type: 'ready' });
    const start = await waitFor(() => inbox.find(message => message.type === 'start'), '对局开始', diagnostic);
    const mySeat = start.roleAssignments.player1.replace('player', 'P');
    const draft = {
        type: 'commanderSync', commanderPhase: 'selection',
        commanderPoolP1: ['vampire', 'centurion', 'berserker'],
        commanderPoolP2: ['magician', 'colonel', 'minister'],
        [`commander${mySeat}`]: mySeat === 'P1' ? 'vampire' : 'magician',
        [`commander${mySeat}Confirmed`]: true
    };
    send(draft);
    const selected = await waitFor(() => inbox.find(message => message.type === 'commanderSync'
        && message.commanderP1Confirmed && message.commanderP2Confirmed), 'Agent 选将', diagnostic);

    // If the host rolls first, play the handover using the same shared game engine.
    if (start.turnOrder[0] === start.roleAssignments.player1) {
        engine.resetGameState();
        engine.configureSkirmishState({
            playerCount: 2, colors: start.factionColors, flagEmojis: start.factionEmojis,
            flagPresets: start.factionPresets, factionNames: start.factionNames,
            controllers: { player1: 'human', player2: 'human' }
        });
        Object.assign(engine.gameState, {
            standardMapId: start.standardMapId, factionRuleMode: start.factionRuleMode, skirmishFog: start.skirmishFog,
            doubleCommanderMode: start.doubleCommanderMode, roleAssignments: start.roleAssignments, turnOrder: start.turnOrder,
            commanderP1: selected.commanderP1, commanderP2: selected.commanderP2,
            commanderP1Confirmed: true, commanderP2Confirmed: true, commanderPhase: 'done'
        });
        engine.gameState.currentCamp = engine.gameState.factions[start.turnOrder[0]];
        engine.seedMatchRng(start.matchSeed);
        engine.initMap();
        grantTurnStartIncome(engine.gameState.currentCamp);
        send({ type: 'saveState', state: engine.serializeState() });
        await engine.advanceAutomatedTurn();
        send(buildActionMessage('endTurn', engine.serializeState(), null, 0));
    }

    const turn = await waitFor(() => events.find(event => event.type === 'turn'), '收到棋盘及提示词', diagnostic);
    assert.equal(turn.prompt, SYSTEM_PROMPT);
    assert.equal(turn.observation.you, start.roleAssignments.player2);
    const chosen = turn.observation.legal.find(unit => unit.move.length);
    const [q, r] = chosen.move[0];
    const plan = { type: 'plan', turnId: turn.turnId, summary: '调整阵线', actions: [
        { type: 'move', unitId: -1, q, r },
        { type: 'move', unitId: chosen.unitId, q, r },
        { type: 'endTurn' }
    ] };
    client.stdin.write(`${JSON.stringify({ ...plan, turnId: 'stale' })}\n`);
    await waitFor(() => events.find(event => event.type === 'inputError'), '拒绝过期回合计划', diagnostic);
    client.stdin.write(`${JSON.stringify(plan)}\n`);

    const move = await waitFor(() => inbox.find(message => message.type === 'action' && message.actionType === 'move'
        && message.originRole === 'player2'), '移动动作广播', diagnostic);
    assert.equal(move.effects.unitId, chosen.unitId);
    assert.deepEqual([move.effects.q, move.effects.r], chosen.move[0]);
    assert.equal(move.state.currentCampKey, start.roleAssignments.player2);
    await waitFor(() => inbox.some(message => message.type === 'action' && message.actionType === 'endTurn'
        && message.originRole === 'player2'), 'Agent 结束回合', diagnostic);
    if (start.turnOrder[1] === start.roleAssignments.player2) {
        await waitFor(() => inbox.some(message => message.type === 'action' && message.actionType === 'endTurn'
            && message.originRole === 'player2' && message.state.currentCampKey === start.roleAssignments.player1
            && message.state.turnCounter === 3), 'Agent 驱动中立回合', diagnostic);
    }
    await waitFor(() => events.find(event => event.type === 'turnEnded' && event.turnId === turn.turnId), '回合确认结果', diagnostic);
    assert.ok(events.some(event => event.type === 'summary' && event.summary === '调整阵线'));
    assert.deepEqual(events.filter(event => event.type === 'actionResult').map(event => event.accepted), [false, true]);
    assert.deepEqual(nonJsonOutput, []);
});
