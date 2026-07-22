// 染血的鸢尾花 · 第一章「花旗向东」
// BI-04 普通关「不归城」v4
// 无边地图上的佩特拉撤离战：点燃南北烽火、焚毁三处档案、坚守大型城市并护送伊蕾妮穿城离开。
import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';
import { collectiblesForScenario } from './collectibles.js';

const CATO = Object.freeze({ name: '卡托', portrait: 'minister' });
const IRENE = Object.freeze({ name: '伊蕾妮', portrait: 'npcFemale' });
const CAPTAIN = Object.freeze({ name: '佩特拉守备队长', portrait: 'npcMale' });

const ARCHIVE_TILES = Object.freeze([
    { q: -1, r: 1 },
    { q: 0, r: -1 },
    { q: 2, r: 0 }
]);
const BEACON_TILES = Object.freeze([
    { q: -1, r: -6 },
    { q: -4, r: 6 }
]);
const TUNNEL_TILE = Object.freeze({ q: 9, r: -2 });

export const config = {
    schemaVersion: 4,
    id: 'bi-04-gate',
    title: '不归城',
    displayId: 'BI-04',
    chronicleId: 'blood-iris',
    seed: 0x2404,
    turnLimit: 8,

    intro: {
        campaignTitle: '染血的鸢尾花',
        chapterTitle: '花旗向东',
        scenarioSubtitle: 'BI-04 不归城'
    },

    weather: 'clear',
    localPlayerCamp: 'petra',
    factions: [
        {
            id: 'petra',
            ...BLOOD_IRIS_FACTION_PRESETS.petraAutonomy,
            note: '正在撤离百姓、销毁名册并封锁西门的佩特拉守军',
            controller: 'human',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'expedition',
            ...BLOOD_IRIS_FACTION_PRESETS.aureliaKingdom,
            note: '从西部三路展开、等待主力攻城器械抵达的王国东征军',
            controller: 'ai',
            participatesInTurns: true,
            active: true
        }
    ],
    turnOrder: ['petra', 'expedition'],
    diplomacy: {
        petra: { expedition: 'enemy' },
        expedition: { petra: 'enemy' }
    },

    mechanics: {
        tacticalCards: false,
        recruitment: false,
        reinforcement: false,
        commanderSkills: false,
        airCommands: false,
        weatherEffects: false,
        morale: true,
        fortifications: true,
        fogOfWar: false,
        alliedVision: false
    },

    aiOpponentCamp: '',
    aiDifficulty: 0.78,
    gold: { petra: 0, expedition: 0 },
    commanders: { petra: 'minister' },
    hands: { petra: [], expedition: [] },
    storyCommanders: [
        { id: 'cato', name: '卡托', archetype: 'minister' },
        { id: 'irene', name: '伊蕾妮', portrait: 'npcFemale' },
        { id: 'gate_captain', name: '佩特拉守备队长', portrait: 'npcMale' }
    ],
    collectibles: collectiblesForScenario('bi-04-gate'),

    board: {
        layout: 'borderless',
        radius: 4,
        cities: [
            // 佩特拉为半径 2 的十九格大型城市，全城共享一个城防血池。
            { q: 0, r: 0, radius: 2, districtId: 1, camp: 'petra' },
            // 西缘营城提供敌军控制区与清晰的进攻源头。
            { q: -9, r: 0, radius: 0, districtId: 2, camp: 'expedition' }
        ],
        surface: [],
        terrain: [
            // 北部岩脊：压住画面边缘，并把西北军势导向北烽火台。
            { q: -5, r: -7, type: 'mountain' }, { q: -4, r: -7, type: 'mountain' },
            { q: -3, r: -7, type: 'mountain' }, { q: -2, r: -7, type: 'mountain' },
            { q: 0, r: -7, type: 'mountain' }, { q: 1, r: -7, type: 'mountain' },
            { q: 2, r: -7, type: 'mountain' }, { q: 3, r: -7, type: 'mountain' },
            { q: 5, r: -6, type: 'mountain' }, { q: 6, r: -6, type: 'mountain' },
            { q: 7, r: -5, type: 'mountain' }, { q: 8, r: -5, type: 'mountain' },
            // 南部果园与墓园林带：围合南烽火路线，但保留两格宽撤离通道。
            { q: -9, r: 5, type: 'forest' }, { q: -8, r: 5, type: 'forest' },
            { q: -8, r: 6, type: 'forest' }, { q: -7, r: 6, type: 'forest' },
            { q: -3, r: 6, type: 'forest' }, { q: -2, r: 6, type: 'forest' },
            { q: -1, r: 6, type: 'forest' }, { q: 0, r: 6, type: 'forest' },
            { q: 1, r: 5, type: 'forest' }, { q: 2, r: 5, type: 'forest' },
            { q: 3, r: 4, type: 'forest' }, { q: 4, r: 4, type: 'forest' },
            // 东部密道口周围的疏林让终点成为边缘地标，而非空白角落。
            { q: 7, r: -3, type: 'forest' }, { q: 8, r: -3, type: 'forest' },
            { q: 8, r: -1, type: 'forest' }, { q: 7, r: 0, type: 'forest' },
            { q: 6, r: 1, type: 'forest' }, { q: 6, r: 2, type: 'forest' }
        ],
        villages: [
            { q: 4, r: -3, districtId: 1 },
            { q: 5, r: 2, districtId: 1 },
            { q: 1, r: 5, districtId: 1 },
            { q: -7, r: -3, districtId: 2 },
            { q: -8, r: 3, districtId: 2 }
        ],
        fortifications: [
            { q: -4, r: -2, type: 'trench' },
            { q: -4, r: -1, type: 'trench' },
            { q: -4, r: 0, type: 'trench' },
            { q: -4, r: 1, type: 'trench' },
            { q: -4, r: 2, type: 'trench' },
            { q: -3, r: -3, type: 'trench' },
            { q: -3, r: 3, type: 'trench' }
        ],
        installations: [],
        districts: [],
        rivers: [],
        crossings: [],
        ports: []
    },

    units: [
        {
            id: 'cato_defender', type: 'infantry', camp: 'petra', q: 0, r: 0,
            storyCommander: 'cato', hpPct: 100, morale: 3, canAct: true
        },
        {
            id: 'irene_courier', type: 'infantry', camp: 'petra', q: 1, r: 0,
            storyCommander: 'irene', hpPct: 85, morale: 2, canAct: true
        },
        {
            id: 'petra_gate_guard', type: 'infantry', camp: 'petra', q: -3, r: 0,
            storyCommander: 'gate_captain', hpPct: 100, morale: 3, canAct: true
        },
        { id: 'petra_west_spear', type: 'infantry', camp: 'petra', q: -3, r: 1, hpPct: 100, morale: 3, canAct: true },
        { id: 'petra_north_archer', type: 'archer', camp: 'petra', q: -2, r: -4, hpPct: 100, morale: 2, canAct: true },
        { id: 'petra_south_rider', type: 'cavalry', camp: 'petra', q: -2, r: 4, hpPct: 95, morale: 2, canAct: true },
        { id: 'petra_city_archer', type: 'archer', camp: 'petra', q: -1, r: -1, hpPct: 100, morale: 2, canAct: true },
        { id: 'petra_tunnel_guard', type: 'infantry', camp: 'petra', q: 6, r: -1, hpPct: 100, morale: 2, canAct: true },

        { id: 'expedition_vanguard', type: 'infantry', camp: 'expedition', q: -8, r: 0, hpPct: 100, morale: 3, canAct: true },
        { id: 'expedition_north_bow', type: 'archer', camp: 'expedition', q: -7, r: -3, hpPct: 100, morale: 2, canAct: true },
        { id: 'expedition_south_bow', type: 'archer', camp: 'expedition', q: -8, r: 3, hpPct: 100, morale: 2, canAct: true },
        { id: 'expedition_north_rider', type: 'cavalry', camp: 'expedition', q: -7, r: -4, hpPct: 100, morale: 2, canAct: true },
        { id: 'expedition_south_rider', type: 'cavalry', camp: 'expedition', q: -7, r: 4, hpPct: 100, morale: 2, canAct: true }
    ],

    unitGroups: [
        {
            id: 'petra_garrison',
            unitIds: [
                'cato_defender', 'petra_gate_guard', 'petra_west_spear', 'petra_north_archer',
                'petra_south_rider', 'petra_city_archer', 'petra_tunnel_guard'
            ]
        },
        {
            id: 'western_assault',
            unitIds: [
                'expedition_vanguard', 'expedition_north_bow', 'expedition_south_bow',
                'expedition_north_rider', 'expedition_south_rider'
            ]
        }
    ],
    areas: [
        { id: 'secret_tunnel', tiles: [TUNNEL_TILE] },
        { id: 'archive_hall', tiles: ARCHIVE_TILES },
        { id: 'evacuation_beacons', tiles: BEACON_TILES },
        {
            id: 'west_gate_front',
            tiles: [
                { q: -4, r: -2 }, { q: -4, r: -1 }, { q: -4, r: 0 },
                { q: -4, r: 1 }, { q: -4, r: 2 }
            ]
        }
    ],
    interactables: [
        {
            id: 'tax_register', q: -1, r: 1, label: '焚毁税粮名册', enabled: true,
            unitIds: ['cato_defender', 'irene_courier']
        },
        {
            id: 'garrison_roll', q: 0, r: -1, label: '焚毁守军名册', enabled: true,
            unitIds: ['cato_defender', 'irene_courier']
        },
        {
            id: 'family_letters', q: 2, r: 0, label: '处置东境往来函', enabled: true,
            unitIds: ['cato_defender', 'irene_courier']
        },
        {
            id: 'north_beacon', q: -1, r: -6, label: '点燃北区撤离烽火', enabled: true,
            unitIds: ['petra_north_archer']
        },
        {
            id: 'south_beacon', q: -4, r: 6, label: '点燃南区撤离烽火', enabled: true,
            unitIds: ['petra_south_rider']
        }
    ],
    variables: [
        { id: 'archives_burned', scope: 'level', type: 'number', initial: 0 },
        { id: 'beacons_lit', scope: 'level', type: 'number', initial: 0 },
        { id: 'cato_withdrawn', scope: 'level', type: 'boolean', initial: false }
    ],

    objectives: {
        signal_evacuation: {
            title: '点燃南北撤离烽火',
            detail: '分别派北区弓手和南区骑手抵达两端烽火台，让全城百姓同时开始向东撤离',
            active: true,
            main: true,
            highlight: { tiles: BEACON_TILES }
        },
        burn_archives: {
            title: '焚毁三处城内档案',
            detail: '由卡托或伊蕾妮亲自进入大型城市内的三个档案点，烧掉会被用于清算的名册',
            active: true,
            main: true,
            highlight: { tiles: ARCHIVE_TILES }
        },
        hold_west_gate: {
            title: '守住佩特拉西部城防',
            detail: '大型城市十九格共享城防血池；抵挡六轮东征军，直到第七个佩特拉回合开始',
            active: true,
            main: true,
            highlight: { tiles: [{ q: 0, r: 0 }, { q: -4, r: 0 }] }
        },
        escort_irene: {
            title: '护送伊蕾妮穿城抵达东侧密道',
            detail: '南北烽火和三处档案全部处理后，操控标有“伊蕾妮”的步兵横穿城市抵达东缘密道；她阵亡则失败',
            active: false,
            status: 'hidden',
            main: true,
            highlight: { unit: 'irene_courier', area: 'secret_tunnel' }
        }
    },

    triggers: [
        {
            id: 'opening_siege', enabled: true, once: true,
            when: [{ kind: 'timer', value: 700 }],
            do: [
                {
                    kind: 'applyEffect', target: { unit: 'cato_defender' }, effectId: 'cato_last_stand',
                    name: '不退之命', desc: '卡托不会在佩特拉撤离完成前战死；重伤后退出战线。', emoji: '⚖️', duration: 0,
                    rule: 'minHp', rulePercent: 1
                },
                {
                    kind: 'showStep',
                    text: '黄昏压在佩特拉城墙上。西边不是一支军队，而是六条并行的尘柱；攻城锤还没出现，测距的白旗已经插满城外。'
                },
                {
                    kind: 'showStep', speaker: CAPTAIN,
                    text: '北坡有骑兵，南果园里是弓手，正西面的人在给投石机清路。尚书，我们至多还有六轮。'
                },
                {
                    kind: 'showStep', speaker: IRENE,
                    text: '城里的百姓还不知道该从哪一边走。档案厅也没清完——税粮名册、守军名册、东境往来函，一页都不能落下。'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '让北区和南区同时点烽火。看见两柱烟，百姓就沿东大道撤；只看见一柱，他们会在城里互相寻找，然后一起堵死。'
                },
                {
                    kind: 'showStep', speaker: IRENE,
                    text: '封蜡匣呢？'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '档案烧净、烽火齐明以后，你带它走东侧密道。今晚我们不求守住佩特拉，只求东征军得到一座没有名字的城。'
                },
                {
                    kind: 'showStep', speaker: CAPTAIN,
                    text: '西门各队听令：沟前迟滞，城下换防。不要追击——真正的大战还在那些尘柱后面。',
                    next: '__begin_last_night'
                },
                { kind: 'setTriggerEnabled', trigger: 'begin_defense', enabled: true }
            ]
        },
        {
            id: 'begin_defense', enabled: false, once: true,
            when: [{ kind: 'eventNextIs', value: '__begin_last_night' }],
            do: [
                { kind: 'unlockInput' },
                {
                    kind: 'showStep',
                    text: '你必须同时经营四条战线：西门守军拖住敌军；卡托与伊蕾妮处理城内档案；北弓手和南骑手分别点燃烽火；条件齐备后，再让伊蕾妮横穿整张地图抵达东侧密道。',
                    highlight: { tiles: [...BEACON_TILES, ...ARCHIVE_TILES, TUNNEL_TILE] }
                },
                {
                    kind: 'showStep',
                    text: '佩特拉是十九格共享血池的大型城市。敌军攻击任一城郭格都会削减同一条城防；西门失守、伊蕾妮阵亡或八回合内未完成撤离，任务都会失败。'
                }
            ]
        },

        {
            id: 'light_north_beacon', enabled: true, once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'north_beacon' }],
            do: [
                { kind: 'setVariable', variable: 'beacons_lit', operation: 'add', value: 1 },
                {
                    kind: 'showStep', speaker: CAPTAIN,
                    text: '北烽火亮了。山墙下的人开始向东移动——别让西北骑兵把这条烟掐灭。'
                }
            ]
        },
        {
            id: 'light_south_beacon', enabled: true, once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'south_beacon' }],
            do: [
                { kind: 'setVariable', variable: 'beacons_lit', operation: 'add', value: 1 },
                {
                    kind: 'showStep', speaker: IRENE,
                    text: '南烽火也亮了。果园里的钟在往东传，城里的人终于知道该往哪里走。'
                }
            ]
        },
        {
            id: 'both_beacons_lit', enabled: true, once: true,
            when: [{ kind: 'variableCompare', scope: 'level', variable: 'beacons_lit', op: '>=', value: 2 }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'signal_evacuation', status: 'completed' },
                {
                    kind: 'showStep',
                    text: '两道烟柱越过城墙，在暮色里连成一条指向东方的线。南北街区的撤离队伍开始汇入东大道。'
                }
            ]
        },

        {
            id: 'burn_tax_register', enabled: true, once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'tax_register' }],
            do: [
                { kind: 'setVariable', variable: 'archives_burned', operation: 'add', value: 1 },
                { kind: 'showStep', speaker: IRENE, text: '粮路、商队、签押的手印。纸比人更懂得怎样告密。税粮名册烧净了。' }
            ]
        },
        {
            id: 'burn_garrison_roll', enabled: true, once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'garrison_roll' }],
            do: [
                { kind: 'setVariable', variable: 'archives_burned', operation: 'add', value: 1 },
                { kind: 'showStep', speaker: CATO, text: '阵亡者的家人会记得他们，不该由一支进城的军队替他们点名。守军名册烧掉。' }
            ]
        },
        {
            id: 'burn_family_letters', enabled: true, once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'family_letters' }],
            do: [
                { kind: 'setVariable', variable: 'archives_burned', operation: 'add', value: 1 },
                { kind: 'showStep', speaker: IRENE, text: '这些是往来函，里面还夹着真正的家书。也要烧吗？' },
                { kind: 'showStep', speaker: CATO, text: '烧官印和回执，把写给人的话带走。别让思念也变成问罪的证据。' }
            ]
        },
        {
            id: 'archives_destroyed', enabled: true, once: true,
            when: [{ kind: 'variableCompare', scope: 'level', variable: 'archives_burned', op: '>=', value: 3 }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'burn_archives', status: 'completed' },
                {
                    kind: 'showStep',
                    text: '档案厅三处火头汇成一片。热风把空白纸页卷上城顶，像一群没有姓名、也无法被审问的鸟。'
                }
            ]
        },
        {
            id: 'evacuation_ready', enabled: true, once: true,
            when: [
                { kind: 'variableCompare', scope: 'level', variable: 'archives_burned', op: '>=', value: 3 },
                { kind: 'variableCompare', scope: 'level', variable: 'beacons_lit', op: '>=', value: 2 }
            ],
            do: [
                { kind: 'setObjectiveStatus', objective: 'escort_irene', status: 'active' },
                { kind: 'setTriggerEnabled', trigger: 'irene_reaches_tunnel', enabled: true },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '烟已齐，名已尽。伊蕾妮，把封蜡匣藏进甲衣，沿东大道走到底。不要回头看城墙。'
                },
                {
                    kind: 'showStep',
                    text: '东侧密道位于地图最右缘的金色目标格。伊蕾妮必须横穿佩特拉城与东郊；守军可以沿途接应，但只有她抵达才算完成护送。',
                    highlight: { unit: 'irene_courier', tiles: [TUNNEL_TILE] }
                }
            ]
        },
        {
            id: 'irene_reaches_tunnel', enabled: false, once: true,
            when: [{ kind: 'unitMovesToTile', target: { unit: 'irene_courier' }, tiles: [TUNNEL_TILE], camp: 'petra' }],
            do: [
                { kind: 'showStep', speaker: IRENE, text: '密道口到了。尚书，东大道后面已经看不见人了。您现在走，还来得及。' },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '我留在这里，东征军才会相信他们追到的是叛臣，而不是一份遗命。走吧——匣子比我的名字轻，路却比我的命长。',
                    next: '__irene_has_left'
                },
                { kind: 'setTriggerEnabled', trigger: 'irene_has_left', enabled: true }
            ]
        },
        {
            id: 'irene_has_left', enabled: false, once: true,
            when: [{ kind: 'eventNextIs', value: '__irene_has_left' }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'escort_irene', status: 'completed' },
                { kind: 'removeUnits', target: { unit: 'irene_courier' }, mode: 'despawn' }
            ]
        },

        {
            id: 'expedition_wave_1', enabled: true, once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition' }],
            do: [
                {
                    kind: 'spawnUnits', units: [
                        { id: 'wave1_north_spear', type: 'infantry', camp: 'expedition', q: -8, r: -2, hpPct: 100, morale: 2, canAct: true },
                        { id: 'wave1_south_spear', type: 'infantry', camp: 'expedition', q: -9, r: 2, hpPct: 100, morale: 2, canAct: true }
                    ]
                },
                { kind: 'showStep', speaker: CAPTAIN, text: '第一列越过界碑了。两翼都是试探，正面的人还在等我们暴露换防路线。' }
            ]
        },
        {
            id: 'expedition_wave_2', enabled: true, once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 1 }],
            do: [
                {
                    kind: 'spawnUnits', units: [
                        { id: 'wave2_north_bow', type: 'archer', camp: 'expedition', q: -6, r: -5, hpPct: 100, morale: 2, canAct: true },
                        { id: 'wave2_south_bow', type: 'archer', camp: 'expedition', q: -9, r: 4, hpPct: 100, morale: 2, canAct: true }
                    ]
                },
                { kind: 'showStep', text: '第二轮号角从南北同时响起。弓手没有射城墙，他们在量烽火台与城门之间的距离。' }
            ]
        },
        {
            id: 'expedition_wave_3', enabled: true, once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 2 }],
            do: [
                {
                    kind: 'spawnUnits', units: [
                        { id: 'wave3_north_rider', type: 'cavalry', camp: 'expedition', q: -6, r: -6, hpPct: 100, morale: 3, canAct: true },
                        { id: 'wave3_south_rider', type: 'cavalry', camp: 'expedition', q: -10, r: 5, hpPct: 100, morale: 3, canAct: true }
                    ]
                },
                { kind: 'showStep', speaker: CAPTAIN, text: '第三列是骑兵。他们绕开西门，开始切南北道路——主将已经看懂我们的撤离方向了。' }
            ]
        },
        {
            id: 'expedition_wave_4', enabled: true, once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 3 }],
            do: [
                {
                    kind: 'spawnUnits', units: [
                        { id: 'wave4_north_spear', type: 'infantry', camp: 'expedition', q: -5, r: -7, hpPct: 100, morale: 3, rank: 1, canAct: true },
                        { id: 'wave4_south_spear', type: 'infantry', camp: 'expedition', q: -11, r: 6, hpPct: 100, morale: 3, rank: 1, canAct: true }
                    ]
                },
                { kind: 'showStep', text: '第四轮没有号角。西边所有鼓声同时停下，紧接着，第一根攻城锤的横木从尘幕后露了出来。' }
            ]
        },
        {
            id: 'expedition_wave_5', enabled: true, once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 4 }],
            do: [
                {
                    kind: 'spawnUnits', units: [
                        { id: 'wave5_north_bow', type: 'archer', camp: 'expedition', q: -6, r: -6, hpPct: 100, morale: 3, rank: 1, canAct: true },
                        { id: 'wave5_south_bow', type: 'archer', camp: 'expedition', q: -10, r: 6, hpPct: 100, morale: 3, rank: 1, canAct: true }
                    ]
                },
                { kind: 'showStep', speaker: CATO, text: '他们开始往箭头上缠油布了。守住城防，不要去救烧起来的空屋——我们要救的是还在路上的人。' }
            ]
        },
        {
            id: 'expedition_wave_6', enabled: true, once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 5 }],
            do: [
                {
                    kind: 'spawnUnits', units: [
                        { id: 'wave6_veteran', type: 'infantry', camp: 'expedition', q: -6, r: -5, hpPct: 100, morale: 3, rank: 2, canAct: true },
                        { id: 'wave6_rider', type: 'cavalry', camp: 'expedition', q: -9, r: 5, hpPct: 100, morale: 3, rank: 1, canAct: true }
                    ]
                },
                { kind: 'showStep', speaker: CAPTAIN, text: '第六列后面升起主旗了。前面这些人不是攻城军——他们只是来替真正的军队把尸体铺成路。' }
            ]
        },
        {
            id: 'west_gate_held', enabled: true, once: true,
            when: [{ kind: 'turnStarted', camp: 'petra', turn: 6 }],
            do: [
                {
                    kind: 'showStep',
                    text: '第七个佩特拉回合开始时，东大道最后一盏提灯消失在密道方向。西门仍在，城防血池尚未归零；而真正的攻城阵列刚刚抵达。',
                    next: '__confirm_west_gate'
                },
                { kind: 'setTriggerEnabled', trigger: 'confirm_west_gate', enabled: true }
            ]
        },
        {
            id: 'confirm_west_gate', enabled: false, once: true,
            when: [{ kind: 'eventNextIs', value: '__confirm_west_gate' }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'hold_west_gate', status: 'completed' },
                { kind: 'showStep', speaker: CATO, text: '撤离完成。现在守住这里不再是为了城，是为了让敌人继续相信，城里还有值得他们围攻的东西。' }
            ]
        },

        {
            id: 'west_gate_falls', enabled: true, once: true,
            when: [{ kind: 'cityCaptured', q: 0, r: 0, camp: 'expedition' }],
            do: [{ kind: 'endScenario', result: 'lose', reason: '佩特拉共享城防在撤离完成前归零，东征军切断了城内通往密道的道路。' }]
        },
        {
            id: 'irene_falls', enabled: true, once: true,
            when: [{ kind: 'unitKilled', target: { unit: 'irene_courier' } }],
            do: [{ kind: 'endScenario', result: 'lose', reason: '伊蕾妮与封蜡匣未能离开佩特拉，卡托最后留下的证词就此断绝。' }]
        },
        {
            id: 'cato_is_wounded', enabled: true, once: true,
            when: [{ kind: 'unitHpCompare', unit: 'cato_defender', mode: 'percent', op: '<=', value: 25 }],
            do: [
                { kind: 'setVariable', variable: 'cato_withdrawn', operation: 'set', value: true },
                { kind: 'setUnitState', target: { unit: 'cato_defender' }, state: 'targetable', value: false },
                { kind: 'setUnitState', target: { unit: 'cato_defender' }, state: 'canAct', value: false },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '别围着我。佩特拉不是靠一张脸撑住的；去守城防血池，去护住仍在向东走的人。'
                }
            ]
        }
    ],

    result: {
        winText: '伊蕾妮带着封蜡匣离开佩特拉，西门后的档案火仍在燃烧。天亮以后，东征军会得到一座城和一个叛臣，却得不到城里那些人的名字。',
        loseText: '佩特拉未能在主力攻城前完成撤离。',
        eliminateEnemy: false,
        starRules: [
            {
                label: '卡托未被迫退出战线',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'cato_withdrawn', op: '==', value: false }]
            },
            {
                label: '守备队长存活',
                when: [{ kind: 'unitExists', unit: 'petra_gate_guard', alive: true }]
            }
        ]
    }
};
