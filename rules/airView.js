// rules/airView.js — 空军视图（机场、己方/非己方有效防空覆盖与交叠区域）的单一纯规则入口。

import { campToKey } from './camps.js';
import { isFriendly } from './diplomacy.js';
import { isPlayableBoardTile } from './boardLayout.js';
import { hexDistance } from './hex.js';
import { isMechanicEnabled } from './mechanics.js';
import { FLAK_SELF_REDUCTION, getAntiAirUnitProfile, getFieldFortification } from './antiAir.js';
import { getKmtLinkDefenseBonus } from './kmtStronghold.js';
import { getRoyalBattleshipAirReduction, ROYAL_ESCORT_RADIUS } from './naval.js';
import { AIRFIELD_BASE_RANGE, getAirCommandRange } from './airCommands.js';
import { isUnitVisibleToCamp } from './visibility.js';

function tileKeyOf(tile) {
    return `${tile.q},${tile.r}`;
}

function sumCoverageAtTile(targetTile, sources) {
    let total = 0;
    let royalBest = 0;
    for (const source of sources) {
        if (hexDistance(source.tile, targetTile) > source.radius) continue;
        if (source.isRoyalEscort) {
            if (source.reduction > royalBest) royalBest = source.reduction;
        } else {
            total += source.reduction;
        }
    }
    return total + royalBest;
}

/**
 * 解析当前视角下的空军视图数据：
 * - 己方/非己方可见机场及其雾安航程（隐藏敌方上校时不泄露 +2 航程）；
 * - 己方/非己方有效防空源（严格执行「无单位驻守的高射机枪阵地不视为有效防空设施」）；
 * - 己方防空格、非己方防空格、交叠格与两档覆盖强度。
 */
export function resolveAirViewState(state, viewerCamp, options = {}) {
    const isTileVisible = typeof options.isTileVisible === 'function' ? options.isTileVisible : () => true;
    const viewerCampKey = campToKey(viewerCamp);
    const tileMap = state?.tileMap;
    const playableTiles = (state?.tiles || []).filter(tile => tile && isPlayableBoardTile(tile)
        && (!tileMap || tileMap.get(tileKeyOf(tile)) === tile));

    const tileVisible = tile => !state?.skirmishFog || isTileVisible(tile, viewerCamp, state);

    const airfields = [];
    const friendlySources = [];
    const hostileSources = [];
    const fortificationsEnabled = isMechanicEnabled(state, 'fortifications');

    for (const tile of playableTiles) {
        const key = tileKeyOf(tile);

        if (tile.installation?.type === 'airfield') {
            const friendly = isFriendly(state, tile.camp, viewerCampKey);
            if (friendly || tileVisible(tile)) {
                const colonelVisible = friendly || (!!tile.unit && isUnitVisibleToCamp(tile.unit, viewerCamp, state));
                const range = colonelVisible ? getAirCommandRange(tile) : AIRFIELD_BASE_RANGE;
                airfields.push({
                    tile,
                    key,
                    q: tile.q,
                    r: tile.r,
                    campKey: campToKey(tile.camp),
                    isFriendly: friendly,
                    status: tile.installation.status || 'ready',
                    range
                });
            }
        }

        const fort = fortificationsEnabled ? getFieldFortification(tile) : null;
        if (fort?.type === 'flak') {
            const op = tile.unit;
            const hasLivingOp = !!op && (op.hp == null || op.hp > 0);
            if (hasLivingOp && tileVisible(tile) && isUnitVisibleToCamp(op, viewerCamp, state)) {
                const opCampKey = campToKey(op.camp);
                const ownerKnown = fort.ownerKnown !== false && !!fort.campKey;
                if (!ownerKnown || isFriendly(state, fort.campKey, opCampKey)) {
                    const effectiveCampKey = ownerKnown ? fort.campKey : opCampKey;
                    const friendly = isFriendly(state, effectiveCampKey, viewerCampKey);
                    const reduction = FLAK_SELF_REDUCTION + getKmtLinkDefenseBonus(op, state, FLAK_SELF_REDUCTION);
                    if (reduction > 0) {
                        (friendly ? friendlySources : hostileSources).push({
                            kind: 'flak',
                            tile,
                            key,
                            radius: 0,
                            reduction,
                            isRoyalEscort: false
                        });
                    }
                }
            }
        }

        const unit = tile.unit;
        if (unit && unit.hp > 0) {
            const royalReduction = getRoyalBattleshipAirReduction(unit, state);
            const profile = royalReduction > 0
                ? { radius: ROYAL_ESCORT_RADIUS, reduction: royalReduction }
                : getAntiAirUnitProfile(unit);
            if (profile && profile.reduction > 0) {
                const unitCampKey = campToKey(unit.camp);
                const friendly = isFriendly(state, unitCampKey, viewerCampKey);
                if (friendly || (tileVisible(tile) && isUnitVisibleToCamp(unit, viewerCamp, state))) {
                    (friendly ? friendlySources : hostileSources).push({
                        kind: 'unit',
                        tile,
                        key,
                        radius: profile.radius,
                        reduction: profile.reduction,
                        isRoyalEscort: royalReduction > 0
                    });
                }
            }
        }
    }

    const friendlyCells = [];
    const hostileCells = [];
    const overlapCells = [];

    for (const tile of playableTiles) {
        if (!tileVisible(tile)) continue;
        const key = tileKeyOf(tile);
        const friendlyReduction = sumCoverageAtTile(tile, friendlySources);
        const hostileReduction = sumCoverageAtTile(tile, hostileSources);
        const friendlyLevel = friendlyReduction >= 0.50 ? 2 : (friendlyReduction > 0 ? 1 : 0);
        const hostileLevel = hostileReduction >= 0.50 ? 2 : (hostileReduction > 0 ? 1 : 0);

        if (friendlyLevel > 0) {
            friendlyCells.push({ tile, key, q: tile.q, r: tile.r, level: friendlyLevel, reduction: friendlyReduction });
        }
        if (hostileLevel > 0) {
            hostileCells.push({ tile, key, q: tile.q, r: tile.r, level: hostileLevel, reduction: hostileReduction });
        }
        if (friendlyLevel > 0 && hostileLevel > 0) {
            overlapCells.push({ tile, key, q: tile.q, r: tile.r });
        }
    }

    const dedupeSourceTiles = sources => {
        const seen = new Set();
        const result = [];
        for (const source of sources) {
            if (seen.has(source.key)) continue;
            seen.add(source.key);
            result.push({ tile: source.tile, key: source.key });
        }
        return result;
    };

    return {
        airfields,
        friendlyCells,
        hostileCells,
        overlapCells,
        friendlySourceTiles: dedupeSourceTiles(friendlySources),
        hostileSourceTiles: dedupeSourceTiles(hostileSources)
    };
}
