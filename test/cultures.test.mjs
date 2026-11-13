import assert from 'node:assert/strict';
import { test } from 'node:test';

const context = {};
globalThis.document = { getElementById() { return { getContext: () => context }; } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const [
    culturesModule,
    visibilityModule,
    unitsModule,
    navalModule,
    movementModule,
    airCommandsModule,
    constructionModule,
    citySiegeModule,
    diplomacyModule,
    stateModule,
    unitModule,
    tileModule,
    recruitmentUiModule,
    synergyModule,
    turnsModule,
    surfacesModule,
    constantsModule
] = await Promise.all([
    import('../rules/cultures.js'),
    import('../rules/visibility.js'),
    import('../rules/units.js'),
    import('../rules/naval.js'),
    import('../rules/movement.js'),
    import('../rules/airCommands.js'),
    import('../rules/construction.js'),
    import('../rules/citySiege.js'),
    import('../rules/diplomacy.js'),
    import('../engine/matchState.js'),
    import('../js/Unit.js'),
    import('../engine/HexTile.js'),
    import('../js/recruitmentUi.js'),
    import('../rules/factionSynergies.js'),
    import('../rules/turns.js'),
    import('../rules/surfaces.js'),
    import('../rules/constants.js')
]);

const {
    FACTION_RULE_MODES,
    NEVER_SURRENDER_CONFIG,
    FREE_RESISTANCE_EFFECT,
    FIRE_SEA_CONFIG,
    BANZAI_CHARGE_CONFIG,
    CULTURE_CONFIG,
    CULTURE_ORDER,
    normalizeFactionRuleMode,
    isCultureSystemEnabled,
    isFactionSynergyRuleActive,
    getActiveCultureId,
    getCulturalBadgeCropForUnit,
    getNeverSurrenderStacks,
    getNeverSurrenderStatBonus,
    getArtilleryCostDiscount,
    hasNegativeWeatherImmunity,
    getCulturalCityMaxHpBonusPct,
    getCulturalCityMaxHp,
    getCulturalReinforceCostScale,
    getCulturalPortRepairCostScale,
    getCulturalAirfieldCost,
    getCulturalWaterMovementBonus,
    getCulturalTerrainStepDelta,
    getCulturalXpMultiplier,
    getFireSeaState,
    getFireSeaDamagePct,
    applyFireSeaToTile,
    expireFireSeaForStartingCamp
} = culturesModule;

const {
    isSubmarineDetector,
    hasSubmarineDetectorInRange,
    isSubmarineTargetableBy,
    isGuerrillaExposedByVillage,
    hasHostileUnitNear,
    isStealthGuerrilla,
    isUnitVisibleToCamp
} = visibilityModule;

const {
    UNIT_CONFIG,
    getUnitBaseType,
    isUniqueCultureUnit,
    canUnitBeRecruitedAtSite,
    getSpecializationOptions,
    isValidSpecialization,
    chooseDefaultSpecialization
} = unitsModule;

const {
    NAVAL_RULES,
    isWaterborneUnit,
    getCrossDomainDamageBonus,
    canCapturePort
} = navalModule;

const {
    getUnitMovementDomain,
    getTransportBaseDefense,
    resolveMovementStep
} = movementModule;

const {
    AIR_COMMAND_CONFIG,
    getVisibleAirCommandKinds
} = airCommandsModule;

const { constructionCost } = constructionModule;
const { getCityMaxHp } = citySiegeModule;
const { setPlayerFactionFlagPreset, setPlayerFactionFlagEmoji } = diplomacyModule;
const { createMatchState, serializeMatchState, restoreMatchState } = stateModule;
const { Unit, setGameStateRef, setLogMessageRef } = unitModule;
const { EngineHexTile } = tileModule;
const { getUniqueRecruitmentOption, canRecruitTypeAtSelectedCity } = recruitmentUiModule;
const { getActiveFactionSynergies } = synergyModule;
const { getFactionCount } = turnsModule;
const { SURFACE_KIND } = surfacesModule;
const { COMBAT_BALANCE } = constantsModule;

let _nextId = 4000;

function addTile(state, q, r, camp = null, options = {}) {
    const tile = new EngineHexTile(q, r);
    tile.surface = options.surface || (options.isPort ? SURFACE_KIND.SHALLOW_WATER : SURFACE_KIND.LAND);
    if (options.terrain) tile.terrain = options.terrain;
    if (camp) tile.camp = camp;
    if (options.isCity) tile.isCity = true;
    if (options.isUrban) tile.isUrban = true;
    if (options.isPort) {
        tile.isPort = true;
        state.portTiles?.add?.(`${q},${r}`);
    }
    if (options.isVillage) tile.isVillage = true;
    if (options.fortification) tile.fortification = options.fortification;
    state.tiles.push(tile);
    state.tileMap.set(`${q},${r}`, tile);
    return tile;
}

function setupCultureState(p1Preset = 'img/flags/svg/us.svg', p2Preset = 'img/flags/svg/gb.svg', mode = FACTION_RULE_MODES.CULTURE) {
    const state = createMatchState();
    state.factionRuleMode = mode;
    state.tiles = [];
    state.tileMap = new Map();
    state.damageTexts = [];
    state.healTexts = [];
    state.goldTexts = [];
    state.shieldTexts = [];
    state.smokeTexts = [];
    if (p1Preset) setPlayerFactionFlagPreset(state, 'player1', p1Preset);
    if (p2Preset) setPlayerFactionFlagPreset(state, 'player2', p2Preset);
    state.currentCamp = state.factions.player1;
    setGameStateRef(state);
    setLogMessageRef(() => {});
    return state;
}

function spawnUnit(type, faction, tile) {
    return new Unit(type, faction, tile, false, _nextId++);
}

test('阵营规则模式互斥：none / culture / synergy 与战役模式强制隔离', () => {
    assert.equal(normalizeFactionRuleMode('unknown'), FACTION_RULE_MODES.NONE);
    assert.equal(normalizeFactionRuleMode('culture'), FACTION_RULE_MODES.CULTURE);
    assert.equal(normalizeFactionRuleMode('synergy'), FACTION_RULE_MODES.SYNERGY);

    const state = setupCultureState('img/flags/svg/us.svg', 'img/flags/svg/gb.svg', FACTION_RULE_MODES.NONE);
    assert.equal(isCultureSystemEnabled(state), false);
    assert.equal(isFactionSynergyRuleActive(state), false);
    assert.equal(getActiveCultureId(state, state.factions.player1), null);

    state.factionRuleMode = FACTION_RULE_MODES.CULTURE;
    assert.equal(isCultureSystemEnabled(state), true);
    assert.equal(isFactionSynergyRuleActive(state), false);
    assert.equal(getActiveCultureId(state, state.factions.player1), 'us');
    assert.equal(getActiveCultureId(state, state.factions.player2), 'gb');
    // 文化模式下锁定国家预设旗帜，禁止切回通用 emoji
    assert.equal(setPlayerFactionFlagEmoji(state, 'player1', '🐉'), false);

    const tile = addTile(state, 0, 0, state.factions.player1);
    const tile2 = addTile(state, 1, 0, state.factions.player1);
    const u1 = spawnUnit('infantry', state.factions.player1, tile);
    const u2 = spawnUnit('cavalry', state.factions.player1, tile2);
    u1.commander = 'aureliaCommander';
    u2.commander = 'eagleCommander';
    assert.deepEqual(getActiveFactionSynergies(state, state.factions.player1), []);

    state.factionRuleMode = FACTION_RULE_MODES.SYNERGY;
    assert.equal(isCultureSystemEnabled(state), false);
    assert.equal(isFactionSynergyRuleActive(state), true);
    assert.equal(getActiveCultureId(state, state.factions.player1), null);
    assert.ok(getActiveFactionSynergies(state, state.factions.player1).length > 0);
    assert.equal(setPlayerFactionFlagPreset(state, 'player1', 'img/flags/svg/fr.svg'), false);

    // 战役模式锁定为阵营协同开启、文化禁用
    state.campaignMode = true;
    state.factionRuleMode = FACTION_RULE_MODES.CULTURE;
    assert.equal(isCultureSystemEnabled(state), false);
    assert.equal(isFactionSynergyRuleActive(state), true);
    assert.equal(getActiveCultureId(state, state.factions.player1), null);

    // 关闭规则与战役后切回标准自定义 emoji 旗帜，重开文化模式时不再识别为预设国家
    state.campaignMode = false;
    state.factionRuleMode = FACTION_RULE_MODES.NONE;
    assert.equal(setPlayerFactionFlagEmoji(state, 'player1', '🐉'), true);
    state.factionRuleMode = FACTION_RULE_MODES.CULTURE;
    assert.equal(getActiveCultureId(state, state.factions.player1), null);
});

test('八国文化完整清单与 7 种特色兵种徽章裁剪配置', () => {
    assert.deepEqual(CULTURE_ORDER, ['us', 'gb', 'fr', 'ru', 'kmt', 'cpc', 'de', 'jp']);
    for (const id of CULTURE_ORDER) {
        const cfg = CULTURE_CONFIG[id];
        assert.ok(cfg, `missing culture ${id}`);
        assert.ok(cfg.flagPreset);
        if (cfg.uniqueUnitType) {
            assert.equal(isUniqueCultureUnit(cfg.uniqueUnitType), true);
            const crop = getCulturalBadgeCropForUnit({ type: cfg.uniqueUnitType, config: UNIT_CONFIG[cfg.uniqueUnitType] });
            assert.equal(crop?.cultureId, id);
            assert.equal(crop?.flagPreset, cfg.flagPreset);
            assert.ok(crop?.badgeCrop && typeof crop.badgeCrop.cx === 'number' && typeof crop.badgeCrop.cy === 'number');
        }
    }
    assert.equal(isUniqueCultureUnit('infantry'), false);
    assert.equal(getCulturalBadgeCropForUnit({ type: 'infantry', config: UNIT_CONFIG.infantry }), null);
});

test('美国文化：海军陆战队城港双招募、两栖不减益与跨海+30%及Tier2海上+1移动与港口5折修理', () => {
    const state = setupCultureState('img/flags/svg/us.svg', 'img/flags/svg/gb.svg');
    const p1 = state.factions.player1;
    const p2 = state.factions.player2;

    const cityTile = addTile(state, 0, 0, p1, { isCity: true });
    const waterTile = addTile(state, 1, 0, null, { surface: SURFACE_KIND.SHALLOW_WATER });
    const portTile = addTile(state, 0, 1, p1, { isPort: true });
    const enemyLandTile = addTile(state, 2, 0, p2);

    const uniqueOpt = getUniqueRecruitmentOption(state, p1);
    assert.equal(uniqueOpt?.type, 'us_marine');
    assert.equal(uniqueOpt?.portOnly, false);
    assert.equal(canUnitBeRecruitedAtSite('us_marine', 'city'), true);
    assert.equal(canUnitBeRecruitedAtSite('us_marine', 'port'), true);
    assert.equal(canRecruitTypeAtSelectedCity('us_marine', cityTile, state, p1), true);
    assert.equal(canRecruitTypeAtSelectedCity('us_marine', portTile, state, p1), true);

    assert.equal(getUnitMovementDomain('us_marine'), 'amphibious');
    assert.equal(getUnitBaseType('us_marine'), 'cavalry');

    // 从沿海陆地步入浅海不进入运输状态、不耗尽剩余移动力
    const stepIntoWater = resolveMovementStep('us_marine', cityTile, waterTile, state, { baseCost: 1 });
    assert.equal(stepIntoWater.allowed, true);
    assert.equal(stepIntoWater.embarking, false);
    assert.equal(stepIntoWater.drainRemaining, false);
    assert.equal(stepIntoWater.cost, 1);

    const marine = spawnUnit('us_marine', p1, waterTile);
    const enemy = spawnUnit('infantry', p2, enemyLandTile);
    assert.equal(isWaterborneUnit(marine), true);
    assert.equal(canCapturePort(marine), true);
    assert.equal(getTransportBaseDefense(marine), null);
    assert.equal(getCrossDomainDamageBonus(marine, enemy), NAVAL_RULES.marineWaterToLandDamage);
    assert.equal(NAVAL_RULES.marineWaterToLandDamage, 0.30);

    // Tier 2: 海上单位移动+1、港口修理费用减半
    assert.equal(getCulturalWaterMovementBonus(state, p1), 1);
    assert.equal(getCulturalWaterMovementBonus(state, p2), 0);
    assert.equal(marine.getEffectiveSpeed(), UNIT_CONFIG.us_marine.speed + 1);
    assert.equal(getCulturalPortRepairCostScale(state, p1), 0.5);
});

test('英国文化：皇家战列舰2格反潜与20%闪避，Tier2 永不投降每2回合+2.5%最高6层', () => {
    const state = setupCultureState('img/flags/svg/gb.svg', 'img/flags/svg/us.svg');
    const gb = state.factions.player1;
    const foe = state.factions.player2;

    const portTile = addTile(state, 0, 0, gb, { isPort: true });
    const cityTile = addTile(state, 0, 1, gb, { isCity: true });
    assert.equal(canRecruitTypeAtSelectedCity('gb_battleship', cityTile, state, gb), false);
    assert.equal(canRecruitTypeAtSelectedCity('gb_battleship', portTile, state, gb), true);

    const shipTile = addTile(state, 1, 0, null, { surface: SURFACE_KIND.SHALLOW_WATER });
    const subTile = addTile(state, 3, 0, null, { surface: SURFACE_KIND.DEEP_WATER });
    const farSubTile = addTile(state, 4, 0, null, { surface: SURFACE_KIND.DEEP_WATER });
    const battleship = spawnUnit('gb_battleship', gb, shipTile);
    const subNear = spawnUnit('submarine', foe, subTile);
    const subFar = spawnUnit('submarine', foe, farSubTile);

    assert.equal(isSubmarineDetector(battleship), true);
    assert.equal(hasSubmarineDetectorInRange(subNear, gb, state), true);
    assert.equal(isSubmarineTargetableBy(subNear, gb, state), true);
    assert.equal(hasSubmarineDetectorInRange(subFar, gb, state), false);
    assert.equal(UNIT_CONFIG.gb_battleship.dodgeChance, 0.20);

    const dodgeRes = battleship._triggerDodge(state, 0);
    assert.equal(dodgeRes.dodged, true);
    assert.equal(dodgeRes.dmg, 0);
    assert.equal(state.shieldTexts.some(t => t.text === '闪避'), true);

    // Tier 2: 永不投降每2回合+1层，最多6层（+15%）
    const stepPerRound = getFactionCount(state);
    state.turnCounter = 0;
    assert.equal(getNeverSurrenderStacks(state, gb), 0);
    state.turnCounter = stepPerRound * 2;
    assert.equal(getNeverSurrenderStacks(state, gb), 1);
    assert.ok(Math.abs(getNeverSurrenderStatBonus(state, gb) - 0.025) < 1e-9);
    state.turnCounter = stepPerRound * 14;
    assert.equal(getNeverSurrenderStacks(state, gb), NEVER_SURRENDER_CONFIG.maxStacks);
    assert.ok(Math.abs(getNeverSurrenderStatBonus(state, gb) - 0.15) < 1e-9);
});

test('法国文化：巨炮4格射程无视陆对海减伤与35%溅射，Tier2 自由抵抗受到暴击令邻格友军士气+1', () => {
    const state = setupCultureState('img/flags/svg/fr.svg', 'img/flags/svg/us.svg');
    const fr = state.factions.player1;
    const foe = state.factions.player2;

    const land1 = addTile(state, 0, 0, fr);
    const land2 = addTile(state, 1, 0, fr);
    const waterTile = addTile(state, 4, 0, null, { surface: SURFACE_KIND.DEEP_WATER });

    const cannon = spawnUnit('fr_heavy_cannon', fr, land1);
    const allyInf = spawnUnit('infantry', fr, land2);
    const enemyShip = spawnUnit('warship', foe, waterTile);

    assert.equal(UNIT_CONFIG.fr_heavy_cannon.range, 4);
    assert.equal(UNIT_CONFIG.fr_heavy_cannon.splashPct, 0.35);
    assert.equal(getCrossDomainDamageBonus(cannon, enemyShip), 0);

    const normalArcher = spawnUnit('archer', foe, addTile(state, 0, 1, foe));
    assert.equal(getCrossDomainDamageBonus(normalArcher, enemyShip), NAVAL_RULES.landVsShipDamage);

    // Tier 2: 法国单位受到暴击时，周围1格内友军士气+1并附加 freeResistance 到期回合
    allyInf.morale = 1;
    cannon.takeDamage(20, enemyShip, false, { isCrit: true });
    assert.equal(allyInf.morale, 2);
    assert.equal(allyInf._freeResistanceUntilRound, FREE_RESISTANCE_EFFECT.durationRounds);
});

test('苏联文化：喀秋莎保留溅射并禁用普通炮兵火箭炮专精，Tier2 炮兵-1费且全军免疫负面天气', () => {
    const state = setupCultureState('img/flags/soviet-union.svg', 'img/flags/svg/us.svg');
    const ru = state.factions.player1;
    const us = state.factions.player2;

    assert.equal(UNIT_CONFIG.ru_katyusha.splashPct, 0.35);
    const ruOpts = getSpecializationOptions('archer', state, ru).map(o => o.key);
    assert.equal(ruOpts.includes('rocketArtillery'), false);
    assert.equal(isValidSpecialization('archer', 'rocketArtillery', state, ru), false);

    const ruDef = chooseDefaultSpecialization({ type: 'archer', camp: ru }, state);
    assert.notEqual(ruDef, 'rocketArtillery');

    // 其他阵营与战役模式仍保留火箭炮专精
    const usOpts = getSpecializationOptions('archer', state, us).map(o => o.key);
    assert.equal(usOpts.includes('rocketArtillery'), true);
    assert.equal(isValidSpecialization('archer', 'rocketArtillery', state, us), true);

    // Tier 2: 炮兵造价-1、天气减益免疫（迷雾天气不缩短苏联炮兵射程）
    assert.equal(getArtilleryCostDiscount(state, ru, 'archer'), 1);
    assert.equal(getArtilleryCostDiscount(state, ru, 'ru_katyusha'), 1);
    assert.equal(getArtilleryCostDiscount(state, ru, 'infantry'), 0);
    assert.equal(hasNegativeWeatherImmunity(state, ru), true);
    assert.equal(hasNegativeWeatherImmunity(state, us), false);

    const t1 = addTile(state, 0, 0, ru);
    const t2 = addTile(state, 1, 0, us);
    const ruArcher = spawnUnit('archer', ru, t1);
    const usArcher = spawnUnit('archer', us, t2);
    state.mechanics.weatherEffects = true;
    state.weather = 'fog';
    assert.equal(ruArcher.getEffectiveRange(), UNIT_CONFIG.archer.range);
    assert.ok(usArcher.getEffectiveRange() < UNIT_CONFIG.archer.range);
});

test('国民党文化：中央教导旅据点+25%防御并免疫暴击，Tier2 城市上限+25%与城市补员折扣', () => {
    const state = setupCultureState('img/flags/kuomintang.svg', 'img/flags/svg/jp.svg');
    const kmt = state.factions.player1;
    const foe = state.factions.player2;

    const cityTile = addTile(state, 0, 0, kmt, { isCity: true });
    const villageTile = addTile(state, 1, 0, kmt, { isVillage: true });
    const atkTile = addTile(state, 0, 1, foe);

    const brigade = spawnUnit('kmt_training_brigade', kmt, cityTile);
    const attacker = spawnUnit('infantry', foe, atkTile);
    attacker.commander = 'centurion';

    // 据点内暴击免疫：反复测 calculateDamage 均不应出现 isCrit === true 且 floatMult <= critThreshold
    for (let i = 0; i < 20; i++) {
        const res = attacker.calculateDamage(brigade);
        assert.equal(res.isCrit, false);
        assert.ok(res.floatMult < COMBAT_BALANCE.float.attack.critThreshold);
    }

    // Tier 2: 城市生命上限 +25%、城市补员 2/3 费用
    assert.equal(getCulturalCityMaxHpBonusPct(state, kmt), 0.25);
    assert.equal(getCulturalCityMaxHp(200, state, kmt), 250);
    assert.equal(getCityMaxHp(0, state, kmt), Math.round(250 * 1.25));
    assert.equal(getCulturalReinforceCostScale(state, cityTile, kmt), 2 / 3);
    assert.equal(getCulturalReinforceCostScale(state, villageTile, kmt), 1);
});

test('中共文化：游击纵队隐身与村庄/邻格/皇帝AI显形规则，Tier2 森/山减耗与村庄补员5折', () => {
    const state = setupCultureState('img/flags/chinese-communist-party-old.svg', 'img/flags/kuomintang.svg');
    const cpc = state.factions.player1;
    const kmt = state.factions.player2;

    const plainTile = addTile(state, 0, 0, cpc);
    const enemyVillage = addTile(state, 2, 0, kmt, { isVillage: true });
    const adjTile = addTile(state, 0, 1, kmt);
    const farTile = addTile(state, 4, 0, kmt);

    const guerrilla = spawnUnit('cpc_guerrilla', cpc, plainTile);
    assert.equal(isStealthGuerrilla(guerrilla), true);
    assert.equal(isUnitVisibleToCamp(guerrilla, cpc, state), true);
    assert.equal(isUnitVisibleToCamp(guerrilla, kmt, state), false);

    // 敌军贴近至 1 格内显形
    spawnUnit('infantry', kmt, adjTile);
    assert.equal(hasHostileUnitNear(guerrilla, state, 1), true);
    assert.equal(isUnitVisibleToCamp(guerrilla, kmt, state), true);

    // 移走邻近敌军后重新隐形，改测试占领敌方/中立村庄显形
    adjTile.unit = null;
    assert.equal(isUnitVisibleToCamp(guerrilla, kmt, state), false);
    guerrilla.tile = enemyVillage;
    enemyVillage.unit = guerrilla;
    assert.equal(isGuerrillaExposedByVillage(guerrilla), true);
    assert.equal(isUnitVisibleToCamp(guerrilla, kmt, state), true);

    // 皇帝AI可穿透隐身
    enemyVillage.unit = null;
    guerrilla.tile = plainTile;
    plainTile.unit = guerrilla;
    kmt.isAI = true;
    kmt.aiDifficulty = 'imperator';
    assert.equal(isUnitVisibleToCamp(guerrilla, kmt, state), true);
    assert.equal(isUnitVisibleToCamp(guerrilla, kmt, state, { ignoreAiBypass: true }), false);

    // Tier 2: 森林 -1、山地 -2，村庄补员 5 折
    assert.equal(getCulturalTerrainStepDelta(state, cpc, 'forest'), -1);
    assert.equal(getCulturalTerrainStepDelta(state, cpc, 'mountain'), -2);
    assert.equal(getCulturalTerrainStepDelta(state, cpc, 'plains'), 0);
    assert.equal(getCulturalReinforceCostScale(state, enemyVillage, cpc), 0.5);
    assert.equal(getCulturalReinforceCostScale(state, farTile, cpc), 1);
});

test('德国文化：斯图卡专属指令与50%防空穿透，Tier2 7金机场与火海叠层/过期/快照序列化', () => {
    const state = setupCultureState('img/flags/germany-iron-cross.svg', 'img/flags/svg/us.svg');
    const de = state.factions.player1;
    const us = state.factions.player2;

    const deCity = addTile(state, 0, 0, de, { isCity: true });
    deCity.airfield = true;
    const usCity = addTile(state, 3, 0, us, { isCity: true });
    usCity.airfield = true;

    assert.equal(getVisibleAirCommandKinds(deCity, state).includes('stukaDiveBomb'), true);
    assert.equal(getVisibleAirCommandKinds(usCity, state).includes('stukaDiveBomb'), false);
    assert.equal(AIR_COMMAND_CONFIG.stukaDiveBomb.antiAirBypassPct, 0.50);
    assert.equal(AIR_COMMAND_CONFIG.stukaDiveBomb.cultureId, 'de');

    // Tier 2: 机场 7 金（建设规则联动）
    assert.equal(getCulturalAirfieldCost(10, state, de), 7);
    assert.equal(constructionCost('airfield', null, deCity, state), 7);
    assert.equal(constructionCost('airfield', null, usCity, state), 10);

    // 火海叠层封顶 2 层、持续 2 回合、仅在施放方回合初递减/过期
    const targetTile = addTile(state, 2, 0, us);
    applyFireSeaToTile(targetTile, de, state);
    assert.deepEqual(getFireSeaState(targetTile), { layers: 1, roundsRemaining: 2, casterCampKey: 'player1' });
    assert.ok(Math.abs(getFireSeaDamagePct(targetTile) - FIRE_SEA_CONFIG.hpLossPctPerLayer) < 1e-9);

    applyFireSeaToTile(targetTile, de, state);
    applyFireSeaToTile(targetTile, de, state);
    assert.equal(getFireSeaState(targetTile).layers, FIRE_SEA_CONFIG.maxLayers);
    assert.ok(Math.abs(getFireSeaDamagePct(targetTile) - 0.20) < 1e-9);

    // 快照序列化/反序列化完整保留 factionRuleMode 和 tile.fireSea
    const snapshot = serializeMatchState(state);
    const restored = createMatchState();
    restoreMatchState(restored, snapshot, {
        HexTileClass: EngineHexTile,
        UnitClass: Unit,
        computeCampBorders: () => [],
        computeDistrictBorders: () => []
    });
    assert.equal(restored.factionRuleMode, FACTION_RULE_MODES.CULTURE);
    const restoredTarget = restored.tileMap.get('2,0');
    assert.deepEqual(getFireSeaState(restoredTarget), { layers: 2, roundsRemaining: 2, casterCampKey: 'player1' });

    // 其他阵营回合开始不会消耗德国火海回合数
    expireFireSeaForStartingCamp(restored, restored.factions.player2);
    assert.equal(getFireSeaState(restoredTarget).roundsRemaining, 2);

    // 德国连续2次开始回合后火海熄灭并进入 expired 返回列表
    expireFireSeaForStartingCamp(restored, restored.factions.player1);
    assert.equal(getFireSeaState(restoredTarget).roundsRemaining, 1);
    const expired = expireFireSeaForStartingCamp(restored, restored.factions.player1);
    assert.equal(expired.length, 1);
    assert.equal(getFireSeaState(restoredTarget), null);
});

test('日本文化：帝国武士常驻禁疗但允许补员与强制回血，万岁冲锋参数及Tier2 经验+20%', () => {
    const state = setupCultureState('img/flags/svg/jp.svg', 'img/flags/svg/gb.svg');
    const jp = state.factions.player1;
    const t = addTile(state, 0, 0, jp, { isCity: true });

    const samurai = spawnUnit('jp_samurai', jp, t);
    samurai.hp = 100;
    assert.equal(samurai.config.permanentAntiHeal, true);
    assert.equal(samurai.heal(50), 0);
    assert.equal(samurai.hp, 100);
    assert.equal(samurai.heal(40, { allowReinforce: true }), 40);
    assert.equal(samurai.hp, 140);
    assert.equal(samurai.heal(30, { bypassAntiHeal: true }), 30);
    assert.equal(samurai.hp, 170);

    assert.equal(BANZAI_CHARGE_CONFIG.range, 2);
    assert.equal(BANZAI_CHARGE_CONFIG.cooldown, 1);
    assert.equal(BANZAI_CHARGE_CONFIG.selfDamageCurrentHpPct, 0.75);
    assert.equal(BANZAI_CHARGE_CONFIG.damageMultiplier, 1.85);
    assert.equal(BANZAI_CHARGE_CONFIG.killHealMaxHpPct, 0.6);

    // Tier 2: 经验获取速度 +20%
    assert.equal(getCulturalXpMultiplier(state, jp), 1.20);
    samurai.addXP(10, { silent: true });
    assert.equal(samurai._xp, 12);
});
