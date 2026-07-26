// 机场空军指令与航母攻击无驻军城市（HP>0）的集成回归：
// 经 headless 引擎驱动真实 gameLogic 结算路径，验证城市血池削减与目标合法性。
import test from 'node:test';
import assert from 'node:assert/strict';

const { wireHeadlessEngine } = await import('../core/headless.js');
wireHeadlessEngine();

const { gameState } = await import('../js/state.js');
const { HexTile } = await import('../js/HexTile.js');
const { Unit } = await import('../js/Unit.js');
const { SURFACE_KIND } = await import('../rules/surfaces.js');
const { AIRFIELD_BASE_POWER } = await import('../rules/airCommands.js');
const gl = await import('../js/gameLogic.js');

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
    gameState.rng = { range: (min, max) => (min + max) / 2, chance: () => false, pick: arr => arr[0] };
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

test('机场扫射指令可指定无驻军但HP>0的敌城并延迟削减城市HP', async () => {
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
    assert.equal(city.hp, 300, '动画抵达前城市HP不变');

    await sleep(1400); // AIR_COMMAND_IMPACT_DELAY_MS.strafe = 1200
    // 无驻军、无上校、无防空：AIRFIELD_BASE_POWER × 1.0 浮动
    assert.equal(city.hp, 300 - AIRFIELD_BASE_POWER, '爆炸时刻削减城市HP');
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
