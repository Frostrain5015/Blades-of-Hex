import { deepFreeze } from './freeze.js';
import { getPlayableBoardCoordinates } from './boardLayout.js';
import { HEX_NEIGHBORS } from './hex.js';

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
        installations: [
            { q: -5, r: 0, type: 'airfield', camp: 'player1' },
            { q: 5, r: 0, type: 'airfield', camp: 'player2' }
        ],
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
        installations: [
            { q: -5, r: 0, type: 'airfield', camp: 'player1' },
            { q: -5, r: 5, type: 'airfield', camp: 'player2' },
            { q: 5, r: 0, type: 'airfield', camp: 'player3' }
        ],
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

const coordinateKey = ({ q, r }) => `${q},${r}`;
const identity = ({ q, r }) => ({ q, r });
const rotate180 = ({ q, r }) => ({ q: -q, r: -r });
const rotate120 = ({ q, r }) => ({ q: -q - r, r: q });
const rotate240 = point => rotate120(rotate120(point));

function transformEntries(entries, transform, extras = {}) {
    return entries.map(entry => ({ ...entry, ...transform(entry), ...extras }));
}

function createArchipelagoMap(playerCount) {
    const transforms = playerCount === 3
        ? [identity, rotate120, rotate240]
        : [identity, rotate180];
    const camps = transforms.map((_, index) => `player${index + 1}`);

    // Every player receives the same home island and forward island under the
    // map's exact rotational symmetry. The small detached islands remain neutral.
    const homeLand = [
        { q: -6, r: 0 }, { q: -5, r: 0 }, { q: -6, r: 1 }, { q: -5, r: 1 },
        { q: -6, r: -1 }, { q: -5, r: -1 }, { q: -7, r: 1 }, { q: -4, r: 0 }
    ];
    const forwardLand = [
        { q: -3, r: 3 }, { q: -2, r: 3 }, { q: -3, r: 2 },
        { q: -2, r: 2 }, { q: -4, r: 3 }
    ];
    const steppingLand = [
        { q: -3, r: -2 }, { q: -2, r: -2 }, { q: -3, r: -1 }
    ];
    const centralLand = [
        { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: -1 },
        { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
    ];
    const landKeys = new Set(centralLand.map(coordinateKey));
    for (const transform of transforms) {
        for (const point of [...homeLand, ...forwardLand, ...steppingLand]) {
            landKeys.add(coordinateKey(transform(point)));
        }
    }

    const surface = getPlayableBoardCoordinates({ layout: 'borderless' })
        .filter(point => !landKeys.has(coordinateKey(point)))
        .map(point => ({
            ...point,
            kind: HEX_NEIGHBORS.some(([dq, dr]) => landKeys.has(`${point.q + dq},${point.r + dr}`))
                ? 'shallowWater'
                : 'deepWater'
        }));

    const cities = [];
    const villages = [{ q: 0, r: 1, districtId: 99 }];
    const installations = [];
    const ports = [{ q: 2, r: -1, districtId: 99, landQ: 1, landR: -1 }];
    const initialUnits = [
        { type: 'carrier', camp: 'neutral', q: 2, r: -1 },
        { type: 'destroyer', camp: 'neutral', q: 1, r: -2 },
        { type: 'infantry', camp: 'neutral', q: 0, r: 0 },
        { type: 'archer', camp: 'neutral', q: -1, r: 0 },
        { type: 'infantry', camp: 'neutral', q: 0, r: 1 }
    ];

    transforms.forEach((transform, index) => {
        const camp = camps[index];
        const homeDistrict = index * 2 + 1;
        const forwardDistrict = index * 2 + 2;
        const homeCity = transform({ q: -6, r: 0 });
        const forwardCity = transform({ q: -3, r: 3 });
        cities.push(
            { ...homeCity, districtId: homeDistrict, camp },
            { ...forwardCity, districtId: forwardDistrict, camp }
        );
        villages.push(
            { ...transform({ q: -5, r: -1 }), districtId: homeDistrict },
            { ...transform({ q: -2, r: 2 }), districtId: forwardDistrict },
            { ...transform({ q: -3, r: -2 }), districtId: 99 }
        );
        installations.push({ ...homeCity, type: 'airfield', camp });
        ports.push(
            {
                ...transform({ q: -7, r: 0 }),
                districtId: homeDistrict,
                landQ: homeCity.q,
                landR: homeCity.r
            },
            { ...transform({ q: -3, r: 4 }), districtId: forwardDistrict, landQ: forwardCity.q, landR: forwardCity.r }
        );
        initialUnits.push(
            ...transformEntries([{ type: 'warship', q: -7, r: 0 }], transform, { camp }),
            ...transformEntries([{ type: 'destroyer', q: -3, r: 4 }], transform, { camp }),
            ...transformEntries([{ type: 'submarine', q: -5, r: -2 }], transform, { camp }),
            ...transformEntries([{ type: 'infantry', q: -6, r: 0 }], transform, { camp }),
            ...transformEntries([{ type: 'archer', q: -5, r: 0 }], transform, { camp }),
            ...transformEntries([{ type: 'cavalry', q: -6, r: 1 }], transform, { camp }),
            ...transformEntries([{ type: 'infantry', q: -3, r: 3 }], transform, { camp }),
            ...transformEntries([{ type: 'archer', q: -2, r: 3 }], transform, { camp }),
            ...transformEntries([{ type: 'infantry', q: -3, r: -2 }], transform, { camp: 'neutral' })
        );
    });
    cities.push({ q: 0, r: 0, districtId: 99, camp: 'neutral' });

    return {
        id: `uncharted-passage-${playerCount}p`,
        familyId: 'uncharted-passage',
        name: `无主航路·${playerCount === 3 ? '三人' : '双人'}`,
        captureReward: {
            type: 'neutralForcesTransfer',
            cityQ: 0,
            cityR: 0,
            sourceCamp: 'neutral'
        },
        board: {
            layout: 'borderless',
            radius: BOARD_RADIUS,
            surface,
            cities,
            terrain: [],
            villages,
            fortifications: [],
            installations,
            districts: [],
            ports
        },
        initialUnits
    };
}

TWO_PLAYER_ISLAND.familyId = 'crown-ring';
TWO_PLAYER_ISLAND.name = '王冠环岛·双人';
THREE_PLAYER_ISLAND.familyId = 'crown-ring';
THREE_PLAYER_ISLAND.name = '王冠环岛·三人';

const TWO_PLAYER_ARCHIPELAGO = createArchipelagoMap(2);
const THREE_PLAYER_ARCHIPELAGO = createArchipelagoMap(3);

export const DEFAULT_STANDARD_MAP_ID = 'crown-ring';

export const STANDARD_MAP_FAMILIES = deepFreeze([
    {
        id: 'crown-ring',
        name: '王冠环岛',
        description: '中央大陆 · 陆海并进',
        maps: { 2: TWO_PLAYER_ISLAND, 3: THREE_PLAYER_ISLAND }
    },
    {
        id: 'uncharted-passage',
        name: '无主航路',
        description: '跳岛争夺 · 中立航母',
        maps: { 2: TWO_PLAYER_ARCHIPELAGO, 3: THREE_PLAYER_ARCHIPELAGO }
    }
]);

export const STANDARD_MAP_POOL = deepFreeze({
    2: STANDARD_MAP_FAMILIES.map(family => family.maps[2]),
    3: STANDARD_MAP_FAMILIES.map(family => family.maps[3])
});

export function getStandardMap(playerCount, familyId = DEFAULT_STANDARD_MAP_ID) {
    const family = STANDARD_MAP_FAMILIES.find(entry => entry.id === familyId)
        || STANDARD_MAP_FAMILIES[0];
    return family.maps[Number(playerCount) === 3 ? 3 : 2];
}
