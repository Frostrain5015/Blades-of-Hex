// 传记《染血的鸢尾花》—— 王国宫廷政变群像
import { BLOOD_IRIS_COLLECTIBLES } from './collectibles.js';
// 三年前的弑君之夜，一句谎言烧尽了整座王国的夏天。
//
// 四章结构：
//   第一章「花旗向东」—— 看似正义的东征，百夫长马库斯视角（T1-T5）
//   第二章「我心如火」—— 猎宫转折，狂战士阿格里乌斯真相线（T6-T9）
//   第三章「同一个誓言」—— 集结反正，城门之战（T10-T13）
//   第四章「鸢尾落处」—— 复都，王座最终决战（T14-T15）
//
// 原《我心如火》的雨幕下的孤城残局素材已分散融入四场教学闪回中。
// 原 heartAsFire 关卡数据文件保留以供参考，不再从 catalog 加载。

export const CAMPAIGN_STORAGE_KEY = 'bladesOfHex.campaign.bloodIris';

// 战役旗帜资产：关卡按阵营预设取用，避免在关卡或 UI 中重复硬编码路径与徽章。
export const BLOOD_IRIS_FLAG_ASSETS = Object.freeze({
    aureliaKingdom: Object.freeze({
        url: 'img/flags/aurelia-kingdom.svg',
        alt: '奥雷利亚王国旗'
    }),
    regency: Object.freeze({
        url: 'img/flags/aurelia-regency.svg',
        alt: '奥雷利亚摄政府旗'
    }),
    petraAutonomy: Object.freeze({
        url: 'img/flags/petra-autonomy.svg',
        alt: '佩特拉自治领旗'
    }),
    trainingTargets: Object.freeze({
        url: 'img/flags/training-targets.svg',
        alt: '训练靶旗'
    })
});

// 战役阵营预设：只包含跨关复用的显示数据；每关仍负责 id、控制方式与回合参与等战术配置。
export const BLOOD_IRIS_FACTION_PRESETS = Object.freeze({
    aureliaKingdom: Object.freeze({
        name: '奥雷利亚王国',
        color: 'red',
        flagUrl: BLOOD_IRIS_FLAG_ASSETS.aureliaKingdom.url,
        flagAlt: BLOOD_IRIS_FLAG_ASSETS.aureliaKingdom.alt
    }),
    regency: Object.freeze({
        name: '摄政府',
        color: 'purple',
        flagUrl: BLOOD_IRIS_FLAG_ASSETS.regency.url,
        flagAlt: BLOOD_IRIS_FLAG_ASSETS.regency.alt
    }),
    petraAutonomy: Object.freeze({
        name: '佩特拉自治领',
        color: 'yellow',
        flagUrl: BLOOD_IRIS_FLAG_ASSETS.petraAutonomy.url,
        flagAlt: BLOOD_IRIS_FLAG_ASSETS.petraAutonomy.alt
    }),
    trainingTargets: Object.freeze({
        name: '训练靶',
        color: 'gray',
        flagUrl: BLOOD_IRIS_FLAG_ASSETS.trainingTargets.url,
        flagAlt: BLOOD_IRIS_FLAG_ASSETS.trainingTargets.alt
    })
});

// 关卡注册表（lobby 按此顺序渲染关卡卡）。新关卡在此登记 + 建模块文件即自动载入。
// 每关卡元字段：id/title/label/elementKey → lobby 渲染；type/order → 排序分类；
// load → 懒加载函数，模块需 export config（配置关卡）或 export default（手写 scenario）。
const SCENARIOS = Object.freeze([
    {
        id: 'bi-t1-sheath',
        title: '花与剑',
        label: 'T1',
        elementKey: 'bi-t1-sheath',
        type: 'teaching',
        chapter: 1,
        order: 1,
        load: () => import('./bi-t1-sheath.js')
    },
    {
        id: 'bi-02-flag',
        title: '泥中鸢尾',
        label: '02',
        elementKey: 'bi-02-flag',
        type: 'normal',
        chapter: 1,
        order: 2,
        load: () => import('./bi-02-flag.js')
    },
    {
        id: 'bi-t3-mountain',
        title: '山有回声',
        label: 'T3',
        elementKey: 'bi-t3-mountain',
        type: 'teaching',
        chapter: 1,
        order: 3,
        load: () => import('./bi-t3-mountain.js')
    },
    {
        id: 'bi-04-gate',
        title: '不归城',
        label: '04',
        elementKey: 'bi-04-gate',
        type: 'normal',
        chapter: 1,
        order: 4,
        load: () => import('./bi-04-gate.js')
    },
    {
        id: 'bi-05-petra',
        title: '灰烬作证',
        label: '05',
        elementKey: 'bi-05-petra',
        type: 'boss',
        chapter: 1,
        order: 5,
        load: () => import('./bi-05-petra.js')
    },
    {
        id: 'bi-06-triumph',
        title: '凯旋者不归',
        label: '06',
        elementKey: 'bi-06-triumph',
        type: 'normal',
        chapter: 2,
        order: 6,
        load: () => import('./bi-06-triumph.js')
    },
    {
        id: 'bi-t7-fog',
        title: '雾中听令',
        label: 'T7',
        elementKey: 'bi-t7-fog',
        type: 'teaching',
        chapter: 2,
        order: 7,
        load: () => import('./bi-t7-fog.js')
    },
    {
        id: 'bi-08-trail',
        title: '雪埋旧路',
        label: '08',
        elementKey: 'bi-08-trail',
        type: 'normal',
        chapter: 2,
        order: 8,
        load: () => import('./bi-08-trail.js')
    },
    {
        id: 'bi-09-halt',
        title: '我心如火',
        label: '09',
        elementKey: 'bi-09-halt',
        type: 'boss',
        chapter: 2,
        order: 9,
        load: () => import('./bi-09-halt.js')
    },
    {
        id: 'bi-13-oppose',
        title: '铁花不开',
        label: '13',
        elementKey: 'bi-13-oppose',
        type: 'boss',
        chapter: 3,
        order: 13,
        load: () => import('./bi-13-oppose.js')
    }
]);

const CHRONICLE = Object.freeze({
    id: 'blood-iris',
    title: '染血的鸢尾花',
    index: '将星列传',
    description: '以血印此花：我守奥雷利亚，不负陛下，不负众民。',
    posterUrl: 'img/campaign/染血的鸢尾花.webp',
    storageKey: CAMPAIGN_STORAGE_KEY,
    collectibles: BLOOD_IRIS_COLLECTIBLES,
    cast: Object.freeze([
        { characterId: 'marcus',   commanderId: 'centurion',   role: 'viewpoint' },
        { characterId: 'varo',     commanderId: 'ironGuard',   role: 'opponent' },
        { characterId: 'agrius',   commanderId: 'berserker',   role: 'ally' },
        { characterId: 'cato',     commanderId: 'minister',    role: 'ally' },
        { characterId: 'severus',  commanderId: 'advisor',     role: 'villain' }
    ]),
    scenarios: SCENARIOS
});

export default CHRONICLE;
