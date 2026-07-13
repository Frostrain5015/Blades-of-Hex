// 染血的鸢尾花 · 第一章「花旗向东」
// BI-05 Boss 关「灰烬作证」
// 同一座佩特拉从马库斯一侧重演。玩家攻破内城，却只能从灰烬、残片与一枚
// 被踩弯的誓章里看见第一道裂缝；这些还不足以让他给任何人定罪。

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';
import { collectiblesForScenario } from './collectibles.js';

const MARCUS = Object.freeze({ name: '马库斯', portrait: 'centurion' });
const CATO = Object.freeze({ name: '卡托', portrait: 'minister' });
const ELIAN = Object.freeze({ name: '艾利安', portrait: 'npcMale' });

export const config = {
    schemaVersion: 2,
    id: 'bi-05-petra',
    title: '灰烬作证',
    displayId: 'BI-05',
    chronicleId: 'blood-iris',
    seed: 0x2505,
    turnLimit: 4,

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
            note: '攻入佩特拉内城的王国东征军前卫',
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
        }
    ],
    turnOrder: ['expedition', 'petra'],
    diplomacy: {
        expedition: { petra: 'enemy' },
        petra: { expedition: 'enemy' }
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
    aiDifficulty: 1.0,
    gold: { expedition: 0, petra: 0 },
    commanders: { expedition: 'centurion', petra: 'minister' },
    hands: { expedition: [], petra: [] },
    storyCommanders: [
        { id: 'marcus', name: '马库斯', archetype: 'centurion' },
        { id: 'cato', name: '卡托', archetype: 'minister' }
    ],
    collectibles: collectiblesForScenario('bi-05-petra'),

    board: {
        radius: 4,
        cities: [
            { q: -4, r: 4, districtId: 1, camp: 'expedition' },
            { q: 2, r: -1, districtId: 2, camp: 'petra' }
        ],
        terrain: [
            { q: -3, r: 2, type: 'forest' },
            { q: -2, r: 1, type: 'forest' },
            { q: -1, r: 0, type: 'forest' },
            { q: 0, r: -2, type: 'mountain' },
            { q: 1, r: -3, type: 'mountain' },
            { q: 2, r: -3, type: 'mountain' },
            { q: 2, r: 0, type: 'forest' }
        ],
        villages: [],
        fortifications: [
            { q: 0, r: -1, type: 'trench' },
            { q: 1, r: -2, type: 'trench' },
            { q: 1, r: 0, type: 'trench' },
            { q: 2, r: -2, type: 'flak' }
        ],
        districts: []
    },

    units: [
        {
            id: 'marcus_assault', type: 'infantry', camp: 'expedition', q: -3, r: 1,
            storyCommander: 'marcus', hpPct: 100, morale: 3, canAct: true
        },
        {
            id: 'titus_assault', type: 'infantry', camp: 'expedition', q: -3, r: 0,
            commander: '', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'nia_assault', type: 'archer', camp: 'expedition', q: -2, r: 0,
            commander: '', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'elian_assault', type: 'cavalry', camp: 'expedition', q: -2, r: 2,
            commander: '', hpPct: 90, morale: 2, canAct: true
        },
        {
            id: 'cato_boss', type: 'infantry', camp: 'petra', q: 1, r: -1,
            storyCommander: 'cato', hpPct: 100, morale: 3, canAct: true
        },
        {
            id: 'petra_wall_guard', type: 'infantry', camp: 'petra', q: 0, r: -1,
            commander: '', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'petra_roof_archer', type: 'archer', camp: 'petra', q: 1, r: -2,
            commander: '', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'petra_last_rider', type: 'cavalry', camp: 'petra', q: 1, r: 0,
            commander: '', hpPct: 85, morale: 1, canAct: true
        }
    ],

    unitGroups: [
        { id: 'marcus_section', unitIds: ['marcus_assault', 'titus_assault', 'nia_assault', 'elian_assault'] },
        { id: 'petra_last_line', unitIds: ['cato_boss', 'petra_wall_guard', 'petra_roof_archer', 'petra_last_rider'] }
    ],
    areas: [
        { id: 'inner_wall', tiles: [{ q: 0, r: -1 }, { q: 1, r: -2 }, { q: 1, r: -1 }, { q: 1, r: 0 }] },
        { id: 'archive_ashes_area', tiles: [{ q: 0, r: 0 }, { q: 1, r: 0 }] }
    ],
    interactables: [
        {
            id: 'archive_ashes', q: 0, r: 0, label: '调查档案厅灰烬', enabled: false,
            unitIds: ['marcus_assault', 'elian_assault'], collectibleId: 'bi05_charred_silk'
        }
    ],
    variables: [
        { id: 'evidence_taken', scope: 'campaign', type: 'boolean', initial: false },
        { id: 'cato_reached', scope: 'level', type: 'boolean', initial: false }
    ],

    objectives: {
        defeat_cato: {
            title: '攻破内城高台',
            detail: '将卡托逼至无法继续指挥。',
            active: true,
            main: true,
            highlight: { unit: 'cato_boss' }
        },
        inspect_ashes: {
            title: '调查档案厅灰烬',
            detail: '让马库斯或艾利安走到高亮的档案厅地块（0,0），找出未燃尽的东西。',
            active: false,
            main: true,
            highlight: { tiles: [{ q: 0, r: 0 }] }
        }
    },

    triggers: [
        {
            id: 'opening_siege', enabled: true, once: true,
            when: [{ kind: 'timer', value: 900 }],
            do: [
                {
                    kind: 'applyEffect', target: { unit: 'cato_boss' }, effectId: 'cato_final_order',
                    name: '佩特拉最后一道命令', desc: '卡托不会在战斗中倒下；逼近极限后，他会自行结束抵抗。', emoji: '⚜️', duration: 0,
                    rule: 'minHp', rulePercent: 1, statMods: { defPct: 15 }
                },
                {
                    kind: 'showStep',
                    text: '围城第三十七天，佩特拉的西门在晨雾里倒下。马库斯带前卫穿过裂口，城里没有凯旋该有的欢呼，只有被踩碎的瓦片和烧焦的纸。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '百夫长，守军退到内城了。那个被叫作“东王”的老头还在高台上。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '他不是一面旗。先把人从工事里赶出来，再谈谁该为这场仗负责。弓手压住高处，骑兵别进窄巷。'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '年轻人，你们走进来的时候，有没有看见城门外那条路？它一直通往王都。可惜有些路走得越正，越不知道自己替谁走。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '尚书，放下兵器。摄政的讨逆令写得很清楚。'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '写得清楚，不等于写得正确。你会明白的——只是别指望我替你明白。'
                }
            ]
        },
        {
            id: 'cato_at_limit', enabled: true, once: true,
            when: [{ kind: 'unitHpCompare', unit: 'cato_boss', mode: 'percent', op: '<=', value: 25 }],
            do: [
                { kind: 'setVariable', variable: 'cato_reached', operation: 'set', value: true },
                { kind: 'setUnitState', target: { unit: 'cato_boss' }, state: 'targetable', value: false },
                { kind: 'setUnitState', target: { unit: 'cato_boss' }, state: 'canAttack', value: false },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '够了。臣不能证明臣的清白——清白不是一张能拿来验真的文书。臣只能选一个地方站着。今天，我站在这里。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '活着受审。你欠这座城一个解释。'
                },
                {
                    kind: 'showStep', speaker: CATO,
                    text: '把我带回去，塞维鲁会替我写一份更好看的解释。别把你的第一场胜仗交给别人替你讲。',
                    next: '__cato_refuses_capture'
                },
                { kind: 'setTriggerEnabled', trigger: 'cato_refuses_capture', enabled: true }
            ]
        },
        {
            id: 'cato_refuses_capture', enabled: false, once: true,
            when: [{ kind: 'eventNextIs', value: '__cato_refuses_capture' }],
            do: [
                { kind: 'removeUnits', target: { unit: 'cato_boss' }, mode: 'kill' },
                { kind: 'setInteractionState', interactable: 'archive_ashes', state: 'available' },
                { kind: 'setObjectiveStatus', objective: 'inspect_ashes', status: 'active' },
                { kind: 'setObjectiveStatus', objective: 'defeat_cato', status: 'completed' },
                {
                    kind: 'showStep',
                    text: '卡托没有等任何人押走他。高台下的抵抗随之散开；午后，一名自称摄政府特使的人进入档案厅，以“防疫与清算逆案”为名，将剩下的卷宗投入火中。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '他们连死人留下的纸也怕？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '进去看看。别踩乱灰。由我或艾利安走到那堆灰上，其他人守住门口。我们至少该知道自己打完了什么。',
                    highlight: { tiles: [{ q: 0, r: 0 }] }
                }
            ]
        },
        {
            id: 'ashes_examined', enabled: true, once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'archive_ashes' }],
            do: [
                { kind: 'setVariable', variable: 'evidence_taken', operation: 'set', value: true },
                {
                    kind: 'showStep',
                    text: '灰烬里有半片没有燃透的帛书，边缘卷成黑色。上面只剩一行断句：\n“……君侧之人，实非忠良……”'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '像是骂摄政的。也可能是叛军自己写来煽动人的。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '两种说法都可能。先收起来，不替它补后半句。'
                },
                {
                    kind: 'showStep',
                    text: '他又在门槛边捡起一枚被踩弯的鸢尾誓章。背面的名字被火熏花了，只剩下“东境驻军”四个字还能辨认。',
                    next: '__take_the_ashes'
                },
                { kind: 'setTriggerEnabled', trigger: 'take_the_ashes', enabled: true }
            ]
        },
        {
            id: 'take_the_ashes', enabled: false, once: true,
            when: [{ kind: 'eventNextIs', value: '__take_the_ashes' }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'inspect_ashes', status: 'completed' }
            ]
        },
        {
            id: 'marcus_falls', enabled: true, once: true,
            when: [{ kind: 'unitKilled', target: { unit: 'marcus_assault' } }],
            do: [{ kind: 'endScenario', result: 'lose', reason: '前卫百夫长阵亡，内城进攻失去指挥。' }]
        }
    ],

    result: {
        winText: '佩特拉的火熄下去时，马库斯把残片和弯折的誓章贴身收好。它们不能证明任何事，却让胜利第一次有了灰烬的味道。',
        loseText: '内城未能攻破。',
        eliminateEnemy: false,
        starRules: [
            {
                label: '前卫小队无人阵亡',
                when: [{ kind: 'groupState', group: 'marcus_section', state: 'allAlive' }]
            },
            {
                label: '全员进入内城工事线',
                when: [{ kind: 'unitsInArea', area: 'inner_wall', camp: 'expedition', op: '>=', value: 4 }]
            }
        ]
    }
};
