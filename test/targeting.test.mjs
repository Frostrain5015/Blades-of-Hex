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
        factions: { player1: camps.player1, player2: camps.player2 },
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

const defendedEnemyCity = tile(2, 0, { isCity: true, camp: camps.player2, hp: 300, maxHp: 300 });
const breachedEnemyCity = tile(3, 0, { isCity: true, camp: camps.player2, hp: 0, maxHp: 300 });
const cityGs = state([own, defendedEnemyCity, breachedEnemyCity], {
    diplomacy: {
        player1: { player2: 'enemy' },
        player2: { player1: 'enemy' }
    }
});
preview = resolveTargetingPreview(cityGs, { cardId: 'airdrop', targeting: 'emptyTile' });
assert.equal(isResolvedTargetingCandidate(preview, defendedEnemyCity), false, '未破城不得空降偷城');
assert.equal(isResolvedTargetingCandidate(preview, breachedEnemyCity), true, '城市HP归零后允许空降占领');

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

const airfield = tile(0, 0, {
    isCity: true,
    camp: camps.player1,
    installation: { type: 'airfield', status: 'ready' }
});
const airfieldNear = tile(5, 0, { unit: unit('airfield-near', camps.player2) });
const airfieldFar = tile(6, 0, { unit: unit('airfield-far', camps.player2) });
gs = state([airfield, airfieldNear, airfieldFar]);
preview = resolveTargetingPreview(gs, {
    cardId: 'air_command_strafe', targeting: 'enemyGlobal', launcherQ: 0, launcherR: 0
});
assert.equal(isResolvedTargetingCandidate(preview, airfieldNear), true);
assert.equal(isResolvedTargetingCandidate(preview, airfieldFar), false);
assert.equal(preview.air.rangeTileKeys.has('0,0'), true, '机场航程圈应包含起点');
assert.equal(preview.air.rangeTileKeys.has('5,0'), true, '机场航程圈应覆盖有效航程');
assert.equal(preview.air.rangeTileKeys.has('6,0'), false, '机场航程圈不应越过实际航程');

// 机场扫射可指定无驻军但HP>0的敌方/中立空城市（削减城市HP）
const strafeCity = tile(4, 0, { isCity: true, camp: camps.player2, hp: 300, maxHp: 300 });
const strafeUrban = tile(4, -1, { isUrban: true, urbanCenterKey: '4,0', camp: camps.player2, hp: 300, maxHp: 300 });
const strafeCityDead = tile(4, 1, { isCity: true, camp: camps.player2, hp: 0, maxHp: 300 });
const strafeOwnCity = tile(3, 1, { isCity: true, camp: camps.player1, hp: 300, maxHp: 300 });
gs = state([airfield, strafeCity, strafeUrban, strafeCityDead, strafeOwnCity], {
    diplomacy: {
        player1: { player2: 'enemy' },
        player2: { player1: 'enemy' }
    }
});
preview = resolveTargetingPreview(gs, {
    cardId: 'air_command_strafe', targeting: 'enemyGlobal', launcherQ: 0, launcherR: 0
});
assert.equal(isResolvedTargetingCandidate(preview, strafeCity), true, '扫射可指定HP>0的空敌城');
assert.equal(isResolvedTargetingCandidate(preview, strafeUrban), true, '扫射可指定HP>0的敌城城郭格');
assert.equal(isResolvedTargetingCandidate(preview, strafeCityDead), false, 'HP=0的破城不再是扫射目标');
assert.equal(isResolvedTargetingCandidate(preview, strafeOwnCity), false, '己方城市不是扫射目标');

gs = state([colonelTile, nearEnemy, farEnemy, nearEmpty, farEmpty], {
    _colonelDeployed: { player1: true }
});
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

const defendedAirliftCity = tile(3, 0, { isCity: true, camp: camps.player2, hp: 300, maxHp: 300 });
const breachedAirliftCity = tile(4, 0, { isCity: true, camp: camps.player2, hp: 0, maxHp: 300 });
gs.tiles.push(defendedAirliftCity, breachedAirliftCity);
gs.tileMap.set('3,0', defendedAirliftCity);
gs.tileMap.set('4,0', breachedAirliftCity);
gs.diplomacy = {
    player1: { player2: 'enemy' },
    player2: { player1: 'enemy' }
};
preview = resolveTargetingPreview(gs, { cardId: 'airlift_dest', targeting: 'emptyTile' });
assert.equal(isResolvedTargetingCandidate(preview, defendedAirliftCity), false, '未破城不得空运偷城');
assert.equal(isResolvedTargetingCandidate(preview, breachedAirliftCity), true, '城市HP归零后允许空运占领');

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
