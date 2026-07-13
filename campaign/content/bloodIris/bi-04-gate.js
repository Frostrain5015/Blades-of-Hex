// 染血的鸢尾花 · 第一章「花旗向东」
// BI-04 普通关「不归城」
// 无预告切换到佩特拉。玩家第一次不再借马库斯的眼睛看这场战争：
// 卡托命人烧掉名字、送走封蜡匣、守住西门；他的理由仍被刻意留在画外。

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';
import { collectiblesForScenario } from './collectibles.js';

const CATO = Object.freeze({ name: '卡托', portrait: 'minister' });
const IRENE = Object.freeze({ name: '伊蕾妮', portrait: 'npcFemale' });
const CAPTAIN = Object.freeze({ name: '佩特拉守备队长', portrait: 'npcMale' });

export const config = {
    schemaVersion: 2,
    id: 'bi-04-gate',
    title: '不归城',
    displayId: 'BI-04',
    chronicleId: 'blood-iris',
    seed: 0x2404,
    turnLimit: 3,

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
            note: '封锁西门、拒绝王都军令的佩特拉守军',
            controller: 'human',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'expedition',
            ...BLOOD_IRIS_FACTION_PRESETS.aureliaKingdom,
            note: '自西而来的王国东征军先头部队',
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
        weatherEffects: false,
        morale: true,
        fortifications: true,
        fogOfWar: false,
        alliedVision: false
    },

    aiOpponentCamp: '',
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
        radius: 4,
        cities: [
            { q: -3, r: 0, districtId: 1, camp: 'petra' }
        ],
        terrain: [
            { q: -4, r: 2, type: 'forest' },
            { q: -2, r: -1, type: 'forest' },
            { q: -1, r: -2, type: 'forest' },
            { q: 1, r: -2, type: 'forest' },
            { q: 2, r: -3, type: 'mountain' },
            { q: 3, r: -4, type: 'mountain' },
            { q: 4, r: -4, type: 'mountain' }
        ],
        villages: [{ q: -1, r: 2, districtId: 1 }],
        fortifications: [
            { q: -4, r: 0, type: 'trench' },
            { q: -3, r: -1, type: 'trench' },
            { q: -2, r: 0, type: 'trench' }
        ],
        districts: []
    },

    units: [
        {
            id: 'cato_defender', type: 'infantry', camp: 'petra', q: -2, r: 0,
            storyCommander: 'cato', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'irene_courier', type: 'infantry', camp: 'petra', q: -1, r: -1,
            storyCommander: 'irene', hpPct: 80, morale: 2, canAct: true
        },
        {
            id: 'petra_gate_guard', type: 'infantry', camp: 'petra', q: -3, r: 1,
            storyCommander: 'gate_captain', hpPct: 100, morale: 3, canAct: true
        },
        {
            id: 'petra_archer', type: 'archer', camp: 'petra', q: -2, r: 1,
            commander: '', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'petra_rider', type: 'cavalry', camp: 'petra', q: 0, r: 0,
            commander: '', hpPct: 90, morale: 2, canAct: true
        },
        {
            id: 'expedition_spear', type: 'infantry', camp: 'expedition', q: -4, r: 0,
            commander: '', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'expedition_bow', type: 'archer', camp: 'expedition', q: -3, r: -1,
            commander: '', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'expedition_rider', type: 'cavalry', camp: 'expedition', q: -4, r: 1,
            commander: '', hpPct: 95, morale: 2, canAct: true
        },
        {
            id: 'expedition_reserve', type: 'infantry', camp: 'expedition', q: -2, r: -2,
            commander: '', hpPct: 100, morale: 2, canAct: true
        }
    ],

    unitGroups: [
        { id: 'petra_garrison', unitIds: ['cato_defender', 'petra_gate_guard', 'petra_archer', 'petra_rider'] },
        { id: 'western_assault', unitIds: ['expedition_spear', 'expedition_bow', 'expedition_rider', 'expedition_reserve'] }
    ],
    areas: [
        { id: 'secret_tunnel', tiles: [{ q: 2, r: -2 }] },
        { id: 'archive_hall', tiles: [{ q: -1, r: 0 }, { q: 0, r: -1 }, { q: 0, r: 0 }] }
    ],
    interactables: [
        {
            id: 'tax_register', q: -1, r: 0, label: '焚毁税粮名册', enabled: true,
            unitIds: ['cato_defender', 'irene_courier']
        },
        {
            id: 'garrison_roll', q: 0, r: -1, label: '焚毁守军名册', enabled: true,
            unitIds: ['cato_defender', 'irene_courier']
        },
        {
            id: 'family_letters', q: 0, r: 0, label: '焚毁东境往来簿', enabled: true,
            unitIds: ['cato_defender', 'irene_courier']
        }
    ],
    variables: [
        { id: 'archives_burned', scope: 'level', type: 'number', initial: 0 },
        { id: 'cato_withdrawn', scope: 'level', type: 'boolean', initial: false }
    ],

    objectives: {
        burn_archives: {
            title: '焚毁档案厅名册',
            detail: '用卡托或伊蕾妮依次走到三处高亮地块完成焚毁；这些档案不会成为收藏物。',
            active: true,
            main: true,
            highlight: { tiles: [{ q: -1, r: 0 }, { q: 0, r: -1 }, { q: 0, r: 0 }] }
        },
        hold_west_gate: {
            title: '坚守西门',
            detail: '守住西门三轮，直到城内撤离完成；每个东征军回合开始时，西侧都会出现新的攻城部队。',
            active: true,
            main: true,
            highlight: { tiles: [{ q: -3, r: 0 }] }
        },
        escort_irene: {
            title: '让伊蕾妮抵达东侧密道',
            detail: '选中地图上标有“伊蕾妮”的步兵，将她移动到右上角持续闪烁的密道地块；她在抵达前阵亡则失败。',
            active: false,
            main: true,
            highlight: { unit: 'irene_courier', area: 'secret_tunnel' }
        }
    },

    triggers: [
        {
            id: 'opening_evacuation', enabled: true, once: true,
            when: [{ kind: 'timer', value: 800 }],
            do: [
                {
                    kind: 'applyEffect', target: { unit: 'cato_defender' }, effectId: 'cato_last_stand',
                    name: '不退之命', desc: '卡托不会在佩特拉西门战死；重伤后将退出战线。', emoji: '⚜️', duration: 0,
                    rule: 'minHp', rulePercent: 1
                },
                {
                    kind: 'showStep',
                    text: '佩特拉，西门。城外的号角没有报出旗号，城内的人却早已知道那是谁的军队。档案厅的窗子开着，纸页被风翻得像一群急着飞走的鸟。'
                },
                {
                    kind: 'showStep', speaker: IRENE,
                    text: '尚书，东征军已经过了外堤。名册里有粮路、军需、还有……支持我们的人。要留一份给以后吗？'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '以后若还需要靠这些名字认人，那就不是我们想留下的以后。烧掉。只留封蜡匣，沿密道出城。'
                },
                {
                    kind: 'showStep', speaker: IRENE,
                    text: '匣里到底是什么？'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '一份不该由你在今晚打开的东西。伊蕾妮，记住：你不是在替我逃。你是在替一个还不能被写进公文的人走路。'
                },
                {
                    kind: 'showStep', speaker: CAPTAIN,
                    text: '西门请求命令！'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '守住三轮。不要为城墙送命——墙要是守不住，就让人活着穿过它。',
                    next: '__burn_the_names'
                },
                { kind: 'setTriggerEnabled', trigger: 'begin_evacuation', enabled: true }
            ]
        },
        {
            id: 'begin_evacuation', enabled: false, once: true,
            when: [{ kind: 'eventNextIs', value: '__burn_the_names' }],
            do: [
                {
                    kind: 'showStep',
                    text: '伊蕾妮就是地图上标有“伊蕾妮”的步兵。所谓护送，不要求其他部队与她保持相邻：你需要保护她存活，并在档案焚毁后直接操控她抵达右上角唯一标亮的密道入口。此刻她与入口都已标亮。',
                    highlight: { unit: 'irene_courier', tiles: [{ q: 2, r: -2 }] }
                },
                {
                    kind: 'showStep',
                    text: '当前先操控卡托或伊蕾妮，亲自走到地图中央三处持续闪烁的档案地块，将税粮名册、守军名册和往来簿全部焚毁。不能隔空点击，也不能由普通守军代劳；西门必须坚守三轮，而东征军每回合都会从西侧获得增援。',
                    highlight: { tiles: [{ q: -1, r: 0 }, { q: 0, r: -1 }, { q: 0, r: 0 }] }
                }
            ]
        },
        {
            id: 'burn_tax_register', enabled: true, once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'tax_register' }],
            do: [
                { kind: 'setVariable', variable: 'archives_burned', operation: 'add', value: 1 },
                { kind: 'showStep', speaker: IRENE, text: '税粮去处、商队姓名、签押的手印……纸比人更会替人记仇。' }
            ]
        },
        {
            id: 'burn_garrison_roll', enabled: true, once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'garrison_roll' }],
            do: [
                { kind: 'setVariable', variable: 'archives_burned', operation: 'add', value: 1 },
                { kind: 'showStep', speaker: CATO, text: '烧干净。阵亡者的家人会记得他们，不该由一支进城的军队替他们点名。' }
            ]
        },
        {
            id: 'burn_family_letters', enabled: true, once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'family_letters' }],
            do: [
                { kind: 'setVariable', variable: 'archives_burned', operation: 'add', value: 1 },
                { kind: 'showStep', speaker: IRENE, text: '连家书也要烧？'
                },
                { kind: 'showStep', speaker: CATO, text: '只烧往来簿。把真正写给人的话带走——别让它们变成问罪的证据。' }
            ]
        },
        {
            id: 'archives_destroyed', enabled: true, once: true,
            when: [{ kind: 'variableCompare', scope: 'level', variable: 'archives_burned', op: '>=', value: 3 }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'escort_irene', status: 'active' },
                { kind: 'setObjectiveStatus', objective: 'burn_archives', status: 'completed' },
                { kind: 'setTriggerEnabled', trigger: 'irene_reaches_tunnel', enabled: true },
                {
                    kind: 'showStep',
                    text: '火从档案厅的窗缝里吐出来。伊蕾妮将一只封蜡匣塞进衣襟，东侧密道仍开着。'
                },
                {
                    kind: 'showStep',
                    text: '现在选中标有“伊蕾妮”的步兵，将她移动到右上角唯一的金色脉冲地块。其他部队不必跟随，只需挡住沿途敌军；在她抵达前，务必阻止东征军将她击杀。',
                    highlight: { unit: 'irene_courier', tiles: [{ q: 2, r: -2 }] }
                }
            ]
        },
        {
            id: 'irene_reaches_tunnel', enabled: false, once: true,
            when: [{ kind: 'unitMovesToTile', target: { unit: 'irene_courier' }, tiles: [{ q: 2, r: -2 }], camp: 'petra' }],
            do: [
                {
                    kind: 'showStep', speaker: IRENE,
                    text: '密道口到了。尚书，您呢？'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '我留在这里，才像那个该被找到的人。走。匣子比我的名字轻，路却比我的命长。',
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
                    kind: 'spawnUnits',
                    units: [
                        { id: 'expedition_wave1_spear', type: 'infantry', camp: 'expedition', q: -4, r: 2, hpPct: 100, morale: 2, canAct: true }
                    ]
                },
                {
                    kind: 'showStep', speaker: CAPTAIN,
                    text: '西坡又起尘了——不是散兵，是第二列旗。只要西门还站着，他们就会一批批压上来！',
                    highlight: { tiles: [{ q: -4, r: 2 }] }
                }
            ]
        },
        {
            id: 'expedition_wave_2', enabled: true, once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 1 }],
            do: [
                {
                    kind: 'spawnUnits',
                    units: [
                        { id: 'expedition_wave2_bow', type: 'archer', camp: 'expedition', q: -4, r: 3, hpPct: 100, morale: 2, canAct: true }
                    ]
                },
                {
                    kind: 'showStep',
                    text: '第二批东征军踏过西坡，弓手开始寻找越过壕沟的射界。西门前没有真正的喘息。',
                    highlight: { tiles: [{ q: -4, r: 3 }] }
                }
            ]
        },
        {
            id: 'expedition_wave_3', enabled: true, once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 2 }],
            do: [
                {
                    kind: 'spawnUnits',
                    units: [
                        { id: 'expedition_wave3_rider', type: 'cavalry', camp: 'expedition', q: -4, r: 2, hpPct: 100, morale: 3, canAct: true },
                        { id: 'expedition_wave3_spear', type: 'infantry', camp: 'expedition', q: -4, r: 3, hpPct: 100, morale: 2, canAct: true }
                    ]
                },
                {
                    kind: 'showStep', speaker: CAPTAIN,
                    text: '第三批！骑兵也压上来了。守住门前最后这段路——城里的人就快走完了！',
                    highlight: { tiles: [{ q: -4, r: 2 }, { q: -4, r: 3 }] }
                }
            ]
        },
        {
            id: 'west_gate_held', enabled: true, once: true,
            when: [{ kind: 'turnStarted', camp: 'petra', turn: 3 }],
            do: [
                {
                    kind: 'showStep',
                    text: '第三夜的号角过去了。西门仍在，城里该走的人也已走向看不见的东边。',
                    next: '__confirm_west_gate'
                },
                { kind: 'setTriggerEnabled', trigger: 'confirm_west_gate', enabled: true }
            ]
        },
        {
            id: 'confirm_west_gate', enabled: false, once: true,
            when: [{ kind: 'eventNextIs', value: '__confirm_west_gate' }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'hold_west_gate', status: 'completed' }
            ]
        },
        {
            id: 'west_gate_falls', enabled: true, once: true,
            when: [{ kind: 'cityCaptured', q: -3, r: 0, camp: 'expedition' }],
            do: [{ kind: 'endScenario', result: 'lose', reason: '西门在撤离完成前失守，佩特拉的密道被截断。' }]
        },
        {
            id: 'irene_falls', enabled: true, once: true,
            when: [{ kind: 'unitKilled', target: { unit: 'irene_courier' } }],
            do: [{ kind: 'endScenario', result: 'lose', reason: '封蜡匣落入敌手，佩特拉再无可送出的证词。' }]
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
                    text: '别围着我。西门不是一张脸撑住的；去守你们各自该站的位置。'
                }
            ]
        }
    ],

    result: {
        winText: '封蜡匣离开佩特拉，西门后的火还在烧。后来每个人都会记得卡托烧了什么，却很少有人记得他留下了谁。',
        loseText: '佩特拉未能完成撤离。',
        eliminateEnemy: false,
        starRules: [
            {
                label: '卡托未被迫撤离',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'cato_withdrawn', op: '==', value: false }]
            },
            {
                label: '守备队长存活',
                when: [{ kind: 'unitExists', unit: 'petra_gate_guard', alive: true }]
            }
        ]
    }
};
