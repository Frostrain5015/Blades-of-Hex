// rules/morale.js — 基础士气及随阵型实时派生的士气惩罚。

function clampMorale(value) {
    return Math.max(0, Math.min(3, Math.round(Number(value) || 0)));
}

export function getBaseMorale(unit) {
    return clampMorale(unit._flankingMoraleBase ?? unit._morale ?? unit.morale);
}

/** Apply a morale award to the base value before positional pressure. */
export function raiseBaseMorale(unit, boostUntil) {
    const base = getBaseMorale(unit);
    if (base === 0 || base === 3) return false;
    const previous = unit.morale;
    unit.morale = base + 1;
    if (base + 1 === 3) unit.moraleBoostUntil = boostUntil;
    return unit.morale !== previous;
}

export function expireMoraleModifiers(unit, round) {
    const previous = unit.morale;
    const base = getBaseMorale(unit);
    if (base === 3 && (unit.moraleBoostUntil || 0) <= round) {
        unit.morale = 2;
        unit.moraleBoostUntil = 0;
    }
    if (unit.moralePenaltyUntil > 0 && unit.moralePenaltyUntil <= round) {
        if (base < 2) unit.morale = 2;
        unit.moralePenaltyUntil = 0;
    }
    return unit.morale !== previous;
}

function writeSituationalMorale(unit, morale) {
    unit._applyingFlankingMorale = true;
    try {
        unit.morale = clampMorale(morale);
    } finally {
        unit._applyingFlankingMorale = false;
    }
}

function clearPositionalMorale(unit) {
    unit._flankingMoraleBase = null;
    unit._flankingMoralePenalty = 0;
    unit._flankingMoraleActivePenalty = 0;
}

/** 清除阵型修正，恢复当前基础士气。 */
export function clearPositionalMoralePenalty(unit) {
    if (!unit) return;
    if (Number.isFinite(unit._flankingMoraleBase)) {
        writeSituationalMorale(unit, unit._flankingMoraleBase);
    }
    clearPositionalMorale(unit);
}

/**
 * 按当前阵型应用夹击(-1)/包围(-2)，解除阵型时立即恢复。
 */
export function applyPositionalMoralePenalty(unit, penalty) {
    if (!unit) return;
    const normalizedPenalty = Math.max(0, Math.min(2, Math.round(Number(penalty) || 0)));
    if (normalizedPenalty === 0) {
        clearPositionalMoralePenalty(unit);
        return;
    }

    unit._flankingMoraleBase = getBaseMorale(unit);
    unit._flankingMoralePenalty = normalizedPenalty;
    unit._flankingMoraleActivePenalty = normalizedPenalty;
    writeSituationalMorale(unit, unit._flankingMoraleBase - normalizedPenalty);
}
