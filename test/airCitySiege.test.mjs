// 经 headless 引擎验证机场和航母的攻城选点、伤害与占领结算。
import test from 'node:test';
import assert from 'node:assert/strict';

const { wireHeadlessEngine } = await import('../core/headless.js');
wireHeadlessEngine();

const { applyRemoteState, gameState, serializeState } = await import('../js/state.js');
const { HexTile } = await import('../js/HexTile.js');
const { Unit } = await import('../js/Unit.js');
const { SURFACE_KIND } = await import('../rules/surfaces.js');
const { AIR_COMMAND_CONFIG, AIRFIELD_BASE_POWER } = await import('../rules/airCommands.js');
const { AIRSTRIKE_FLIGHT, AIRSTRIKE_TARGET_PROGRESS, isUnitWaitingForAirdrop, shouldRenderAirstrikeEngineFire } = await import('../rules/attackPresentation.js');
const { airstrikeEffects } = await import('../js/effects.js');
const { buildBattlefieldSnapshot } = await import('../js/rendering/battlefieldSnapshot.js');
const { resolveTargetingPreview } = await import('../rules/targeting.js');
const gl = await import('../js/gameLogic.js');
const { startMatchRecording, getCurrentMatchLog, buildMatchReview } = await import('../js/matchRecorder.js');

const P1 = { id: 'player1', name: '甲', color: '#e04848' };
const P2 = { id: 'player2', name: '乙', color: '#487be0' };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function setupMatch(tiles) {
    gameState.tiles = tiles;
    gameState.tileMap = new Map(tiles.map(t => [`${t.q},${t.r}`, t]));
    gameState.factions = { player1: P1, player2: P2 };
    gameState.turnOrder = ['player1', 'player2'];
    gameState.currentCamp = P1;
    gameState.turnCounter = 0;
    gameState.diplomacy = {
        player1: { player2: 'enemy' },
        player2: { player1: 'enemy' }
    };
    gameState.playerGold = { player1: 100, player2: 100 };
    gameState.previousGold = { player1: 100, player2: 100 };
    gameState.surrenderedCamps = [];
    gameState.mechanics = {};
    gameState.weather = 'clear';
    gameState.rng = { range: (min, max) => (min + max) / 2, chance: () => false, pick: arr => arr[0], getState: () => 1, setState() {} };
    gameState.damageTexts = [];
    gameState.goldTexts = [];
    gameState.killCount = {};
    gameState.factionMoraleBoost = {};
    gameState.gameOver = false;
    gameState.skirmishFog = false;
    gameState.selectedUnit = null;
    gameState.movableTiles = [];
    gameState.attackableTiles = [];
}

function waterTile(q, r) {
    const tile = new HexTile(q, r);
    tile.surface = SURFACE_KIND.SHALLOW_WATER;
    tile.terrain = 'water';
    tile.camp = null;
    return tile;
}

function enemyCityTile(q, r, hp = 300) {
    const tile = new HexTile(q, r);
    tile.isCity = true;
    tile.isUrban = true;
    tile.camp = P2;
    tile.hp = hp;
    tile.maxHp = 300;
    return tile;
}

test('航母可指定无驻军但HP>0的敌城并削减城市HP', async () => {
    const sea = waterTile(0, 0);
    const city = enemyCityTile(3, 0);
    const breached = enemyCityTile(0, 3, 0);
    setupMatch([sea, city, breached]);
    const carrier = new Unit('carrier', P1, sea);
    sea.unit = carrier;

    const targets = gl.getAttackableTiles(carrier);
    assert.ok(targets.includes(city), '空敌城应出现在航母可攻击列表');
    assert.ok(!targets.includes(breached), 'HP=0的破城不应成为攻击目标');

    const ok = gl.attackCityTile(carrier, city);
    assert.equal(ok, true);
    assert.equal(carrier.canAct, false);
    // 无防空覆盖、无将领/叠层/军衔加成：45 × 1.0 浮动 = 45
    assert.equal(city.hp, 300 - 45, '城市血池应按航母空军管线削减');
    assert.equal(breached.hp, 0, '无关城市不受影响');
    await sleep(900); // 等延迟伤害数字的 setTimeout 落定
});

test('航母不能超出射程指定空城', () => {
    const sea = waterTile(0, 0);
    const farCity = enemyCityTile(6, 0); // 航母射程上限5（射程封顶）
    setupMatch([sea, farCity]);
    const carrier = new Unit('carrier', P1, sea);
    sea.unit = carrier;

    assert.ok(!gl.getAttackableTiles(carrier).includes(farCity));
    assert.equal(gl.attackCityTile(carrier, farCity), false, '超射程攻城应被拒绝');
    assert.equal(farCity.hp, 300);
});

test('空军上校把航母射程由5提高到7', () => {
    const sea = waterTile(0, 0);
    const enhancedTarget = enemyCityTile(7, 0);
    const outsideTarget = enemyCityTile(8, 0);
    setupMatch([sea, enhancedTarget, outsideTarget]);
    const carrier = new Unit('carrier', P1, sea, false, null, 'colonel');
    sea.unit = carrier;
    const targets = gl.getAttackableTiles(carrier);
    assert.ok(targets.includes(enhancedTarget));
    assert.ok(!targets.includes(outsideTarget));
});

test('机场扫射同步提交空城结构伤害，伤害浮字延迟至弹着', () => {
    const airfield = new HexTile(0, 0);
    airfield.isCity = true;
    airfield.isUrban = true;
    airfield.camp = P1;
    airfield.hp = 300;
    airfield.maxHp = 300;
    airfield.installation = { type: 'airfield', status: 'ready' };
    const city = enemyCityTile(4, 0);
    setupMatch([airfield, city]);

    const ok = gl.executeAirCommand('strafe', airfield, city);
    assert.equal(ok, true);
    assert.equal(gameState.playerGold.player1, 100 - 4, '扫射应扣除4金币');
    // 无驻军、无上校、无防空：AIRFIELD_BASE_POWER × 1.0 浮动
    assert.equal(city.hp, 300 - AIRFIELD_BASE_POWER);
    assert.equal(serializeState().tiles.find(tile => tile.q === city.q && tile.r === city.r).hp, city.hp);
    assert.ok(gameState.floatTextPending.some(text => text.x === city.x && text.y === city.y
        && text.value === AIRFIELD_BASE_POWER && text.showAt > performance.now()));
    assert.ok(airfield.installation.airCommandReadyRound.strafe > 0, '扫射应进入冷却');
});

test('机场扫射指令拒绝以空地/己方城市为目标', () => {
    const airfield = new HexTile(0, 0);
    airfield.isCity = true;
    airfield.camp = P1;
    airfield.hp = 300;
    airfield.maxHp = 300;
    airfield.installation = { type: 'airfield', status: 'ready' };
    const emptyPlain = new HexTile(2, 0);
    const ownCity = new HexTile(0, 2);
    ownCity.isCity = true;
    ownCity.camp = P1;
    ownCity.hp = 300;
    ownCity.maxHp = 300;
    setupMatch([airfield, emptyPlain, ownCity]);

    assert.equal(gl.executeAirCommand('strafe', airfield, emptyPlain), false, '空地不是合法扫射目标');
    assert.equal(gl.executeAirCommand('strafe', airfield, ownCity), false, '己方城市不是合法扫射目标');
    assert.equal(gameState.playerGold.player1, 100, '被拒绝的指令不应扣费');
});

test('机场击杀保留阵营归因和动作 ID，随后进城保留轴坐标路线', () => {
    const airfield = new HexTile(0, 0);
    Object.assign(airfield, {
        isCity: true, isUrban: true, camp: P1, hp: 300, maxHp: 300,
        installation: { type: 'airfield', status: 'ready' }
    });
    const approach = new HexTile(1, 0);
    const city = enemyCityTile(2, 0, 0);
    setupMatch([airfield, approach, city]);
    const occupier = new Unit('infantry', P1, approach);
    const garrison = new Unit('infantry', P2, city);
    garrison.hp = 1;
    startMatchRecording(gameState);

    assert.equal(gl.executeAirCommand('strafe', airfield, city), true);
    gl.moveUnit(occupier, city);

    const log = getCurrentMatchLog();
    const sortie = log.timeline.find(entry => entry.actionType === 'airCommand');
    const movement = log.timeline.find(entry => entry.actionType === 'move');
    const damage = log.timeline.find(entry => entry.eventType === 'unitHpChanged' && entry.payload.delta < 0);
    const death = log.timeline.find(entry => entry.eventType === 'unitKilled');
    const capture = log.timeline.find(entry => entry.eventType === 'cityCaptured');
    assert.equal(damage.causedByActionId, sortie.actionId);
    assert.equal(damage.payload.sourceCampKey, 'player1');
    assert.equal(damage.payload.sourceUnitId, null);
    assert.equal(death.causedByActionId, sortie.actionId);
    assert.equal(death.payload.killerCampKey, 'player1');
    assert.equal(capture.causedByActionId, movement.actionId);
    assert.deepEqual(movement.payload.path, [{ q: 1, r: 0 }, { q: 2, r: 0 }]);
    const stats = buildMatchReview(log);
    assert.equal(stats.overview.camps.find(camp => camp.campKey === 'player1').damageDealt, 1);
});

test('斯图卡立即结算原目标，动画期间换位不会重复扣血或打到入格友军', async () => {
    const airfield = enemyCityTile(0, 0);
    airfield.camp = P1;
    airfield.installation = { type: 'airfield', status: 'ready' };
    const target = new HexTile(2, 0);
    const exit = new HexTile(3, 0);
    const reserve = new HexTile(1, 0);
    setupMatch([airfield, target, exit, reserve]);
    const previousMode = gameState.factionRuleMode;
    P1.flagPreset = 'img/flags/germany-iron-cross.svg';
    gameState.factionRuleMode = 'culture';
    try {
        const enemy = new Unit('infantry', P2, target);
        const ally = new Unit('infantry', P1, reserve);
        assert.equal(gl.executeAirCommand('stukaDiveBomb', airfield, target), true);
        assert.equal(enemy.hp, enemy.maxHp - 23);
        assert.equal(enemy.fireSea.roundsRemaining, 2);
        assert.equal(gameState.playerGold.player1, 98);
        enemy.tile = exit;
        exit.unit = enemy;
        reserve.unit = null;
        ally.tile = target;
        target.unit = ally;
        await sleep(1250);
        assert.equal(enemy.hp, enemy.maxHp - 23);
        assert.equal(enemy.fireSea.roundsRemaining, 2);
        assert.equal(ally.fireSea, undefined);
        assert.equal(ally.hp, ally.maxHp);
    } finally {
        delete P1.flagPreset;
        gameState.factionRuleMode = previousMode;
    }
});

test('机场可向无驻军的破城空降，城市和行政区在同步快照中易主', () => {
    const airfield = enemyCityTile(0, 0);
    airfield.camp = P1;
    airfield.installation = { type: 'airfield', status: 'ready' };
    const breached = enemyCityTile(8, 0, 0);
    breached.districtId = 1;
    breached.installation = { type: 'airfield', status: 'ready', campKey: P2.id };
    const districtTile = new HexTile(7, 0);
    districtTile.camp = P2;
    districtTile.districtId = breached.districtId;
    const intact = enemyCityTile(4, 0);
    intact.districtId = 2;
    const occupied = enemyCityTile(4, 1, 0);
    const outOfRange = enemyCityTile(9, 0, 0);
    const water = waterTile(3, 0);
    setupMatch([airfield, breached, districtTile, intact, occupied, outOfRange, water]);
    new Unit('infantry', P2, occupied);

    const preview = resolveTargetingPreview(gameState, {
        cardId: 'air_command_airdrop', targeting: 'emptyTile', launcherQ: 0, launcherR: 0
    });
    assert.ok(preview.candidateTileKeys.has('8,0'));
    for (const target of [intact, occupied, outOfRange, water]) {
        assert.equal(preview.candidateTileKeys.has(`${target.q},${target.r}`), false);
        assert.equal(gl.executeAirCommand('airdrop', airfield, target), false);
    }
    assert.equal(gameState.playerGold.player1, 100);

    assert.equal(gl.executeAirCommand('airdrop', airfield, breached), true);
    const snapshot = serializeState();
    const city = snapshot.tiles.find(tile => tile.q === breached.q && tile.r === breached.r);
    assert.equal(city.campKey, P1.id);
    assert.equal(city.installation.campKey, P1.id);
    assert.equal(city.unit.type, 'infantry');
    assert.equal(city.unit.canAct, false);
    assert.equal(city.unit.xp, 5);
    assert.equal(districtTile.camp, P1);
    assert.equal(intact.camp, P2);
    assert.equal(snapshot.playerGold.player1, 100 - AIR_COMMAND_CONFIG.airdrop.cost);
    assert.equal(airfield.installation.airCommandReadyRound.airdrop, AIR_COMMAND_CONFIG.airdrop.cooldown + 1);

    const flight = airstrikeEffects.at(-1);
    const landAt = breached.unit._airdropLandAt;
    assert.equal(flight.type, 'airdrop');
    assert.equal(isUnitWaitingForAirdrop(breached.unit, flight.startTime + AIRSTRIKE_TARGET_PROGRESS * flight.duration), true);
    assert.equal(landAt, flight.startTime + (AIRSTRIKE_TARGET_PROGRESS + AIRSTRIKE_FLIGHT.dropDuration) * flight.duration);
    assert.equal(isUnitWaitingForAirdrop(breached.unit, landAt), false);
    assert.equal(city.unit.airdropWaiting, false, '动画等待只存在于客户端');
    assert.equal(buildBattlefieldSnapshot(gameState, { viewerCampKey: P1.id }).units
        .find(unit => unit.id === breached.unit.id)?.renderable, false, '降落前 Pixi 不显示新单位');
    applyRemoteState(snapshot, HexTile, Unit);
    assert.equal(gameState.tileMap.get('8,0').unit._airdropLandAt, landAt, '后续快照同步不提前结束空降动画');
});


test('空降落点受防空火力拦截时立即按比例扣血且封顶85%，空袭>50%触发过半起火标记', () => {
    const airfield = enemyCityTile(0, 0);
    airfield.camp = P1;
    airfield.installation = { type: 'airfield', status: 'ready', campKey: P1.id };

    const dropSingleAA = new HexTile(2, 0);
    const aaUnit1 = new Unit('archer', P2, new HexTile(3, 0), false);
    aaUnit1.specializationKey = 'antiAirArtillery'; // 35%
    aaUnit1._rank = 1;

    const dropCapPlain = new HexTile(4, 0);
    dropCapPlain.fortification = 'flak'; // 30%
    dropCapPlain.fieldFortification = { type: 'flak', campKey: P2.id, ownerKnown: true };
    const aaUnit2 = new Unit('archer', P2, new HexTile(5, 0), false);
    aaUnit2.specializationKey = 'antiAirArtillery';
    aaUnit2._rank = 3; // 50%
    const aaUnit3 = new Unit('destroyer', P2, waterTile(4, 1), false);
    aaUnit3.specializationKey = 'antiAirDestroyer';
    aaUnit3._rank = 3; // +50% -> raw 130%, capped 85%

    const cardDropTile = new HexTile(4, -1);
    cardDropTile.camp = P2;

    const exact50Tile = enemyCityTile(0, 3, 200);
    const exact50Defender = new Unit('infantry', P2, exact50Tile, false);
    const aaExact50 = new Unit('archer', P2, new HexTile(1, 3), false);
    aaExact50.specializationKey = 'antiAirArtillery';
    aaExact50._rank = 3; // 50%

    setupMatch([
        airfield,
        dropSingleAA, aaUnit1.tile,
        dropCapPlain, aaUnit2.tile, aaUnit3.tile,
        cardDropTile,
        exact50Tile, aaExact50.tile
    ]);
    gameState.mechanics = { fortifications: true, airCommands: true };

    assert.equal(gl.executeAirCommand('airdrop', airfield, dropSingleAA), true);
    assert.equal(dropSingleAA.unit.hp, Math.round(180 * 0.65), '35% 防空拦截后空降步兵落地为 117 HP');
    assert.equal(dropSingleAA.unit.displayHp, dropSingleAA.unit.hp);

    airfield.installation.airCommandReadyRound.airdrop = 0;
    assert.equal(gl.executeAirCommand('airdrop', airfield, dropCapPlain), true);
    assert.equal(dropCapPlain.unit.hp, Math.round(180 * 0.15), '超 85% 防空总和应封顶在 85% 扣血 (180 -> 27)');

    const cardInf = new Unit('infantry', P1, cardDropTile, false);
    cardInf.maxHp = 100;
    cardInf.hp = 100;
    cardInf.displayHp = 100;
    gl.applyAADropHP(cardInf, cardDropTile, P1, gameState.tileMap, gameState);
    assert.equal(cardInf.hp, 15, '战术卡/空运落点在已占位且防空 100% 时也按 85% 封顶扣血');

    // 空袭 50% 不触发起火，>50% 在飞到一半起火
    assert.equal(gl.executeAirCommand('strafe', airfield, exact50Tile), true);
    const exact50Fx = airstrikeEffects.at(-1);
    assert.equal(exact50Fx.antiAir, 0.5);
    assert.equal(shouldRenderAirstrikeEngineFire(exact50Fx, 0.75), false, '恰好等于50%防空不应触发着火');
    assert.equal(exact50Defender.hp > 0, true);

    airfield.installation.airCommandReadyRound.bombing = 0;
    assert.equal(gl.executeAirCommand('bombing', airfield, aaUnit2.tile), true);
    const heavyAAFx = airstrikeEffects.at(-1);
    assert.ok(heavyAAFx.antiAir > 0.5);
    assert.equal(shouldRenderAirstrikeEngineFire(heavyAAFx, 0.45), false, '飞到一半前不起火');
    assert.equal(shouldRenderAirstrikeEngineFire(heavyAAFx, 0.5), true, '飞到一半起开始起火拖黑烟');
});
