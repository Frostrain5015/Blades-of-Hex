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
    constantsModule,
    effectItemsModule,
    unitStatusIconsModule
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
    import('../rules/constants.js'),
    import('../js/effectItems.js'),
    import('../js/unitStatusIcons.js')
]);

const { buildUnitEffectItems } = effectItemsModule;
const { getUnitStatusIcons } = unitStatusIconsModule;

test('单人选将时留出全部国旗，确认后为 AI 分配其余阵营', () => {
    const state = stateModule.createMatchState();
    state.factionRuleMode = 'culture';
    stateModule.configureStandardMatch(state, { controllers: { player1: 'human', player2: 'ai' } });
    const { ensureCultureFactionPresets, setPlayerFactionFlagPreset, FLAG_PRESETS } = diplomacyModule;
    ensureCultureFactionPresets(state, { includeAi: false });
    assert.ok(Object.hasOwn(FLAG_PRESETS, state.factions.player1.flagPreset));
    assert.equal(state.factions.player2.flagPreset, null);

    const selected = 'img/flags/svg/gb.svg';
    assert.ok(setPlayerFactionFlagPreset(state, 'player1', selected));
    ensureCultureFactionPresets(state, { randomizeAi: true });
    assert.equal(state.factions.player1.flagPreset, selected);
    assert.ok(Object.hasOwn(FLAG_PRESETS, state.factions.player2.flagPreset));
    assert.notEqual(state.factions.player2.colorId, state.factions.player1.colorId);
});

test('AI 按抽中的索引选旗，真人锁定后每面剩余旗都可抽中，多席不放回', () => {
    const { ensureCultureFactionPresets, setPlayerFactionFlagPreset, FLAG_PRESETS } = diplomacyModule;
    const flags = Object.keys(FLAG_PRESETS);
    for (const humanFlag of flags) {
        const available = flags.filter(flag => flag !== humanFlag);
        for (const [index, expected] of available.entries()) {
            const state = stateModule.createMatchState();
            state.factionRuleMode = 'culture';
            stateModule.configureStandardMatch(state, {
                playerCount: 3,
                controllers: { player1: 'ai', player2: 'human', player3: 'ai' }
            });
            setPlayerFactionFlagPreset(state, 'player2', humanFlag);
            // 模拟旧预设，确认时重新抽两席。
            setPlayerFactionFlagPreset(state, 'player1', expected);
            const drawSizes = [];
            ensureCultureFactionPresets(state, {
                randomizeAi: true,
                drawIndex: count => {
                    drawSizes.push(count);
                    return drawSizes.length === 1 ? index : count - 1;
                }
            });
            assert.deepEqual(drawSizes, [7, 6]);
            assert.equal(state.factions.player1.flagPreset, expected);
            assert.equal(state.factions.player2.flagPreset, humanFlag);
            assert.equal(state.factions.player3.flagPreset, available.filter(flag => flag !== expected).at(-1));
        }
    }
});

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
    getNeverSurrenderAttackBonus,
    getArtilleryCostDiscount,
    hasNegativeWeatherImmunity,
    getCulturalCityMaxHpBonusPct,
    getCulturalCityMaxHp,
    getCulturalReinforceCostScale,
    getHistoricalCost,
    getCulturalAirfieldCost,
    getCulturalWaterMovementBonus,
    getCulturalTerrainStepDelta,
    getCulturalXpMultiplier,
    getFireSeaState,
    getFireSeaDefenseReduction,
    applyFireSeaToUnit
} = culturesModule;

const {
    isSubmarineDetector,
    hasSubmarineDetectorInRange,
    isSubmarineTargetableBy,
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
    getRoyalEscortBonus,
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
const { getKmtLinkedUnits, getKmtLinkDamageBonus, getKmtLinkDefenseBonus, getKmtSharedHealth } = await import('../rules/kmtStronghold.js');

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

test('美国文化：海军陆战队两栖交战、城港双招募、海上行动与维修折扣', () => {
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
    assert.equal(getCrossDomainDamageBonus(marine, enemy), 0);

    // Tier 2: 海上单位移动+1、港口修理费用减1
    assert.equal(getCulturalWaterMovementBonus(state, p1), 1);
    assert.equal(getCulturalWaterMovementBonus(state, p2), 0);
    assert.equal(marine.getEffectiveSpeed(), UNIT_CONFIG.us_marine.speed + 1);
    assert.equal(getHistoricalCost(4, state, p1), 3);
    assert.equal(getHistoricalCost(1, state, p1), 1);

    const warship = spawnUnit('warship', p2, portTile);
    const shoreMarine = spawnUnit('us_marine', p1, cityTile);
    const cavalry = spawnUnit('cavalry', p1, addTile(state, -1, 1, p1));
    assert.equal(getCrossDomainDamageBonus(shoreMarine, warship), 0);
    assert.equal(getCrossDomainDamageBonus(marine, warship), 0);
    assert.equal(getCrossDomainDamageBonus(cavalry, warship), -0.40);

    shoreMarine._calcFloat = marine._calcFloat = cavalry._calcFloat = () => 1;
    const marineDamage = shoreMarine.calculateDamage(warship).dmg / shoreMarine.getEffectiveAttack();
    const cavalryDamage = cavalry.calculateDamage(warship).dmg / cavalry.getEffectiveAttack();
    assert.ok(marineDamage > cavalryDamage * 1.9 && marineDamage < cavalryDamage * 2.1,
        `expected ~2.0x ratio after rounding, got marine=${marineDamage}, cavalry=${cavalryDamage}`);
    assert.equal(marine.calculateDamage(warship).dmg, shoreMarine.calculateDamage(warship).dmg);
    assert.equal(marine.calculateDamage(enemy).dmg, shoreMarine.calculateDamage(enemy).dmg);
    assert.equal(marine.calculateDamage(warship).dmg, marine._resolveDamage(marine, warship, 1, 0.20, true).dmg);
});

test('英国文化：皇家战列舰2格反潜、海上护航、3阶防空与永不言弃攻防上限', () => {
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
    const escort = spawnUnit('destroyer', gb, addTile(state, 2, -1, null, { surface: SURFACE_KIND.SHALLOW_WATER }));
    assert.equal(getRoyalEscortBonus(battleship, state), 0.35);
    assert.equal(getRoyalEscortBonus(escort, state), 0.35);
    battleship._rank = 3;
    assert.equal(getRoyalEscortBonus(escort, state), 0.50);
    state.rng.next = () => 0.119;
    assert.equal(battleship.rollDodge(state), true);
    assert.equal(escort.rollDodge(state), true);
    state.rng.next = () => 0.12;
    assert.equal(escort.rollDodge(state), false);
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
    assert.equal(getNeverSurrenderAttackBonus(state, gb), 0.10);
});

test('法国巨炮射程5，自由不屈由暴击或阵亡触发并按阵营冷却', () => {
    const state = setupCultureState('img/flags/svg/fr.svg', 'img/flags/svg/us.svg');
    const fr = state.factions.player1;
    const foe = state.factions.player2;

    const land1 = addTile(state, 0, 0, fr);
    const land2 = addTile(state, 1, 0, fr);
    const waterTile = addTile(state, 5, 0, null, { surface: SURFACE_KIND.DEEP_WATER });

    const cannon = spawnUnit('fr_heavy_cannon', fr, land1);
    const allyInf = spawnUnit('infantry', fr, land2);
    const enemyShip = spawnUnit('warship', foe, waterTile);

    assert.equal(cannon.getEffectiveRange(), 5);
    assert.equal(UNIT_CONFIG.fr_heavy_cannon.splashPct, 0.35);
    assert.equal(getCrossDomainDamageBonus(cannon, enemyShip), 0);

    const normalArcher = spawnUnit('archer', foe, addTile(state, 0, 1, foe));
    assert.equal(getCrossDomainDamageBonus(normalArcher, enemyShip), NAVAL_RULES.landVsShipDamage);

    allyInf.morale = 1;
    allyInf._shield = 11;
    cannon.takeDamage(20, enemyShip, false, { isCrit: true });
    assert.equal(allyInf.morale, 2);
    assert.equal(allyInf.activeShield, 11 + FREE_RESISTANCE_EFFECT.shield);
    const until = allyInf._freeResistanceUntilTurn;
    state.turnCounter = until;
    assert.equal(allyInf.morale, 1);
    assert.equal(allyInf.activeShield, 11);
    const firstLoss = spawnUnit('infantry', fr, addTile(state, 2, 0, fr));
    firstLoss.applyDamage(firstLoss.hp);
    assert.equal(allyInf.activeShield, 11);
    state.turnCounter = getFactionCount(state) * FREE_RESISTANCE_EFFECT.cooldownRounds;
    cannon.applyDamage(cannon.hp);
    assert.equal(allyInf.activeShield, 11 + FREE_RESISTANCE_EFFECT.shield);
    const allyEffectItems = buildUnitEffectItems(allyInf, state);
    assert.equal(allyEffectItems.filter(item => item.label === FREE_RESISTANCE_EFFECT.name).length, 1);
    assert.equal(allyEffectItems.some(item => item.key === 'culture:free-resistance'), true);
    assert.equal(getUnitStatusIcons(allyInf, state).some(item => item.label === FREE_RESISTANCE_EFFECT.name), false);
});

test('苏联文化：喀秋莎保留溅射且全阵营普通炮兵禁用火箭炮专精，Tier2 炮兵-1费且全军免疫负面天气', () => {
    const state = setupCultureState('img/flags/soviet-union.svg', 'img/flags/svg/us.svg');
    const ru = state.factions.player1;
    const us = state.factions.player2;

    assert.equal(UNIT_CONFIG.ru_katyusha.splashPct, 0.30);
    const ruOpts = getSpecializationOptions('archer', state, ru).map(o => o.key);
    assert.deepEqual(ruOpts, ['fieldGun', 'antiAirArtillery']);
    assert.equal(isValidSpecialization('archer', 'rocketArtillery', state, ru), false);

    const ruDef = chooseDefaultSpecialization({ type: 'archer', camp: ru }, state);
    assert.notEqual(ruDef, 'rocketArtillery');

    // 其他阵营与非文化标准模式同样禁用普通炮兵火箭炮专精，保留喀秋莎与巨炮溅射稀缺性
    const usOpts = getSpecializationOptions('archer', state, us).map(o => o.key);
    assert.deepEqual(usOpts, ['fieldGun', 'antiAirArtillery']);
    assert.equal(isValidSpecialization('archer', 'rocketArtillery', state, us), false);
    assert.deepEqual(
        getSpecializationOptions('archer', { factionRuleMode: 'none' }, us).map(o => o.key),
        ['fieldGun', 'antiAirArtillery']
    );
    assert.equal(isValidSpecialization('archer', 'rocketArtillery'), false);

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

test('中华民国：教导旅跨地图共享生命、放大驻地防御并给相邻友军提供一次增伤', () => {
    const state = setupCultureState('img/flags/kuomintang.svg', 'img/flags/svg/jp.svg');
    const kmt = state.factions.player1;
    const foe = state.factions.player2;

    const cityTile = addTile(state, 0, 0, kmt, { isCity: true });
    const villageTile = addTile(state, 1, 0, kmt, { isVillage: true });
    const farTile = addTile(state, 6, 0, kmt, { terrain: 'mountain' });
    const atkTile = addTile(state, 0, 1, foe);

    const brigade = spawnUnit('kmt_training_brigade', kmt, cityTile);
    const attacker = spawnUnit('infantry', foe, atkTile);
    const friendly = spawnUnit('infantry', kmt, villageTile);
    const outOfAura = spawnUnit('infantry', kmt, addTile(state, 2, 0, kmt));
    friendly._calcFloat = attacker._calcFloat = () => 1;
    cityTile.maxHp = cityTile.hp = 250;
    const originalDamage = friendly.calculateDamage(attacker).dmg;
    const unlinkedDefense = attacker.calculateDamage(brigade).dmg;
    assert.equal(getKmtLinkDamageBonus(friendly, state), 0);
    const other = spawnUnit('kmt_training_brigade', kmt, farTile);
    assert.deepEqual(getKmtLinkedUnits(brigade, state), [brigade, other]);
    assert.deepEqual(getKmtSharedHealth(getKmtLinkedUnits(other, state)), { hp: 420, maxHp: 420 });
    assert.equal(getKmtLinkDamageBonus(brigade, state), 0.15);
    assert.equal(getKmtLinkDamageBonus(friendly, state), 0.15);
    assert.equal(getKmtLinkDamageBonus(outOfAura, state), 0);
    assert.equal(getKmtLinkDamageBonus(attacker, state), 0);
    assert.ok(Math.abs(friendly.calculateDamage(attacker).dmg / originalDamage - 1.15) < 1e-9);
    assert.ok(attacker.calculateDamage(brigade).dmg < unlinkedDefense);
    assert.equal(getKmtLinkDefenseBonus(brigade, state, 0.20), 0.10);
    assert.equal(getKmtLinkDefenseBonus(friendly, state, 0.20), 0);
    brigade.takeDamage(90, attacker, false, { impactDelayMs: 230 });
    assert.deepEqual(state._pendingKmtStrongholdFx.map(({ q, r, delayMs }) => ({ q, r, delayMs })), [
        { q: cityTile.q, r: cityTile.r, delayMs: 230 }
    ]);
    assert.deepEqual([brigade.hp, other.hp], [165, 165]);
    assert.equal(other.heal(30), 30);
    assert.deepEqual([brigade.hp, other.hp], [180, 180]);
    brigade._shield = 15;
    other.takeDamage(359, attacker);
    assert.equal(brigade._shield, 15, '护盾只保护持有者');
    assert.deepEqual(getKmtSharedHealth(getKmtLinkedUnits(brigade, state)), { hp: 1, maxHp: 420 });
    assert.equal(brigade.heal(419), 419);
    assert.deepEqual([brigade.hp, other.hp], [210, 210], '从最后1点回满仍按各自容量分摊');
    other.applyDamage(420, { source: 'true', attacker });
    assert.deepEqual([cityTile.unit, farTile.unit], [null, null]);
    assert.equal(getKmtLinkDamageBonus(friendly, state), 0);

    // Tier 2: 城市生命上限 +25%、城市补员 2/3 费用
    assert.equal(getCulturalCityMaxHpBonusPct(state, kmt), 0.30);
    assert.equal(getCulturalCityMaxHp(200, state, kmt), 260);
    assert.equal(getCityMaxHp(0, state, kmt), 325);
    assert.equal(getCulturalReinforceCostScale(state, cityTile, kmt), 2 / 3);
    assert.equal(getCulturalReinforceCostScale(state, villageTile, kmt), 1);
});

test('中共苏区：游击纵队只在主动隐匿期间隐藏，邻格侦测按观察阵营计算', () => {
    const state = setupCultureState('img/flags/chinese-communist-party-old.svg', 'img/flags/kuomintang.svg');
    const cpc = state.factions.player1;
    const kmt = state.factions.player2;

    const plainTile = addTile(state, 0, 0, cpc);
    const enemyVillage = addTile(state, 2, 0, kmt, { isVillage: true });
    const adjTile = addTile(state, 0, 1, kmt);
    const farTile = addTile(state, 4, 0, kmt);

    const guerrilla = spawnUnit('cpc_guerrilla', cpc, plainTile);
    assert.equal(isStealthGuerrilla(guerrilla), false);
    assert.equal(isUnitVisibleToCamp(guerrilla, kmt, state), true);
    guerrilla._guerrillaHiddenThroughRound = 1;
    assert.equal(isStealthGuerrilla(guerrilla), true);
    assert.equal(isUnitVisibleToCamp(guerrilla, cpc, state), true);
    assert.equal(isUnitVisibleToCamp(guerrilla, kmt, state), false);

    // 中立守军贴近时可以自行侦测，其他阵营仍按自己的视角判定。
    spawnUnit('infantry', state.factions.neutral, adjTile);
    assert.equal(isUnitVisibleToCamp(guerrilla, state.factions.neutral, state), true);
    assert.equal(isUnitVisibleToCamp(guerrilla, kmt, state), false);

    // 敌军贴近至 1 格内显形
    spawnUnit('infantry', kmt, adjTile);
    assert.equal(hasHostileUnitNear(guerrilla, state, 1), true);
    assert.equal(isUnitVisibleToCamp(guerrilla, kmt, state), true);

    // 移走侦测单位后继续隐匿，村庄和 AI 难度不额外揭示。
    adjTile.unit = null;
    assert.equal(isUnitVisibleToCamp(guerrilla, kmt, state), false);
    guerrilla.tile = enemyVillage;
    enemyVillage.unit = guerrilla;
    assert.equal(isUnitVisibleToCamp(guerrilla, kmt, state), false);

    enemyVillage.unit = null;
    guerrilla.tile = plainTile;
    plainTile.unit = guerrilla;
    kmt.isAI = true;
    kmt.aiDifficulty = 'imperator';
    assert.equal(isUnitVisibleToCamp(guerrilla, kmt, state), false);

    // 森林和山地移动成本均降到平原水平。
    assert.equal(getCulturalTerrainStepDelta(state, cpc, 'forest'), -1);
    assert.equal(getCulturalTerrainStepDelta(state, cpc, 'mountain'), -4);
    assert.equal(getCulturalTerrainStepDelta(state, cpc, 'plains'), 0);
    assert.equal(getCulturalReinforceCostScale(state, enemyVillage, cpc), 0.5);
    assert.equal(getCulturalReinforceCostScale(state, farTile, cpc), 1);
});

test('德国文化：斯图卡无冷却、机场费用降低30%、火海附着单位并同步快照', () => {
    const state = setupCultureState('img/flags/germany-iron-cross.svg', 'img/flags/svg/us.svg');
    const de = state.factions.player1;
    const us = state.factions.player2;

    const deCity = addTile(state, 0, 0, de, { isCity: true });
    deCity.airfield = true;
    const usCity = addTile(state, 3, 0, us, { isCity: true });
    usCity.airfield = true;

    assert.equal(getVisibleAirCommandKinds(deCity, state).includes('stukaDiveBomb'), true);
    assert.equal(getVisibleAirCommandKinds(usCity, state).includes('stukaDiveBomb'), false);
    assert.equal(AIR_COMMAND_CONFIG.stukaDiveBomb.antiAirBypassPct, undefined);
    assert.equal(AIR_COMMAND_CONFIG.stukaDiveBomb.cost, 2);
    assert.equal(AIR_COMMAND_CONFIG.stukaDiveBomb.multiplier, 0.45);
    assert.equal(AIR_COMMAND_CONFIG.stukaDiveBomb.cooldown, 0);
    assert.equal(AIR_COMMAND_CONFIG.stukaDiveBomb.cultureId, 'de');
    assert.equal(CULTURE_CONFIG.de.tier2.summary.includes('机场建造费用降低30%'), true);
    assert.equal(AIR_COMMAND_CONFIG.stukaDiveBomb.desc, '俯冲扫射指定目标并附加「火海」（可对空地/空城施放，引爆非己方地雷/水雷）。');

    // Tier 2: 机场建造费用降低30%（10 -> 7金，建设规则联动）
    assert.equal(getCulturalAirfieldCost(10, state, de), 7);
    assert.equal(getCulturalAirfieldCost(20, state, de), 14);
    assert.equal(constructionCost('airfield', null, deCity, state), 7);
    assert.equal(constructionCost('airfield', null, usCity, state), 9);

    const targetTile = addTile(state, 2, 0, us);
    const target = spawnUnit('infantry', us, targetTile);
    applyFireSeaToUnit(target, de, state);
    target.fireSea.roundsRemaining = 1;
    applyFireSeaToUnit(target, de, state);
    assert.deepEqual(getFireSeaState(target), { roundsRemaining: 2, sourceCampKey: 'player1' });
    assert.equal(getFireSeaState(targetTile), null);
    assert.equal(getFireSeaDefenseReduction(target), 0.35);
    assert.equal(FIRE_SEA_CONFIG.hpLossPct, 0.05);

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
    assert.deepEqual(getFireSeaState(restored.tileMap.get('2,0').unit), { roundsRemaining: 2, sourceCampKey: 'player1' });
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
    assert.equal(BANZAI_CHARGE_CONFIG.movementCost, 2);
    assert.equal(BANZAI_CHARGE_CONFIG.selfDamageCurrentHpPct, 0.30);
    assert.equal(BANZAI_CHARGE_CONFIG.missingHpDamagePct, 0.30);
    assert.equal(BANZAI_CHARGE_CONFIG.maxBonusDamage, 60);
    assert.equal(BANZAI_CHARGE_CONFIG.killHealMaxHpPct, 0.35);

    // Tier 2: 经验获取速度 +20%
    assert.equal(getCulturalXpMultiplier(state, jp), 1.20);
    samurai.addXP(10, { silent: true });
    assert.equal(samurai._xp, 12);
});

test('效果队列遵循「详情图鉴化、状态动态化」原则，不在 desc 中重复可变状态', () => {
    const state = setupCultureState('img/flags/svg/gb.svg', 'img/flags/chinese-communist-party-old.svg');
    const gb = state.factions.player1;
    const cpc = state.factions.player2;
    const tile1 = addTile(state, 0, 0, gb, { isCity: true });
    const tile2 = addTile(state, 1, 0, cpc);
    const tile3 = addTile(state, 3, 0, gb);

    const inf = spawnUnit('infantry', gb, tile1);
    inf.commander = 'astrologer';
    inf.activeSkillDur = 2;
    inf._engineerConstruction = { turnsRemaining: 1 };
    inf._campaignEffects = [{ id: 'camp1', name: '援军鼓舞', desc: '攻击力提升10%', duration: 2 }];

    const stepPerRound = getFactionCount(state);
    state.turnCounter = stepPerRound * 2;
    state.weather = 'wind';
    let gbItems = buildUnitEffectItems(inf, state);
    const ns2 = gbItems.find(i => i.key === 'culture:never-surrender');
    assert.equal(ns2.desc, NEVER_SURRENDER_CONFIG.desc);
    assert.equal(ns2.status.includes('1/6层'), true);
    assert.equal(ns2.status.includes('+2.5%'), true);

    state.turnCounter = stepPerRound * 4;
    state.weather = 'rain';
    gbItems = buildUnitEffectItems(inf, state);
    const ns4 = gbItems.find(i => i.key === 'culture:never-surrender');
    assert.equal(ns4.desc, ns2.desc);
    assert.equal(ns4.status.includes('2/6层'), true);
    assert.equal(ns4.status.includes('+5%'), true);

    const eng = gbItems.find(i => i.key === 'engineer:constructing');
    assert.equal(eng.desc.includes('1回合'), false);
    assert.equal(eng.status, '剩余1回合');

    const campFx = gbItems.find(i => i.key.startsWith('campaign:'));
    assert.equal(campFx.desc, '攻击力提升10%');
    assert.equal(campFx.status, '剩余2回合');

    const starShift = gbItems.find(i => i.label === '星移');
    assert.equal(starShift.desc.includes('雨天'), false);
    assert.equal(starShift.status, '锁定雨天 持续2回合');

    const guerrilla = spawnUnit('cpc_guerrilla', cpc, tile2);
    guerrilla._guerrillaHiddenThroughRound = 99;
    const exposedItems = buildUnitEffectItems(guerrilla, state);
    const exposedStealth = exposedItems.find(i => i.key === 'culture:stealth');
    assert.equal(exposedStealth.label, '敌后隐匿');
    assert.equal(exposedStealth.status.includes('已被侦测'), true);

    tile1.unit = null;
    tile3.unit = spawnUnit('infantry', gb, tile3);
    const hiddenItems = buildUnitEffectItems(guerrilla, state);
    const hiddenStealth = hiddenItems.find(i => i.key === 'culture:stealth');
    assert.equal(hiddenStealth.label, '敌后隐匿');
    assert.equal(hiddenStealth.desc, exposedStealth.desc);
    assert.equal(hiddenStealth.status.includes('隐匿中'), true);
});
