import { getCulturalTerrainStepDelta, getCulturalWaterMovementBonus } from '../../rules/cultures.js';
import { COMMANDER_CONFIG } from '../../rules/commanders.js';
import { HEX_NEIGHBORS } from '../../rules/hex.js';
import { isEmbarkableLandUnit, resolveMovementStep, TRANSPORT_SPEED_CAP } from '../../rules/movement.js';
import { isWaterTile } from '../../rules/surfaces.js';
import { TERRAIN_CONFIG } from '../../rules/terrain.js';

const STEPS_PER_TURN = 12;

// Reverse search once per objective and movement profile. Units and zones of
// control change during the approach; the movement engine validates each actual step.
export function createCaptureRouteFinder(state) {
    const cache = new Map();
    return (unit, goal, from = unit.tile) => {
        if (!from || !goal) return null;
        const speed = Math.max(1, unit.config.speed + (unit._rankPanelSpeedBonus || 0)
            + (COMMANDER_CONFIG[unit.commander]?.definition.spdBonus || 0)
            + (unit.getCampaignEffectMods?.().spdFlat || 0));
        const waterBonus = getCulturalWaterMovementBonus(state, unit.camp);
        const waterSpeed = (isEmbarkableLandUnit(unit) ? Math.min(speed, TRANSPORT_SPEED_CAP) : speed) + waterBonus;
        const key = `${goal.q},${goal.r}:${unit.camp.id}:${unit.type}:${speed}:${unit.commander === 'martyr' && !!unit._martyrPrimed}`;
        let routes = cache.get(key);
        if (!routes) {
            routes = new Map([[goal, { cost: 0, landing: null }]]);
            const buckets = [[goal]];
            for (let cost = 0; cost < buckets.length; cost++) {
                for (const tile of buckets[cost] || []) {
                    const route = routes.get(tile);
                    if (route.cost !== cost) continue;
                    const terrainCost = TERRAIN_CONFIG[tile.terrain]?.stepCost ?? 1;
                    const baseCost = isWaterTile(tile) ? terrainCost : unit.type === 'cpc_guerrilla' ? 1
                        : Math.max(1, terrainCost + getCulturalTerrainStepDelta(state, unit.camp, tile.terrain));
                    for (const [dq, dr] of HEX_NEIGHBORS) {
                        const previous = state.tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                        if (!previous) continue;
                        const step = resolveMovementStep(unit, previous, tile, state, { baseCost });
                        if (!step.allowed) continue;
                        const wasAtSea = isWaterTile(previous);
                        const travel = Math.max(1, Math.ceil(step.cost * STEPS_PER_TURN / (wasAtSea ? waterSpeed : speed)));
                        const nextCost = cost + (step.drainRemaining ? Math.max(travel, STEPS_PER_TURN) : travel);
                        if (nextCost >= (routes.get(previous)?.cost ?? Infinity)) continue;
                        const landing = wasAtSea && !isWaterTile(tile) ? tile : route.landing;
                        routes.set(previous, { cost: nextCost, landing });
                        (buckets[nextCost] ||= []).push(previous);
                    }
                }
            }
            cache.set(key, routes);
        }
        const route = routes.get(from);
        return route ? { turns: route.cost / STEPS_PER_TURN, landing: route.landing } : null;
    };
}
