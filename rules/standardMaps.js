import { deepFreeze } from './freeze.js';
import { getPlayableBoardCoordinates } from './boardLayout.js';

const BOARD_RADIUS = 7;
const ISLAND_RADIUS = 5;

function hexRadius(q, r) {
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
}

function createIslandSurface() {
    return getPlayableBoardCoordinates({ layout: 'borderless' })
        .filter(({ q, r }) => hexRadius(q, r) > ISLAND_RADIUS)
        .map(({ q, r }) => ({
            q,
            r,
            kind: hexRadius(q, r) === ISLAND_RADIUS + 1 ? 'shallowWater' : 'deepWater'
        }));
}

const ISLAND_SURFACE = createIslandSurface();

const TWO_PLAYER_ISLAND = {
    id: 'grand-island-2p',
    name: '环海群岛·双人',
    board: {
        layout: 'borderless',
        radius: BOARD_RADIUS,
        surface: ISLAND_SURFACE,
        cities: [
            { q: -5, r: 0, districtId: 1, camp: 'player1' },
            { q: 5, r: 0, districtId: 2, camp: 'player2' },
            { q: 2, r: -5, districtId: 3, camp: 'neutral' },
            { q: -2, r: 5, districtId: 4, camp: 'neutral' },
            { q: 0, r: 0, districtId: 5, camp: 'neutral' }
        ],
        terrain: [],
        villages: [
            { q: -3, r: 0, districtId: 1 }, { q: -5, r: 3, districtId: 1 },
            { q: 3, r: 0, districtId: 2 }, { q: 5, r: -3, districtId: 2 },
            { q: 4, r: -5, districtId: 3 }, { q: -1, r: -4, districtId: 3 },
            { q: -4, r: 5, districtId: 4 }, { q: 1, r: 4, districtId: 4 },
            { q: 0, r: 2, districtId: 5 }, { q: 0, r: -2, districtId: 5 }
        ],
        fortifications: [],
        districts: [],
        ports: [
            { q: -6, r: 0, districtId: 1, landQ: -5, landR: 0 }, { q: 6, r: 0, districtId: 2, landQ: 5, landR: 0 },
            { q: 2, r: -6, districtId: 3, landQ: 2, landR: -5 }, { q: -2, r: 6, districtId: 4, landQ: -2, landR: 5 }
        ]
    },
    initialUnits: [
        { type: 'warship', camp: 'player1', q: -6, r: 0 },
        { type: 'destroyer', camp: 'player1', q: -5, r: -1 },
        { type: 'submarine', camp: 'player1', q: -6, r: 1 },
        { type: 'warship', camp: 'player2', q: 6, r: 0 },
        { type: 'destroyer', camp: 'player2', q: 5, r: 1 },
        { type: 'submarine', camp: 'player2', q: 6, r: -1 },
        { type: 'destroyer', camp: 'neutral', q: 2, r: -6 },
        { type: 'destroyer', camp: 'neutral', q: -2, r: 6 },
        { type: 'infantry', camp: 'player1', q: -5, r: 0 }, { type: 'infantry', camp: 'player1', q: -4, r: 0 },
        { type: 'infantry', camp: 'player1', q: -5, r: 1 }, { type: 'infantry', camp: 'player1', q: -3, r: -2 },
        { type: 'archer', camp: 'player1', q: -5, r: 2 }, { type: 'archer', camp: 'player1', q: -4, r: -1 },
        { type: 'cavalry', camp: 'player1', q: -4, r: 1 }, { type: 'cavalry', camp: 'player1', q: -3, r: -1 },
        { type: 'infantry', camp: 'player2', q: 5, r: 0 }, { type: 'infantry', camp: 'player2', q: 4, r: 0 },
        { type: 'infantry', camp: 'player2', q: 5, r: -1 }, { type: 'infantry', camp: 'player2', q: 3, r: 2 },
        { type: 'archer', camp: 'player2', q: 5, r: -2 }, { type: 'archer', camp: 'player2', q: 4, r: 1 },
        { type: 'cavalry', camp: 'player2', q: 4, r: -1 }, { type: 'cavalry', camp: 'player2', q: 3, r: 1 },
        { type: 'infantry', camp: 'neutral', q: 0, r: 0 },
        { type: 'infantry', camp: 'neutral', q: 2, r: -5 }, { type: 'infantry', camp: 'neutral', q: -2, r: 5 },
        { type: 'infantry', camp: 'neutral', q: 2, r: -4 }, { type: 'infantry', camp: 'neutral', q: -2, r: 4 },
        { type: 'archer', camp: 'neutral', q: 3, r: -5 }, { type: 'archer', camp: 'neutral', q: -3, r: 5 },
        { type: 'cavalry', camp: 'neutral', q: -1, r: 1 }, { type: 'cavalry', camp: 'neutral', q: 1, r: -1 }
    ]
};

const THREE_PLAYER_ISLAND = {
    id: 'grand-island-3p',
    name: '环海群岛·三人',
    board: {
        layout: 'borderless',
        radius: BOARD_RADIUS,
        surface: ISLAND_SURFACE,
        cities: [
            { q: -5, r: 0, districtId: 1, camp: 'player1' }, { q: 0, r: -5, districtId: 2, camp: 'player1' },
            { q: -5, r: 5, districtId: 3, camp: 'player2' }, { q: 0, r: 5, districtId: 4, camp: 'player2' },
            { q: 5, r: 0, districtId: 6, camp: 'player3' }, { q: 5, r: -5, districtId: 7, camp: 'player3' },
            { q: 0, r: 0, districtId: 5, camp: 'neutral' }
        ],
        terrain: [],
        villages: [
            { q: -3, r: 0, districtId: 1 }, { q: 0, r: -3, districtId: 2 },
            { q: -3, r: 3, districtId: 3 }, { q: 0, r: 3, districtId: 4 },
            { q: 3, r: 0, districtId: 6 }, { q: 3, r: -3, districtId: 7 }
        ],
        fortifications: [],
        districts: [],
        ports: [
            { q: -6, r: 0, districtId: 1, landQ: -5, landR: 0 }, { q: 0, r: -6, districtId: 2, landQ: 0, landR: -5 },
            { q: -6, r: 6, districtId: 3, landQ: -5, landR: 5 }, { q: 0, r: 6, districtId: 4, landQ: 0, landR: 5 },
            { q: 6, r: 0, districtId: 6, landQ: 5, landR: 0 }, { q: 6, r: -6, districtId: 7, landQ: 5, landR: -5 }
        ]
    },
    initialUnits: [
        { type: 'warship', camp: 'player1', q: -6, r: 0 }, { type: 'warship', camp: 'player1', q: 0, r: -6 },
        { type: 'destroyer', camp: 'player1', q: -5, r: -1 }, { type: 'submarine', camp: 'player1', q: -6, r: 1 },
        { type: 'destroyer', camp: 'player1', q: 1, r: -6 }, { type: 'submarine', camp: 'player1', q: -1, r: -5 },
        { type: 'warship', camp: 'player2', q: -6, r: 6 }, { type: 'warship', camp: 'player2', q: 0, r: 6 },
        { type: 'destroyer', camp: 'player2', q: -6, r: 5 }, { type: 'submarine', camp: 'player2', q: -5, r: 6 },
        { type: 'destroyer', camp: 'player2', q: -1, r: 6 }, { type: 'submarine', camp: 'player2', q: 1, r: 5 },
        { type: 'warship', camp: 'player3', q: 6, r: 0 }, { type: 'warship', camp: 'player3', q: 6, r: -6 },
        { type: 'destroyer', camp: 'player3', q: 5, r: 1 }, { type: 'submarine', camp: 'player3', q: 6, r: -1 },
        { type: 'destroyer', camp: 'player3', q: 6, r: -5 }, { type: 'submarine', camp: 'player3', q: 5, r: -6 },
        { type: 'infantry', camp: 'player1', q: -5, r: 0 }, { type: 'infantry', camp: 'player1', q: 0, r: -5 },
        { type: 'infantry', camp: 'player1', q: -4, r: 0 }, { type: 'infantry', camp: 'player1', q: 0, r: -4 },
        { type: 'archer', camp: 'player1', q: -4, r: -1 }, { type: 'archer', camp: 'player1', q: 1, r: -5 },
        { type: 'cavalry', camp: 'player1', q: -3, r: -1 }, { type: 'cavalry', camp: 'player1', q: 1, r: -4 },
        { type: 'infantry', camp: 'player2', q: -5, r: 5 }, { type: 'infantry', camp: 'player2', q: 0, r: 5 },
        { type: 'infantry', camp: 'player2', q: 0, r: 4 }, { type: 'infantry', camp: 'player2', q: -4, r: 4 },
        { type: 'archer', camp: 'player2', q: -1, r: 5 }, { type: 'archer', camp: 'player2', q: -5, r: 4 },
        { type: 'cavalry', camp: 'player2', q: -1, r: 4 }, { type: 'cavalry', camp: 'player2', q: -4, r: 3 },
        { type: 'infantry', camp: 'player3', q: 5, r: 0 }, { type: 'infantry', camp: 'player3', q: 5, r: -5 },
        { type: 'infantry', camp: 'player3', q: 4, r: -4 }, { type: 'infantry', camp: 'player3', q: 4, r: 0 },
        { type: 'archer', camp: 'player3', q: 5, r: -4 }, { type: 'archer', camp: 'player3', q: 4, r: 1 },
        { type: 'cavalry', camp: 'player3', q: 4, r: -3 }, { type: 'cavalry', camp: 'player3', q: 3, r: 1 },
        { type: 'infantry', camp: 'neutral', q: 0, r: 0 },
        { type: 'infantry', camp: 'neutral', q: 2, r: -2 }, { type: 'infantry', camp: 'neutral', q: 0, r: 2 },
        { type: 'infantry', camp: 'neutral', q: -2, r: 0 },
        { type: 'archer', camp: 'neutral', q: 1, r: -1 }, { type: 'archer', camp: 'neutral', q: 0, r: 1 },
        { type: 'archer', camp: 'neutral', q: -1, r: 0 }
    ]
};

export const STANDARD_MAP_POOL = deepFreeze({ 2: [TWO_PLAYER_ISLAND], 3: [THREE_PLAYER_ISLAND] });

export function getStandardMap(playerCount) {
    return STANDARD_MAP_POOL[Number(playerCount) === 3 ? 3 : 2][0];
}
