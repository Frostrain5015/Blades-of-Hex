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
    sovietsInManchuria: ['苏军驻东北部队', sovietFlag, 'red']
};

// 双人对阵与开局说明以 docs/历史模式中立守备对阵表.md 为准。
const matchups = new Map([
    ['de:fr', ['belgium', '1940', '德军经阿登地区绕过马奇诺防线。']],
    ['de:ru', ['poland', '1939', '波兰面临德苏两线入侵。']],
    ['de:gb', ['norway', '1940', '德国入侵挪威，英国派兵介入。']],
    ['de:us', ['france', '1944', '美军参加诺曼底登陆。']],
    ['de:jp', ['italy', '1940', '德、意、日签署《三国同盟条约》。']],
    ['de:kmt', ['japan', '1937', '日本向仍在协助国民政府的德国施压，要求撤走顾问。']],
    ['cpc:de', ['soviet', '1941', '德国入侵苏联，中共中央表态支持苏联抵抗。']],
    ['gb:ru', ['iran', '1941', '英国与苏联共同出兵伊朗。']],
    ['fr:ru', ['germany', '1945', '法国和苏联分别管理德国的占领区。']],
    ['ru:us', ['germany', '1948–1949', '苏联封锁西柏林的陆路与水路，美国和英国展开空运。']],
    ['jp:ru', ['republicOfChina', '1945', '苏联对日宣战，中国东北迎来抗战结束。']],
    ['kmt:ru', ['mongolia', '1945–1946', '蒙古地位是中苏谈判议题，国民政府随后承认其独立。']],
    ['cpc:ru', ['mongolia', '1945', '蒙古出现在抗战结束时东北亚的局势中。']],
    ['fr:gb', ['norway', '1940', '英国和法国共同出兵挪威。']],
    ['gb:us', ['germany', '1944', '英国和美国共同参加对德作战。']],
    ['gb:jp', ['malaya', '1941–1942', '日军进攻英属马来亚。']],
    ['gb:kmt', ['india', '1942', '中国驻印军在兰姆伽整训。']],
    ['cpc:gb', ['nationalistGovernment', '1949', '国民政府是这一时期中国局势中的第三方。']],
    ['fr:us', ['morocco', '1942', '美军在摩洛哥登陆，与维希法军交战。']],
    ['fr:jp', ['vietnam', '1940', '日军进入法属印度支那。']],
    ['fr:kmt', ['northVietnam', '1945–1946', '国军进驻越北受降，中法随后交涉驻军交接。']],
    ['cpc:fr', ['saigon', '1950', '越南西贡政权是印度支那局势中的一方。']],
    ['jp:us', ['philippines', '1941', '日军入侵菲律宾，美菲部队共同防守。']],
    ['kmt:us', ['burma', '1944', '中美部队共同参与缅北反攻。']],
    ['cpc:us', ['southKorea', '1950', '中国人民志愿军入朝后与美军交战。']],
    ['jp:kmt', ['manchukuo', '1932', '日本扶植满洲国，国民政府提出抗议。']],
    ['cpc:jp', ['republicOfChina', '1942', '抗战期间，国共关系日趋紧张。']],
    ['cpc:kmt', ['sovietsInManchuria', '1945–1946', '苏军占领并陆续撤离东北，国共部队先后进入。']]
]);

export function getHistoricalNeutralAppearance(state) {
    if (!isCultureSystemEnabled(state)) return null;
    const seats = ['player1', 'player2', 'player3']
        .filter(key => state.factions?.[key] && state.factions[key].active !== false);
    if (seats.length !== 2) return null;
    const cultures = seats.map(key => getCultureIdForFlagPreset(state.factions[key].flagPreset));
    const matchup = matchups.get(cultures.sort().join(':'));
    if (!matchup) return null;

    const [neutralThemeId, neutralThemePeriod, note] = matchup;
    const [name, flag, colorId] = appearances[neutralThemeId];
    return {
        neutralThemeId, neutralThemePeriod, note, name,
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
