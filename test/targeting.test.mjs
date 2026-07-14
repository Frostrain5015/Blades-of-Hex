import assert from 'node:assert/strict';
import {
    resolveTargetingPreview,
    isResolvedTargetingCandidate,
    TARGET_INTENTS,
    TARGET_SHAPES
} from '../rules/targeting.js';

const camps = {
    player1: { id: 'player1', name: '甲' },
    player2: { id: 'player2', name: '乙' }
};

function tile(q, r, extra = {}) {
    return { q, r, s: -q - r, x: q * 50, y: r * 50, terrain: 'plain', ...extra };
}

function unit(id, camp, extra = {}) {
    return { id, camp, type: 'infantry', hp: 100, canAct: true, ...extra };
}

function state(tiles, extra = {}) {
    const tileMap = new Map(tiles.map(t => [`${t.q},${t.r}`, t]));
    for (const t of tiles) if (t.unit) t.unit.tile = t;
    return {
        tiles,
        tileMap,
        currentCamp: camps.player1,
        skirmishFog: false,
        weather: 'clear',
        mechanics: { weatherEffects: true, fortifications: true },
        ...extra
    };
}

const own = tile(0, 0, { unit: unit('own', camps.player1) });
const enemy = tile(1, 0, { unit: unit('enemy', camps.player2) });
const empty = tile(0, 1);
const occupied = tile(-1, 1, { unit: unit('occupied', camps.player1) });
let gs = state([own, enemy, empty, occupied]);

let preview = resolveTargetingPreview(gs, { cardId: 'airdrop', targeting: 'emptyTile' });
assert.equal(preview.intent, TARGET_INTENTS.TRANSPORT);
assert.equal(preview.shape, TARGET_SHAPES.TILE);
assert.equal(isResolvedTargetingCandidate(preview, empty), true);
assert.equal(isResolvedTargetingCandidate(preview, occupied), false, 'emptyTile 必须排除占用格');

own.unit.commander = 'paladin';
preview = resolveTargetingPreview(gs, { cardId: 'commanderDeploy', targeting: 'friendlyAny' });
assert.equal(preview.intent, TARGET_INTENTS.ATTACH);
assert.equal(isResolvedTargetingCandidate(preview, own), false, '已有将领单位不得再次挂载');
assert.equal(isResolvedTargetingCandidate(preview, occupied), true);

preview = resolveTargetingPreview(gs, { cardId: 'heal', targeting: 'anyUnit' });
assert.equal(preview.intent, TARGET_INTENTS.HEAL);
assert.equal(isResolvedTargetingCandidate(preview, enemy), true, '疗愈沿用 anyUnit 的真实敌我皆可契约');

const colonelTile = tile(0, 0, { unit: unit('colonel', camps.player1, { commander: 'colonel' }) });
const nearEnemy = tile(6, 0, { unit: unit('near', camps.player2) });
const farEnemy = tile(7, 0, { unit: unit('far', camps.player2) });
const nearEmpty = tile(0, 6);
const farEmpty = tile(0, 7);
gs = state([colonelTile, nearEnemy, farEnemy, nearEmpty, farEmpty], {
    _colonelDeployed: { player1: true }
});

preview = resolveTargetingPreview(gs, { cardId: 'diveStrafe', targeting: 'enemyGlobal' });
assert.equal(isResolvedTargetingCandidate(preview, nearEnemy), true);
assert.equal(isResolvedTargetingCandidate(preview, farEnemy), false);
assert.equal(preview.air.colonelOriginUnitId, 'colonel');

preview = resolveTargetingPreview(gs, { cardId: 'airstrike', targeting: 'enemyGlobal' });
assert.equal(isResolvedTargetingCandidate(preview, farEnemy), true, '普通空袭不受上校航程限制');
assert.equal(preview.air.colonelOriginUnitId, undefined, '普通空袭不得伪造上校起点');
assert.equal(preview.air.rangeTileKeys.size, 0);

colonelTile.unit._imprisoned = false;
preview = resolveTargetingPreview(gs, { cardId: 'airlift', targeting: 'friendlyAny' });
assert.equal(isResolvedTargetingCandidate(preview, colonelTile), false, '空运不得运送上校自身');

const cargoTile = tile(1, 0, { unit: unit('cargo', camps.player1) });
const prisonTile = tile(2, 0, { unit: unit('prison', camps.player1, { _imprisoned: true }) });
gs.tiles.push(cargoTile, prisonTile);
gs.tileMap.set('1,0', cargoTile);
gs.tileMap.set('2,0', prisonTile);
cargoTile.unit.tile = cargoTile;
prisonTile.unit.tile = prisonTile;
preview = resolveTargetingPreview(gs, { cardId: 'airlift', targeting: 'friendlyAny' });
assert.equal(isResolvedTargetingCandidate(preview, cargoTile), true);
assert.equal(isResolvedTargetingCandidate(preview, prisonTile), false);

gs._airliftTarget = { unitId: 'cargo' };
preview = resolveTargetingPreview(gs, { cardId: 'airlift_dest', targeting: 'emptyTile' });
assert.equal(isResolvedTargetingCandidate(preview, nearEmpty), true);
assert.equal(isResolvedTargetingCandidate(preview, farEmpty), false);

gs.weather = 'fog';
preview = resolveTargetingPreview(gs, { cardId: 'airdrop', targeting: 'emptyTile' });
assert.equal(preview.candidateTileKeys.size, 0, '开启天气机制时雾天所有空军卡停飞');
assert.equal(preview.air.grounded, true);

const tianyanTile = tile(0, 0, { unit: unit('tianyan', camps.player1, { commander: 'tianyan' }) });
const droneNear = tile(1, 0);
const droneFar = tile(2, 0);
const mountain = tile(0, 1, { terrain: 'mountain' });
gs = state([tianyanTile, droneNear, droneFar, mountain]);
preview = resolveTargetingPreview(gs, { cardId: 'drone_deploy', targeting: 'emptyTile' });
assert.equal(isResolvedTargetingCandidate(preview, droneNear), true);
assert.equal(isResolvedTargetingCandidate(preview, droneFar), false);
assert.equal(isResolvedTargetingCandidate(preview, mountain), false);

const engineerTile = tile(0, 0, { unit: unit('eng', camps.player1, { commander: 'engineer' }) });
const adjacent = tile(1, 0);
const same = tile(0, 0);
const village = tile(0, 1, { isVillage: true });
gs = state([engineerTile, adjacent, village]);
preview = resolveTargetingPreview(gs, {
    cardId: 'engineer_bunker', targeting: 'emptyTile', engineerUnitId: 'eng'
});
assert.equal(isResolvedTargetingCandidate(preview, adjacent), true);
assert.equal(isResolvedTargetingCandidate(preview, same), false);
assert.equal(isResolvedTargetingCandidate(preview, village), false);

gs = state([tile(0, 0), tile(1, 0), tile(0, 1)], {
    skirmishFog: true
});
preview = resolveTargetingPreview(gs, { cardId: 'scout', targeting: 'anyTileGlobal' }, {
    hoveredTile: gs.tiles[0],
    isTileVisible: () => false
});
assert.equal(preview.candidateTileKeys.size, 3, '侦察中心允许选未显形真实格');
assert.equal(preview.affectedTileKeys.size, 3, '范围集合只包含真实棋盘格');

console.log('targeting resolver tests passed');
