import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { engine } from '../core/headless.js';
import { getActiveCultureId, CULTURE_CONFIG } from '../rules/cultures.js';
import { PLAYER_FACTION_COLOR_KEYS } from '../rules/camps.js';
import { getHistoricalNeutralAppearance } from '../rules/historicalNeutral.js';
import { buildMatchStatsDocument } from '../js/matchStats.js';
import { startMatchRecording, getCurrentMatchLog, buildMatchReview, clearMatchRecording } from '../js/matchRecorder.js';

function setup(cultures, factionRuleMode = 'culture') {
    engine.resetGameState();
    engine.seedMatchRng('historical-neutral-tests');
    engine.configureSkirmishState({
        playerCount: cultures.length,
        flagPresets: Object.fromEntries(cultures.map((id, index) => [
            `player${index + 1}`, CULTURE_CONFIG[id].flagPreset
        ]))
    });
    engine.gameState.factionRuleMode = factionRuleMode;
    return engine.gameState;
}

test('校对手改文档中的全部 28 对阵，包括换边、年代、旗帜文件与色板', () => {
    const doc = readFileSync(new URL('../docs/历史模式中立守备对阵表.md', import.meta.url), 'utf8');
    const ids = new Map(Object.values(CULTURE_CONFIG).map(culture => [culture.name, culture.id]));
    ids.set('中共', 'cpc');
    ids.set('国民政府', 'kmt');
    const rows = doc.split(/\r?\n/).filter(line => /^\|[^|]*×[^|]*\|/.test(line));
    const pairs = new Set();
    for (const row of rows) {
        const [, pair, name, period] = row.split('|').map(cell => cell.trim());
        const cultures = pair.split(' × ').map(nameOfCamp => ids.get(nameOfCamp));
        assert.ok(cultures.every(Boolean), pair);
        pairs.add([...cultures].sort().join(':'));
        const appearance = getHistoricalNeutralAppearance(setup(cultures));
        assert.equal(appearance?.name, name, pair);
        assert.equal(appearance.neutralThemePeriod, period, pair);
        assert.ok(existsSync(new URL(`../${appearance.flagUrl}`, import.meta.url)), appearance.flagUrl);
        assert.match(appearance.color, /^#[0-9a-f]{6}$/i);
        assert.deepEqual(getHistoricalNeutralAppearance(setup([...cultures].reverse())), appearance, pair);
    }
    assert.equal(rows.length, 28);
    assert.equal(pairs.size, 28);
    assert.equal(PLAYER_FACTION_COLOR_KEYS.length, 7);
});

test('采用手改指定的国旗版本和意大利截图色', () => {
    const cases = [
        [['de', 'jp'], 'historical/kingdom-of-italy.svg', '#99839D'],
        [['fr', 'ru'], 'svg/de.svg'],
        [['ru', 'us'], 'svg/de.svg'],
        [['gb', 'us'], 'svg/de.svg'],
        [['gb', 'jp'], 'svg/my.svg'],
        [['jp', 'ru'], 'svg/tw.svg'],
        [['jp', 'cpc'], 'svg/tw.svg'],
        [['gb', 'cpc'], 'svg/tw.svg'],
        [['fr', 'jp'], 'historical/south-vietnam.svg'],
        [['fr', 'cpc'], 'historical/south-vietnam.svg'],
        [['fr', 'kmt'], 'svg/vn.svg'],
        [['us', 'cpc'], 'svg/kr.svg']
    ];
    for (const [cultures, flag, color] of cases) {
        const appearance = getHistoricalNeutralAppearance(setup(cultures));
        assert.equal(appearance?.flagUrl, `img/flags/${flag}`, cultures.join(':'));
        if (color) assert.equal(appearance.color, color);
    }
});

test('历史守备写入地图和联机快照，完整录像与简版复盘保留外观', () => {
    const state = setup(['de', 'jp']);
    state.standardMapId = 'uncharted-passage';
    const neutral = state.factions.neutral;
    engine.initMap();
    assert.equal(state.factions.neutral, neutral);
    assert.equal(neutral.name, '意大利');
    assert.equal(neutral.controller, 'ai');
    assert.equal(getActiveCultureId(state, neutral), null);
    assert.ok(state.tiles.some(tile => tile.isCity && tile.camp === neutral && tile.camp.color === '#99839D'));
    assert.ok(state.tiles.some(tile => tile.unit?.camp === neutral && tile.unit.camp.flagUrl === neutral.flagUrl));

    const snapshot = JSON.parse(JSON.stringify(engine.serializeState()));
    engine.resetGameState();
    engine.deserializeState(snapshot, engine.HexTile, engine.Unit);
    assert.equal(state.factions.neutral.flagUrl, neutral.flagUrl);
    assert.equal(state.factions.neutral.color, neutral.color);
    assert.equal(state.factions.neutral.neutralThemeId, 'italy');
    assert.ok(state.tiles.some(tile => tile.unit?.camp === state.factions.neutral));

    startMatchRecording(state);
    try {
        const full = getCurrentMatchLog();
        const review = buildMatchReview(full);
        const stats = buildMatchStatsDocument(review);
        for (const group of [full.participants, review.participants, stats.camps]) {
            const faction = group.find(item => item.campKey === 'neutral');
            assert.equal(faction.name, neutral.name);
            assert.equal(faction.flagUrl, neutral.flagUrl);
            assert.equal(faction.colorId, neutral.colorId);
            assert.equal(faction.neutralThemePeriod, '1940');
        }
    } finally {
        clearMatchRecording();
    }
});

test('三人、普通、协同和战役模式沿用各自的中立外观', () => {
    for (const [cultures, mode] of [
        [['de', 'jp', 'fr'], 'culture'], [['de', 'jp'], 'none'], [['de', 'jp'], 'synergy']
    ]) assert.equal(getHistoricalNeutralAppearance(setup(cultures, mode)), null);
    const state = setup(['de', 'jp']);
    state.campaignMode = true;
    assert.equal(getHistoricalNeutralAppearance(state), null);
});
