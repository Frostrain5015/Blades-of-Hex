// 染血的鸢尾花 · 第一章「花旗向东」
// BI-04 普通关「不归城」
//
// 无预告切换到卡托一侧。上一关玩家在山脊上看见的那条向东的平民队列，就是这里。
//
// 设计意图：
//   大纲要求：点燃南北烽火、焚毁三处名册、守大城六轮、护送伊蕾妮穿图抵密道；
//   佩特拉陷落或伊蕾妮阵亡即失败；卡托重伤退出战线但不直接失败。
//
//   旧版把四条主线同时摊在开场，八回合内既要跑烽火、烧档案、守城，
//   又要让**步兵**伊蕾妮横穿八格（步兵 2 格/回合＝五个回合），排程根本排不开。
//   本版改成两段：
//     第一段「城还有名字」——烽火与档案并行，两条线用不同的人、在不同的区域；
//     第二段「带走名字」——准备完成后才开放护送，伊蕾妮改为**骑兵信使**
//     （4 格/回合，八格＝两回合），排程立刻合理。
//   增援从六波压到四波，但每一波换一种威胁形状（试探→测距→切断→破城），
//   而不是同一种敌人堆六次。
//
// 特殊机制「烟起则民行」：
//   每点燃一座烽火，全体守军获得一层防御加成；三处档案焚尽，守军士气上升。
//   准备工作不是"额外任务"，而是让守城真的变容易——玩家能感觉到
//   自己守的不是城墙，是还在往东走的那些人。
//
// 收藏品：`bi04_family_letter` 未焚的家书。它与下一关马库斯在同一间档案厅
//   捡到的 `bi05_charred_silk` 焦黑帛书残片是同一个房间的两面。
//
// 数值依据：城防上限 = 200 + 400×radius → 半径 2 的佩特拉共 1000 点共享血池；
//   满血驻军 +20% 防御，脱战每回合回复上限 10%；战壕对近战 +25%。
//   骑兵 speed 8 = 4 格/回合，步兵 4 = 2 格，弓 3 = 2 格。
//   turnLimit 运行时不裁决，写 0；真正的时限由 turnStarted 触发器实现。

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';
import { collectiblesForScenario } from './collectibles.js';

const CATO = Object.freeze({ name: '卡托', portrait: 'minister' });
const IRENE = Object.freeze({ name: '伊蕾妮', portrait: 'npcFemale' });
const CAPTAIN = Object.freeze({ name: '佩特拉守备队长', portrait: 'npcMale' });

// 三处档案都在十九格城郭之内，逼玩家把卡托或伊蕾妮留在城里跑动。
const ARCHIVE_TAX = Object.freeze({ q: -1, r: 1 });
const ARCHIVE_ROLL = Object.freeze({ q: 0, r: -1 });
const ARCHIVE_LETTERS = Object.freeze({ q: 2, r: 0 });
const ARCHIVE_TILES = Object.freeze([ARCHIVE_TAX, ARCHIVE_ROLL, ARCHIVE_LETTERS]);

// 南北烽火在地图两端，只有城外的弓手与骑手够得着。
const NORTH_BEACON = Object.freeze({ q: -1, r: -6 });
const SOUTH_BEACON = Object.freeze({ q: -4, r: 6 });
const BEACON_TILES = Object.freeze([NORTH_BEACON, SOUTH_BEACON]);

const TUNNEL_TILE = Object.freeze({ q: 9, r: -2 });

export const config = {
    schemaVersion: 4,
    id: 'bi-04-gate',
    title: '不归城',
    displayId: 'BI-04',
    chronicleId: 'blood-iris',
    seed: 0x2404,
    turnLimit: 0,

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
            note: '正在疏散百姓、销毁名册并封住西门的佩特拉守军',
            controller: 'human',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'expedition',
            ...BLOOD_IRIS_FACTION_PRESETS.aureliaKingdom,
            note: '从西面展开、等待主力攻城器械抵达的王国东征军',
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
    // 东征军此刻的任务是围困与试探，主力攻城队还在路上；压力来自波次形状变化，不是单波强度。
    aiDifficulty: 0.85,
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
            // 佩特拉：半径 2 的十九格大城，全城共享一条 1000 点城防血池。
            { q: 0, r: 0, radius: 2, districtId: 1, camp: 'petra' },
            // 西缘营城给敌军一个清晰的来源，也让红旗在地图上先于军队出现。
            { q: -8, r: 0, radius: 0, districtId: 2, camp: 'expedition' }
        ],
        surface: [],
        terrain: [
            // 北部岩脊：压住上缘，把西北来的骑兵挤向北烽火那条路。
            { q: -5, r: -7, type: 'mountain' }, { q: -4, r: -7, type: 'mountain' },
            { q: -3, r: -7, type: 'mountain' }, { q: -2, r: -7, type: 'mountain' },
            { q: 0, r: -7, type: 'mountain' }, { q: 1, r: -7, type: 'mountain' },
            { q: 2, r: -7, type: 'mountain' }, { q: 3, r: -7, type: 'mountain' },
            { q: 5, r: -6, type: 'mountain' }, { q: 6, r: -6, type: 'mountain' },
            { q: 7, r: -5, type: 'mountain' }, { q: 8, r: -5, type: 'mountain' },
            // 南部果园与墓园林带：围合南烽火那条路，留两格宽的撤离通道。
            { q: -9, r: 5, type: 'forest' }, { q: -8, r: 5, type: 'forest' },
            { q: -8, r: 6, type: 'forest' }, { q: -7, r: 6, type: 'forest' },
            { q: -3, r: 6, type: 'forest' }, { q: -2, r: 6, type: 'forest' },
            { q: -1, r: 6, type: 'forest' }, { q: 0, r: 6, type: 'forest' },
            { q: 1, r: 5, type: 'forest' }, { q: 2, r: 5, type: 'forest' },
            { q: 3, r: 4, type: 'forest' }, { q: 4, r: 4, type: 'forest' },
            // 东缘密道口的疏林：让终点是个地标，不是一块空白角落。
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
        // 西门外的壕线：对近战 +25%，是守六轮唯一能站住的地方。
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
            // 信使骑马。八格的横穿距离只有骑兵排得开——这是本关能成立的前提。
            id: 'irene_courier', type: 'cavalry', camp: 'petra', q: 1, r: 0,
            storyCommander: 'irene', hpPct: 90, morale: 2, canAct: true
        },
        {
            id: 'petra_gate_guard', type: 'infantry', camp: 'petra', q: -3, r: 0,
            storyCommander: 'gate_captain', hpPct: 100, morale: 3, canAct: true
        },
        { id: 'petra_west_spear', type: 'infantry', camp: 'petra', q: -3, r: 1, hpPct: 100, morale: 3, canAct: true },
        { id: 'petra_west_shield', type: 'infantry', camp: 'petra', q: -3, r: -1, hpPct: 100, morale: 3, canAct: true },
        { id: 'petra_city_archer', type: 'archer', camp: 'petra', q: -1, r: -1, hpPct: 100, morale: 2, canAct: true },
        // 这两位是专门留给南北烽火的腿——弓手向北，骑手向南。
        { id: 'petra_north_archer', type: 'archer', camp: 'petra', q: -2, r: -4, hpPct: 100, morale: 2, canAct: true },
        { id: 'petra_south_rider', type: 'cavalry', camp: 'petra', q: -2, r: 4, hpPct: 95, morale: 2, canAct: true },
        { id: 'petra_tunnel_guard', type: 'infantry', camp: 'petra', q: 6, r: -1, hpPct: 100, morale: 2, canAct: true },

        { id: 'expedition_vanguard', type: 'infantry', camp: 'expedition', q: -7, r: 0, hpPct: 100, morale: 3, canAct: true },
        { id: 'expedition_north_bow', type: 'archer', camp: 'expedition', q: -7, r: -3, hpPct: 100, morale: 2, canAct: true },
        { id: 'expedition_south_bow', type: 'archer', camp: 'expedition', q: -8, r: 3, hpPct: 100, morale: 2, canAct: true },
        { id: 'expedition_north_rider', type: 'cavalry', camp: 'expedition', q: -7, r: -4, hpPct: 100, morale: 2, canAct: true },
        { id: 'expedition_south_rider', type: 'cavalry', camp: 'expedition', q: -7, r: 4, hpPct: 100, morale: 2, canAct: true }
    ],

    unitGroups: [
        {
            id: 'petra_garrison',
            unitIds: [
                'cato_defender', 'petra_gate_guard', 'petra_west_spear', 'petra_west_shield',
                'petra_north_archer', 'petra_south_rider', 'petra_city_archer', 'petra_tunnel_guard'
            ]
        },
        {
            id: 'west_line',
            unitIds: ['petra_gate_guard', 'petra_west_spear', 'petra_west_shield']
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
            id: 'north_beacon', q: NORTH_BEACON.q, r: NORTH_BEACON.r,
            label: '点燃北区撤离烽火', enabled: true,
            unitIds: ['petra_north_archer', 'petra_south_rider', 'irene_courier']
        },
        {
            id: 'south_beacon', q: SOUTH_BEACON.q, r: SOUTH_BEACON.r,
            label: '点燃南区撤离烽火', enabled: true,
            unitIds: ['petra_south_rider', 'petra_north_archer', 'irene_courier']
        },
        {
            id: 'tax_register', q: ARCHIVE_TAX.q, r: ARCHIVE_TAX.r,
            label: '焚毁税粮名册', enabled: true,
            unitIds: ['cato_defender', 'irene_courier']
        },
        {
            id: 'garrison_roll', q: ARCHIVE_ROLL.q, r: ARCHIVE_ROLL.r,
            label: '焚毁守军名册', enabled: true,
            unitIds: ['cato_defender', 'irene_courier']
        },
        {
            id: 'family_letters', q: ARCHIVE_LETTERS.q, r: ARCHIVE_LETTERS.r,
            label: '处置东境往来函', enabled: true,
            unitIds: ['cato_defender', 'irene_courier'],
            collectibleId: 'bi04_family_letter'
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
            detail: '南北两端各一座烽火台。看见两柱烟，城里的人才知道该往东走；只看见一柱，他们会在城中互相寻找。',
            active: true,
            main: true,
            highlight: { tiles: BEACON_TILES }
        },
        burn_archives: {
            title: '焚毁城内三处名册',
            detail: '由卡托或伊蕾妮亲自走到三个档案点，烧掉日后会被用来清算的名册。',
            active: true,
            main: true,
            highlight: { tiles: ARCHIVE_TILES }
        },
        hold_the_city: {
            title: '守住佩特拉，直到第六个回合',
            detail: '十九格城郭共享一条城防血池；任何一格挨打都在削同一条血。撑过六轮，撤离就完成了。',
            active: true,
            main: true,
            highlight: { area: 'west_gate_front' }
        },
        escort_irene: {
            title: '护送伊蕾妮抵达东侧密道',
            detail: '烽火与名册都处理完之后开放。伊蕾妮骑马，一回合四格；她阵亡即失败。',
            active: false,
            main: true,
            highlight: { unit: 'irene_courier', area: 'secret_tunnel' }
        }
    },

    triggers: [
        {
            id: 'opening_siege',
            title: '开场：最后一夜的分工',
            enabled: true,
            once: true,
            when: [{ kind: 'timer', value: 700 }],
            do: [
                {
                    // 卡托是尚书不是武将；他不能死在这里，只能被打退。
                    kind: 'applyEffect', target: { unit: 'cato_defender' }, effectId: 'cato_last_stand',
                    name: '不退之命', desc: '卡托不会在撤离完成前战死；重伤后退出战线。', emoji: '⚖️', duration: 0,
                    rule: 'minHp', rulePercent: 1
                },
                {
                    kind: 'showStep',
                    text: '西边不是一支军队，是六条并排的尘柱。攻城锤还没到，测距的白旗已经插满城外。佩特拉的城门在黄昏时闩上了。'
                },
                {
                    kind: 'showStep', speaker: CAPTAIN,
                    text: '报：北坡骑兵，南果园弓手，正西在给投石机清路。按他们铺路的速度，我们还有六轮。'
                },
                {
                    kind: 'showStep', speaker: IRENE,
                    text: '城里的人不知道往哪边走。档案厅也没清完——税粮名册、守军名册、东境往来函。'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '南北同时点烽火。两柱烟，百姓就沿东大道走；只有一柱，他们会先在城里找亲戚，然后一起堵死在门口。'
                },
                {
                    kind: 'showStep', speaker: CAPTAIN,
                    text: '尚书，守六轮就六轮。可您在城里跑档案厅，我拦不住流矢。'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '拦不住就不拦。名册留下来，东征军进城第一件事是照着念名字；到那时候你拦什么都晚了。'
                },
                {
                    kind: 'showStep', speaker: IRENE,
                    text: '封蜡匣呢？'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '烟齐了、名尽了，你再走东侧密道。今晚不求守住佩特拉，只求他们明天得到一座没有名字的城。',
                    next: '__begin_last_night'
                },
                { kind: 'setTriggerEnabled', trigger: 'begin_defense', enabled: true }
            ]
        },
        {
            id: 'begin_defense',
            title: '任务说明与分工提示',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__begin_last_night' }],
            do: [
                { kind: 'unlockInput' },
                {
                    kind: 'showStep',
                    text: '三件事同时做：西门壕线拖住敌军；卡托或伊蕾妮在城内跑三处档案；北面弓手和南面骑手各去点一座烽火。',
                    highlight: { tiles: [...BEACON_TILES, ...ARCHIVE_TILES] }
                },
                {
                    kind: 'showStep',
                    text: '每点亮一座烽火，全体守军的防御都会提高——百姓走得越顺，守军越知道自己在守什么。烽火与名册全部处理完，才会开放东侧密道。'
                }
            ]
        },

        {
            id: 'light_north_beacon',
            title: '北烽火：守军获得一层防御',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'north_beacon' }],
            do: [
                { kind: 'setVariable', variable: 'beacons_lit', operation: 'add', value: 1 },
                {
                    kind: 'applyEffect', target: { group: 'petra_garrison' }, effectId: 'north_road_open',
                    name: '北路已通', desc: '北区百姓开始向东移动；守军防御提高 10%。', emoji: '🔥', duration: 0,
                    statMods: { defPct: 10 }
                },
                {
                    kind: 'showStep', speaker: CAPTAIN,
                    text: '北烽火起来了。山墙下的人开始动——别让西北那队骑兵把这条烟掐了。'
                }
            ]
        },
        {
            id: 'light_south_beacon',
            title: '南烽火：守军获得一层防御',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'south_beacon' }],
            do: [
                { kind: 'setVariable', variable: 'beacons_lit', operation: 'add', value: 1 },
                {
                    kind: 'applyEffect', target: { group: 'petra_garrison' }, effectId: 'south_road_open',
                    name: '南路已通', desc: '南区百姓开始向东移动；守军防御提高 10%。', emoji: '🔥', duration: 0,
                    statMods: { defPct: 10 }
                },
                {
                    kind: 'showStep', speaker: IRENE,
                    text: '南烽火也亮了。果园里的钟往东传，城里的人终于知道该往哪边挤。'
                }
            ]
        },
        {
            id: 'both_beacons_lit',
            title: '两柱烟连成一线',
            enabled: true,
            once: true,
            when: [{ kind: 'variableCompare', scope: 'level', variable: 'beacons_lit', op: '>=', value: 2 }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'signal_evacuation', status: 'completed' },
                {
                    kind: 'showStep',
                    text: '两道烟柱越过城墙，在暮色里连成一条指向东的线。南北街区的人开始汇进东大道。'
                }
            ]
        },

        {
            id: 'burn_tax_register',
            title: '焚：税粮名册',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'tax_register' }],
            do: [
                { kind: 'setVariable', variable: 'archives_burned', operation: 'add', value: 1 },
                { kind: 'showStep', speaker: IRENE, text: '粮路、商队、签押的手印。纸记得比人清楚。税粮名册烧净了。' }
            ]
        },
        {
            id: 'burn_garrison_roll',
            title: '焚：守军名册',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'garrison_roll' }],
            do: [
                { kind: 'setVariable', variable: 'archives_burned', operation: 'add', value: 1 },
                { kind: 'showStep', speaker: CATO, text: '阵亡的人，家里记得住。不必让一支进城的军队照着册子再点一次名。' }
            ]
        },
        {
            id: 'burn_family_letters',
            title: '焚：东境往来函（留下一封家书）',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'family_letters' }],
            do: [
                { kind: 'setVariable', variable: 'archives_burned', operation: 'add', value: 1 },
                { kind: 'showStep', speaker: IRENE, text: '这一摞是往来函，里面夹着真的家书。也烧？' },
                { kind: 'showStep', speaker: CATO, text: '官印和回执烧掉。写给人的那几行抽出来——别让惦记也变成罪证。' },
                {
                    kind: 'showStep',
                    text: '她从火盆边抽出一封没有封蜡的信，抖掉灰，塞进甲衣内衬。'
                }
            ]
        },
        {
            id: 'archives_destroyed',
            title: '三处档案焚尽：守军士气上升',
            enabled: true,
            once: true,
            when: [{ kind: 'variableCompare', scope: 'level', variable: 'archives_burned', op: '>=', value: 3 }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'burn_archives', status: 'completed' },
                { kind: 'changeUnitMorale', target: { group: 'petra_garrison' }, operation: 'set', value: 3, fx: true },
                {
                    kind: 'showStep',
                    text: '档案厅三处火头连成一片。热风把空白纸页卷上城顶——从今夜起，这座城里没有一个可以被点名的人。'
                }
            ]
        },

        {
            id: 'evacuation_ready',
            title: '准备完成，开放护送',
            enabled: true,
            once: true,
            when: [
                { kind: 'variableCompare', scope: 'level', variable: 'archives_burned', op: '>=', value: 3 },
                { kind: 'variableCompare', scope: 'level', variable: 'beacons_lit', op: '>=', value: 2 }
            ],
            do: [
                { kind: 'setObjectiveStatus', objective: 'escort_irene', status: 'active' },
                { kind: 'setTriggerEnabled', trigger: 'irene_reaches_tunnel', enabled: true },
                { kind: 'revealTiles', camp: 'petra', target: { tiles: [TUNNEL_TILE] } },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '烟齐了，名尽了。伊蕾妮，匣子进甲衣，沿东大道走到底，别回头看城墙。'
                },
                {
                    kind: 'showStep',
                    text: '密道口在地图最东缘。伊蕾妮一回合能跑四格；守军可以沿途接应，但只有她自己抵达才算数。',
                    highlight: { unit: 'irene_courier', tiles: [TUNNEL_TILE] }
                }
            ]
        },
        {
            id: 'irene_reaches_tunnel',
            title: '伊蕾妮抵达密道',
            enabled: false,
            once: true,
            when: [
                {
                    kind: 'unitMovesToTile',
                    target: { unit: 'irene_courier' }, camp: 'petra',
                    tiles: [TUNNEL_TILE]
                }
            ],
            do: [
                { kind: 'showStep', speaker: IRENE, text: '密道口到了。尚书，东大道后面已经看不见人了——您现在走，还来得及。' },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '我走了，他们追的就是一份遗命。我留下，他们追到的是一个叛臣。匣子比我的名字轻，路比我的命长。',
                    next: '__irene_has_left'
                },
                { kind: 'setTriggerEnabled', trigger: 'irene_has_left', enabled: true }
            ]
        },
        {
            id: 'irene_has_left',
            title: '护送完成',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__irene_has_left' }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'escort_irene', status: 'completed' },
                { kind: 'removeUnits', target: { unit: 'irene_courier' }, mode: 'despawn' }
            ]
        },

        // ── 四波增援：每一波换一种威胁形状 ────────────────────────
        {
            id: 'wave_probe',
            title: '第一波：试探正面',
            enabled: true,
            once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition' }],
            do: [
                {
                    kind: 'spawnUnits', units: [
                        { id: 'wave1_spear_n', type: 'infantry', camp: 'expedition', q: -7, r: -2, hpPct: 100, morale: 2, canAct: true },
                        { id: 'wave1_spear_s', type: 'infantry', camp: 'expedition', q: -7, r: 2, hpPct: 100, morale: 2, canAct: true }
                    ]
                },
                { kind: 'showStep', speaker: CAPTAIN, text: '第一列越过界碑。是试探——他们在看我们把人放在哪几条壕里。' }
            ]
        },
        {
            id: 'wave_ranging',
            title: '第二波：弓手测距，威胁烽火台',
            enabled: true,
            once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 1 }],
            do: [
                {
                    kind: 'spawnUnits', units: [
                        { id: 'wave2_bow_n', type: 'archer', camp: 'expedition', q: -6, r: -5, hpPct: 100, morale: 2, canAct: true },
                        { id: 'wave2_bow_s', type: 'archer', camp: 'expedition', q: -8, r: 4, hpPct: 100, morale: 2, canAct: true }
                    ]
                },
                { kind: 'showStep', text: '第二轮号角从南北同时响。弓手没有射城墙——他们在量烽火台和城门之间的距离。' }
            ]
        },
        {
            id: 'wave_flanking',
            title: '第三波：骑兵绕后切南北道路',
            enabled: true,
            once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 2 }],
            do: [
                {
                    kind: 'spawnUnits', units: [
                        { id: 'wave3_rider_n', type: 'cavalry', camp: 'expedition', q: -5, r: -6, hpPct: 100, morale: 3, canAct: true },
                        { id: 'wave3_rider_s', type: 'cavalry', camp: 'expedition', q: -9, r: 5, hpPct: 100, morale: 3, canAct: true }
                    ]
                },
                { kind: 'showStep', speaker: CAPTAIN, text: '骑兵绕开了西门，往南北两头去了。他们看懂我们的撤离方向了。' }
            ]
        },
        {
            id: 'wave_siege',
            title: '第四波：攻城队上来，专打城防血池',
            enabled: true,
            once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 3 }],
            do: [
                {
                    kind: 'spawnUnits', units: [
                        { id: 'wave4_ram_guard', type: 'infantry', camp: 'expedition', q: -6, r: 0, hpPct: 100, morale: 3, rank: 2, canAct: true },
                        { id: 'wave4_veteran', type: 'infantry', camp: 'expedition', q: -6, r: -1, hpPct: 100, morale: 3, rank: 1, canAct: true },
                        { id: 'wave4_fire_bow', type: 'archer', camp: 'expedition', q: -7, r: 1, hpPct: 100, morale: 3, rank: 1, canAct: true }
                    ]
                },
                { kind: 'showStep', text: '第四轮没有号角。西边所有鼓声同时停下，然后第一根攻城锤的横木从尘幕后推了出来。' },
                { kind: 'showStep', speaker: CATO, text: '箭头上缠油布了。守血池，别去救烧起来的空屋——要救的人已经在路上。' }
            ]
        },

        {
            id: 'city_held',
            title: '第六个佩特拉回合：守住了',
            enabled: true,
            once: true,
            when: [{ kind: 'turnStarted', camp: 'petra', turn: 5 }],
            do: [
                {
                    kind: 'showStep',
                    text: '第六个回合开始时，东大道最后一盏提灯灭在密道方向。西门还在，城防血池还没见底——而真正的攻城阵列，刚刚抵达。',
                    next: '__confirm_hold'
                },
                { kind: 'setTriggerEnabled', trigger: 'confirm_hold', enabled: true }
            ]
        },
        {
            id: 'confirm_hold',
            title: '确认守城完成',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__confirm_hold' }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'hold_the_city', status: 'completed' },
                { kind: 'showStep', speaker: CATO, text: '从现在起，守这里不是为了城。是为了让他们继续相信，城里还有值得围的东西。' }
            ]
        },

        {
            id: 'cato_is_wounded',
            title: '卡托重伤退出战线',
            enabled: true,
            once: true,
            when: [{ kind: 'unitHpCompare', unit: 'cato_defender', mode: 'percent', op: '<=', value: 25 }],
            do: [
                { kind: 'setVariable', variable: 'cato_withdrawn', operation: 'set', value: true },
                { kind: 'setUnitState', target: { unit: 'cato_defender' }, state: 'targetable', value: false },
                { kind: 'setUnitState', target: { unit: 'cato_defender' }, state: 'canAct', value: false },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '别围着我。佩特拉不是靠一张脸撑住的——去守血池，去护还在往东走的人。'
                }
            ]
        },
        {
            id: 'city_falls',
            title: '失败：城防归零',
            enabled: true,
            once: true,
            when: [{ kind: 'cityCaptured', q: 0, r: 0, camp: 'expedition' }],
            do: [
                { kind: 'endScenario', result: 'lose', reason: '佩特拉共享城防在撤离完成前归零，通往密道的城内道路被切断。' }
            ]
        },
        {
            id: 'irene_falls',
            title: '失败：信使阵亡',
            enabled: true,
            once: true,
            when: [{ kind: 'unitKilled', target: { unit: 'irene_courier' } }],
            do: [
                { kind: 'endScenario', result: 'lose', reason: '伊蕾妮与封蜡匣未能离开佩特拉，卡托留下的证词就此断绝。' }
            ]
        }
    ],

    result: {
        winText: '伊蕾妮带着封蜡匣进了密道，档案厅的火还在烧。天亮以后，东征军会得到一座城和一个叛臣，却得不到城里那些人的名字。',
        loseText: '佩特拉没能在主力攻城之前完成撤离。',
        eliminateEnemy: false,
        starRules: [
            {
                label: '卡托未被迫退出战线',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'cato_withdrawn', op: '==', value: false }]
            },
            {
                label: '守备队长存活',
                when: [{ kind: 'unitExists', unit: 'petra_gate_guard', alive: true }]
            },
            {
                label: '从火盆边抽出了那封家书',
                when: [{ kind: 'collectibleUnlocked', collectible: 'bi04_family_letter', unlocked: true }]
            }
        ]
    }
};
