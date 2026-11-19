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
const { iconEffects, airstrikeEffects } = await import('../js/effects.js');
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
    assert.equal(city.hp, 300 - 50, '城市血池应按航母空军管线削减');
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

test('机场扫射可瞄准空地但仍拒绝己方城市', () => {
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

    assert.equal(gl.executeAirCommand('strafe', airfield, ownCity), false, '己方城市不是合法扫射目标');
    assert.equal(gameState.playerGold.player1, 100, '被拒绝的指令不应扣费');
    assert.equal(gl.executeAirCommand('strafe', airfield, emptyPlain), true, '空地可作为合法扫射目标');
    assert.equal(gameState.playerGold.player1, 100 - AIR_COMMAND_CONFIG.strafe.cost);
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
    assert.equal(damage.payload.sourceUnitId, 'airfield:0,0:player1'); assert.equal(death.payload.killerId, 'airfield:0,0:player1');
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
        assert.equal(enemy.hp, enemy.maxHp - 21);
        assert.equal(enemy.fireSea.roundsRemaining, 2);
        assert.equal(gameState.playerGold.player1, 98);
        enemy.tile = exit;
        exit.unit = enemy;
        reserve.unit = null;
        ally.tile = target;
        target.unit = ally;
        await sleep(1250);
        assert.equal(enemy.hp, enemy.maxHp - 21);
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


test('空军上校驻守机场发动的空军指令归入上校名下，非上校驻军仍归虚拟机场', () => {
    const airfield = enemyCityTile(0, 0);
    airfield.camp = P1;
    airfield.installation = { type: 'airfield', status: 'ready', campKey: P1.id };
    const targetCity1 = enemyCityTile(2, 0, 200);
    const targetCity2 = enemyCityTile(0, 2, 200);
    setupMatch([airfield, targetCity1, targetCity2]);

    const colonel = new Unit('infantry', P1, airfield, false, null, 'colonel');
    const victim1 = new Unit('infantry', P2, targetCity1, false);
    victim1.hp = 1;
    startMatchRecording(gameState);

    assert.equal(gl.executeAirCommand('strafe', airfield, targetCity1), true);
    const log1 = getCurrentMatchLog();
    const colonelAction = log1.timeline.find(entry => entry.kind === 'action' && entry.actionType === 'airCommand');
    const colonelDmg = log1.timeline.find(entry => entry.eventType === 'unitHpChanged' && entry.payload.delta < 0);
    const colonelKill = log1.timeline.find(entry => entry.eventType === 'unitKilled');
    assert.equal(colonelAction.payload.sourceUnitId, colonel.id);
    assert.equal(colonelDmg.payload.sourceUnitId, colonel.id);
    assert.equal(colonelKill.payload.killerId, colonel.id);

    // 换防普通步兵后再次发动空军指令，归因应回落到单城虚拟空军实体
    airfield.unit = null;
    new Unit('infantry', P1, airfield, false);
    airfield.installation.airCommandReadyRound.strafe = 0;
    const victim2 = new Unit('infantry', P2, targetCity2, false);
    victim2.hp = 1;

    assert.equal(gl.executeAirCommand('strafe', airfield, targetCity2), true);
    const log2 = getCurrentMatchLog();
    const afAction = log2.timeline.filter(entry => entry.kind === 'action' && entry.actionType === 'airCommand').at(-1);
    const afDmg = log2.timeline.filter(entry => entry.eventType === 'unitHpChanged' && entry.payload.delta < 0).at(-1);
    const afKill = log2.timeline.filter(entry => entry.eventType === 'unitKilled').at(-1);
    assert.equal(afAction.payload.sourceUnitId, 'airfield:0,0:player1');
    assert.equal(afDmg.payload.sourceUnitId, 'airfield:0,0:player1');
    assert.equal(afKill.payload.killerId, 'airfield:0,0:player1');
});

test('航母与制海巡洋舰额外齐射接入 _resolveDamage 标准管线', () => {
    const sea1 = waterTile(0, 0);
    const sea2 = waterTile(1, 0);
    const land = new HexTile(2, 0);
    land.terrain = 'plains';
    setupMatch([sea1, sea2, land]);

    const carrier = new Unit('carrier', P1, sea1, false);
    const heldInfantry = new Unit('infantry', P2, land, false);
    heldInfantry._rank = 1; heldInfantry.specializationKey = 'garrisonInfantry'; // holdFirstHitReduction 0.15
    heldInfantry.movedThisTurn = false;
    heldInfantry._timesAttackedThisTurn = 0;

    const prevRng = gameState.rng; gameState.rng = { next: () => 0.5, range: (lo, hi) => (lo + hi) / 2, chance: () => true, between: (a) => a }; const firstHit = carrier.calculateDamage(heldInfantry, 0);
    assert.ok(Number.isFinite(firstHit.dmg) && firstHit.dmg > 0);
    assert.ok(Number.isFinite(firstHit.floatMult));
    heldInfantry._timesAttackedThisTurn = 1;
    const secondHit = carrier.calculateDamage(heldInfantry, 0);
    assert.ok(secondHit.dmg > firstHit.dmg, '航母经标准管线应受到守城步兵首击减伤并在后续攻击恢复满伤');

    const cruiser = new Unit('warship', P1, sea1, false);
    cruiser._rank = 1; cruiser.specializationKey = 'fleetCruiser';
    const enemyShip = new Unit('destroyer', P2, sea2, false);
    const salvo = cruiser.calculateDamage(enemyShip, 0, { baseMulti: 0.5, showDamageText: false });
    const full = cruiser.calculateDamage(enemyShip, 0, { baseMulti: 1, showDamageText: false });
    assert.ok(salvo.dmg > 0 && salvo.dmg < full.dmg, '制海巡洋舰半倍齐射应完整通过四乘区 _resolveDamage 管线'); gameState.rng = prevRng;
});

test('扫射、斯图卡、轰炸可对空地/空城施放并引爆非己方地雷与水雷，轰炸一次清扫7格雷区', () => {
    const airfield = enemyCityTile(0, 0);
    airfield.camp = P1;
    airfield.installation = { type: 'airfield', status: 'ready' };

    const enemyLandMine = new HexTile(2, 0);
    enemyLandMine._minePlanted = true;
    enemyLandMine._mineCampKey = 'player2';
    enemyLandMine._mineType = 'land';

    const breachedCityWaterMine = enemyCityTile(3, 0, 0);
    breachedCityWaterMine.surface = SURFACE_KIND.WATER;
    breachedCityWaterMine._minePlanted = true;
    breachedCityWaterMine._mineCampKey = 'player2';
    breachedCityWaterMine._mineType = 'water';

    const bombCenter = new HexTile(5, 0);
    bombCenter._minePlanted = true;
    bombCenter._mineCampKey = 'player2';
    bombCenter._mineType = 'land';

    const bombNeighborEnemySea = waterTile(6, 0);
    bombNeighborEnemySea._minePlanted = true;
    bombNeighborEnemySea._mineCampKey = 'player2';
    bombNeighborEnemySea._mineType = 'water';

    const bombNeighborFriendlyMine = new HexTile(5, -1);
    bombNeighborFriendlyMine._minePlanted = true;
    bombNeighborFriendlyMine._mineCampKey = 'player1';
    bombNeighborFriendlyMine._mineType = 'land';

    setupMatch([airfield, enemyLandMine, breachedCityWaterMine, bombCenter, bombNeighborEnemySea, bombNeighborFriendlyMine]);
    const previousMode = gameState.factionRuleMode;
    P1.flagPreset = 'img/flags/germany-iron-cross.svg';
    gameState.factionRuleMode = 'culture';
    try {
        startMatchRecording(gameState);
        assert.equal(gl.executeAirCommand('strafe', airfield, enemyLandMine), true, '扫射空地应成功');
        assert.equal(enemyLandMine._minePlanted, false, '扫射应引爆非己方地雷');
        assert.equal(enemyLandMine._mineCampKey, null);

        assert.equal(gl.executeAirCommand('stukaDiveBomb', airfield, breachedCityWaterMine), true, '斯图卡应可瞄准空破城施放');
        assert.equal(breachedCityWaterMine._minePlanted, false, '斯图卡应引爆非己方水雷');

        assert.equal(gl.executeAirCommand('bombing', airfield, bombCenter), true, '轰炸空地应成功');
        assert.equal(bombCenter._minePlanted, false, '轰炸应引爆中心非己方地雷');
        assert.equal(bombNeighborEnemySea._minePlanted, false, '轰炸应一并引爆相邻6格内的非己方水雷');
        assert.equal(bombNeighborFriendlyMine._minePlanted, true, '轰炸不得误爆己方地雷');

        const log = getCurrentMatchLog();
        const airActions = log.timeline.filter(e => e.kind === 'action' && e.actionType === 'airCommand');
        assert.equal(airActions[0].payload.detonatedMines.length, 1);
        assert.equal(airActions[1].payload.detonatedMines[0].mineType, 'water');
        assert.equal(airActions[2].payload.detonatedMines.length, 2);
    } finally {
        delete P1.flagPreset;
        gameState.factionRuleMode = previousMode;
    }
});

test('地雷/水雷部署时非己方视角看不到部署位置动画与坐标日志', async () => {
    const city1 = enemyCityTile(0, 0);
    city1.camp = P1;
    const landTile = new HexTile(1, 0);
    landTile.camp = P2;
    const ownTile = new HexTile(-1, 0);
    ownTile.camp = P1;
    setupMatch([city1, landTile, ownTile]);
    gameState.gameMode = 'pve';
    gameState.aiOpponentCamp = P2;
    P1.controller = 'human';
    P2.controller = 'ai';
    gameState.omniscientView = false;
    gameState.logHistory = [];
    iconEffects.length = 0;

    // P2 AI 在己方地格布雷：人类视角（P1）不得看到布雷特效或坐标日志
    gameState.currentCamp = P2;
    gameState.playerHands.player2 = [{ id: 'landmine' }];
    gameState.playerUsesThisTurn = { player1: 0, player2: 0 };
    gameState.cardDiscardPile = [];
    gameState.cardTargeting = { cardId: 'landmine', targeting: 'emptyFriendlyLandmine', handIndex: 0 };
    gl.executeTacticalCard('landmine', landTile);
    assert.equal(landTile._minePlanted, true);
    await sleep(1700);
    assert.equal(iconEffects.some(fx => fx.x === landTile.x && fx.y === landTile.y && (fx.label === '地雷' || fx.label === '水雷')), false,
        'AI 布雷时人类视角不得出现地块定位动画');
    assert.equal(gameState.logHistory.some(entry => entry.includes(`(${landTile.q},${landTile.r})`)), false,
        'AI 布雷时日志不得泄漏坐标');

    // P1 人类己方布雷：自己视角正常显示布雷动画与坐标日志
    gameState.currentCamp = P1;
    gameState.playerHands.player1 = [{ id: 'landmine' }];
    gameState.cardTargeting = { cardId: 'landmine', targeting: 'emptyFriendlyLandmine', handIndex: 0 };
    gl.executeTacticalCard('landmine', ownTile);
    assert.equal(ownTile._minePlanted, true);
    await sleep(1700);
    assert.equal(iconEffects.some(fx => fx.x === ownTile.x && fx.y === ownTile.y && fx.label === '地雷'), true,
        '己方布雷时己方视角应正常显示部署动画');
    assert.equal(gameState.logHistory.some(entry => entry.includes(`(${ownTile.q},${ownTile.r})`)), true,
        '己方布雷日志应包含坐标');
});

test('轰炸具防空火力的中立城市或中立防空部队时，无论是否邻格溅射或当场摧毁/击杀都保留防空子弹流来源', () => {
    const NEU = { id: 'neutral', name: '中立', color: '#888888' };
    const airfield = enemyCityTile(0, 0);
    airfield.camp = P1;
    airfield.installation = { type: 'airfield', status: 'ready' };

    const neutralFlakCity = new HexTile(3, 0);
    neutralFlakCity.isCity = true;
    neutralFlakCity.camp = NEU;
    neutralFlakCity.hp = 300;
    neutralFlakCity.maxHp = 300;
    neutralFlakCity.fortification = 'flak';
    neutralFlakCity.fieldFortification = { type: 'flak', campKey: 'neutral', ownerKnown: true };

    const unmannedNeutralFlak = new HexTile(1, 1);
    unmannedNeutralFlak.camp = NEU;
    unmannedNeutralFlak.fortification = 'flak';
    unmannedNeutralFlak.fieldFortification = { type: 'flak', campKey: 'neutral', ownerKnown: true };

    const adjacentPlain = new HexTile(2, 0);
    adjacentPlain.camp = NEU;

    const neutralAaTile = new HexTile(5, 0);
    neutralAaTile.camp = NEU;

    setupMatch([airfield, neutralFlakCity, unmannedNeutralFlak, adjacentPlain, neutralAaTile]);
    gameState.factions.neutral = NEU;
    gameState.diplomacy.player1.neutral = 'neutral';
    gameState.diplomacy.player2.neutral = 'neutral';
    gameState.diplomacy.neutral = { player1: 'neutral', player2: 'neutral' };

    new Unit('infantry', NEU, neutralFlakCity);

    const neutralAaUnit = new Unit('archer', NEU, neutralAaTile);
    neutralAaUnit._rank = 1;
    neutralAaUnit.specializationKey = 'antiAirArtillery';
    neutralAaUnit.hp = 1; // 轰炸当场击杀，验证击杀前仍保留防空子弹流来源

    // 0) 无人驻守的中立高射机枪不产生防空源
    airstrikeEffects.length = 0;
    assert.equal(gl.executeAirCommand('bombing', airfield, unmannedNeutralFlak), true);
    assert.equal(airstrikeEffects.at(-1)?.aaSources?.some(s => s.q === 1 && s.r === 1), false,
        '无单位驻守的中立高射机枪不视为有效防空设施');

    // 1) 轰炸邻格（中立高射机枪城市位于7格溅射范围内）：仍捕获该中立城市为防空源
    airfield.installation.airCommandReadyRound.bombing = 0;
    airstrikeEffects.length = 0;
    assert.equal(gl.executeAirCommand('bombing', airfield, adjacentPlain), true);
    assert.ok(airstrikeEffects.at(-1)?.aaSources?.some(s => s.q === 3 && s.r === 0),
        '轰炸邻格溅射中立防空城市时应包含该中立城市的防空源');

    // 2) 直接轰炸中立防空城市且触发 30% 工事摧毁：摧毁前已捕获防空源
    airfield.installation.airCommandReadyRound.bombing = 0;
    gameState.rng = { range: (min, max) => (min + max) / 2, chance: () => true, pick: arr => arr[0], getState: () => 1, setState() {} };
    airstrikeEffects.length = 0;
    assert.equal(gl.executeAirCommand('bombing', airfield, neutralFlakCity), true);
    assert.equal(neutralFlakCity.fortification, null, '测试前提：本次轰炸摧毁了中立高射机枪');
    assert.ok(airstrikeEffects.at(-1)?.aaSources?.some(s => s.q === 3 && s.r === 0),
        '即使高射机枪在本次轰炸中被摧毁，动画仍应播放防空子弹流');

    // 3) 轰炸中立防空部队并当场击杀：击杀前已捕获防空源
    airfield.installation.airCommandReadyRound.bombing = 0;
    airstrikeEffects.length = 0;
    assert.equal(gl.executeAirCommand('bombing', airfield, neutralAaTile), true);
    assert.equal(neutralAaTile.unit, null, '测试前提：中立防空部队已被当场击杀');
    assert.ok(airstrikeEffects.at(-1)?.aaSources?.some(s => s.q === 5 && s.r === 0),
        '即使中立防空部队被当场击杀，动画仍应播放防空子弹流');
});
