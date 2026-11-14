// js/effectItems.js — 单位效果清单的共享构建器。
// HUD 效果队列（input.js）与棋盘状态图标行（unitStatusIcons.js）都从本模块取同一份
// 效果数组，保证"单位当前受什么影响"只有一个事实来源：
//   HUD 渲染完整卡片（图标+标题+描述+状态），棋盘渲染过滤后的图标行。
// 地块级效果（地形/城市/机场/工事）与天气不在此处——它们不属于"单位状态"，
// 仍由 input.js 自行构建。

import { MORALE_CONFIG } from '../rules/terrain.js';
import { EMOJI_FONT_STACK } from '../rules/symbols.js';
import { FRONTEND_TEXT } from '../rules/uiText.js';
import { isKmtLinkMember, getKmtLinkedUnits, getKmtLinkDamageBonus, getKmtPoolCapacity } from '../rules/kmtStronghold.js';
import { percent } from '../rules/format.js';
import { COMMANDER_CONFIG } from '../rules/commanders.js';
import { getRoundIndex } from './config.js';
import { FREE_RESISTANCE_EFFECT, NEVER_SURRENDER_CONFIG, getNeverSurrenderStacks, getNeverSurrenderStatBonus } from '../rules/cultures.js';
import { hasHostileUnitNear, isGuerrillaExposedByVillage, isStealthGuerrilla } from '../rules/visibility.js';
import { getCommander, getCommanderAuraDefenseBonus, getStallerSnareLayers } from './commanderInterface.js';

const EFFECT_ICONS = FRONTEND_TEXT.icons.effect;

/**
 * 构建指定单位当前的全部效果项（不含地块与天气）。
 * 每项形如 { key, icon, iconFont?, label, desc, color, count?, status?, kind:'effect', active?, intensity? }。
 */
export function buildUnitEffectItems(unit, gameState) {
    if (!unit) return [];
    const items = [];

    const timedEffects = unit.getTimedEffects(gameState);
    const hasMoraleTimed = timedEffects.some(fx => fx.label === MORALE_CONFIG[unit.morale]?.name);
    if (unit.morale !== 2 && !hasMoraleTimed) {
        const morale = MORALE_CONFIG[unit.morale];
        items.push({
            key: 'morale:' + unit.morale,
            icon: morale.badgeIcon || morale.icon || '●',
            iconFont: EMOJI_FONT_STACK,
            label: morale.name,
            desc: morale.desc,
            color: morale.color,
            kind: 'effect'
        });
    }

    timedEffects.forEach((effect, index) => {
        const remaining = effect.remaining != null && effect.remaining !== '永久' ? effect.remaining : '';
        items.push({
            key: 'timed:' + effect.label + ':' + index,
            icon: EFFECT_ICONS[effect.label] || '✦',
            label: effect.label,
            desc: effect.desc || '效果生效中',
            color: effect.color || '#8fcfff',
            count: remaining !== '' ? '⏳' + remaining : '',
            status: effect.status || (remaining !== '' ? '持续' + remaining + '回合' : '持续生效'),
            kind: 'effect'
        });
    });

    if (unit._isDrone && unit._droneSignalDisabled) {
        items.push({
            key: 'tianyan:signal-lost',
            icon: '📡',
            label: '信号失联',
            desc: '超出天眼信号范围，当前无法行动',
            color: '#ff9b72',
            kind: 'effect'
        });
    }

    const auraDefBonus = getCommanderAuraDefenseBonus(unit);
    if (auraDefBonus > 0) {
        items.push({
            key: 'aura:ironGuard',
            icon: '🛡️',
            label: '守护灵光',
            desc: unit.commander === 'ironGuard'
                ? FRONTEND_TEXT.effectDescriptions.guardianSelf
                : FRONTEND_TEXT.effectDescriptions.guardianAlly,
            color: '#7eb8ff',
            kind: 'effect'
        });
    }

    // 夜观星光护体：移除独立徽章，改为在天气效果上叠加星标 + 描述标注

    if (unit.commander !== 'staller' && unit.tile) {
        const layers = getStallerSnareLayers(unit.tile, unit.camp, gameState.tileMap);
        if (layers > 0) {
            items.push({
                key: 'staller:snare',
                icon: '🕸️',
                label: '缚足',
                desc: '每层使得当前单位每步行动力消耗提高' + COMMANDER_CONFIG.staller.balance.movementCostPerLayer + '点',
                color: '#c08050',
                status: '当前生效 每步行动力消耗提高' + (layers * COMMANDER_CONFIG.staller.balance.movementCostPerLayer),
                kind: 'effect'
            });
        }
    }

    // 停滞者迟滞力场（防御侧）：2 格内友军停滞者（含自身）为远程攻击（炮/碉堡）提供减伤，
    // 与实际结算（Unit.js _resolveDamage ④层）同一搜索范围。
    if (unit.tile && gameState.tileMap) {
        const rings = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1],
            [2,0],[2,-1],[2,-2],[1,-2],[1,1],[0,2],[0,-2],[-1,2],[-1,-1],[-2,0],[-2,1],[-2,2]];
        const covered = rings.some(([dq, dr]) => {
            const nb = gameState.tileMap.get(`${unit.tile.q + dq},${unit.tile.r + dr}`);
            return !!(nb && nb.unit && nb.unit.camp === unit.camp && nb.unit.commander === 'staller');
        });
        if (covered) {
            items.push({
                key: 'staller:field',
                icon: '🌀',
                label: '迟滞力场',
                desc: `受到炮兵/碉堡的远程攻击时防御提高${Math.round(COMMANDER_CONFIG.staller.balance.rangedDefenseBonus * 100)}%`,
                color: '#7eb8ff',
                status: '当前生效',
                kind: 'effect'
            });
        }
    }

    if (unit._engineerConstruction) {
        const remain = unit._engineerConstruction.turnsRemaining || 1;
        items.push({
            key: 'engineer:constructing',
            icon: '🚧',
            label: '施工中',
            desc: '碉堡还需' + remain + '回合建成',
            color: '#e8c477',
            count: '⏳' + remain,
            status: '持续' + remain + '回合',
            kind: 'effect'
        });
    }
    if (unit._engineerScaffold) {
        const remain = unit._engineerScaffold.turnsRemaining || 1;
        items.push({
            key: 'engineer:scaffold',
            icon: '🏗️',
            label: '脚手架',
            desc: '还需' + remain + '回合建成碉堡，可被攻击摧毁',
            color: '#e8c477',
            count: '⏳' + remain,
            status: '持续' + remain + '回合',
            kind: 'effect'
        });
    }
    if (unit._poison) {
        const remain = Math.max(0, unit._poison.remainingTicks || 0);
        items.push({
            key: 'status:poison',
            icon: '☣️',
            label: '中毒',
            desc: '所属阵营回合开始流失15%最大生命，可致死，并向相邻未中毒单位传播；疗愈卡可净化。',
            color: '#9bcf55',
            count: '⏳' + remain,
            status: `剩余${remain}次结算`,
            kind: 'effect'
        });
    }

    if ((unit._freeResistanceUntilTurn || 0) > gameState.turnCounter) {
        items.push({
            key: 'culture:free-resistance',
            icon: FREE_RESISTANCE_EFFECT.icon,
            label: FREE_RESISTANCE_EFFECT.name,
            desc: FREE_RESISTANCE_EFFECT.desc,
            color: FREE_RESISTANCE_EFFECT.color,
            count: unit._freeResistanceShield || '',
            status: `临时护盾 ${unit._freeResistanceShield || 0} · 下次行动结束后失效`,
            kind: 'effect'
        });
    }

    const nsStacks = getNeverSurrenderStacks(gameState, unit.camp);
    if (nsStacks > 0) {
        const bonusPct = Math.round(getNeverSurrenderStatBonus(gameState, unit.camp) * 1000) / 10;
        items.push({
            key: 'culture:never-surrender',
            icon: NEVER_SURRENDER_CONFIG.icon,
            label: NEVER_SURRENDER_CONFIG.name,
            desc: `战局累计强化：全军攻击力与防御力各提高${bonusPct}%（每2回合+2.5%，上限6层）。`,
            color: '#6ea8fe',
            count: `${nsStacks}/${NEVER_SURRENDER_CONFIG.maxStacks}`,
            status: `+${bonusPct}% 攻防`,
            kind: 'effect'
        });
    }

    if (isStealthGuerrilla(unit)) {
        const exposed = isGuerrillaExposedByVillage(unit) || hasHostileUnitNear(unit, gameState);
        items.push({
            key: 'culture:stealth',
            icon: '🌿',
            label: exposed ? '行踪暴露' : '敌后游击',
            desc: exposed
                ? '当前位于非己方村庄或1格内有敌军，已失去隐蔽状态（皇帝AI同样可侦测）。'
                : '当前对敌军隐蔽行踪；仅在敌军逼近至1格内或占领非己方原本控制的村庄时显形（皇帝AI除外）。',
            color: exposed ? '#ff9b72' : '#8fd18b',
            status: exposed ? '已显形' : '隐蔽中',
            kind: 'effect'
        });
    }

    const linkedBrigades = getKmtLinkedUnits(unit, gameState);
    const linkDamage = getKmtLinkDamageBonus(unit, gameState);
    if (isKmtLinkMember(unit) || linkDamage) {
        const passive = FRONTEND_TEXT.unitPassives.kmt_training_brigade;
        items.push({
            key: 'culture:kmt-stronghold',
            icon: FRONTEND_TEXT.icons.unitPassive.kmt_training_brigade,
            label: passive.name,
            desc: passive.desc,
            color: '#a9d7ed',
            status: linkedBrigades.length
                ? `共享生命 ${linkedBrigades.reduce((sum, ally) => sum + ally.hp, 0)}/${linkedBrigades.reduce((sum, ally) => sum + getKmtPoolCapacity(ally), 0)} · 伤害 +${percent(linkDamage)}`
                : linkDamage ? `相邻教导旅支援 · 伤害 +${percent(linkDamage)}` : '等待另一支教导旅入场',
            kind: 'effect'
        });
    }
    if (unit.type === 'us_marine' && unit._marineLandingReady) {
        items.push({
            key: 'culture:marine-landing',
            icon: '⚓',
            label: '登陆突击',
            desc: '本回合下一次对陆上单位的主动攻击伤害提高20%。',
            color: '#7cdef0',
            kind: 'effect'
        });
    }

    if (unit.config?.permanentAntiHeal) {
        items.push({
            key: 'culture:anti-heal',
            icon: '🩸',
            label: '武士禁疗',
            desc: '常驻禁疗状态：无法通过常规治疗回血（可在城市或村庄补员；万岁冲锋击杀目标后可无视禁疗回复60%最大生命）。',
            color: '#ef5350',
            status: '常驻禁疗',
            kind: 'effect'
        });
    }

    if (unit._heavyCannonAutoFiredThisTurn) {
        items.push({
            key: 'culture:heavy-cannon-fired',
            icon: '💣',
            label: '重炮已齐射',
            desc: '本回合开始时已自动执行远程炮击；本回合仍可机动，但不可再次手动攻击。',
            color: '#9ec5ff',
            status: '不可再手动攻击',
            kind: 'effect'
        });
    }

    // 战役触发器施加的效果
    if (Array.isArray(unit._campaignEffects) && unit._campaignEffects.length) {
        for (const eff of unit._campaignEffects) {
            items.push({
                key: "campaign:" + eff.name + ":" + eff.id,
                icon: eff.emoji || "✨",
                label: eff.name,
                desc: (eff.desc || "战役效果") + (eff.duration ? " · 剩余" + eff.duration + "回合" : ""),
                color: "#ffd866",
                count: eff.duration ? "⏳" + eff.duration : "",
                status: eff.duration ? "持续" + eff.duration + "回合" : "持续生效",
                kind: 'effect'
            });
        }
    }
    return items;
}
