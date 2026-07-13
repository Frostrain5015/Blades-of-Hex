// 目标级常驻高亮解析器。配置只保存稳定引用；每一帧从当前棋盘解析单位位置，
// 因此单位移动后光圈会自然跟随，目标离开 active 状态后也会立即消失。
export function resolveActiveObjectiveHighlightTiles(config, objectiveStates, tileMap) {
    if (!config?.objectives || !(tileMap instanceof Map)) return [];

    const resolved = [];
    const seen = new Set();
    const areas = new Map((config.areas || []).map(area => [area.id, area]));
    const addCoord = (q, r) => {
        const key = `${q},${r}`;
        if (seen.has(key)) return;
        const tile = tileMap.get(key);
        if (!tile) return;
        seen.add(key);
        resolved.push(tile);
    };
    const addUnit = (unitId) => {
        if (!unitId) return;
        for (const tile of tileMap.values()) {
            if (tile?.unit?.id !== unitId) continue;
            addCoord(tile.q, tile.r);
            return;
        }
    };

    for (const [objectiveId, objective] of Object.entries(config.objectives)) {
        const state = objectiveStates?.[objectiveId] || (objective?.active === false ? 'hidden' : 'active');
        if (state !== 'active') continue;
        const highlight = objective?.highlight;
        if (!highlight || typeof highlight !== 'object') continue;

        addUnit(highlight.unit);
        for (const point of (highlight.tiles || [])) addCoord(point.q, point.r);
        const area = areas.get(highlight.area);
        for (const point of (area?.tiles || [])) addCoord(point.q, point.r);
    }

    return resolved;
}
