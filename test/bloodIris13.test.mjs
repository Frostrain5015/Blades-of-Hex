import test from 'node:test';
import assert from 'node:assert/strict';
import chronicle, { BLOOD_IRIS_FLAG_ASSETS } from '../campaign/content/bloodIris/chronicle.js';
import { config } from '../campaign/content/bloodIris/bi-13-oppose.js';
import { normalizeLevel, validateLevel } from '../campaign/runtime/schema.js';
import { getPlayableBoardCoordinates } from '../rules/boardLayout.js';

const level = normalizeLevel(config);
const triggerById = new Map(level.triggers.map(trigger => [trigger.id, trigger]));

test('《铁花不开》已作为 BI-13 Boss 正式接入且通过 schema 校验', () => {
    const registryEntry = chronicle.scenarios.find(scenario => scenario.id === 'bi-13-oppose');

    assert.equal(config.schemaVersion, 4);
    assert.deepEqual(validateLevel(level), { errors: [], warnings: [] });
    assert.equal(registryEntry?.order, 13);
    assert.equal(registryEntry?.type, 'boss');
});

test('所有效忠摄政府的部队统一使用紫色阵营色与规定旗帜', () => {
    const regency = level.factions.find(faction => faction.id === 'regency');
    const crown = level.factions.find(faction => faction.id === 'crown');

    assert.equal(regency.color, 'purple');
    assert.equal(regency.flagUrl, BLOOD_IRIS_FLAG_ASSETS.regency.url);
    assert.equal(regency.flagAlt, BLOOD_IRIS_FLAG_ASSETS.regency.alt);
    assert.equal(crown.color, 'red');
    assert.equal(crown.flagUrl, BLOOD_IRIS_FLAG_ASSETS.aureliaKingdom.url);
    assert.ok(level.units.filter(unit => unit.camp === 'regency').length >= 13);
});

test('难度回调后红军拥有十一支初始部队、招募补员与充足开局军费', () => {
    assert.equal(level.mechanics.recruitment, true);
    assert.equal(level.mechanics.reinforcement, true);
    assert.equal(level.factions.find(faction => faction.id === 'crown').canRecruit, true);
    assert.equal(level.factions.find(faction => faction.id === 'regency').canRecruit, false);
    assert.equal(level.gold.crown, 32);
    assert.ok(level.aiDifficulty <= 0.78);
    assert.equal(level.units.filter(unit => unit.camp === 'crown').length, 11);
    assert.ok(level.board.cities.some(city => city.camp === 'crown'));
});

test('关卡使用 277 格无边地图和十九格王都大型城市', () => {
    const playable = getPlayableBoardCoordinates(level.board);
    const capital = level.board.cities.find(city => city.camp === 'regency');

    assert.equal(level.board.layout, 'borderless');
    assert.equal(playable.length, 277);
    assert.equal(capital.radius, 2);
    assert.equal(1 + 3 * capital.radius * (capital.radius + 1), 19);
});

test('主目标横跨东西与南北边缘并形成真实多线攻城', () => {
    const objectiveTiles = Object.values(level.objectives)
        .flatMap(objective => objective.highlight?.tiles || []);
    const unitTiles = level.units.map(({ q, r }) => ({ q, r }));
    const qs = [...objectiveTiles, ...unitTiles].map(tile => tile.q);
    const rs = [...objectiveTiles, ...unitTiles].map(tile => tile.r);

    assert.ok(Math.max(...qs) - Math.min(...qs) >= 18);
    assert.ok(Math.max(...rs) - Math.min(...rs) >= 12);
    assert.ok(level.board.terrain.length >= 60);
    assert.ok(level.board.fortifications.length >= 25);
    assert.ok(level.board.villages.length >= 12);
});

test('拔塔、夺取前线城、破门、瓦罗出阵与誓章处置严格分为五个阶段', () => {
    const towers = triggerById.get('both_towers_silent');
    const assaultReady = triggerById.get('forward_assault_ready');
    const gate = triggerById.get('gate_breached');
    const varo = triggerById.get('varo_reaches_threshold');
    const badge = triggerById.get('badge_recovered');

    assert.ok(towers.when.some(condition => condition.variable === 'towers_silenced' && condition.value === 2));
    assert.ok(!towers.do.some(action => action.kind === 'setObjectiveStatus' && action.objective === 'break_gate' && action.status === 'active'));
    assert.ok(assaultReady.when.some(condition => condition.variable === 'towers_silenced' && condition.value === 2));
    assert.ok(assaultReady.when.some(condition => condition.kind === 'cityOwnedBy'
        && condition.q === -2
        && condition.r === 0
        && condition.camp === 'crown'));
    assert.ok(assaultReady.do.some(action => action.kind === 'setObjectiveStatus' && action.objective === 'break_gate' && action.status === 'active'));
    assert.ok(gate.when.some(condition => condition.kind === 'cityOwnedBy' && condition.camp === 'crown'));
    assert.ok(gate.do.some(action => action.kind === 'setUnitState' && action.target?.unit === 'varo_iron_guard' && action.state === 'targetable' && action.value === true));
    assert.ok(varo.when.some(condition => condition.kind === 'unitHpCompare' && condition.value === 20));
    assert.ok(varo.do.some(action => action.kind === 'setInteractionState' && action.interactable === 'recover_oath_badge' && action.state === 'available'));
    assert.ok(badge.do.some(action => action.kind === 'showStep' && /我们发的是同一个誓/.test(action.text)));
});

test('中央紫军前线城被夺取后成为红军的中场招募支点', () => {
    const capital = level.board.cities.find(city => city.camp === 'regency' && city.radius === 2);
    const rearCamp = level.board.cities.find(city => city.camp === 'crown');
    const forwardCity = level.board.cities.find(city => city.districtId === 11);
    const garrison = level.units.find(unit => unit.id === 'forward_city_garrison');
    const capture = triggerById.get('forward_city_captured');
    const hexDistance = (from, to) => {
        const dq = from.q - to.q;
        const dr = from.r - to.r;
        return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    };

    assert.deepEqual(
        { q: forwardCity.q, r: forwardCity.r, camp: forwardCity.camp, radius: forwardCity.radius, hpPct: forwardCity.hpPct },
        { q: -2, r: 0, camp: 'regency', radius: 0, hpPct: 70 }
    );
    assert.deepEqual({ q: garrison.q, r: garrison.r, camp: garrison.camp }, { q: -2, r: 0, camp: 'regency' });
    assert.ok(hexDistance(rearCamp, forwardCity) < hexDistance(rearCamp, capital));
    assert.ok(hexDistance(forwardCity, capital) < hexDistance(rearCamp, capital));
    assert.deepEqual(capture.when, [{ kind: 'cityCaptured', q: -2, r: 0, camp: 'crown' }]);
    assert.ok(capture.do.some(action => action.kind === 'changeGold' && action.camp === 'crown' && action.value === 12));
    assert.ok(capture.do.some(action => action.kind === 'setObjectiveStatus'
        && action.objective === 'capture_forward_city'
        && action.status === 'completed'));
});

test('攻城炮存亡是硬失败条件，瓦罗则由阈值保护进入剧情处置', () => {
    const opening = triggerById.get('opening_at_the_gate');
    const engineFailure = triggerById.get('siege_engine_destroyed');

    assert.ok(opening.do.some(action => action.kind === 'applyEffect'
        && action.target?.unit === 'varo_iron_guard'
        && action.rule === 'minHp'
        && action.rulePercent === 1));
    assert.deepEqual(engineFailure.when, [{ kind: 'unitKilled', target: { unit: 'siege_engine' } }]);
    assert.ok(engineFailure.do.some(action => action.kind === 'endScenario' && action.result === 'lose'));
});

test('誓章后的停手与追击是两个互斥战场命令并写入结局变量', () => {
    const spare = triggerById.get('spare_varo');
    const pursue = triggerById.get('pursue_varo');
    const choices = level.interactables.filter(item => item.id.startsWith('order_'));

    assert.equal(choices.length, 2);
    assert.notDeepEqual(
        { q: choices[0].q, r: choices[0].r },
        { q: choices[1].q, r: choices[1].r }
    );
    assert.ok(choices.every(item => item.unitIds.includes('marcus_guard') && item.enabled === false));
    assert.ok(spare.do.some(action => action.kind === 'setVariable' && action.variable === 'varo_spared' && action.value === true));
    assert.ok(spare.do.some(action => action.kind === 'setInteractionState' && action.interactable === 'order_pursue_varo' && action.state === 'disabled'));
    assert.ok(pursue.do.some(action => action.kind === 'setVariable' && action.variable === 'varo_spared' && action.value === false));
    assert.ok(pursue.do.some(action => action.kind === 'setInteractionState' && action.interactable === 'order_spare_varo' && action.state === 'disabled'));
});

test('十四回合与五批纵深援军拉开 Boss 战体量并支撑十分钟以上压力', () => {
    const waves = level.triggers.filter(trigger => trigger.id.startsWith('purple_wave_'));
    const waveText = waves.flatMap(trigger => trigger.do)
        .filter(action => action.kind === 'showStep')
        .map(action => action.text)
        .join('\n');

    assert.ok(level.turnLimit >= 14);
    assert.equal(waves.length, 5);
    assert.deepEqual(waves.map(trigger => trigger.when[0].turn), [2, 4, 6, 8, 10]);
    assert.match(waveText, /主力|集结钟|预备队/);
});

test('Boss 关额外包含可选军械库、真实剧情 Buff 和半血反击阶段', () => {
    const arsenalInteractions = level.interactables.filter(item => ['north_powder_magazine', 'south_axle_depot'].includes(item.id));
    const arsenalTriggers = [triggerById.get('take_north_powder'), triggerById.get('take_south_axles')];
    const towerFallTriggers = [triggerById.get('north_tower_falls'), triggerById.get('south_tower_falls')];
    const counterstroke = triggerById.get('varo_counterstroke');

    assert.equal(arsenalInteractions.length, 2);
    assert.ok(arsenalInteractions.every(item => item.enabled === false));
    assert.ok(towerFallTriggers.every(trigger => trigger.do.some(action => action.kind === 'setInteractionState' && action.state === 'available')));
    assert.ok(level.objectives.secure_arsenals.main === false);
    assert.ok(arsenalTriggers.every(trigger => trigger.do.some(action => action.kind === 'applyEffect' && action.target?.unit === 'siege_engine')));
    assert.ok(arsenalTriggers.every(trigger => trigger.do.some(action => action.kind === 'changeGold' && action.camp === 'crown' && action.value === 10)));
    assert.ok(arsenalTriggers.every(trigger => trigger.do.some(action => action.kind === 'spawnUnits' && action.units.length === 2)));
    assert.ok(triggerById.get('take_north_powder').do.some(action => action.statMods?.atkPct === 0.3));
    assert.ok(triggerById.get('take_south_axles').do.some(action => action.statMods?.spdFlat === 2 && action.statMods?.hpFlat === 40));
    assert.ok(counterstroke.when.some(condition => condition.kind === 'unitHpCompare' && condition.value === 55));
    assert.ok(counterstroke.do.some(action => action.kind === 'applyEffect'
        && action.target?.unit === 'varo_iron_guard'
        && action.statMods?.atkPct === 0.3
        && action.duration === 2));
});

test('马库斯与瓦罗始终是同期受训、亲如兄弟的同袍，而非师生', () => {
    const openingText = triggerById.get('opening_at_the_gate').do
        .filter(action => action.kind === 'showStep').map(action => action.text).join('\n');
    const duel = triggerById.get('brothers_cross_blades');
    const counterText = triggerById.get('varo_counterstroke').do
        .filter(action => action.kind === 'showStep').map(action => action.text).join('\n');
    const thresholdText = triggerById.get('varo_reaches_threshold').do
        .filter(action => action.kind === 'showStep').map(action => action.text).join('\n');

    const allNarrativeText = level.triggers.flatMap(trigger => trigger.do)
        .flatMap(action => [action.text, action.reason])
        .filter(Boolean)
        .join('\n');

    assert.match(openingText, /替我挡过一矛|把你背回过营地/);
    assert.match(openingText, /入伍那年一起背过|同一座校场里练熟/);
    assert.ok(duel.when.some(condition => condition.kind === 'any'));
    assert.equal(duel.do.filter(action => action.kind === 'applyEffect' && action.name === '不再留手').length, 2);
    assert.match(counterText, /我守的从来不是塞维鲁|哪怕门外是你/);
    assert.match(thresholdText, /亲如兄弟|我选择了这条路/);
    assert.doesNotMatch(allNarrativeText, /我教你的|你教我的|最后一课|教给他的|他教的一切/);
});

test('暗红誓章进入本关收藏物并由王都中心调查点真实回收', () => {
    const badge = level.collectibles.find(item => item.id === 'bi13_blood_oath_badge');
    const interaction = level.interactables.find(item => item.id === 'recover_oath_badge');

    assert.match(badge.description, /汗、锈与血/);
    assert.equal(interaction.collectibleId, badge.id);
    assert.deepEqual({ q: interaction.q, r: interaction.r }, { q: 6, r: 0 });
});
