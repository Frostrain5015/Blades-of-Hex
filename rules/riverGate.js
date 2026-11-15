import { RIVER_VALLEY_GATE } from './maps/river-valley.js';
import { canAttack } from './diplomacy.js';
import { getRoundIndex } from './turns.js';

function axialDistance(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs((a.q + a.r) - (b.q + b.r))) / 2;
}

function riverBankSign(tile) {
    return tile.q + tile.r / 2 < 0.25 ? -1 : 1;
}

export function getRiverGate(state) {
    if (state?.campaignMode || state?.isThreePlayer || state?.standardMapId !== 'river-valley') return null;
    return RIVER_VALLEY_GATE;
}

export function getRiverGateOpenLane(state) {
    return state.riverGate?.openLane === 'north' ? 'north' : 'south';
}

export function isRiverSegmentFlooded(state, segment) {
    const gate = getRiverGate(state);
    if (!gate || segment.riverId !== gate.riverId) return false;
    return getRiverGateOpenLane(state) === 'north'
        ? segment.segmentIndex >= gate.southStart
        : segment.segmentIndex <= gate.northEnd;
}

export function canSwitchRiverGate(state, tile) {
    const gate = getRiverGate(state);
    return !!gate && tile?.q === gate.q && tile.r === gate.r && tile.isCity
        && tile.camp === state.currentCamp && tile.camp?.id !== 'neutral' && !state.gameOver
        && state.riverGate?.changedRound !== getRoundIndex(state);
}

export function switchRiverGate(state, tile) {
    if (!canSwitchRiverGate(state, tile)) return false;
    state.riverGate = {
        openLane: getRiverGateOpenLane(state) === 'north' ? 'south' : 'north',
        changedRound: getRoundIndex(state)
    };
    return true;
}

/**
 * 为 AI 选择当前回合对自身更有利的河谷渡口（'north' 或 'south'）。
 * 综合衡量己方在上下游渡口的跨河推进需求，以及敌方逼近我方城市时的封渡防守收益；
 * 仅当另一侧收益显著高于当前开启侧时才建议换闸，避免无意义反复拉闸。
 */
export function chooseRiverGateLane(state, camp, { isTileKnown = null } = {}) {
    const gate = getRiverGate(state);
    if (!gate || !camp || !Array.isArray(state?.tiles)) return null;
    const current = getRiverGateOpenLane(state);
    const cities = state.tiles.filter(tile => tile.isCity);
    const ownCities = cities.filter(city => city.camp === camp);
    const targetCities = cities.filter(city => city.camp !== camp);
    const lanes = [
        { id: 'north', anchor: { q: 2, r: -5 }, inZone: tile => tile.r <= -2 },
        { id: 'south', anchor: { q: -2, r: 5 }, inZone: tile => tile.r >= 2 }
    ];
    const scoreLane = lane => {
        let score = 0;
        for (const tile of state.tiles) {
            const unit = tile.unit;
            if (!unit || unit.hp <= 0 || unit._isImmobile || unit._isDrone || unit._constructionScaffold) continue;
            if (!lane.inZone(tile)) continue;
            const dist = axialDistance(tile, lane.anchor);
            if (dist > 5) continue;
            const bank = riverBankSign(tile);
            if (unit.camp === camp) {
                const hasCrossTarget = targetCities.some(city =>
                    riverBankSign(city) !== bank && (lane.inZone(city) || city.camp?.id !== 'neutral'));
                if (hasCrossTarget) {
                    score += dist <= 3 ? 5 : 3.5;
                }
            } else if (unit.camp?.id !== 'neutral' && canAttack(state, camp, unit.camp)
                && (!isTileKnown || isTileKnown(tile))) {
                const threatenedCity = ownCities.find(city => riverBankSign(city) !== bank && lane.inZone(city))
                    || ownCities.find(city => riverBankSign(city) !== bank);
                if (threatenedCity) {
                    const vulnerable = threatenedCity.hp <= 0 || !threatenedCity.unit;
                    score -= 4 + (vulnerable ? 2 : 0);
                }
            }
        }
        return score;
    };
    const scores = Object.fromEntries(lanes.map(lane => [lane.id, scoreLane(lane)]));
    const other = current === 'north' ? 'south' : 'north';
    return scores[other] - scores[current] > 1 ? other : current;
}
