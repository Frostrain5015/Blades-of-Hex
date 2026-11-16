import { getPaletteEntry } from './camps.js';
import { getCultureIdForFlagPreset, isCultureSystemEnabled } from './cultures.js';

const germanFlag = 'svg/de.svg';
const republicOfChinaFlag = 'svg/tw.svg';
const saigonFlag = 'historical/south-vietnam.svg';
const sovietFlag = 'soviet-union.svg';

const appearances = {
    belgium: ['比利时', 'svg/be.svg', 'belgiumSage'],
    poland: ['波兰', 'svg/pl.svg', 'polandSand'],
    norway: ['挪威', 'svg/no.svg', 'norwayRose'],
    france: ['法国', 'svg/fr.svg', 'franceSky'],
    italy: ['意大利', 'historical/kingdom-of-italy.svg', 'italyMauve'],
    japan: ['日本', 'svg/jp.svg', 'japanOlive'],
    soviet: ['苏联', sovietFlag, 'red'],
    iran: ['伊朗', 'historical/iran-1941.svg', 'iranJade'],
    germany: ['德国', germanFlag, 'germanyGray'],
    republicOfChina: ['中华民国', republicOfChinaFlag, 'blue'],
    mongolia: ['蒙古', 'historical/mongolia-1945.svg', 'mongoliaClay'],
    malaya: ['马来亚', 'svg/my.svg', 'malayaSlate'],
    india: ['印度', 'svg/in.svg', 'indiaOchre'],
    nationalistGovernment: ['国民政府', republicOfChinaFlag, 'blue'],
    morocco: ['摩洛哥', 'svg/ma.svg', 'moroccoTerracotta'],
    vietnam: ['越南', saigonFlag, 'saigonLilac'],
    northVietnam: ['北越共产党武装', 'svg/vn.svg', 'vietnamRose'],
    saigon: ['越南西贡政权', saigonFlag, 'saigonLilac'],
    philippines: ['菲律宾', 'svg/ph.svg', 'philippinesCoral'],
    burma: ['缅甸', 'historical/burma-1944.svg', 'burmaStone'],
    southKorea: ['韩国', 'svg/kr.svg', 'koreaLavender'],
    manchukuo: ['满洲国', 'historical/manchukuo.svg', 'manchukuoSand'],
    sovietsInManchuria: ['苏联', sovietFlag, 'red']
};

// 双人对阵以 docs/历史模式中立守备对阵表.md 为准。
const matchups = new Map([
    ['de:fr', ['belgium', '1940']],
    ['de:ru', ['poland', '1939']],
    ['de:gb', ['norway', '1940']],
    ['de:us', ['france', '1944']],
    ['de:jp', ['italy', '1940']],
    ['de:kmt', ['japan', '1937']],
    ['cpc:de', ['soviet', '1941']],
    ['gb:ru', ['iran', '1941']],
    ['fr:ru', ['germany', '1945']],
    ['ru:us', ['germany', '1948–1949']],
    ['jp:ru', ['republicOfChina', '1945']],
    ['kmt:ru', ['mongolia', '1945–1946']],
    ['cpc:ru', ['mongolia', '1945']],
    ['fr:gb', ['norway', '1940']],
    ['gb:us', ['germany', '1944']],
    ['gb:jp', ['malaya', '1941–1942']],
    ['gb:kmt', ['india', '1942']],
    ['cpc:gb', ['nationalistGovernment', '1949']],
    ['fr:us', ['morocco', '1942']],
    ['fr:jp', ['vietnam', '1940']],
    ['fr:kmt', ['northVietnam', '1945–1946']],
    ['cpc:fr', ['saigon', '1950']],
    ['jp:us', ['philippines', '1941']],
    ['kmt:us', ['burma', '1944']],
    ['cpc:us', ['southKorea', '1950']],
    ['jp:kmt', ['manchukuo', '1932']],
    ['cpc:jp', ['republicOfChina', '1942']],
    ['cpc:kmt', ['sovietsInManchuria', '1945–1946']]
]);

export function getHistoricalNeutralAppearance(state) {
    if (!isCultureSystemEnabled(state)) return null;
    const seats = ['player1', 'player2', 'player3']
        .filter(key => state.factions?.[key] && state.factions[key].active !== false);
    if (seats.length !== 2) return null;
    const cultures = seats.map(key => getCultureIdForFlagPreset(state.factions[key].flagPreset));
    const matchup = matchups.get(cultures.sort().join(':'));
    if (!matchup) return null;

    const [neutralThemeId, neutralThemePeriod] = matchup;
    const [name, flag, colorId] = appearances[neutralThemeId];
    return {
        neutralThemeId, neutralThemePeriod, name,
        colorId, color: getPaletteEntry(colorId).tile,
        flagUrl: `img/flags/${flag}`, flagAlt: `${name}旗帜`
    };
}

export function applyHistoricalNeutralAppearance(state) {
    const appearance = getHistoricalNeutralAppearance(state);
    const neutral = state.factions?.neutral;
    if (!appearance || !neutral) return null;
    Object.assign(neutral, appearance);
    return neutral;
}
