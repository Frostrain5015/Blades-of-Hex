import { getPlayableBoardCoordinates } from '../boardLayout.js';
import { hexDistance } from '../hex.js';

const radius = 7;
const westBankQ = r => -Math.ceil(r / 2);
const point = (q, r) => ({ q, r, s: -q - r });
const cities = [
    { q: -5, r: 0, districtId: 1, camp: 'player1' },
    { q: 6, r: 0, districtId: 2, camp: 'player2' },
    { q: 0, r: -3, districtId: 3, camp: 'neutral' },
    { q: 1, r: 3, districtId: 4, camp: 'neutral' },
    { q: 1, r: -1, districtId: 5, camp: 'neutral', hpPct: 60 }
];
const districts = getPlayableBoardCoordinates({ layout: 'hex', radius }).map(({ q, r }) => {
    if (q === cities[4].q && r === cities[4].r) return { q, r, districtId: cities[4].districtId };
    const west = q <= westBankQ(r);
    const [home, town] = west ? [cities[0], cities[2]] : [cities[1], cities[3]];
    const from = point(q, r);
    const districtId = hexDistance(from, point(town.q, town.r)) < hexDistance(from, point(home.q, home.r))
        ? town.districtId : home.districtId;
    return { q, r, districtId };
});

const riverId = 'valley-river';
const points = [];
for (let r = -radius; r <= radius; r++) {
    const q = westBankQ(r);
    points.push({ q, r, vertex: 5 }, { q, r, vertex: 0 });
}
const crossings = [
    { r: -5, kind: 'bridge' },
    { r: -1, kind: 'bridge' },
    { r: 5, kind: 'ford' }
].map(({ r, kind }) => ({ riverId, segmentIndex: 2 * (r + radius), kind }));

export const RIVER_VALLEY_GATE = {
    q: 1, r: -1, riverId,
    northEnd: 2 * (-3 + radius),
    southStart: 2 * (3 + radius)
};

function terrain(type, cells) {
    return cells.map(([q, r]) => ({ q, r, type }));
}

function army(camp, units) {
    return units.map(([type, q, r]) => ({ camp, type, q, r }));
}

export const TWO_PLAYER_RIVER_VALLEY = {
    id: 'river-valley-2p',
    familyId: 'river-valley',
    name: '河谷防线·双人',
    randomTerrain: false,
    board: {
        layout: 'hex',
        radius,
        surface: [],
        cities,
        districts,
        terrain: [
            ...terrain('mountain', [[-1,-5],[0,-5],[1,-6],[4,-6],[5,-5],[6,-5]]),
            ...terrain('forest', [[-2,-4],[-1,-3],[2,-4],[4,-3],[-5,2],[-5,3],[-4,2],[-4,3],[-3,3],[-4,5],[-3,5],[-2,4],[-2,5],[-1,4],[-1,5],[0,4],[0,5],[1,4]])
        ],
        villages: [{ q: -5, r: 1, districtId: 1 }, { q: 5, r: -1, districtId: 2 }],
        fortifications: [],
        installations: cities.slice(0, 2).map(({ q, r, camp }) => ({ q, r, camp, type: 'airfield' })),
        ports: [],
        rivers: [{ id: riverId, width: 'river', points }],
        crossings
    },
    initialUnits: [
        ...army('player1', [['infantry',-5,0],['infantry',-3,-1],['infantry',-4,2],['archer',-2,-2],['archer',-4,1],['cavalry',-4,0]]),
        ...army('player2', [['infantry',6,0],['infantry',4,-1],['infantry',4,1],['archer',4,-2],['archer',5,1],['cavalry',5,0]]),
        ...army('neutral', [['infantry',0,-3],['infantry',1,3],['infantry',1,-1]])
    ]
};
