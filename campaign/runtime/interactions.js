/**
 * 调查点只响应“指定单位移动到精确地块”。点击地块、区域命中或非指定单位均不完成调查。
 */
export function resolveInteractableMove(config, interactionStates, unitId, targetTile) {
    if (!unitId || !targetTile) return null;
    const item = (config?.interactables || []).find(candidate =>
        candidate.q === targetTile.q
        && candidate.r === targetTile.r
        && interactionStates?.[candidate.id] === 'available');
    if (!item) return null;
    const allowedUnitIds = Array.isArray(item.unitIds) ? item.unitIds : [];
    return {
        item,
        allowed: allowedUnitIds.includes(unitId),
        allowedUnitIds
    };
}
