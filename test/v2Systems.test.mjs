import test from 'node:test';
import assert from 'node:assert/strict';

import {
    UNIT_CONFIG,
    getSpecializationAbilityValue,
    isRankLockedUnit,
    isStaticBattleStructure,
    resolveUnitRankProfile
} from '../rules/units.js';
import {
    CONSTRUCTION_CONFIG,
    DEFENSE_CONSTRUCTION_SUPPORT_RANGE,
    canBuildBunkerAt,
    canBuildFieldFortification,
    canBuildFieldFortificationAt,
    canBuildShoreBatteryAt,
    canBuildAirfieldAt,
    constructionCost,
    getAirfieldCap
} from '../rules/construction.js';
import { createDefaultLevel, validateLevel } from '../campaign/runtime/schema.js';
import { resolveTargetingPreview } from '../rules/targeting.js';
import { hexDistance } from '../rules/hex.js';
import { getFactionCount } from '../rules/turns.js';

test('0阶标准型、待专精与选定专精使用同一确定性军衔映射', () => {
    const base = resolveUnitRankProfile('infantry', 0, null);
    assert.equal(base.hp, UNIT_CONFIG.infantry.hp);
    assert.equal(base.pendingSpecialization, false);

    const pending = resolveUnitRankProfile('infantry', 2, null);
    assert.equal(pending.pendingSpecialization, true);
    assert.equal(pending.hp, UNIT_CONFIG.infantry.hp, '待选择期间不提前获得2阶奖励');

    const selected = resolveUnitRankProfile('infantry', 2, 'garrisonInfantry');
    assert.equal(selected.pendingSpecialization, false);
    assert.equal(selected.hp, 225);
    assert.equal(selected.attack, 48);
    assert.equal(getSpecializationAbilityValue({ type: 'infantry', specializationKey: 'garrisonInfantry', _rank: 3 }, 'cityRegen'), 0.20);
    assert.equal(resolveUnitRankProfile('archer', 2, 'antiAirArtillery').attack, 53,
        '防空炮保留普通攻击，防空火力是附加能力');
    const invalidRocket = resolveUnitRankProfile('archer', 2, 'rocketArtillery');
    assert.equal(invalidRocket.specializationKey, null);
    assert.equal(invalidRocket.pendingSpecialization, true);
});

test('建筑锁定军衔，航母把2阶攻击奖励映射为航空火力', () => {
    assert.equal(isRankLockedUnit('mgNest'), true);
    assert.equal(isRankLockedUnit('shoreBattery'), true);
    assert.equal(isRankLockedUnit('drone'), true);
    // 固定火力点（无目标时自动跳过行动）：碉堡/岸防炮算，可移动的无人机不算
    assert.equal(isStaticBattleStructure('mgNest'), true);
    assert.equal(isStaticBattleStructure('shoreBattery'), true);
    assert.equal(isStaticBattleStructure('drone'), false);
    assert.equal(isStaticBattleStructure('infantry'), false);
    const carrier = resolveUnitRankProfile('carrier', 2, null);
    assert.equal(carrier.carrierAirPowerBonus, 8);
    assert.equal(carrier.unbranchedReward.damageBonus, 0.15);
});

test('通用建设与工程师折扣、机场逐城建设资格使用规则层单一配置', () => {
    const engineer = { commander: 'engineer' };
    assert.equal(constructionCost('trench'), CONSTRUCTION_CONFIG.trench.cost);
    assert.equal(constructionCost('trench', engineer), CONSTRUCTION_CONFIG.trench.engineerCost);
    assert.equal(constructionCost('bunker', engineer), 7);
    assert.equal(constructionCost('airfield', null, { unit: engineer }), 7);
    assert.equal(constructionCost('shoreBattery'), 10);

    const camp = { id: 'player1' };
    const state = { tiles: Array.from({ length: 4 }, () => ({ isCity: true, camp })) };
    assert.equal(getAirfieldCap(state, camp), Number.POSITIVE_INFINITY);
    state.airfieldCapOverrides = { player1: 3 };
    assert.equal(getAirfieldCap(state, camp), Number.POSITIVE_INFINITY);
    const availableCity = state.tiles[3];
    availableCity.hp = 300;
    state.mechanics = { airCommands: true };
    for (const city of state.tiles.slice(0, 3)) city.installation = { type: 'airfield', status: 'ready' };
    assert.equal(canBuildAirfieldAt(availableCity, camp, state), true,
        '已有任意数量机场时，无机场的己方城市仍可付费建设');
});

test('岸防炮只可选中己方控制的临海空地，附近部队无法替代地块控制权', () => {
    const camp = { id: 'player1' };
    const coast = { q: 0, r: 0, s: 0, surface: 'land', camp, unit: null };
    const water = { q: 1, r: 0, s: -1, surface: 'shallowWater', camp: null, unit: null };
    const inland = { q: -1, r: 0, s: 1, surface: 'land', camp, unit: null };
    const support = { q: -1, r: 1, s: 0, surface: 'land', camp, unit: { hp: 100, camp } };
    const tiles = [coast, water, inland, support];
    const state = {
        currentCamp: camp,
        mechanics: { fortifications: true },
        tiles,
        tileMap: new Map(tiles.map(tile => [`${tile.q},${tile.r}`, tile])),
        turnCounter: 0,
        turnOrder: ['player1', 'player2']
    };
    const targeting = { cardId: 'build_shore_battery', targeting: 'emptyTile' };
    assert.equal(canBuildShoreBatteryAt(coast, camp, state), true);
    assert.deepEqual(resolveTargetingPreview(state, targeting).candidateTiles, [coast]);
    for (const otherCamp of [{ id: 'neutral' }, { id: 'player2' }]) {
        coast.camp = otherCamp;
        assert.equal(canBuildBunkerAt(camp, coast, state), true, '部队支援范围仍可用于碉堡');
        assert.equal(canBuildShoreBatteryAt(coast, camp, state), false);
        assert.deepEqual(resolveTargetingPreview(state, targeting).candidateTiles, []);
    }
    coast.camp = camp;
    state.shoreBatteryBuiltRound = { player1: 0 };
    assert.equal(canBuildShoreBatteryAt(coast, camp, state), false, '阵营共享冷却继续生效');
});

test('无主航路的预置岸防炮不挡沿海建造，玩家新建炮位仍需保持间距', async () => {
    const { engine } = await import('../core/headless.js');
    const { executeShoreBatteryConstruction } = await import('../js/gameLogic.js');
    for (const playerCount of [2, 3]) {
        engine.resetGameState();
        engine.configureSkirmishState({ playerCount });
        const state = engine.gameState;
        assert.deepEqual(state.shoreBatteryBuiltRound, {});
        state.standardMapId = 'uncharted-passage';
        engine.initMap();
        const targeting = { cardId: 'build_shore_battery', targeting: 'emptyTile' };
        for (const campKey of state.turnOrder.filter(key => key !== 'neutral')) {
            const camp = state.factions[campKey];
            state.currentCamp = camp;
            const { candidateTiles } = resolveTargetingPreview(state, targeting);
            assert.ok(candidateTiles.length > 0, `${playerCount}P ${campKey} 应有沿海炮位`);
        }
        state.currentCamp = state.factions.player1;
        state.playerGold.player1 = 30;
        const { candidateTiles } = resolveTargetingPreview(state, targeting);
        const site = candidateTiles.find(tile => candidateTiles.some(other => other !== tile && hexDistance(tile, other) < 7));
        assert.ok(site);
        const nearby = candidateTiles.find(tile => tile !== site && hexDistance(site, tile) < 7);
        assert.equal(executeShoreBatteryConstruction(site), true);
        assert.equal(site.unit.type, 'shoreBattery');
        assert.equal(state.playerGold.player1, 20);
        assert.equal(canBuildShoreBatteryAt(nearby, state.currentCamp, state), false);
        state.turnCounter += getFactionCount(state) * 2;
        assert.equal(canBuildShoreBatteryAt(nearby, state.currentCamp, state), false);
        assert.equal(executeShoreBatteryConstruction(nearby), false);
        assert.equal(state.playerGold.player1, 20);
    }
});

test('地面部队可在中立或敌控陆地就地修建战壕与高射机枪', () => {
    const camp = { id: 'player1' };
    const occupiedTile = {
        q: 0, r: 0, surface: 'land', playable: true,
        camp: { id: 'neutral' }, fortification: null, fieldFortification: null
    };
    const unit = {
        hp: 100, camp: { id: 'player1' }, tile: occupiedTile,
        config: { movementDomain: 'land' }, canAct: true, isNewRecruit: false,
        isEmbarked: false, _isDrone: false
    };
    const state = {
        currentCamp: camp,
        mechanics: { fortifications: true }
    };
    assert.equal(canBuildFieldFortification(unit, 'trench', state), true);
    assert.equal(canBuildFieldFortification(unit, 'flak', state), true);
});

test('常驻建设规则：地形工事覆盖己方行政区，并允许己军脚下的非己方行政区', () => {
    const camp = { id: 'player1' };
    const enemy = { id: 'player2' };
    const owned = { q: 0, r: 0, surface: 'land', playable: true, camp, unit: null, fortification: null, fieldFortification: null };
    const occupiedEnemy = { q: 1, r: 0, surface: 'land', playable: true, camp: enemy, fortification: null, fieldFortification: null };
    occupiedEnemy.unit = { hp: 100, camp };
    const unsupportedEnemy = { q: 2, r: 0, surface: 'land', playable: true, camp: enemy, unit: null, fortification: null, fieldFortification: null };
    const state = { currentCamp: camp, mechanics: { fortifications: true }, tiles: [owned, occupiedEnemy, unsupportedEnemy] };

    assert.equal(canBuildFieldFortificationAt(owned, 'trench', camp, state), true);
    assert.equal(canBuildFieldFortificationAt(occupiedEnemy, 'flak', camp, state), true);
    assert.equal(canBuildFieldFortificationAt(unsupportedEnemy, 'trench', camp, state), false);
    owned.fortification = 'trench';
    assert.equal(canBuildFieldFortificationAt(owned, 'flak', camp, state), false, '同一格不得叠加地形工事');
});

test('常驻建设规则：防御建筑覆盖己方行政区，非己方行政区以任意己军6格支援', () => {
    const camp = { id: 'player1' };
    const enemy = { id: 'player2' };
    const support = { q: 0, r: 0, s: 0, surface: 'land', playable: true, camp: enemy };
    support.unit = { hp: 100, camp };
    const ownedFar = { q: 12, r: 0, s: -12, surface: 'land', playable: true, camp, unit: null };
    const enemyAtSix = { q: DEFENSE_CONSTRUCTION_SUPPORT_RANGE, r: 0, s: -DEFENSE_CONSTRUCTION_SUPPORT_RANGE, surface: 'land', playable: true, camp: enemy, unit: null };
    const enemyAtSeven = { q: DEFENSE_CONSTRUCTION_SUPPORT_RANGE + 1, r: 0, s: -(DEFENSE_CONSTRUCTION_SUPPORT_RANGE + 1), surface: 'land', playable: true, camp: enemy, unit: null };
    const tiles = [support, ownedFar, enemyAtSix, enemyAtSeven];
    const state = {
        currentCamp: camp,
        mechanics: { fortifications: true },
        tiles,
        tileMap: new Map(tiles.map(tile => [`${tile.q},${tile.r}`, tile]))
    };

    assert.equal(canBuildBunkerAt(camp, ownedFar, state), true, '己方行政区不受部队距离限制');
    assert.equal(canBuildBunkerAt(camp, enemyAtSix, state), true);
    assert.equal(canBuildBunkerAt(camp, enemyAtSeven, state), false);
    assert.equal(resolveTargetingPreview(state, { cardId: 'build_laser_tower', targeting: 'emptyTile' }).candidateTiles.length, 0);
    enemyAtSix.unit = { hp: 100, camp };
    assert.equal(canBuildBunkerAt(camp, enemyAtSix, state), false, '防御建筑只能建在空地');
    enemyAtSix.unit = null;
    enemyAtSix.fortification = 'trench';
    assert.equal(canBuildBunkerAt(camp, enemyAtSix, state), false, '防御建筑不得覆盖已有地形工事');
});

test('战役 schema 接受机场、军衔专精和精确专精数量条件', () => {
    const level = createDefaultLevel();
    level.factions[0].airfieldCap = 1;
    level.board.installations.push({
        q: 0, r: 0, type: 'airfield', status: 'ready',
        airCommandReadyRound: { bombing: 2 }
    });
    level.units.push({
        id: 'guard', type: 'infantry', camp: 'player1', q: 0, r: 0,
        rank: 1, specializationKey: 'garrisonInfantry', hpPct: 100, morale: 2, canAct: true
    });
    level.triggers.push({
        id: 'guard_ready', enabled: true, once: true,
        when: [{ kind: 'factionUnitCount', camp: 'player1', type: 'infantry', specializationKey: 'garrisonInfantry', op: '>=', value: 1 }],
        do: [{ kind: 'showStep', mode: 'narrator', text: '守军就位。' }]
    });
    const valid = validateLevel(level);
    assert.deepEqual(valid.errors, []);

    level.triggers[0].when[0].specializationKey = 'heavyCavalry';
    assert.match(validateLevel(level).errors.join('\n'), /专精筛选/);
});


test('战壕覆盖炮击减伤，且补员与修船费用统一下调25%并四舍五入', async () => {
    const { FORTIFICATION_CONFIG } = await import('../rules/terrain.js');
    const { computeHealGoldCost } = await import('../rules/healing.js');
    const { wireHeadlessEngine } = await import('../core/headless.js');
    wireHeadlessEngine();
    const { gameState } = await import('../js/state.js');
    const { HexTile } = await import('../js/HexTile.js');
    const { Unit } = await import('../js/Unit.js');

    assert.equal(FORTIFICATION_CONFIG.trench.appliesTo, 'meleeAndBombardment');
    assert.equal(computeHealGoldCost(8, 90, 180), 3, '半血步兵原4金降25%并四舍五入为3金');
    assert.equal(computeHealGoldCost(15, 87, 175), 6, '约半血巡洋舰15*0.5*0.75=5.625四舍五入为6金');
    assert.equal(computeHealGoldCost(8, 1, 180), 1, '最低不少于1金');

    const P1 = { id: 'player1', name: '红军' };
    const P2 = { id: 'player2', name: '蓝军' };
    const flakTile = new HexTile(0, 0);
    flakTile.fortification = 'flak';
    const trenchTile = new HexTile(1, 0);
    trenchTile.fortification = 'trench';
    const shooterTile = new HexTile(3, 0);
    gameState.tiles = [flakTile, trenchTile, shooterTile];
    gameState.tileMap = new Map([['0,0', flakTile], ['1,0', trenchTile], ['3,0', shooterTile]]);
    gameState.factions = { player1: P1, player2: P2 };
    gameState.turnOrder = ['player1', 'player2'];
    gameState.currentCamp = P1;
    gameState.mechanics = { fortifications: true };
    gameState.diplomacy = { player1: { player2: 'enemy' }, player2: { player1: 'enemy' } };
    gameState.rng = { next: () => 0.5, range: (a, b) => (a + b) / 2, chance: () => false, between: a => a };

    const archer = new Unit('archer', P1, shooterTile, false);
    const flakDefender = new Unit('infantry', P2, flakTile, false);
    const trenchDefender = new Unit('infantry', P2, trenchTile, false);
    const flakHit = archer.calculateDamage(flakDefender, 0, { showDamageText: false });
    const trenchHit = archer.calculateDamage(trenchDefender, 0, { showDamageText: false });
    assert.ok(trenchHit.dmg < flakHit.dmg * 0.80, '同为工事要塞格时，战壕应有效削减炮兵炮击伤害 (+25% 防御)');
});

test('要塞炮与攻城火力规则、文案及真实 Unit 伤害结算口径一致', async () => {
    const { FRONTEND_TEXT, getConstructionChoiceContent } = await import('../rules/uiText.js');
    const { CULTURE_CONFIG } = await import('../rules/cultures.js');
    const { CANNON_SIEGE_ATTACKER_TYPES, getCannonSiegeDamageBonus } = await import('../rules/citySiege.js');
    const { wireHeadlessEngine } = await import('../core/headless.js');
    wireHeadlessEngine();
    const { gameState } = await import('../js/state.js');
    const { HexTile } = await import('../js/HexTile.js');
    const { Unit } = await import('../js/Unit.js');

    assert.equal(UNIT_CONFIG.shoreBattery.name, '要塞炮');
    assert.equal(CONSTRUCTION_CONFIG.shoreBattery.name, '要塞炮');
    assert.equal(FRONTEND_TEXT.unitPassives.shoreBattery.name, '要塞炮');
    assert.match(FRONTEND_TEXT.unitPassives.shoreBattery.desc, /15%/);
    assert.match(FRONTEND_TEXT.unitPassives.shoreBattery.desc, /35%/);
    assert.equal(FRONTEND_TEXT.unitPassives.cannonSiege.name, '攻城火力');
    assert.match(FRONTEND_TEXT.unitPassives.cannonSiege.desc, /40%/);
    assert.match(CULTURE_CONFIG.ru.tier1.summary, /30%/);
    assert.match(CULTURE_CONFIG.us.tier1.summary, /40%/);
    assert.match(CULTURE_CONFIG.us.tier1.summary, /要塞炮/);
    assert.match(getConstructionChoiceContent('trench').effect, /25%/);
    assert.match(getConstructionChoiceContent('flak').effect, /30%防空/);
    assert.match(getConstructionChoiceContent('bunker').effect, /200生命.*40攻击.*5%防御.*30%/);
    assert.match(getConstructionChoiceContent('bunker', { engineer: true }).placement, /立即完成/);
    assert.match(getConstructionChoiceContent('shoreBattery').effect, /150生命.*50攻击.*15%.*35%.*40%/);
    for (const type of ['archer', 'fr_heavy_cannon', 'ru_katyusha', 'warship', 'gb_battleship', 'shoreBattery']) {
        assert.equal(CANNON_SIEGE_ATTACKER_TYPES.has(type), true);
        assert.equal(getCannonSiegeDamageBonus({ type }), 0.40);
    }

    const P1 = { id: 'player1', name: '红军' };
    const P2 = { id: 'player2', name: '蓝军' };
    const cityHp1 = new HexTile(0, 0);
    cityHp1.isCity = true;
    cityHp1.maxHp = 250;
    cityHp1.hp = 1;
    const cityHp0 = new HexTile(1, 0);
    cityHp0.isCity = true;
    cityHp0.maxHp = 250;
    cityHp0.hp = 0;
    const trenchTile = new HexTile(2, 0);
    trenchTile.fortification = 'trench';
    const shooterTile = new HexTile(3, 0);
    const seaTile = new HexTile(4, 0, 'deepWater');
    const batteryTile = new HexTile(5, 0);
    gameState.tiles = [cityHp1, cityHp0, trenchTile, shooterTile, seaTile, batteryTile];
    gameState.tileMap = new Map(gameState.tiles.map(t => [`${t.q},${t.r}`, t]));
    gameState.factions = { player1: P1, player2: P2 };
    gameState.turnOrder = ['player1', 'player2'];
    gameState.currentCamp = P1;
    gameState.mechanics = { fortifications: true };
    gameState.diplomacy = { player1: { player2: 'enemy' }, player2: { player1: 'enemy' } };
    gameState.rng = { next: () => 0.5, range: (a, b) => (a + b) / 2, chance: () => false, between: a => a };

    const archer = new Unit('archer', P1, shooterTile, false);
    archer._calcFloat = () => 1;
    const activeCityGarrison = new Unit('cavalry', P2, cityHp1, false);
    const brokenCityGarrison = new Unit('cavalry', P2, cityHp0, false);
    const trenchGarrison = new Unit('cavalry', P2, trenchTile, false);
    const hitActiveCity = archer.calculateDamage(activeCityGarrison, 0, { showDamageText: false }).dmg;
    const hitBrokenCity = archer.calculateDamage(brokenCityGarrison, 0, { showDamageText: false }).dmg;
    const hitTrench = archer.calculateDamage(trenchGarrison, 0, { showDamageText: false }).dmg;
    assert.ok(hitActiveCity > hitBrokenCity * 1.35, '非0HP城市内驻军受攻城火力+40%增伤');
    assert.ok(hitBrokenCity > hitTrench, '0HP城市驻军不再触发攻城火力，战壕反而还有防御');

    const battery = new Unit('shoreBattery', P1, batteryTile, false);
    battery._calcFloat = () => 1;
    const enemyMarineSea = new Unit('us_marine', P2, seaTile, false);
    const enemyArcher = new Unit('archer', P2, shooterTile, false);
    const archerHit = battery.calculateDamage(enemyArcher, 0, { showDamageText: false }).dmg;
    const marineHit = battery.calculateDamage(enemyMarineSea, 0, { showDamageText: false }).dmg;
    assert.ok(Math.abs(archerHit - 57.5) < 1e-6, `要塞炮打火炮+15% (expected ~57.5, got ${archerHit})`);
    assert.ok(Math.abs(marineHit - 30.875) < 1e-6, `水上陆战队豁免+15%，吃-35%并计5%甲 (expected ~30.875, got ${marineHit})`);
});
