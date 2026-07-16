// WebSocket 联机对局套件：
//   建房 → 加入 → 双方准备 → 双方选将 → 部署 → 回合轮转同步 → 远端特效回放 → 断线重连(stateSync)
import {
    newGamePage, pickCommander, waitGameStart, gameSnapshot, deployCommander,
    clickEndTurn, installFxProbe, readFxProbe, fetchedFxModules, fxRegistryStats,
    waitFor, sleep, Reporter,
} from './lib/helpers.mjs';

const FX_MANIFEST = ['ironGuard', 'astrologer', 'staller', 'necromancer', 'fallenAngel',
    'berserker', 'paladin', 'priest', 'diplomat', 'vampire', 'advisor', 'minister'];

async function getMyRole(page) {
    return page.evaluate(async () => (await import('/js/network.js')).getMyRole());
}

async function getCurrentTurnRole(page) {
    return page.evaluate(async () => {
        const { gameState } = await import('/js/state.js');
        return (await import('/js/network.js')).campToRole(gameState.currentCamp) || 'neutral';
    });
}

async function ensureTurnFor(targetPage, otherPage) {
    const targetRole = await getMyRole(targetPage);
    const otherRole = await getMyRole(otherPage);
    for (let i = 0; i < 20; i++) {
        const turnRole = await getCurrentTurnRole(targetPage);
        if (turnRole === targetRole) return;
        if (turnRole === 'neutral') {
            await sleep(1500);
            continue;
        }
        const mover = turnRole === targetRole ? targetPage : turnRole === otherRole ? otherPage : null;
        if (mover) await clickEndTurn(mover);
        await sleep(1500);
    }
    throw new Error(`无法推进到重连玩家回合: target=${targetRole}, turn=${await getCurrentTurnRole(targetPage)}`);
}

async function probeReconnectActionButtons(page) {
    return page.evaluate(async () => {
        const { gameState } = await import('/js/state.js');
        const input = await import('/js/input.js');
        const { campToKey } = await import('/rules/camps.js');
        const net = await import('/js/network.js');
        const role = net.getMyRole();
        const camp = net.roleToCamp(role);
        if (!camp) return { ok: false, reason: 'no role' };

        const tile = gameState.tiles.find(t => t.unit
            && campToKey(t.unit.camp) === campToKey(camp)
            && (t.isCity || t.isVillage));
        if (!tile || !tile.unit) return { ok: false, reason: 'no city unit' };

        const unit = tile.unit;
        unit.commander = 'priest';
        unit.canAct = true;
        unit.isNewRecruit = false;
        unit.activeSkillCD = 0;
        unit.activeSkillDur = 0;
        unit._healingAura = 0;
        unit.hp = Math.max(1, unit.maxHp - 40);
        unit.displayHp = unit.hp;
        tile._reinforcedThisTurn = false;
        gameState.playerGold[campToKey(unit.camp)] = 99;

        // 新引擎允许相机平移/缩放，测试不再用旧的未变换画布坐标模拟点击。
        gameState.selectedTile = tile;
        gameState.selectedUnit = unit;
        gameState.movableTiles = [];
        gameState.attackableTiles = [];
        input.showSelectionHudForTile(tile);

        const skillBtn = document.getElementById('boardActiveSkill');
        const reinforceBtn = document.getElementById('boardReinforce');
        const isUnavailable = button => !button
            || button.classList.contains('is-disabled')
            || button.getAttribute('aria-disabled') === 'true';
        const before = {
            ok: true,
            selected: gameState.selectedUnit?.id === unit.id,
            skillVisible: !!skillBtn && skillBtn.offsetParent !== null,
            skillDisabled: isUnavailable(skillBtn),
            reinforceVisible: !!reinforceBtn && reinforceBtn.offsetParent !== null,
            reinforceDisabled: isUnavailable(reinforceBtn),
        };

        const activate = button => button?.click();
        activate(skillBtn);
        const activeSkillCD = unit.activeSkillCD;
        activate(document.getElementById('boardReinforce'));

        return {
            ...before,
            activeSkillCD,
            reinforced: !!tile._reinforcedThisTurn,
            hp: unit.hp,
            maxHp: unit.maxHp,
        };
    });
}

export async function run(browser) {
    const R = new Reporter('net');
    const A = await newGamePage(browser);
    const B = await newGamePage(browser);

    // ── 1. A 建房 ──
    await A.click('#multiplayerBtn');
    await sleep(1000);
    await A.click('#createRoomBtn');
    await A.waitForSelector('#prepConfirm', { timeout: 5000 });
    await A.click('#prepConfirm');
    await waitFor(async () => A.evaluate(() => document.getElementById('roomIdValue')?.textContent.trim().length > 0),
        10000, '房间号出现');
    const roomId = await A.evaluate(() => document.getElementById('roomIdValue').textContent.trim());
    R.assert(!!roomId, `创建房间成功（房间号 ${roomId}）`);

    // ── 2. B 加入 ──
    await B.click('#multiplayerBtn');
    await sleep(1000);
    await B.click('#refreshRoomsBtn');
    await sleep(800);
    const joinedViaUI = await B.evaluate((rid) => {
        const item = [...document.querySelectorAll('#roomList > *')].find(el => el.textContent.includes(rid));
        if (item) { item.click(); return true; }
        return false;
    }, roomId);
    if (!joinedViaUI) await B.evaluate(async (rid) => (await import('/js/network.js')).joinRoom(rid), roomId);
    await waitFor(async () => B.evaluate(() => {
        const btn = document.getElementById('readyBtn');
        return btn && btn.offsetParent && !btn.disabled;
    }), 10000, 'B 进房且准备键可用');
    R.ok(`B 加入房间（${joinedViaUI ? '房间列表' : '直连'}）`);

    // ── 3. 双方准备 → 选将 ──
    await Promise.all([
        waitFor(async () => A.evaluate(() => !document.getElementById('readyBtn').disabled), 10000, 'A 准备键可用'),
        waitFor(async () => B.evaluate(() => !document.getElementById('readyBtn').disabled), 10000, 'B 准备键可用'),
    ]);
    await A.click('#readyBtn');
    await B.click('#readyBtn');
    await Promise.all([
        A.waitForSelector('#commanderLogo:not([disabled])', { timeout: 15000 }),
        B.waitForSelector('#commanderLogo:not([disabled])', { timeout: 15000 })
    ]);
    await A.click('#commanderLogo');
    await A.click('#commanderColorPicker .commander-color-swatch[data-color-id="purple"]');
    await A.click('#commanderColorPicker .commander-emoji-option[data-emoji="🐉"]');
    await B.click('#commanderLogo');
    await B.click('#commanderColorPicker .commander-color-swatch[data-color-id="cyan"]');
    await B.click('#commanderColorPicker .commander-emoji-option[data-emoji="🦅"]');
    await waitFor(async () => A.evaluate(async () => {
        const { gameState } = await import('/js/state.js');
        return gameState.factions.player1?.colorId === 'purple'
            && gameState.factions.player1?.flagEmoji === '🐉'
            && gameState.factions.player2?.colorId === 'cyan'
            && gameState.factions.player2?.flagEmoji === '🦅';
    }), 10000, '联机旗帜外观同步');
    const syncedFlags = await B.evaluate(async () => {
        const { gameState } = await import('/js/state.js');
        return {
            p1: gameState.factions.player1,
            p2: gameState.factions.player2
        };
    });
    R.assert(syncedFlags.p1.colorId === 'purple' && syncedFlags.p1.flagEmoji === '🐉'
        && syncedFlags.p2.colorId === 'cyan' && syncedFlags.p2.flagEmoji === '🦅'
        && syncedFlags.p1.flagUrl?.startsWith('data:image/svg+xml')
        && syncedFlags.p2.flagUrl?.startsWith('data:image/svg+xml'),
    '联机房间同步阵营色与旗面徽记，双方使用同一面规则生成旗帜');
    await pickCommander(A);
    console.log('[test] A 选将完成');
    await sleep(500);
    await pickCommander(B);
    console.log('[test] B 选将完成');
    await sleep(800);
    await Promise.all([waitGameStart(A, 60000), waitGameStart(B, 60000)]);
    const [sa, sb] = [await gameSnapshot(A), await gameSnapshot(B)];
    R.assert(sa.tiles > 0 && sb.tiles > 0 && sa.commanderP1 === sb.commanderP1 && sa.commanderP2 === sb.commanderP2,
        `双端开局一致（P1=${sa.commanderP1}，P2=${sa.commanderP2}）`);

    // ── 确定双方稳定席位；阵营颜色和行动顺序与席位相互独立 ──
    const roleA = await getMyRole(A);
    const roleB = await getMyRole(B);
    const pageP1 = roleA === 'player1' ? A : B;
    const pageP2 = roleA === 'player2' ? A : B;
    R.assert(roleA !== roleB, `角色分配 A=${roleA} B=${roleB}`);

    // ── 4. 双端懒加载断言 ──
    const selectedCommanders = [sa.commanderP1, sa.commanderP2].filter(Boolean);
    const expected = selectedCommanders.filter(id => FX_MANIFEST.includes(id));
    for (const [name, pg] of [['A', A], ['B', B]]) {
        const fetched = await fetchedFxModules(pg);
        R.assert(expected.every(id => fetched.includes(id)) && fetched.every(id => selectedCommanders.includes(id)),
            `${name} 端按需加载 [${fetched.join(', ') || '无'}]`);
    }

    // ── 5. 双方部署 + 两轮回合轮转 ──
    await installFxProbe(A);
    await installFxProbe(B);
    const [da, db] = [await deployCommander(pageP1), await deployCommander(pageP2)];
    R.assert(da.ok && db.ok, `双方部署将领（P1→${da.unit}，P2→${db.unit}）`);
    await sleep(1500);

    const pageByRole = { [roleA]: A, [roleB]: B };
    // 双人联机回合顺序由开局掷骰决定，随后经过中立 AI 回合形成完整一圈。
    for (let round = 1; round <= 2; round++) {
        const snap0 = await gameSnapshot(pageP1);
        const t0 = snap0.turnCounter;
        const startingRole = await getCurrentTurnRole(pageP1);
        console.log(`[test] Round ${round}: turnCounter=${t0}, role=${startingRole}, camp=${snap0.currentCamp}`);

        for (let action = 0; action < 2; action++) {
            await waitFor(async () => pageByRole[await getCurrentTurnRole(pageP1)] != null,
                40000, `第 ${round} 轮第 ${action + 1} 个玩家回合出现`);
            const actingRole = await getCurrentTurnRole(pageP1);
            const mover = pageByRole[actingRole];
            const watcher = mover === A ? B : A;
            const before = (await gameSnapshot(mover)).turnCounter;
            await clickEndTurn(mover);
            await waitFor(async () => (await gameSnapshot(watcher)).turnCounter > before,
                25000, `${actingRole} 结束回合后双端同步`);
        }

        // 中立 AI 自动结束后，应回到本轮起始玩家。
        await waitFor(async () => {
            const s = await gameSnapshot(pageP1);
            return await getCurrentTurnRole(pageP1) === startingRole && s.turnCounter > t0 + 1;
        }, 40000, `掷骰顺序完成第 ${round} 个完整轮转`);
        R.ok(`第 ${round} 轮回合轮转同步`);
    }
    const [ta, tb] = [(await gameSnapshot(pageP1)).turnCounter, (await gameSnapshot(pageP2)).turnCounter];
    R.assert(ta === tb, `双端回合计数一致（${ta}）`);
    const pb = await readFxProbe(pageP2);
    R.assert(pb.turnFlash > 0, 'P2 端回合闪光回放');
    R.assert(pb.coinParticles > 0 || pb.goldTexts > 0, `P2 端收入事件/金币特效回放（coins=${pb.coinParticles}, gold=${pb.goldTexts}）`);
    R.assertNoPageErrors(A, 'A 端对局');
    R.assertNoPageErrors(B, 'B 端对局');

    // ── 6. 断线重连（stateSync 恢复 + fx 重新装载） ──
    await B.reload({ waitUntil: 'networkidle' });
    B._errors.length = 0;
    // 重连 UI：点多人按钮 → 自动连接服务器 → 切换到大厅
    await B.click('#multiplayerBtn');
    // 等连接就绪（连接成功 → 大厅界面出现)
    await waitFor(async () => B.evaluate(() => {
        const lb = document.getElementById('lobbyOverlay');
        return lb && lb.style.display !== 'none' && document.getElementById('roomList')?.offsetParent;
    }), 15000, 'B 重连后 WebSocket + 大厅就绪');
    // 通过直连 joinRoom（不需要刷新列表再点）
    await B.evaluate(async (rid) => (await import('/js/network.js')).joinRoom(rid), roomId);
    await waitFor(async () => B.evaluate(() => {
        const gw = document.getElementById('gameWrapper');
        return gw && gw.style.display !== 'none';
    }), 50000, 'B 重连后恢复棋局（收到 stateSync）');
    await waitFor(async () => {
        const snap = await gameSnapshot(B);
        return snap.tiles > 0 && snap.turnCounter === ta;
    }, 50000, 'B 重连后完整恢复棋局（地图与回合同步）');
    const sb2 = await gameSnapshot(B);
    R.assert(sb2.tiles > 0 && sb2.turnCounter === ta, `stateSync 恢复（回合 ${sb2.turnCounter}，地图 ${sb2.tiles} 格）`);
    // 重连后 fx 模块验证：网络条目可能因浏览器缓存而不完整，用注册表钩子做真实验证
    const stats2 = await fxRegistryStats(B);
    if (expected.length > 0) {
        const totalHooks = Object.values(stats2.layers).reduce((a, b) => a + b, 0);
        R.softAssert(totalHooks > 0, `重连后 fx 注册表已挂钩（图层钩子 ${totalHooks} 个，updater ${stats2.updaters} 个）`);
    }
    const fetched2 = await fetchedFxModules(B);
    R.softAssert(expected.every(id => fetched2.includes(id)),
        `重连后 fx 模块已在网络日志中出现 [${fetched2.join(', ') || '无'}]，期望含 ${expected.join(', ')}（缓存可能跳过，以注册表为准）`);
    // 重连后同步存活：查当前轮到谁 → 该玩家结束回合，对家收到
    const bSnap = await gameSnapshot(B);
    // B 重连了自己的角色；看 B 端 gameState.currentCamp 与角色匹配来确定是谁的回合
    const bRole = await getMyRole(B);
    // B 端角色在等待对手操作，就是对家在轮。
    const [aCanMove, bCanMove] = await Promise.all([A, B].map(page => page.evaluate(async () => {
        const { gameState } = await import('/js/state.js');
        const network = await import('/js/network.js');
        return network.isMyTurn(gameState.currentCamp);
    })));
    const whoMoves = bCanMove ? B : A;
    const whoWatches = whoMoves === A ? B : A;
    const tk = bSnap.turnCounter;
    await clickEndTurn(whoMoves);
    await waitFor(async () => (await gameSnapshot(whoWatches)).turnCounter > tk, 20000, '重连后回合同步存活');
    R.ok('重连后回合同步存活');
    R.assertNoPageErrors(B, 'B 端重连');

    await ensureTurnFor(B, A);
    const buttonProbe = await probeReconnectActionButtons(B);
    R.assert(buttonProbe.ok && buttonProbe.selected, `重连后可重新选中己方单位（${buttonProbe.reason || 'ok'}）`);
    R.assert(buttonProbe.skillVisible && !buttonProbe.skillDisabled && buttonProbe.activeSkillCD > 0,
        `重连后主动技能按钮可点击（visible=${buttonProbe.skillVisible}, disabled=${buttonProbe.skillDisabled}, cd=${buttonProbe.activeSkillCD}）`);
    R.assert(buttonProbe.reinforceVisible && !buttonProbe.reinforceDisabled && buttonProbe.reinforced,
        `重连后补充兵员按钮可点击（visible=${buttonProbe.reinforceVisible}, disabled=${buttonProbe.reinforceDisabled}, reinforced=${buttonProbe.reinforced}）`);

    await A.context().close();
    await B.context().close();
    return R.summary();
}
