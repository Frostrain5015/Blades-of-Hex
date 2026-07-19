// rules/morale.js — 夹击/包围产生的事件型士气惩罚；不依赖渲染与全局 gameState。

export const POSITIONAL_MORALE_RECOVERY_ROUNDS = 3;

function clampMorale(value) {
    return Math.max(0, Math.min(3, Math.round(Number(value) || 0)));
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
    unit._flankingMoraleRecoveryUntil = 0;
}

/** 免疫/净化来源立即移除阵型士气事件，不进入三回合恢复期。 */
export function clearPositionalMoralePenalty(unit) {
    if (!unit) return;
    if (Number.isFinite(unit._flankingMoraleBase)) {
        writeSituationalMorale(unit, unit._flankingMoraleBase);
    }
    clearPositionalMorale(unit);
}

/**
 * 按当前阵型应用夹击(-1)/包围(-2)士气事件。
 *
 * penalty > 0 表示阵型影响仍存在：惩罚相对进入态势前的基础士气计算，重算不会重复扣点。
 * penalty = 0 表示阵型已经解除：保留最后一次惩罚 recoveryRounds 个完整回合后恢复基础士气。
 */
export function applyPositionalMoralePenalty(
    unit,
    penalty,
    currentRound,
    recoveryRounds = POSITIONAL_MORALE_RECOVERY_ROUNDS
) {
    if (!unit) return;
    const normalizedPenalty = Math.max(0, Math.min(2, Math.round(Number(penalty) || 0)));
    const round = Math.max(0, Math.round(Number(currentRound) || 0));
    const duration = Math.max(1, Math.round(Number(recoveryRounds) || POSITIONAL_MORALE_RECOVERY_ROUNDS));

    if (normalizedPenalty > 0) {
        if (!Number.isFinite(unit._flankingMoraleBase)) {
            unit._flankingMoraleBase = clampMorale(unit.morale);
        }
        unit._flankingMoralePenalty = normalizedPenalty;
        unit._flankingMoraleActivePenalty = normalizedPenalty;
        unit._flankingMoraleRecoveryUntil = 0;
        writeSituationalMorale(unit, unit._flankingMoraleBase - normalizedPenalty);
        return;
    }

    const storedPenalty = Math.max(0, Math.min(2, Math.round(Number(unit._flankingMoralePenalty) || 0)));
    if (!Number.isFinite(unit._flankingMoraleBase) || storedPenalty <= 0) {
        clearPositionalMorale(unit);
        return;
    }

    unit._flankingMoraleActivePenalty = 0;
    if (!Number.isFinite(unit._flankingMoraleRecoveryUntil) || unit._flankingMoraleRecoveryUntil <= 0) {
        unit._flankingMoraleRecoveryUntil = round + duration;
    }

    if (round >= unit._flankingMoraleRecoveryUntil) {
        writeSituationalMorale(unit, unit._flankingMoraleBase);
        clearPositionalMorale(unit);
        return;
    }

    writeSituationalMorale(unit, unit._flankingMoraleBase - storedPenalty);
}
