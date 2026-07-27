// 染血的鸢尾花 · 第一章「花旗向东」
// BI-05 Boss 关「灰烬作证」
//
// 同一座佩特拉，从马库斯这一侧重演。玩家攻破内城，却只能从灰烬和一枚
// 被踩弯的誓章里看见第一道裂缝——还不足以给任何人定罪。
//
// 设计意图（Boss 关：多阶段 + 限伤 + 倒计时，标准路线 20 分钟以上）：
//   第一幕「外郭」——巷战。守军蹲在壕线里，正面强攻要挨 25% 减伤的反击；
//                    卡托此阶段无敌，逼玩家先清场，不能一头扎向 Boss。
//   第二幕「高台」——**内城的共享城防血池就是卡托的血条**。
//                    半径 1 的内城 = 600 点共享血池（200+400×radius），
//                    血池不归零就进不了任何城内格，也就够不着他。
//                    这一幕把游戏既有的攻城机制直接当成 Boss 战机制用：
//                    卡托不是一个站着挨打的单位，他就是这座城。
//   第三幕「档案厅」——摄政府特使当着马库斯的面焚档。特使是**不可攻击的中立单位**：
//                    他有王命，你有刀，但你动不了他。倒计时三个我方回合，
//                    跑到档案厅就拿到残片，跑不到剧情照常推进、少一项证据。
//
// 与 BI-04 的对位：上一关玩家（作为卡托一方）在这间档案厅烧掉名册、抽走一封家书；
//   这一关同一间屋子里，马库斯从灰里捡到的是别人没烧净的半片帛书。
//
// 数值依据：内城 radius 1 → 城防 1000？不，上限 = 200 + 400×radius = 600。
//   满血驻军 +20% 防御，脱战每回合回血 10% 上限——所以拖久了城防会回，必须持续压。
//   战壕对近战 +25%；森林（瓦砾）对远程 +15%。
//   本关首次开放【将领技】与【补员】：百夫长【乘胜】开始生效，
//   营地可花金币给伤兵补血——长关需要一个中途恢复的阀门。

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';
import { collectiblesForScenario } from './collectibles.js';

const MARCUS = Object.freeze({ name: '马库斯', portrait: 'centurion' });
const CATO = Object.freeze({ name: '卡托', portrait: 'minister' });
const ELIAN = Object.freeze({ name: '艾利安', portrait: 'npcMale' });
const NIA = Object.freeze({ name: '妮娅', portrait: 'npcFemale' });
const TITUS = Object.freeze({ name: '提图斯', portrait: 'npcMale' });
const ENVOY = Object.freeze({ name: '摄政府特使', portrait: 'npcMale' });

const KEEP_CENTER = Object.freeze({ q: 2, r: -1 });   // 内城高台中心格
const ARCHIVE_TILE = Object.freeze({ q: 1, r: 2 });   // 档案厅
const BARRICADES = Object.freeze([
    { q: -4, r: -2 }, { q: -4, r: 0 }, { q: -4, r: 2 }
]);

export const config = {
    schemaVersion: 4,
    id: 'bi-05-petra',
    title: '灰烬作证',
    displayId: 'BI-05',
    chronicleId: 'blood-iris',
    seed: 0x2505,
    turnLimit: 0,

    intro: {
        campaignTitle: '染血的鸢尾花',
        chapterTitle: '花旗向东',
        scenarioSubtitle: 'BI-05 灰烬作证'
    },

    weather: 'clear',
    localPlayerCamp: 'expedition',
    factions: [
        {
            id: 'expedition',
            ...BLOOD_IRIS_FACTION_PRESETS.aureliaKingdom,
            note: '从西门缺口攻入佩特拉的王国东征军前卫',
            controller: 'human',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'petra',
            ...BLOOD_IRIS_FACTION_PRESETS.petraAutonomy,
            note: '退守内城高台的佩特拉残军',
            controller: 'ai',
            participatesInTurns: true,
            active: true
        },
        {
            // 特使一行不参与回合、不可攻击。他不是敌人——他是命令。
            id: 'envoy',
            name: '摄政府特使随员',
            color: 'white',
            note: '奉宰相府命入城清查逆案的文吏与随从',
            controller: 'scripted',
            participatesInTurns: false,
            active: true
        }
    ],
    turnOrder: ['expedition', 'petra'],
    diplomacy: {
        expedition: { petra: 'enemy', envoy: 'ally' },
        petra: { expedition: 'enemy', envoy: 'neutral' },
        envoy: { expedition: 'ally', petra: 'neutral' }
    },

    mechanics: {
        tacticalCards: false,
        recruitment: false,
        // 长关需要一个中途恢复的阀门：营地可花金币补员。
        reinforcement: true,
        // 本关首次开放将领技——百夫长【乘胜】开始生效。
        commanderSkills: true,
        airCommands: false,
        weatherEffects: false,
        morale: true,
        fortifications: true,
        fogOfWar: false,
        alliedVision: false
    },

    aiOpponentCamp: '',
    aiDifficulty: 1.15,
    gold: { expedition: 6, petra: 0, envoy: 0 },
    commanders: { expedition: 'centurion', petra: 'minister' },
    hands: { expedition: [], petra: [], envoy: [] },
    storyCommanders: [
        { id: 'marcus', name: '马库斯', archetype: 'centurion' },
        { id: 'cato', name: '卡托', archetype: 'minister' },
        { id: 'envoy', name: '摄政府特使', portrait: 'npcMale' }
    ],
    collectibles: collectiblesForScenario('bi-05-petra'),

    board: {
        layout: 'borderless',
        radius: 4,
        cities: [
            // 内城高台：半径 1 的七格小城，600 点共享城防——这就是卡托的血条。
            { q: KEEP_CENTER.q, r: KEEP_CENTER.r, radius: 1, districtId: 1, camp: 'petra' },
            // 西门外的前卫营地：补员的落点。
            { q: -8, r: 1, radius: 0, districtId: 2, camp: 'expedition' }
        ],
        surface: [],
        terrain: [
            // 高台下的岩基：把内城垫高，也让南北两侧无法直接绕上去。
            { q: 3, r: -3, type: 'mountain' }, { q: 4, r: -3, type: 'mountain' },
            { q: 4, r: -2, type: 'mountain' }, { q: 1, r: -3, type: 'mountain' },
            { q: 0, r: -2, type: 'mountain' }, { q: 4, r: -1, type: 'mountain' },
            // 外郭瓦砾：倒塌的街区，对远程有掩护，把巷战挤成三条通路。
            { q: -3, r: -1, type: 'forest' }, { q: -3, r: 1, type: 'forest' },
            { q: -2, r: -3, type: 'forest' }, { q: -2, r: 3, type: 'forest' },
            { q: -1, r: -1, type: 'forest' }, { q: -1, r: 1, type: 'forest' },
            { q: 0, r: 3, type: 'forest' }, { q: -1, r: 4, type: 'forest' },
            { q: 2, r: 3, type: 'forest' }, { q: 3, r: 2, type: 'forest' },
            { q: -6, r: -2, type: 'forest' }, { q: -6, r: 3, type: 'forest' },
            // 北缘与南缘的城墙残段
            { q: -5, r: -5, type: 'mountain' }, { q: -3, r: -5, type: 'mountain' },
            { q: -1, r: -5, type: 'mountain' }, { q: 1, r: -5, type: 'mountain' },
            { q: -6, r: 5, type: 'mountain' }, { q: -4, r: 5, type: 'mountain' },
            { q: -2, r: 5, type: 'mountain' }, { q: 0, r: 5, type: 'mountain' }
        ],
        villages: [
            { q: -6, r: 0, districtId: 2 },
            { q: 5, r: 0, districtId: 1 }
        ],
        // 三道街垒：外郭守军蹲在里面，对近战 +25%。正面硬冲要付学费。
        fortifications: [
            { q: -4, r: -2, type: 'trench' },
            { q: -4, r: 0, type: 'trench' },
            { q: -4, r: 2, type: 'trench' },
            { q: -2, r: -2, type: 'trench' },
            { q: -2, r: 2, type: 'trench' }
        ],
        installations: [],
        districts: [],
        rivers: [],
        crossings: [],
        ports: []
    },

    units: [
        // 三个人在 T1 领章、在 BI-02 走驿道，到这里各自定型：
        // 提图斯扛盾成了卫戍，妮娅上了野炮，艾利安还是那个跑得最快的。
        {
            id: 'marcus_assault', type: 'infantry', camp: 'expedition', q: -7, r: 0,
            storyCommander: 'marcus', hpPct: 100, morale: 3, rank: 1, specializationKey: 'assaultInfantry', canAct: true
        },
        { id: 'titus_assault', type: 'infantry', camp: 'expedition', q: -7, r: 1, hpPct: 100, morale: 2, rank: 1, specializationKey: 'garrisonInfantry', canAct: true },
        { id: 'nia_assault', type: 'archer', camp: 'expedition', q: -8, r: 1, hpPct: 100, morale: 2, rank: 1, specializationKey: 'fieldGun', canAct: true },
        { id: 'elian_assault', type: 'cavalry', camp: 'expedition', q: -7, r: -1, hpPct: 95, morale: 2, rank: 1, specializationKey: 'lightCavalry', canAct: true },
        { id: 'expedition_spear_a', type: 'infantry', camp: 'expedition', q: -7, r: 2, hpPct: 100, morale: 2, canAct: true },
        { id: 'expedition_bow_a', type: 'archer', camp: 'expedition', q: -8, r: 0, hpPct: 100, morale: 2, canAct: true },

        // ── 外郭守军（第一幕） ──
        { id: 'ward_spear_n', type: 'infantry', camp: 'petra', q: -4, r: -2, hpPct: 100, morale: 2, canAct: true },
        { id: 'ward_spear_c', type: 'infantry', camp: 'petra', q: -4, r: 0, hpPct: 100, morale: 3, canAct: true },
        { id: 'ward_spear_s', type: 'infantry', camp: 'petra', q: -4, r: 2, hpPct: 100, morale: 2, canAct: true },
        { id: 'ward_bow_n', type: 'archer', camp: 'petra', q: -2, r: -2, hpPct: 100, morale: 2, canAct: true },
        { id: 'ward_bow_s', type: 'archer', camp: 'petra', q: -2, r: 2, hpPct: 100, morale: 2, canAct: true },

        // ── 内城（第二幕） ──
        {
            id: 'cato_boss', type: 'infantry', camp: 'petra', q: 3, r: -1,
            storyCommander: 'cato', hpPct: 100, morale: 3, rank: 2, specializationKey: 'garrisonInfantry', canAct: true
        },
        { id: 'keep_guard_a', type: 'infantry', camp: 'petra', q: 1, r: -1, hpPct: 100, morale: 3, rank: 1, specializationKey: 'garrisonInfantry', canAct: true },
        { id: 'keep_guard_b', type: 'infantry', camp: 'petra', q: 2, r: 0, hpPct: 100, morale: 3, canAct: true },
        { id: 'keep_archer', type: 'archer', camp: 'petra', q: 3, r: -2, hpPct: 100, morale: 3, rank: 1, specializationKey: 'fieldGun', canAct: true }
    ],

    unitGroups: [
        {
            id: 'marcus_section',
            unitIds: ['marcus_assault', 'titus_assault', 'nia_assault', 'elian_assault']
        },
        {
            id: 'assault_force',
            unitIds: [
                'marcus_assault', 'titus_assault', 'nia_assault', 'elian_assault',
                'expedition_spear_a', 'expedition_bow_a'
            ]
        },
        {
            id: 'outer_ward',
            unitIds: ['ward_spear_n', 'ward_spear_c', 'ward_spear_s', 'ward_bow_n', 'ward_bow_s']
        },
        {
            id: 'keep_garrison',
            unitIds: ['cato_boss', 'keep_guard_a', 'keep_guard_b', 'keep_archer']
        }
    ],
    areas: [
        { id: 'barricade_line', tiles: BARRICADES },
        { id: 'inner_keep', tiles: [KEEP_CENTER, { q: 3, r: -1 }, { q: 3, r: -2 }, { q: 2, r: -2 }, { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 2, r: 0 }] },
        { id: 'archive_hall', tiles: [ARCHIVE_TILE] }
    ],
    interactables: [
        {
            id: 'archive_ashes',
            q: ARCHIVE_TILE.q, r: ARCHIVE_TILE.r,
            label: '翻检档案厅的灰',
            enabled: false,
            unitIds: ['marcus_assault', 'elian_assault', 'titus_assault', 'nia_assault'],
            collectibleId: 'bi05_charred_silk'
        }
    ],
    variables: [
        { id: 'evidence_taken', scope: 'campaign', type: 'boolean', initial: false },
        { id: 'ward_cleared', scope: 'level', type: 'boolean', initial: false },
        { id: 'ashes_cold', scope: 'level', type: 'boolean', initial: false }
    ],

    objectives: {
        clear_outer_ward: {
            title: '第一幕：清除外郭街垒',
            detail: '守军蹲在壕里，对近战多两成半防御。绕侧翼、用弓压制，或者付出代价正面推。',
            active: true,
            main: true,
            highlight: { area: 'barricade_line' }
        },
        break_the_keep: {
            title: '第二幕：攻破内城高台',
            detail: '内城七格共享一条城防血池；血池不归零，谁也进不去。卡托就站在里面。',
            active: false,
            main: true,
            highlight: { area: 'inner_keep' }
        },
        reach_the_ashes: {
            title: '第三幕：在火烧尽之前赶到档案厅',
            detail: '特使正在焚档。三个回合之内让马库斯一行踏进档案厅——赶不到，剧情照常，但那半片东西就没了。',
            active: false,
            main: false,
            highlight: { tiles: [ARCHIVE_TILE] }
        }
    },

    triggers: [
        {
            id: 'opening_breach',
            title: '开场：西门缺口',
            enabled: true,
            once: true,
            when: [{ kind: 'timer', value: 900 }],
            do: [
                // 卡托不会战死，也不在第一幕被够到。
                {
                    kind: 'applyEffect', target: { unit: 'cato_boss' }, effectId: 'cato_final_order',
                    name: '佩特拉最后一道命令', desc: '卡托不会在战斗中倒下；逼到极限时，他会自己结束抵抗。', emoji: '⚜️', duration: 0,
                    rule: 'minHp', rulePercent: 1, statMods: { defPct: 15 }
                },
                { kind: 'setUnitState', target: { unit: 'cato_boss' }, state: 'targetable', value: false },
                {
                    kind: 'showStep',
                    text: '围城第三十七天，西门在晨雾里塌了半边。马库斯带前卫穿过缺口。城里没有巷战该有的声音——没有人喊，没有人跑，只有踩碎的瓦。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '百夫长，屋子是空的。锅还在灶上，柴是冷的。'
                },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '东大道上全是车辙，压得很深，往东去的。走了有些日子了。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '所以他们守的是空城。……记下来，别议论。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '街口有壕，三道。守军还在里面。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '壕里的人对着刀多两成半防御。别拿脸去撞——弓手压住，骑兵绕侧，步兵最后进。',
                    next: '__act_one'
                },
                { kind: 'setTriggerEnabled', trigger: 'act_one_brief', enabled: true }
            ]
        },
        {
            id: 'act_one_brief',
            title: '第一幕说明',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__act_one' }],
            do: [
                { kind: 'unlockInput' },
                {
                    kind: 'showStep',
                    text: '前卫已升一衔，百夫长【乘胜】开始生效：命中有机会、击杀必定追加一次行动。西门外的营地可以花金币给伤兵补员。'
                }
            ]
        },

        // ── 卡托的指挥：只要他还在战线上，每个佩特拉回合都给残军加一层据守 ──
        {
            id: 'cato_commands',
            title: '卡托在指挥（每佩特拉回合）',
            enabled: true,
            once: false,
            when: [{ kind: 'turnStarted', camp: 'petra' }],
            do: [
                {
                    kind: 'applyEffect', target: { group: 'keep_garrison' }, effectId: 'cato_hold_order',
                    name: '据守', desc: '尚书还在台上发令：防御提高 15%。', emoji: '⚖️', duration: 1,
                    statMods: { defPct: 15 }
                }
            ]
        },

        {
            id: 'outer_ward_cleared',
            title: '第一幕完成，开启内城',
            enabled: true,
            once: true,
            when: [{ kind: 'groupState', group: 'outer_ward', state: 'allDead' }],
            do: [
                { kind: 'setVariable', variable: 'ward_cleared', operation: 'set', value: true },
                { kind: 'setObjectiveStatus', objective: 'break_the_keep', status: 'active' },
                { kind: 'setObjectiveStatus', objective: 'clear_outer_ward', status: 'completed' },
                { kind: 'setUnitState', target: { unit: 'cato_boss' }, state: 'targetable', value: true },
                { kind: 'setTriggerEnabled', trigger: 'keep_relief', enabled: true },
                {
                    kind: 'showStep',
                    text: '最后一道街垒空了。往东是一道石阶，阶上是内城高台——七格城郭，一条城防，围着一个不肯走的人。'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '年轻人。你们进城的时候，看见门外那条路了吗？它一直通到王都。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '尚书。放下兵器，摄政的讨逆令写得很清楚。'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '写得清楚，不等于写得对。——不过这话你现在听不进去，我也不打算说服你。'
                },
                {
                    kind: 'showStep',
                    text: '内城七格共享一条城防血池：打哪一格都在削同一条血。血池不归零，谁也踏不进去；脱战时它每回合还会回一成。'
                }
            ]
        },
        {
            id: 'keep_relief',
            title: '内城回援：残军从东侧回防',
            enabled: false,
            once: true,
            when: [{ kind: 'turnStarted', camp: 'petra', turn: 1 }],
            do: [
                {
                    kind: 'spawnUnits', units: [
                        { id: 'relief_rider', type: 'cavalry', camp: 'petra', q: 5, r: -1, hpPct: 100, morale: 3, rank: 1, canAct: true },
                        { id: 'relief_spear', type: 'infantry', camp: 'petra', q: 5, r: 1, hpPct: 100, morale: 3, rank: 1, canAct: true }
                    ]
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '东边有人回来了。不多，两队——他们把最后的人也调回来守这堆石头。'
                }
            ]
        },

        {
            id: 'keep_taken',
            title: '第二幕完成：内城被夺，卡托拒俘',
            enabled: true,
            once: true,
            when: [{ kind: 'cityCaptured', q: KEEP_CENTER.q, r: KEEP_CENTER.r, camp: 'expedition' }],
            do: [
                { kind: 'setTriggerEnabled', trigger: 'cato_commands', enabled: false },
                { kind: 'setUnitState', target: { unit: 'cato_boss' }, state: 'canAttack', value: false },
                { kind: 'setUnitState', target: { unit: 'cato_boss' }, state: 'targetable', value: false },
                { kind: 'setObjectiveStatus', objective: 'break_the_keep', status: 'completed' },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '够了。臣不能证明臣的清白——清白不是一件能拿去验的东西。臣只能选一个地方站着。今天，臣站在这里。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '活着受审。你欠这座城一个交代。'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '把我带回去，摄政会替我写一份更体面的交代。别把你的第一场胜仗，交给别人替你讲。',
                    next: '__cato_refuses'
                },
                { kind: 'setTriggerEnabled', trigger: 'cato_refuses', enabled: true }
            ]
        },
        {
            id: 'cato_refuses',
            title: '第三幕开场：特使焚档，倒计时开始',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__cato_refuses' }],
            do: [
                { kind: 'removeUnits', target: { unit: 'cato_boss' }, mode: 'kill' },
                {
                    kind: 'spawnUnits', units: [
                        { id: 'regency_envoy', type: 'infantry', camp: 'envoy', q: 2, r: 2, hpPct: 100, morale: 2, canAct: false, storyCommander: 'envoy' }
                    ]
                },
                { kind: 'setInteractionState', interactable: 'archive_ashes', state: 'available' },
                { kind: 'setObjectiveStatus', objective: 'reach_the_ashes', status: 'active' },
                { kind: 'setTriggerEnabled', trigger: 'ashes_burn_out', enabled: true },
                { kind: 'revealTiles', camp: 'expedition', target: { tiles: [ARCHIVE_TILE] } },
                {
                    kind: 'showStep',
                    text: '卡托没有等人来押他。高台下的抵抗随之散开。午后，一队没有番号的人进了城——为首的出示宰相府文书，说是奉命清查逆案。'
                },
                {
                    kind: 'showStep', speaker: ENVOY,
                    text: '百夫长。档案厅归本使处置，防疫与清算的规矩。你的人守住门口就行。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '里面已经烧过一次了。'
                },
                {
                    kind: 'showStep', speaker: ENVOY,
                    text: '那就烧第二次。烧不干净的东西，最会惹事。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '百夫长，他连死人留下的纸也怕？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '他有王命，我们有刀，动不了他。——但那堆灰是我们先进的门。三个回合，谁离得近谁进去，别踩乱。',
                    highlight: { tiles: [ARCHIVE_TILE] }
                }
            ]
        },
        {
            id: 'ashes_burn_out',
            title: '倒计时：火烧尽，证据没了',
            enabled: false,
            once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 2 }],
            do: [
                { kind: 'setVariable', variable: 'ashes_cold', operation: 'set', value: true },
                { kind: 'setInteractionState', interactable: 'archive_ashes', state: 'disabled' },
                { kind: 'setObjectiveStatus', objective: 'reach_the_ashes', status: 'failed' },
                {
                    kind: 'showStep',
                    text: '前卫赶到门口时，火盆已经凉了。厅里只剩一地白灰，风从塌了的窗洞进来，把灰吹得贴着地跑。'
                },
                {
                    kind: 'showStep', speaker: ENVOY,
                    text: '清查完毕。百夫长，回执我替你写好了——"无违碍"。签个字。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '……给我笔。'
                }
            ]
        },
        {
            id: 'ashes_examined',
            title: '取得残片',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'archive_ashes' }],
            do: [
                { kind: 'setVariable', variable: 'evidence_taken', operation: 'set', value: true },
                { kind: 'setTriggerEnabled', trigger: 'ashes_burn_out', enabled: false },
                { kind: 'setObjectiveStatus', objective: 'reach_the_ashes', status: 'completed' },
                {
                    kind: 'showStep',
                    text: '火盆还热。灰里有半片没燃透的帛书，边缘卷成黑色，只剩一行断句：\n\n“……君侧之人，实非忠良……”'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '像是骂摄政的。也可能是叛军自己写来煽人的。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '两样都可能。收起来，别替它补后半句。'
                },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '教头，门槛上还有一枚章。踩弯了。'
                },
                {
                    kind: 'showStep',
                    text: '铁芯鎏金，五瓣。背面的名字被熏花了，只剩"东境驻军"四个字还认得出来——和驿道上那些编号，是同一批。',
                    next: '__take_the_ashes'
                },
                { kind: 'setTriggerEnabled', trigger: 'take_the_ashes', enabled: true }
            ]
        },
        {
            id: 'take_the_ashes',
            title: '收尾',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__take_the_ashes' }],
            do: [
                {
                    kind: 'showStep',
                    text: '特使站在门口，看着他把那半片纸收进甲衣。没有拦，也没有问。'
                },
                {
                    kind: 'showStep', speaker: ENVOY,
                    text: '百夫长，回执我替你写好了——"清查完毕，无违碍"。签个字。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '……教头，这个要报上去吗？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '给我笔。'
                },
                {
                    kind: 'showStep',
                    text: '他在回执上签了字，四个字和特使写的一样。残片和那枚弯章一起收进甲衣内衬，贴着自己那枚放。\n\n这是他第一次把看见的和写下的分开。'
                }
            ]
        },

        {
            id: 'marcus_falls',
            title: '失败：前卫失去指挥',
            enabled: true,
            once: true,
            when: [{ kind: 'unitKilled', target: { unit: 'marcus_assault' } }],
            do: [
                { kind: 'endScenario', result: 'lose', reason: '前卫百夫长阵亡，内城进攻失去指挥。' }
            ]
        }
    ],

    result: {
        winText: '佩特拉的火熄下去时，东征结束了。马库斯拿到了一座城、一个叛臣，和半片说不清是谁写的纸——胜利第一次有了灰的味道。',
        loseText: '内城未能攻破。',
        eliminateEnemy: false,
        starRules: [
            {
                label: '前卫班底四人无一阵亡',
                when: [{ kind: 'groupState', group: 'marcus_section', state: 'allAlive' }]
            },
            {
                label: '赶在火烧尽之前取得残片',
                when: [{ kind: 'collectibleUnlocked', collectible: 'bi05_charred_silk', unlocked: true }]
            }
        ]
    }
};
