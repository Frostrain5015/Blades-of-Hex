import { getPlayableBoardCoordinates } from '../../../rules/boardLayout.js';

// Keep the fixture tied to the real borderless board contract: only fully
// playable cells enter the scenario; partial edge cells remain render-only.
const EASTERN_SEA = getPlayableBoardCoordinates({ layout: 'borderless' })
    .filter(({ q }) => q >= 4)
    .map(({ q, r }) => ({
        q,
        r,
        kind: q <= 5 ? 'shallowWater' : 'deepWater'
    }));

const riverPoints = values => values.map(([q, r, vertex]) => ({ q, r, vertex }));

const MAIN_RIVER = riverPoints([
    [-5, -4, 4], [-5, -4, 5], [-5, -4, 0], [-5, -4, 1],
    [-5, -3, 2], [-5, -3, 1],
    [-4, -3, 2], [-4, -3, 1],
    [-3, -3, 2], [-3, -3, 1],
    [-2, -3, 2], [-2, -3, 1],
    [-1, -3, 2], [-1, -3, 1],
    [0, -3, 2], [0, -3, 1],
    [1, -3, 2], [1, -3, 1],
    [2, -3, 2], [2, -3, 1],
    [3, -3, 2], [3, -3, 1]
]);

const SOUTH_STREAM = riverPoints([
    [-7, 1, 4], [-7, 1, 5], [-7, 1, 0], [-7, 1, 1],
    [-7, 2, 2], [-7, 2, 1],
    [-6, 2, 2], [-6, 2, 1],
    [-5, 2, 2], [-5, 2, 1],
    [-4, 2, 2], [-4, 2, 1],
    [-3, 2, 2], [-3, 2, 1],
    [-2, 2, 2], [-2, 2, 1],
    [-1, 2, 2], [-1, 2, 1],
    [0, 2, 2], [0, 2, 1],
    [1, 2, 2], [1, 2, 1],
    [2, 2, 2], [2, 2, 1],
    [3, 2, 2], [3, 2, 1]
]);

export const config = {
    schemaVersion: 3,
    id: 'visual-qa-all-effects',
    title: '全域视觉验收场',
    displayId: 'VQA-01',
    chronicleId: 'visual-qa',
    seed: 0x7a11,
    turnLimit: 0,
    intro: {
        campaignTitle: '开发者视觉验收',
        chapterTitle: '常驻实验场',
        scenarioSubtitle: 'VQA-01 全域视觉验收场'
    },
    weather: 'cycle',
    localPlayerCamp: 'player1',
    factions: [
        {
            id: 'player1', name: '赤旗验收军', note: '玩家控制；移动、技能与卡牌验收',
            color: 'red', flagUrl: 'img/flags/aurelia-kingdom.svg', flagAlt: '赤旗验收军旗',
            controller: 'human', participatesInTurns: true, active: true
        },
        {
            id: 'player2', name: '紫旗靶标军', note: '近战、远程与防空靶标',
            color: 'purple', flagUrl: 'img/flags/aurelia-regency.svg', flagAlt: '紫旗靶标军旗',
            controller: 'scripted', participatesInTurns: true, active: true
        },
        {
            id: 'player3', name: '金旗观察军', note: '第三阵营与外交关系颜色验收',
            color: 'yellow', flagUrl: 'img/flags/petra-autonomy.svg', flagAlt: '金旗观察军旗',
            controller: 'scripted', participatesInTurns: true, active: true
        }
    ],
    turnOrder: ['player1', 'player2', 'player3'],
    diplomacy: {
        player1: { player2: 'enemy', player3: 'enemy' },
        player2: { player1: 'enemy', player3: 'neutral' },
        player3: { player1: 'enemy', player2: 'neutral' }
    },
    mechanics: {
        tacticalCards: true,
        recruitment: true,
        reinforcement: true,
        commanderSkills: true,
        weatherEffects: true,
        morale: true,
        fortifications: true,
        fogOfWar: false,
        alliedVision: false
    },
    aiOpponentCamp: '',
    aiDifficulty: 1,
    gold: { player1: 99, player2: 0, player3: 0 },
    // Deliberately excludes colonel so the ordinary tactical-card contract is
    // never replaced by its aircraft-specific hand.
    commanders: { player1: 'diplomat', player2: 'ironGuard', player3: 'priest' },
    hands: {
        player1: ['airstrike', 'heal', 'forceMarch', 'shield'],
        player2: [],
        player3: []
    },
    storyCommanders: [],
    collectibles: [],
    board: {
        layout: 'borderless',
        radius: 4,
        cities: [
            {
                q: -6,
                r: -2,
                districtId: 101,
                camp: 'player1',
                footprint: [
                    { q: -5, r: -2 }, { q: -6, r: -1 }, { q: -7, r: -1 },
                    { q: -7, r: -2 }, { q: -6, r: -3 }, { q: -5, r: -3 }
                ]
            },
            { q: 0, r: -6, districtId: 202, camp: 'player2' },
            { q: -8, r: 5, districtId: 303, camp: 'player3' }
        ],
        surface: EASTERN_SEA,
        terrain: [
            { q: 1, r: -5, type: 'mountain' },
            { q: 2, r: -6, type: 'mountain' },
            { q: 3, r: -6, type: 'mountain' },
            { q: 2, r: -5, type: 'mountain' },
            { q: 3, r: -5, type: 'mountain' },
            { q: 2, r: -4, type: 'mountain' },
            { q: 3, r: -4, type: 'mountain' },
            { q: -5, r: 2, type: 'forest' },
            { q: -4, r: 2, type: 'forest' },
            { q: -5, r: 3, type: 'forest' },
            { q: -4, r: 3, type: 'forest' },
            { q: -3, r: 3, type: 'forest' },
            { q: -4, r: 4, type: 'forest' },
            { q: -3, r: 4, type: 'forest' }
        ],
        villages: [
            { q: -8, r: -2, districtId: 101 },
            { q: -1, r: -5, districtId: 202 },
            { q: -7, r: 4, districtId: 303 }
        ],
        fortifications: [
            { q: -1, r: 0, type: 'trench' },
            { q: -2, r: -1, type: 'trench' },
            { q: 1, r: -2, type: 'flak' },
            { q: 2, r: -2, type: 'flak' }
        ],
        districts: [],
        rivers: [
            { id: 'qa-main', width: 'river', points: MAIN_RIVER, navigable: false },
            { id: 'qa-stream', width: 'stream', points: SOUTH_STREAM, navigable: false }
        ],
        crossings: [
            { riverId: 'qa-main', segmentIndex: 10, kind: 'bridge' },
            { riverId: 'qa-stream', segmentIndex: 14, kind: 'ford' }
        ],
        ports: [{ q: 3, r: 0 }, { q: 3, r: 3 }]
    },
    units: [
        {
            id: 'qa_move_cavalry', type: 'cavalry', camp: 'player1', q: -4, r: 0,
            commander: 'diplomat', hpPct: 100, morale: 3, canAct: true
        },
        {
            id: 'qa_melee_source', type: 'infantry', camp: 'player1', q: -2, r: 0,
            commander: 'engineer', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'qa_ranged_source', type: 'archer', camp: 'player1', q: -2, r: 2,
            hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'qa_buff_target', type: 'infantry', camp: 'player1', q: -3, r: 1,
            hpPct: 55, morale: 1, canAct: true
        },
        {
            id: 'qa_drone', type: 'drone', camp: 'player1', q: -5, r: 0,
            hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'qa_player_ship', type: 'warship', camp: 'player1', q: 5, r: 0,
            hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'qa_melee_target', type: 'infantry', camp: 'player2', q: -1, r: 0,
            commander: 'ironGuard', hpPct: 100, morale: 3, canAct: true
        },
        {
            id: 'qa_ranged_target', type: 'cavalry', camp: 'player2', q: 0, r: 2,
            hpPct: 75, morale: 1, canAct: true
        },
        {
            id: 'qa_aa_archer', type: 'archer', camp: 'player2', q: 0, r: -1,
            hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'qa_flak_nest', type: 'mgNest', camp: 'player2', q: 1, r: -2,
            hpPct: 100, morale: 2, canAct: false
        },
        {
            id: 'qa_enemy_ship', type: 'warship', camp: 'player2', q: 7, r: 0,
            hpPct: 85, morale: 2, canAct: true
        },
        {
            id: 'qa_third_commander', type: 'infantry', camp: 'player3', q: 1, r: 2,
            commander: 'priest', hpPct: 65, morale: 3, canAct: true
        },
        {
            id: 'qa_third_archer', type: 'archer', camp: 'player3', q: 2, r: 1,
            hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'qa_third_ship', type: 'warship', camp: 'player3', q: 7, r: -2,
            hpPct: 100, morale: 2, canAct: true
        }
    ],
    unitGroups: [],
    areas: [],
    interactables: [],
    variables: [],
    objectives: {},
    triggers: [],
    result: {
        winText: '视觉验收结束。',
        loseText: '视觉验收重置。',
        eliminateEnemy: false,
        starRules: []
    }
};
