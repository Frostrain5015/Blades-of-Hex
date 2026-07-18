import { CAMP, campToKey } from '../rules/camps.js';
import {
    UNIT_CONFIG,
    COUNTER_RELATION,
    chooseDefaultSpecialization,
    getSpecializationAbilityValue,
    isRankLockedUnit,
    isStrongpointTarget,
    isValidSpecialization,
    resolveUnitRankProfile,
    unitNeedsSpecialization
} from '../rules/units.js';
import { MORALE_CONFIG, TERRAIN_CONFIG, FORTIFICATION_CONFIG } from '../rules/terrain.js';
import { hexDistance, HEX_NEIGHBORS } from '../rules/hex.js';
import { getRoundIndex } from '../rules/turns.js';
import { getCommander, getCommanderDefenseBonus, getCommanderAuraDefenseBonus, getCommanderAllyAuraDamage, getCommanderAttackBonus, getCommanderAuraAttackBonus, getCommanderWeatherImmunity, getCommanderWeatherDebuff, isCommanderGuaranteedCrit, getCommanderCritRateBonus, triggerCommanderOnMoraleChange, triggerCommanderAllyDamage } from './commanderInterface.js';
import { nextId } from './uid.js';
import { emit } from './eventBus.js';
import { COMBAT_BALANCE } from '../rules/constants.js';
import { COMMANDER_CONFIG } from '../rules/commanders.js';
import { FRONTEND_TEXT } from '../rules/uiText.js';
import { isFriendly, isHostile } from '../rules/diplomacy.js';
import { isMechanicEnabled } from '../rules/mechanics.js';
import { isRangedAttackPresentation } from '../rules/attackPresentation.js';
import { getAntiAirReduction } from '../rules/antiAir.js';
import { getCityDefenseBonus } from '../rules/citySiege.js';
import {
    COLONEL_AIR_DAMAGE_BONUS,
    COLONEL_AIR_MAX_STACKS,
    COLONEL_AIR_RANGE_BONUS,
    COLONEL_AIR_STACK_BONUS,
    COLONEL_ANTI_AIR_PIERCE,
    getMountedCommanderAirAttackBonus
} from '../rules/airCommands.js';
import { areCommanderMechanicsSuppressed, canUnitOccupyTile, getTransportBaseDefense, getUnitCombatRange, getUnitMovementDomain, isEmbarkableLandUnit, TRANSPORT_RULES, TRANSPORT_SPEED_CAP } from '../rules/movement.js';
import { isWaterTile } from '../rules/surfaces.js';
import { canUnitTargetUnit, getCrossDomainDamageBonus } from '../rules/naval.js';

// 延迟引用，由游戏逻辑设置(避免循环依赖)
let _logMessage = null;
let _gameState = null;
let _isNetworkGame = null;
// 晋升事件收集（供联机同步，每轮 action 前清空）
export let _pendingRankUps = [];
export function setLogMessageRef(fn) { _logMessage = fn; }
export function setGameStateRef(ref) { _gameState = ref; }
export function setIsNetworkGameRef(fn) { _isNetworkGame = fn; }

/**
 * 是否允许为该单位走 AI 自动选专精路径。
 * 联机对局中所有玩家席位都是人类，仅中立阵营可自动选择；
 * 这同时防御旧版本快照里被污染成 'ai' 的玩家阵营 controller。
 */
function _allowAutoSpecialization(unit) {
    const campKey = campToKey(unit.camp);
    if (campKey === 'neutral') return true;
    const controller = _gameState?.factions?.[campKey]?.controller;
    return controller === 'ai' && !(_isNetworkGame?.());
}

export class Unit {
    constructor(type, camp, tile, isNewRecruit = false, idOverride = null, commander = null, transportState = null, specializationKey = null) {
        this.id = idOverride ?? nextId();
        this.type = type;
        this.config = UNIT_CONFIG[type];
        if (!this.config) throw new TypeError(`Unknown unit type: ${type}`);
        this.isEmbarked = transportState?.isEmbarked === true
            && isWaterTile(tile)
            && isEmbarkableLandUnit({ type, config: this.config });
        this._transportTransitionedThisTurn = transportState?.transitionedThisTurn === true;
        if (!canUnitOccupyTile({ type, config: this.config, isEmbarked: this.isEmbarked }, tile)) {
            throw new TypeError(`Unit ${type} cannot occupy tile ${tile?.q},${tile?.r}`);
        }
        this.movementDomain = getUnitMovementDomain({ type, config: this.config });
        this.camp = camp;
        this.commander = commander;
        // 战役剧情身份与玩法将领原型分离；标准对局保持这些字段为空。
        this.storyCommanderId = null;
        this.commanderName = '';
        this.commanderPortrait = commander || null;
        this._centurionTriggered = false;
        // 应用将领属性加成（百分比化：基于兵种基础面板）
        const cmdCfg = commander ? getCommander(commander) : null;
        const hpBonus = cmdCfg ? Math.round(this.config.hp * (cmdCfg.hpBonusPct || 0)) : 0;
        const atkBonus = cmdCfg ? Math.round(this.config.attack * (cmdCfg.atkBonusPct || 0)) : 0;
        const spdBonus = cmdCfg ? (cmdCfg.spdBonus || 0) : 0;
        this.hp = this.config.hp + hpBonus;
        this.maxHp = this.config.hp + hpBonus;
        this._atkBonus = atkBonus;
        this.canAct = true;
        this.tile = tile;
        this.movedThisTurn = false;
        this.moveDistance = 0;
        this.counterAttackCount = 0;
        this._timesAttackedThisTurn = 0;
        this.isNewRecruit = isNewRecruit;
        this._morale = 2;
        this.moraleBoostUntil = 0;
        this.moralePenaltyUntil = 0;
        this.godMode = false;
        this._xp = 0;
        this._rank = 0;
        this.specializationKey = null;
        this._pendingSpecialization = false;
        this._rankLocked = isRankLockedUnit(type);
        this._rankPanelHpBonus = 0;
        this._rankPanelAttackBonus = 0;
        this._rankPanelDefenseBonus = 0;
        this._rankPanelSpeedBonus = 0;
        this._rankPanelRangeBonus = 0;
        // 旧字段暂留为只读兼容槽；v2 的防御全部由面板差值派生。
        this._rankDefBonus = 0;
        this._rankCritBonus = 0;
        this._rankRegenPct = 0;
        this._fallen = false;
        this._shieldPulseUntil = 0;
        this.activeSkillCD = 0;
        this.activeSkillDur = 0;
        this._imprisoned = false;
        this._isImmobile = false;
        this._engineerConstruction = null;
        this._campaignEffects = [];  // [{id,name,emoji,duration,statMods:{atkPct,defPct,spdPct,hpPct}}]
        this._engineerScaffold = null;
        this._engineerBunkerCD = 0;
        this._phantomStacks = 0;
        this._berserkerQixue = false;
        this._shield = 0;
        this._shieldMax = 0;
        this._shieldTurns = 0;
        this._poison = null;
        this._displayShield = 0;
        this.remainingMP = this.config.speed + spdBonus;
        this.displaySpeed = this.config.speed + spdBonus;
        // 移动动画状态（瞬时，不参与序列化）
        this.movePath = null;       // [{x, y}, ...] waypoints
        this.movePathStart = 0;
        this.movePathDuration = 0;
        // HP 显示平滑过渡
        this.displayHp = this.hp;
        tile.unit = this;
        if (specializationKey) this._setRestoredSpecialization(specializationKey);
    }

    get morale() { return this._morale; }
    set morale(v) {
        const old = this._morale;
        this._morale = v;
        if (old !== v) triggerCommanderOnMoraleChange(this, old, v);
    }

    // 返回当前限时效果列表（供 tooltip / UI 展示）
    // 格式：{ label, desc, color, remaining }
    getTimedEffects(gameState) {
        const effects = [];
        const curRound = gameState ? getRoundIndex(gameState) : 0;

        if (this.isEmbarked && isEmbarkableLandUnit(this)) {
            effects.push({
                label: TRANSPORT_RULES.effectLabel,
                desc: getTransportBaseDefense(this) === TRANSPORT_RULES.deepWaterBaseDefense
                    ? TRANSPORT_RULES.deepWaterEffectDescription
                    : TRANSPORT_RULES.effectDescription,
                color: '#4f91bd'
            });
        }

        // 击杀士气上升（moraleBoostUntil 为回合数, 0-indexed）
        if (this.morale === 3 && this.moraleBoostUntil > curRound) {
            const remainingRounds = this.moraleBoostUntil - curRound;
            effects.push({
                label: MORALE_CONFIG[3].name,
                desc: MORALE_CONFIG[3].desc,
                color: MORALE_CONFIG[3].color,
                remaining: remainingRounds
            });
        }

        // 主动技能持续中
        if (this.activeSkillDur > 0 && this.commander) {
            const cmdCfg = getCommander(this.commander);
            if (cmdCfg && cmdCfg.activeSkill) {
                const buffParts = [];
                if (cmdCfg.activeSkill.buffs) {
                    const b = cmdCfg.activeSkill.buffs;
                    if (b.atk) buffParts.push(`攻击力提高${b.atk}点`);
                    if (b.def) buffParts.push(`防御力提高${Math.round(b.def * 100)}%`);
                }
                // 占星者星移：显示当前锁定的天气
                let skillDesc = buffParts.length ? buffParts.join('，') : '';
                if (this.commander === 'astrologer' && cmdCfg.activeSkill.name === '星移' && _gameState) {
                    const w = _gameState.weather;
                    const wName = w === 'clear' ? '晴' : w === 'rain' ? '雨' : w === 'fog' ? '雾' : w === 'wind' ? '风' : '';
                    skillDesc = '锁定当前天气：' + wName;
                }
                effects.push({
                    label: cmdCfg.activeSkill.name,
                    desc: skillDesc,
                    color: '#ff8844',
                    remaining: this.activeSkillDur
                });
            }
        }

        // 谋士攻心的士气下降/混乱（moralePenaltyUntil 为回合数, 0-indexed）
        if (this.morale < 2 && this.moralePenaltyUntil > curRound) {
            const morale = MORALE_CONFIG[this.morale];
            effects.push({
                label: morale.name,
                desc: morale.desc,
                color: morale.color,
                remaining: this.moralePenaltyUntil - curRound
            });
        }

        if (this._berserkerQixue) {
            const balance = COMMANDER_CONFIG.berserker.balance;
            const stacks = Math.min(balance.maxStacks, Math.floor(((this.maxHp - this.hp) / this.maxHp) / balance.hpLossPerStackPct));
            effects.push({
                label: '泣血',
                desc: COMMANDER_CONFIG.berserker.definition.activeSkill.desc,
                color: '#d63c3c',
                status: '当前生效 攻击力提高' + Math.round(stacks * balance.statBonusPerStackPct * 100) + '%，防御力提高' + Math.round(stacks * balance.statBonusPerStackPct * 100) + '%'
            });
        }

        if (this._imprisoned) {
            effects.push({ label: '禁锢', desc: '本回合无法移动', color: '#ff8844' });
        }
        if (this._isImmobile) {
            effects.push({ label: '不可移动', desc: '该单位无法移动', color: '#888' });
        }

        // 勇气灵光（自身）
        if (this.commander === 'paladin' && !areCommanderMechanicsSuppressed(this)) {
            effects.push({ label: '勇气灵光', desc: FRONTEND_TEXT.effectDescriptions.courageAura, color: '#ffd700' });
        }

        // 勇气灵光 — 受相邻圣骑士影响
        if (this.commander !== 'paladin' && gameState && gameState.tileMap && this.tile) {
            let hasPaladinAura = false;
            for (const [dq, dr] of HEX_NEIGHBORS) {
                const nb = gameState.tileMap.get(`${this.tile.q + dq},${this.tile.r + dr}`);
                if (nb && nb.unit && nb.unit.commander === 'paladin' && !areCommanderMechanicsSuppressed(nb.unit) && isFriendly(_gameState, nb.unit.camp, this.camp)) {
                    hasPaladinAura = true;
                    break;
                }
            }
            if (hasPaladinAura) {
                effects.push({ label: '勇气灵光', desc: FRONTEND_TEXT.effectDescriptions.courageAura, color: '#ffd700' });
            }
        }

        // 牧师治愈灵光
        if (this._healingAura > 0) {
            effects.push({ label: '治愈灵光', desc: FRONTEND_TEXT.effectDescriptions.healingAura, color: '#44dd88', remaining: this._healingAura });
        }

        return effects;
    }

    // 返回主动技能冷却剩余轮数（供 tooltip 属性栏展示）
    getCooldownRounds() {
        return this.activeSkillCD > 0 ? this.activeSkillCD : 0;
    }

    get isCommanderUnit() { return Boolean(this.commander || this.commanderName); }

    getCommanderDisplayName() {
        return this.commanderName || getCommander(this.commander)?.name || this.commander || '';
    }

    getCommanderPortraitId() {
        return this.commanderPortrait || this.commander || null;
    }

    get pendingSpecialization() {
        return unitNeedsSpecialization(this);
    }

    getSpecializationAbility(abilityKey) {
        return getSpecializationAbilityValue(this, abilityKey);
    }

    _setRestoredSpecialization(specializationKey) {
        this.specializationKey = this._rank >= 1 && isValidSpecialization(this.type, specializationKey)
            ? specializationKey
            : null;
        this._rebuildRankProfile({ adjustResources: false });
    }

    /**
     * 从基础兵种、当前军衔和专精重建派生面板。
     * 这是晋升、战役预设和快照恢复共用的唯一入口，避免重复累计奖励。
     */
    _rebuildRankProfile({ adjustResources = true } = {}) {
        const profile = resolveUnitRankProfile(this.type, this._rank, this.specializationKey);
        if (!profile) return false;

        const previousHpBonus = this._rankPanelHpBonus || 0;
        const previousSpeed = this.getEffectiveSpeed();
        this.specializationKey = profile.specializationKey;
        this._pendingSpecialization = profile.pendingSpecialization;
        this._rankPanelHpBonus = profile.hp - this.config.hp;
        this._rankPanelAttackBonus = profile.attack - this.config.attack;
        this._rankPanelDefenseBonus = profile.defense - (this.config.defense || 0);
        this._rankPanelSpeedBonus = profile.speed - this.config.speed;
        this._rankPanelRangeBonus = profile.range - this.config.range;
        this._rankCritBonus = profile.rankCritBonus;
        this._rankRegenPct = profile.rankRegenPct;
        this._rankDefBonus = 0;
        this._unbranchedRankReward = profile.unbranchedReward;

        const hpDelta = this._rankPanelHpBonus - previousHpBonus;
        if (hpDelta !== 0) {
            if (this._campaignBaseMaxHp != null) {
                this._campaignBaseMaxHp = Math.max(1, this._campaignBaseMaxHp + hpDelta);
                this.refreshCampaignEffectState();
            } else {
                this.maxHp = Math.max(1, this.maxHp + hpDelta);
            }
            if (adjustResources && hpDelta > 0 && !(this.commander === 'martyr' && this._martyrPrimed)) {
                this.hp = Math.min(this._campaignMaxHp || this.maxHp, this.maxHp, this.hp + hpDelta);
            } else {
                this.hp = Math.min(this.hp, this._campaignMaxHp || this.maxHp, this.maxHp);
            }
        }

        const nextSpeed = this.getEffectiveSpeed();
        if (adjustResources) this.remainingMP = Math.max(0, (this.remainingMP || 0) + nextSpeed - previousSpeed);
        this.displaySpeed = nextSpeed;
        this.displayHp = Math.min(this.displayHp ?? this.hp, this.maxHp);
        return true;
    }

    chooseSpecialization(specializationKey) {
        if (this._rankLocked || this._rank < 1 || this.specializationKey) return false;
        if (!isValidSpecialization(this.type, specializationKey)) return false;
        // 防守：人类阵营单位只能经 UI 路径选择专精（联机中玩家席位一律视为人类）
        if (!_allowAutoSpecialization(this)) {
            const stk = new Error().stack;
            if (!stk?.includes('_applySpecializationChoice')) return false;
        }
        this.specializationKey = specializationKey;
        this._rebuildRankProfile();
        emit('match:unitSpecialized', {
            unit: this,
            unitId: this.id,
            specializationKey,
            rank: this._rank
        });
        return true;
    }

    getCampaignEffectMods() {
        const total = {
            atkPct: 0, atkFlat: 0, defPct: 0, meleeDefPct: 0,
            rangeDefPct: 0, spdFlat: 0, hpPct: 0, hpFlat: 0
        };
        for (const effect of this._campaignEffects || []) {
            const mods = effect?.statMods || {};
            for (const key of Object.keys(total)) total[key] += Number(mods[key]) || 0;
        }
        return total;
    }

    getEffectiveSpeed() {
        const commander = this.commander ? getCommander(this.commander) : null;
        const speed = Math.max(0, this.config.speed + (this._rankPanelSpeedBonus || 0) + (commander?.spdBonus || 0) + this.getCampaignEffectMods().spdFlat);
        return this.isEmbarked ? Math.min(TRANSPORT_SPEED_CAP, speed) : speed;
    }

    getCampaignDefenseBonus(attacker = null) {
        const mods = this.getCampaignEffectMods();
        let percent = mods.defPct;
        if (attacker) {
            const melee = attacker.type === 'infantry' || attacker.type === 'cavalry';
            percent += melee ? mods.meleeDefPct : mods.rangeDefPct;
        }
        return percent / 100;
    }

    refreshCampaignEffectState() {
        const effects = Array.isArray(this._campaignEffects) ? this._campaignEffects : [];
        const mods = this.getCampaignEffectMods();
        const hasHpModifier = effects.some(effect => {
            const effectMods = effect?.statMods || {};
            return (Number(effectMods.hpPct) || 0) !== 0 || (Number(effectMods.hpFlat) || 0) !== 0;
        });

        if (hasHpModifier) {
            if (this._campaignBaseMaxHp == null) this._campaignBaseMaxHp = this.maxHp;
            this.maxHp = Math.max(1, Math.round(this._campaignBaseMaxHp * (1 + mods.hpPct / 100) + mods.hpFlat));
        } else if (this._campaignBaseMaxHp != null) {
            this.maxHp = Math.max(1, this._campaignBaseMaxHp);
            delete this._campaignBaseMaxHp;
        }

        const minPercent = Math.max(0, ...effects
            .filter(effect => effect?.rule === 'minHp')
            .map(effect => Number(effect.rulePercent) || 0));
        const maxPercents = effects
            .filter(effect => effect?.rule === 'maxHp')
            .map(effect => Number(effect.rulePercent) || 100);
        if (minPercent > 0) this._campaignMinHp = this.maxHp * Math.min(100, minPercent) / 100;
        else delete this._campaignMinHp;
        if (maxPercents.length > 0) this._campaignMaxHp = this.maxHp * Math.max(0, Math.min(...maxPercents)) / 100;
        else delete this._campaignMaxHp;

        const hasGodMode = effects.some(effect => effect?.rule === 'godMode');
        if (hasGodMode) {
            if (!Object.hasOwn(this, '_campaignGodModeBase')) this._campaignGodModeBase = this.godMode;
            this.godMode = true;
        } else if (Object.hasOwn(this, '_campaignGodModeBase')) {
            this.godMode = this._campaignGodModeBase;
            delete this._campaignGodModeBase;
        }

        const maxAllowed = this._campaignMaxHp || this.maxHp;
        this.hp = Math.min(this.hp, maxAllowed, this.maxHp);
        this.displaySpeed = this.getEffectiveSpeed();
    }

    assignCampaignCommander(commander) {
        const nextCommander = commander || null;
        if (this.commander === nextCommander) return;
        const previousSpeed = this.getEffectiveSpeed();
        const oldConfig = this.commander ? getCommander(this.commander) : null;
        const nextConfig = nextCommander ? getCommander(nextCommander) : null;
        const oldHp = oldConfig ? Math.round(this.config.hp * (oldConfig.hpBonusPct || 0)) : 0;
        const nextHp = nextConfig ? Math.round(this.config.hp * (nextConfig.hpBonusPct || 0)) : 0;
        const oldAtk = oldConfig ? Math.round(this.config.attack * (oldConfig.atkBonusPct || 0)) : 0;
        const nextAtk = nextConfig ? Math.round(this.config.attack * (nextConfig.atkBonusPct || 0)) : 0;
        this.commander = nextCommander;
        if (!this.storyCommanderId) this.commanderPortrait = nextCommander;
        if (this._campaignBaseMaxHp != null) this._campaignBaseMaxHp += nextHp - oldHp;
        else this.maxHp = Math.max(1, this.maxHp + nextHp - oldHp);
        this._atkBonus = (this._atkBonus || 0) + nextAtk - oldAtk;
        this.refreshCampaignEffectState();
        this.hp = Math.max(1, Math.min(this._campaignMaxHp || this.maxHp, this.maxHp, this.hp + nextHp - oldHp));
        this.remainingMP = Math.max(0, this.remainingMP + this.getEffectiveSpeed() - previousSpeed);
        this.displaySpeed = this.getEffectiveSpeed();
    }

    getEffectiveAttack() {
        if (this.type === 'carrier') return this.config.attack + (this._rankPanelAttackBonus || 0);
        const auraAtk = getCommanderAuraAttackBonus(this);
        let base;
        if (this.isEmbarked && isEmbarkableLandUnit(this)) {
            const commander = this.commander ? getCommander(this.commander) : null;
            const originalCommanderBonus = commander
                ? Math.round(this.config.attack * (commander.atkBonusPct || 0))
                : 0;
            const transportCommanderBonus = commander
                ? Math.round(TRANSPORT_RULES.baseAttack * (commander.atkBonusPct || 0))
                : 0;
            const nonCommanderFlat = (this._atkBonus || 0) - originalCommanderBonus;
            base = TRANSPORT_RULES.baseAttack * (1 + auraAtk) + transportCommanderBonus + nonCommanderFlat;
        } else {
            base = (this.config.attack + (this._rankPanelAttackBonus || 0)) * (1 + auraAtk) + (this._atkBonus || 0) + getCommanderAttackBonus(this);
        }
        const mods = this.getCampaignEffectMods();
        return Math.round(base * (1 + mods.atkPct / 100) + mods.atkFlat);
    }

    getEffectiveRange() {
        const base = getUnitCombatRange(this);
        return this.type === 'carrier' && this.commander === 'colonel' && !areCommanderMechanicsSuppressed(this)
            ? base + COLONEL_AIR_RANGE_BONUS
            : base;
    }

    // 伤害浮动倍率（替代 critRate + critMulti 二值系统）
    // 浮动倍率区间 —— 暴击率完全由区间体现（阈值以上占比即暴击概率），不做独立随机判定
    _calcFloat(isCounter = false, isCityCounter = false, critRateBonus = 0, noCrit = false, forceCrit = false) {
        const gs = _gameState;
        let lo, hi;
        const floatBalance = COMBAT_BALANCE.float;

        if (isCounter) {
            lo = isCityCounter ? floatBalance.counter.cityMin : floatBalance.counter.min;
            hi = floatBalance.counter.max;
        } else {
            lo = floatBalance.attack.min; hi = floatBalance.attack.max;
        }

        // 士气影响浮动区间（进而改变暴击概率与伤害浮动）
        if (isMechanicEnabled(_gameState, 'morale')) {
            if (this.morale === 3)      { lo += floatBalance.morale.up.min; hi += floatBalance.morale.up.max; }
            else if (this.morale === 1) { lo += floatBalance.morale.down.min; hi += floatBalance.morale.down.max; }
            else if (this.morale === 0) { lo += floatBalance.morale.confused.min; hi += floatBalance.morale.confused.max; }
        }

        const threshold = isCounter ? floatBalance.counter.critThreshold : floatBalance.attack.critThreshold;
        if (noCrit) {
            // 逆克：整段浮动压到暴击阈值以下 → 暴击率0
            if (hi > threshold) hi = threshold - 0.001;
            if (lo > hi) lo = hi;
        } else if (forceCrit) {
            // 必定暴击：整段上移到阈值之上（保持原宽度）
            const width = hi - lo;
            lo = threshold + 0.001;
            hi = lo + width;
        } else if (critRateBonus > 0) {
            // 暴击率加成：整体上移浮动区间，使阈值以上占比≈基础+加成（cap 100%）
            const shift = Math.min(critRateBonus, 1) * (hi - lo);
            lo += shift; hi += shift;
        }

        if (!gs?.rng) throw new Error('Unit damage calculation requires MatchState.rng');
        return gs.rng.range(lo, hi);
    }

    // ===== 伤害计算管线（四层乘算） =====================
    // 伤害 = ①攻击力乘区 × ②增伤乘区 × ③暴击/浮动乘区 × ④防御乘区 （反击另乘 baseMulti=0.75）
    //   ① 攻击力：getEffectiveAttack()，「攻击力+xx」「攻击力提高xx%」
    //   ② 增伤（层内加算）：兵种克制 + 士气 + 冲锋/城市攻坚等，「造成的伤害提高xx%」
    //   ③ 暴击/浮动：_calcFloat()，「暴击率提高/降低xx%」
    //   ④ 防御（层内加算后 1-Σ）：地形/守城/兵种/军衔/士气/将领/灵光，「防御力提高xx%」
    _resolveDamage(attacker, defender, baseMulti = 1, extraBonus = 0,
                   isCounter = false, isCityCounter = false, isAirDamage = false, ignoreDef = 0, attackFlatBonus = 0,
                   forceNoCrit = false) {
        const counterCoeff = COUNTER_RELATION[attacker.type]?.[defender.type] ?? 1;
        const attackerCommanderSuppressed = areCommanderMechanicsSuppressed(attacker);
        const defenderCommanderSuppressed = areCommanderMechanicsSuppressed(defender);
        const qixueActive = !attackerCommanderSuppressed && attacker.commander === 'berserker' && attacker._berserkerQixue && !isCounter;

        // ② 增伤乘区
        let dmgUp = extraBonus + getCrossDomainDamageBonus(attacker, defender);
        // 固守：只削减“受到的第一次攻击”，反击伤害不吃也不消耗该标记
        const firstHitReduction = isCounter ? 0 : (defender.getSpecializationAbility?.('holdFirstHitReduction') || 0);
        if (firstHitReduction > 0 && !defender.movedThisTurn && (defender._timesAttackedThisTurn || 0) === 0) {
            dmgUp -= firstHitReduction;
        }
        if (qixueActive) dmgUp += COMMANDER_CONFIG.berserker.balance.qixueDamageBonus;
        // 兵种克制：顺克 +20% / 逆克 −20%（归入②增伤乘区）；暴击率另在③处理（顺克+25%/逆克锁0）
        if (counterCoeff > 1) dmgUp += COMBAT_BALANCE.counter.advantageDamage;
        else if (counterCoeff < 1) dmgUp += COMBAT_BALANCE.counter.disadvantageDamage;
        // 魔术师·千面：攻击克制目标时伤害提高25%（与基础顺克+20%叠加→+45%）
        if (!attackerCommanderSuppressed && attacker.commander === 'magician' && counterCoeff > 1) dmgUp += COMMANDER_CONFIG.magician.balance.counterDamageBonus;
        // 魔术师幻形：每层+5%增伤（上限30%），归入②乘区
        if (!attackerCommanderSuppressed && attacker.commander === 'magician' && attacker._phantomStacks) {
            const balance = COMMANDER_CONFIG.magician.balance;
            dmgUp += Math.min(attacker._phantomStacks * balance.damagePerStack, balance.maxStacks * balance.damagePerStack);
        }
        const offenseMulti = Math.max(0, 1 + dmgUp);

        // ③ 暴击/浮动乘区：暴击率完全由浮动区间体现，无独立随机判定
        //    各暴击率来源累加 → 在 _calcFloat 内整体上移浮动区间，使阈值以上占比≈基础+加成
        const phantomCrit = attackerCommanderSuppressed ? 0 : (attacker._phantomStacks || 0) * COMMANDER_CONFIG.magician.balance.critPerStack;
        const cmdCrit = getCommanderCritRateBonus(attacker);            // 堕天使黑形态 +60% 等
        const counterCrit = counterCoeff > 1 ? COMBAT_BALANCE.counter.advantageCrit : 0;
        const counterNoCrit = counterCoeff < 1;                        // 逆克 无法暴击
        const critRateBonus = (attacker._rankCritBonus || 0) + phantomCrit + cmdCrit + counterCrit + (qixueActive ? COMMANDER_CONFIG.berserker.balance.qixueCritBonus : 0);
        const forceCrit = !counterNoCrit && isCommanderGuaranteedCrit(attacker);
        const floatMult = attacker._calcFloat(isCounter, isCityCounter, critRateBonus, counterNoCrit || forceNoCrit, forceCrit && !forceNoCrit);
        const isCrit = floatMult > (isCounter ? COMBAT_BALANCE.float.counter.critThreshold : COMBAT_BALANCE.float.attack.critThreshold);

        // ④ 防御乘区
        const transportedDefender = defender.isEmbarked && isEmbarkableLandUnit(defender);
        let defSum = transportedDefender ? getTransportBaseDefense(defender) : TERRAIN_CONFIG[defender.tile.terrain].defenseBonus;
        // 工事定向减伤：战壕仅挡近战（步/骑）、高射机枪仅挡地面远程（炮/碉堡）。
        // 空军(isAirDamage，含无人机)不吃工事定向加成，改由下方防空层处理。
        const fortification = isMechanicEnabled(_gameState, 'fortifications') && defender.tile.fortification ? FORTIFICATION_CONFIG[defender.tile.fortification] : null;
        if (!transportedDefender && fortification && !isAirDamage) {
            const isMeleeAtk = attacker.type === 'infantry' || attacker.type === 'cavalry';
            const isGroundRangedAtk = attacker.type === 'archer' || attacker.type === 'mgNest';
            if (fortification.appliesTo === 'melee' && isMeleeAtk) defSum += fortification.defenseBonus;
            else if (fortification.appliesTo === 'ranged' && isGroundRangedAtk) defSum += fortification.defenseBonus;
        }
        // 森林掩蔽：对远程攻击（炮兵/碉堡/无人机）额外+15%防御，与地形自带10%加算
        if (!transportedDefender && defender.tile.terrain === 'forest' && (attacker.type === 'archer' || attacker.type === 'mgNest' || attacker.type === 'drone')) {
            defSum += COMBAT_BALANCE.defense.forestVsRangedBonus;
        }
        // 风天：步兵防御-15%（星移期间扩展至敌方全兵种；占星者星光力场免疫）；星移减益区内额外-15%
        if (!transportedDefender && isMechanicEnabled(_gameState, 'weatherEffects') && _gameState.weather === 'wind' && (defender.type === 'infantry' || (_gameState.weatherLockUntil > 0 && getRoundIndex(_gameState) < _gameState.weatherLockUntil && defender.camp !== attacker.camp))
            && !getCommanderWeatherImmunity(defender.tile, defender.camp, _gameState.tileMap)) {
            defSum -= COMBAT_BALANCE.defense.windInfantryPenalty;
            if (getCommanderWeatherDebuff(defender.tile, defender.camp, _gameState)) defSum -= COMBAT_BALANCE.defense.windInfantryPenalty;
        }
        // 雨天：步兵守城防御力额外+10%（占星者星光力场免疫）
        if (!transportedDefender && isMechanicEnabled(_gameState, 'weatherEffects') && _gameState.weather === 'rain' && defender.type === 'infantry' && defender.tile.isCity
            && !getCommanderWeatherImmunity(defender.tile, defender.camp, _gameState.tileMap)) {
            defSum += COMBAT_BALANCE.defense.rainCityInfantryBonus;
        }
        if (!transportedDefender) defSum += (defender.config.defense || 0) + (defender._rankPanelDefenseBonus || 0);
        if (isMechanicEnabled(_gameState, 'morale')) defSum += MORALE_CONFIG[defender.morale].defBonus;
        defSum += getCommanderDefenseBonus(defender);
        // 魔术师·千面：被克制目标攻击时受伤降低15%
        if (!defenderCommanderSuppressed && defender.commander === 'magician' && counterCoeff > 1) defSum += COMMANDER_CONFIG.magician.balance.counterDefenseBonus;
        // 停滞者力场：2格内友军停滞者 → 对远程攻击(炮兵/碉堡)防御 +25%（单层）
        // 空军伤害(isAirDamage)不走此分支：停滞者已作为防空层在下方计入 +25%，
        // 否则炮兵载体的上校空军卡会被同一个停滞者叠加 15%+25% 双重加防
        if (!isAirDamage && (attacker.type === 'archer' || attacker.type === 'mgNest') && _gameState && _gameState.tileMap) {
            const dirs = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
            const dirs2 = [[2,0],[2,-1],[2,-2],[1,-2],[1,1],[0,2],[0,-2],[-1,2],[-1,-1],[-2,0],[-2,1],[-2,2]];
            let hasStaller = false;
            for (const [dq, dr] of [...dirs, ...dirs2]) {
                const nb = _gameState.tileMap.get(`${defender.tile.q + dq},${defender.tile.r + dr}`);
                if (!nb || !nb.unit || nb.unit.camp !== defender.camp) continue;
                if (nb.unit.commander === 'staller' && !areCommanderMechanicsSuppressed(nb.unit)) { hasStaller = true; break; }
            }
            if (hasStaller) defSum += COMMANDER_CONFIG.staller.balance.rangedDefenseBonus;
        }
        // 防空火力：2格内友军 炮兵/碉堡/停滞者单位 → 仅对空军(上校空军卡)伤害 +25%/层（封顶2层=50%）
        if (isAirDamage && _gameState && _gameState.tileMap) {
            const antiAirReduction = getAntiAirReduction(defender.tile, attacker.camp, _gameState.tileMap, {
                state: _gameState
            });
            if (antiAirReduction > 0) defSum += antiAirReduction;
        }
        defSum += getCommanderAuraDefenseBonus(defender);
        defSum += defender.getCampaignDefenseBonus(attacker);
        // 城防：驻军站在城市地块上时，城市当前HP按比例转化为防御力，不区分空军/地面伤害。
        if (defender.tile?.isCity) defSum += getCityDefenseBonus(defender.tile);
        // 空军上校俯冲扫射：无视目标防御力
        if (ignoreDef > 0) defSum -= ignoreDef;
        const defenseMulti = Math.max(COMBAT_BALANCE.defense.minimumMultiplier, 1 - Math.min(COMBAT_BALANCE.defense.maximumReduction, defSum));

        return {
            dmg: (attacker.getEffectiveAttack() + attackFlatBonus) * baseMulti * offenseMulti * floatMult * defenseMulti,
            isCrit
        };
    }

    calculateDamage(targetUnit) {
        const gs = _gameState;

        if (this.type === 'carrier') {
            const colonelActive = this.commander === 'colonel' && !areCommanderMechanicsSuppressed(this);
            const campKey = campToKey(this.camp);
            const stacks = colonelActive
                ? Math.min(COLONEL_AIR_MAX_STACKS, gs?._colonelAirStacks?.[campKey] || 0)
                : 0;
            const carrierRankBonus = this._unbranchedRankReward?.damageBonus || 0;
            const colonelBonus = colonelActive
                ? COLONEL_AIR_DAMAGE_BONUS + stacks * COLONEL_AIR_STACK_BONUS
                : 0;
            const missingHpPower = Math.min(15, Math.floor(((targetUnit.maxHp - targetUnit.hp) / targetUnit.maxHp) * 20));
            // 舰载机读取所挂将领自身的攻击修正，但不读取宿主舰体的其他单位属性修正。
            const commanderAttackBonus = getMountedCommanderAirAttackBonus(this, this.config.attack);
            const power = this.config.attack + (this._rankPanelAttackBonus || 0) + commanderAttackBonus + missingHpPower;
            const floatMult = colonelActive || this._rank >= 4
                ? this._calcFloat(false, false, this._rankCritBonus || 0)
                : gs.rng.range(0.95, 1.05);
            let defense = (TERRAIN_CONFIG[targetUnit.tile.terrain]?.defenseBonus || 0)
                + (targetUnit.config.defense || 0)
                + (targetUnit._rankPanelDefenseBonus || 0)
                + (isMechanicEnabled(gs, 'morale') ? (MORALE_CONFIG[targetUnit.morale]?.defBonus || 0) : 0)
                + getCommanderDefenseBonus(targetUnit)
                + getCommanderAuraDefenseBonus(targetUnit)
                + (targetUnit.getCampaignDefenseBonus?.(this) || 0)
                + (targetUnit.tile?.isCity ? getCityDefenseBonus(targetUnit.tile) : 0);
            let antiAir = getAntiAirReduction(targetUnit.tile, this.camp, gs.tileMap, { state: gs });
            if (colonelActive) antiAir = Math.max(0, antiAir - COLONEL_ANTI_AIR_PIERCE);
            defense += antiAir;
            const defenseMulti = Math.max(
                COMBAT_BALANCE.defense.minimumMultiplier,
                1 - Math.min(COMBAT_BALANCE.defense.maximumReduction, defense)
            );
            const result = {
                dmg: power * (1 + carrierRankBonus + colonelBonus) * floatMult * defenseMulti,
                isCrit: floatMult > COMBAT_BALANCE.float.attack.critThreshold,
                antiAir
            };
            gs.damageTexts.push({
                x: targetUnit.tile.x, y: targetUnit.tile.y, value: result.dmg, isCrit: result.isCrit,
                isAirDamage: true, timeLeft: 900, lastUpdate: performance.now()
            });
            return result;
        }

        // 无人机机枪射击：走标准四大乘区，空军伤害（受防空减免），克制关系由 COUNTER_RELATION.drone 决定
        if (this._isDrone) {
            const result = this._resolveDamage(this, targetUnit, 1, 0, false, false, true);
            gs.damageTexts.push({
                x: targetUnit.tile.x,
                y: targetUnit.tile.y,
                value: result.dmg,
                isCrit: result.isCrit,
                timeLeft: 900,
                lastUpdate: performance.now()
            });
            return result;
        }

        // 骑兵冲锋·势能制：本回合每移动1格，造成的伤害提高10%（上限30%），雾天额外+5%/格
        // moveDistance 随回合重置，势能回合结束消失
        const baseChargeRate = this.getSpecializationAbility('chargePerStep') || 0;
        const fogChargeDelta = gs && isMechanicEnabled(gs, 'weatherEffects') && gs.weather === 'fog' && baseChargeRate > 0
            ? COMBAT_BALANCE.cavalry.fogChargeDamagePerStep - COMBAT_BALANCE.cavalry.normalChargeDamagePerStep
            : 0;
        const cavBonus = !this.isEmbarked && baseChargeRate > 0
            ? Math.min(this.moveDistance, COMBAT_BALANCE.cavalry.maxChargeSteps) * (baseChargeRate + fogChargeDelta)
            : 0;
        const assaultBonus = isStrongpointTarget(targetUnit) ? (this.getSpecializationAbility('fortificationDamage') || 0) : 0;
        const antiSubBonus = targetUnit.type === 'submarine' ? (this.getSpecializationAbility('submarineDamage') || 0) : 0;
        const fleetBonus = targetUnit.config?.movementDomain === 'naval' && !targetUnit.isEmbarked
            ? (this.getSpecializationAbility('shipDamage') || 0) : 0;
        // 火控雷达只抵消“舰打岸”的跨域减伤；海上运输状态的陆军没有该减伤，不吃这份增伤
        const supportLandBonus = targetUnit.config?.movementDomain !== 'naval' && !targetUnit.isEmbarked
            ? (this.getSpecializationAbility('landDamage') || 0) : 0;
        const submergedBonus = this.type === 'submarine' && this._submarineChargedAttack
            ? (this._unbranchedRankReward?.nextAttackDamage || 0) : 0;
        // 天气条件增伤：雾天骑兵+20%（归入②增伤乘区）；风天炮兵增伤已由野战炮专精的风天穿甲翻倍取代
        const weatherBonus = (!this.isEmbarked && gs && isMechanicEnabled(gs, 'weatherEffects') && gs.weather === 'fog' && this.type === 'cavalry') ? COMBAT_BALANCE.cavalry.fogDamageBonus
            : 0;

        let ignoreDef = this.getSpecializationAbility('armorPierce') || 0;
        if (ignoreDef > 0 && (this.tile.terrain === 'mountain' || (gs && isMechanicEnabled(gs, 'weatherEffects') && gs.weather === 'wind'))) {
            ignoreDef *= 2;
        }
        const targetIsRanged = targetUnit.type === 'archer' || targetUnit.type === 'mgNest' || targetUnit.type === 'drone' || targetUnit.type === 'carrier';
        if (targetIsRanged) ignoreDef += this.getSpecializationAbility('rangedArmorPierce') || 0;
        const result = this._resolveDamage(
            this,
            targetUnit,
            1,
            cavBonus + assaultBonus + antiSubBonus + fleetBonus + supportLandBonus + submergedBonus + weatherBonus,
            false,
            false,
            false,
            ignoreDef,
            0
        );

        gs.damageTexts.push({
            x: targetUnit.tile.x,
            y: targetUnit.tile.y,
            value: result.dmg,
            isCrit: result.isCrit,
            timeLeft: 900,
            lastUpdate: performance.now()
        });
        return result;
    }

    calculateCounterDamage(attackerUnit) {
        const log = _logMessage;
        const gs = _gameState;

        if (this.type === 'carrier' || attackerUnit?.type === 'carrier'
            || this._transportTransitionedThisTurn || this.counterAttackCount >= 1 || this._campaignNoCounter
            || (isMechanicEnabled(_gameState, 'morale') && this.morale === 0)) {
            return { dmg: 0, isCrit: false };
        }
        if (attackerUnit?.type === 'submarine' && this.type !== 'submarine') {
            return { dmg: 0, isCrit: false };
        }
        // 无人机攻击地面单位时，地面单位无法反击
        if (attackerUnit && attackerUnit._isDrone && !this._isDrone) {
            return { dmg: 0, isCrit: false };
        }
        // 反击可达性：攻击者必须落在防守方自身射程内才能还击
        //   近战单位(步/骑) 射程1 → 仅贴脸攻击可被反击
        //   远程单位(炮/碉堡) 射程2 → 2格内的攻击者（含远程炮击/近战贴脸）均可被反击
        const counterIsRanged = isRangedAttackPresentation(this);
        const counterRange = this._isDrone ? 2 : (counterIsRanged ? this.getEffectiveRange() : 1);
        if (hexDistance(attackerUnit.tile, this.tile) > counterRange) {
            return { dmg: 0, isCrit: false };
        }
        // Melee retaliation follows the same surface-domain rule as a normal
        // assault. For example, infantry on land cannot counter a warship that
        // fired from an adjacent water cell, while ranged defenders still can.
        if (!canUnitTargetUnit(this, attackerUnit, gs)) {
            return { dmg: 0, isCrit: false };
        }

        const result = this._resolveDamage(this, attackerUnit, COMBAT_BALANCE.float.counter.baseMultiplier, 0, true, false, this._isDrone);
        const counterReduction = attackerUnit.getSpecializationAbility?.('counterDamageReduction') || 0;
        if (counterReduction > 0) result.dmg *= 1 - counterReduction;

        if (this.hp > 0) {
            this.counterAttackCount++;
            log(`${this.camp.name} ${this.config.name}兵反击造成${Math.round(result.dmg)}伤害${result.isCrit ? '，反击强击！' : ''}`);

            gs.damageTexts.push({
                x: attackerUnit.tile.x,
                y: attackerUnit.tile.y,
                value: result.dmg,
                isCrit: result.isCrit,
                timeLeft: 750,
                lastUpdate: performance.now()
            });
        }
        return result;
    }

    // ===== 统一伤害入口 =====================
    // 所有伤害结算必须经此进入（普攻/反击由 takeDamage 薄包装转入）。
    // source 来源标签决定结算规则：
    //   'melee'  近战攻击                          —— 吸收护盾；触发铁卫转移/圣骑士誓言
    //   'ranged' 远程攻击(炮兵/碉堡/空袭对策卡)    —— 同上
    //   'true'   真实伤害(雷击/至圣斩/殉道自爆/灼烧) —— 绕过护盾和全部乘区；不触发铁卫转移/誓言
    // opts:
    //   attacker     击杀记功单位（缺省不计 killCount）
    //   skipAura     强制跳过铁卫转移/誓言
    //   ignoreShield 覆写护盾规则（缺省由 source 决定）
    //   minHp        生命下限，伤害不致死（堕天使灼烧=1）
    // 返回 true 表示目标死亡
    applyDamage(dmg, opts = {}) {
        const {
            source = 'true',
            attacker = null,
            skipAura = false,
            ignoreShield = source === 'true',
            minHp = 0
        } = opts;
        const log = _logMessage;
        const oldHp = this.hp;
        const effectiveMinHp = Math.max(minHp, Number(this._campaignMinHp) || 0);

        if (this.godMode) return false;

        let actualDmg = dmg;

        // 护盾优先吸收伤害（真实伤害绕过）
        const suppressedIronGuardShield = areCommanderMechanicsSuppressed(this) && this.commander === 'ironGuard' && this._shieldTurns >= 999;
        if (!ignoreShield && !suppressedIronGuardShield && this._shield > 0 && actualDmg > 0) {
            const absorbed = Math.min(this._shield, actualDmg);
            this._shield -= absorbed;
            actualDmg -= absorbed;
            if (actualDmg <= 0) return false;
        }

        const auraApplies = !skipAura && (source === 'melee' || source === 'ranged');

        // 铁卫灵光：相邻友军所受伤害由铁卫护盾承担；护盾不足时溢出部分由友军自己承担
        if (auraApplies && this.commander !== 'ironGuard' && _gameState) {
            const ironGuard = this._findAdjacentFriendlyIronGuard();
            if (ironGuard && ironGuard._shield > 0) {
                const leftover = Math.max(0, getCommanderAllyAuraDamage(this, actualDmg, ironGuard));
                // 同步友军头顶伤害数字：全部吸收则移除，部分吸收则改为实际承受值
                const dts = _gameState.damageTexts;
                for (let i = dts.length - 1; i >= 0; i--) {
                    if (dts[i].x === this.tile.x && dts[i].y === this.tile.y) {
                        if (leftover <= 0) dts.splice(i, 1);
                        else dts[i].value = Math.round(leftover);
                        break;
                    }
                }
                actualDmg = leftover;
                if (actualDmg <= 0) return false;
            }
        }

        // 圣骑士誓言：友军受击概率获得誓言
        if (auraApplies && actualDmg > 0) {
            triggerCommanderAllyDamage(this, actualDmg);
        }

        // 牧师治愈灵光·临终迸发：致命一击时提前释放剩余 HoT，若仍不足抵扣或治疗后
        // 仍低于20%最大生命，则血量固定为20%最大生命；灵光随之消耗。
        // （minHp>0 的伤害本就不致死，如堕天使灼烧，不触发此保底）
        if (this._healingAura > 0 && effectiveMinHp <= 0 && (this.hp - actualDmg) <= 0) {
            const balance = COMMANDER_CONFIG.priest.balance;
            const burst = Math.round(this.maxHp * balance.auraHealPct * this._healingAura);
            const floor = Math.round(this.maxHp * balance.minimumHpPct);
            this._healingAura = 0;
            this.hp = Math.max(Math.round(this.hp - actualDmg + burst), floor);
            if (_gameState && _gameState.healTexts) {
                _gameState.healTexts.push({
                    x: this.tile.x, y: this.tile.y, value: burst,
                    timeLeft: 1000, lastUpdate: performance.now()
                });
            }
            emit('fx:healFlash', { x: this.tile.x, y: this.tile.y });
            emit('fx:healParticles', { x: this.tile.x, y: this.tile.y });
            emit('fx:commanderSkill', { x: this.tile.x, y: this.tile.y, glyph: '\u{1F54A}\u{FE0F}', label: '临终迸发' });
            log(`${this.camp.name}${this.config.name}兵的【治愈灵光】临终迸发，从致命一击中幸存（+${burst}HP）`);
            return false;
        }

        this.hp = Math.round(Math.max(effectiveMinHp, this.hp - actualDmg));
        if (this.hp !== oldHp) emit('match:unitHpChanged', {
            unit: this, unitId: this.id, oldHp, newHp: this.hp, delta: this.hp - oldHp,
            source, sourceUnit: attacker, sourceUnitId: attacker?.id || null
        });
        // 殉道者：HP≤1时进入自爆倒计时（包括致死伤害）
        if (!areCommanderMechanicsSuppressed(this) && this.commander === 'martyr' && !this._martyrPrimed && this.hp <= COMMANDER_CONFIG.martyr.balance.triggerHp) {
            this._martyrPrimed = true;
            this.hp = COMMANDER_CONFIG.martyr.balance.triggerHp;
            this.canAct = false;
            this.remainingMP = 0;
            log(`${this.camp.name}殉道者【${this.config.name}兵】生命垂危，进入殉道倒计时！`);
            emit('fx:commanderSkill', { x: this.tile.x, y: this.tile.y, glyph: '💥', label: '殉道倒计时' });
            return false;
        }
        // 殉道者已进入倒计时后再次受伤：血量锁死在1，不会死亡
        if (this.commander === 'martyr' && this._martyrPrimed && this.hp <= 0) {
            this.hp = 1;
            return false;
        }
        if (this.hp <= 0) {
            this.destroy(attacker);
            return true;
        }
        return false;
    }

    // 单位死亡统一出口：将领效果清除、离场、击杀计数、阵亡特效
    // （殉道者自爆的自毁也走这里，保证 commanderP1/P2/P3 引用被清除）
    destroy(attackerUnit = null) {
        const log = _logMessage;
        if (this._campaignDeathEmitted) return;
        this._campaignDeathEmitted = true;
        const deathSnapshot = {
            unitId: this.id,
            unitType: this.type,
            camp: this.camp,
            killerId: attackerUnit?.id || null,
            killerType: attackerUnit?.type || null,
            killerCamp: attackerUnit?.camp || null,
            reason: attackerUnit ? 'combat' : 'effect',
            campaignMinHp: this._campaignMinHp || 0,
            campaignMaxHp: this._campaignMaxHp || 0
        };
        // 工程师脚手架被摧毁：立即解除对应工程师的施工锁定（金币不返还）
        if (this._engineerScaffold && _gameState) {
            const builderId = this._engineerScaffold.builderId;
            for (const t of _gameState.tiles) {
                const u = t.unit;
                if (u && u.id === builderId && u._engineerConstruction && u._engineerConstruction.scaffoldId === this.id) {
                    u._engineerConstruction = null;
                    break;
                }
            }
            if (log) log(`${this.camp.name}工程师的碉堡在施工中被摧毁，工程师解除锁定`);
        }
        if (this.commander) {
            // 空军上校阵亡 → 禁用对应玩家的专属空军卡
            if (this.commander === 'colonel' && _gameState && _gameState._colonelDeployed) {
                const campKey = campToKey(this.camp);
                _gameState._colonelDeployed[campKey] = false;
                // 上校阵亡：收回所有空军对策卡（仅保留部署卡）
                if (_gameState.playerHands && _gameState.playerHands[campKey]) {
                    const hand = _gameState.playerHands[campKey];
                    for (let hi = hand.length - 1; hi >= 0; hi--) {
                        const cid = typeof hand[hi] === 'object' ? hand[hi].id : hand[hi];
                        if (cid === 'diveStrafe' || cid === 'carpetBomb' || cid === 'airlift') {
                            hand.splice(hi, 1);
                        }
                    }
                }
            }
            const commanderSlots = campToKey(this.camp) === 'player1'
                ? ['commanderP1', 'commanderP1Secondary']
                : campToKey(this.camp) === 'player2'
                    ? ['commanderP2', 'commanderP2Secondary']
                    : campToKey(this.camp) === 'player3'
                        ? ['commanderP3', 'commanderP3Secondary']
                        : null;
            if (commanderSlots && _gameState[commanderSlots[0]] === this.commander) _gameState[commanderSlots[0]] = null;
            else if (commanderSlots && _gameState[commanderSlots[1]] === this.commander) _gameState[commanderSlots[1]] = null;
        }
        if (this.isCommanderUnit && log) log(`${this.camp.name}将领【${this.getCommanderDisplayName()}】阵亡${this.commander ? '，效果消失' : ''}`);

        // 所有来源击杀将领：全军士气+1（攻击方阵营；无明确攻击者时以当前回合阵营为准）
        if (this.isCommanderUnit) {
            let killerCamp = null;
            if (attackerUnit && isHostile(_gameState, attackerUnit.camp, this.camp)) {
                killerCamp = attackerUnit.camp;
            } else if (!attackerUnit && _gameState && _gameState.currentCamp !== this.camp) {
                killerCamp = _gameState.currentCamp;
            }
            if (killerCamp) {
                const kKey = campToKey(killerCamp);
                if (kKey) {
                    if (!_gameState.factionMoraleBoost) _gameState.factionMoraleBoost = {};
                    _gameState.factionMoraleBoost[kKey] = getRoundIndex(_gameState) + COMMANDER_CONFIG.martyr.balance.moraleBoostRounds;
                    for (const tile of _gameState.tiles) {
                        const u = tile.unit;
                        if (u && u.camp === killerCamp && u.morale !== 0 && u.morale < 3) {
                            const oldM = u.morale;
                            u.morale = Math.min(3, u.morale + 1);
                            if (u.morale === 3) u.moraleBoostUntil = getRoundIndex(_gameState) + COMMANDER_CONFIG.martyr.balance.moraleBoostRounds;
                            if (u.morale !== oldM) emit('fx:morale', { unit: u });
                        }
                    }
                    emit('fx:factionMorale', { color: '#ffd700' });
                    log(`⚔ ${killerCamp.name}斩杀敌方将领，全军士气+1！`);
                }
            }
        }

        // 己方阵营 key（供留魂标记 + 殉道者挽歌被动共用）
        const ownKey = campToKey(this.camp) === 'neutral' ? null : campToKey(this.camp);

        // E2 亡灵法师留魂：非魂卒、非将领单位阵亡时留下亡魂标记（脚手架不留魂）
        if (!this._isSoulMinion && !this.isCommanderUnit && !this._engineerScaffold && this.tile && _gameState && _gameState.tileMap) {
            // 检查是否有亡灵法师在场上
            let hasNecromancer = false;
            for (const t of _gameState.tiles) {
                // 仅同阵营亡灵法师能牵引本方亡魂 → 只有同阵营在场才留标记
                if (t.unit && t.unit.commander === 'necromancer' && !areCommanderMechanicsSuppressed(t.unit) && isFriendly(_gameState, t.unit.camp, this.camp) && t.unit.hp > 0) {
                    hasNecromancer = true;
                    break;
                }
            }
            if (hasNecromancer) {
                if (!_gameState._soulMarks) _gameState._soulMarks = [];
                _gameState._soulMarks.push({
                    q: this.tile.q, r: this.tile.r,
                    campKey: ownKey,
                    bornAt: getRoundIndex(_gameState),  // 回合数(0-indexed)，与老化检查一致
                    origType: this.type,                // 保留原兵种
                    origMaxHp: this.maxHp,              // 保留原生命上限（含将领加成）
                    origAtkBonus: this._atkBonus || 0   // 保留原攻击加成（含将领加成）
                });
            }
        }

        // 记录己方阵营阵亡数（供殉道者挽歌被动使用）
        if (ownKey) {
            if (!_gameState._friendlyDeathCount) _gameState._friendlyDeathCount = {};
            _gameState._friendlyDeathCount[ownKey] = (_gameState._friendlyDeathCount[ownKey] || 0) + 1;
        }
        this.hp = 0;
        this.tile.unit = null;
        log(`${this.camp.name} ${this.config.name}兵被消灭`);
        if (attackerUnit) {
            const key = campToKey(attackerUnit.camp);
            _gameState.killCount[key] = (_gameState.killCount[key] || 0) + 1;
        }
        emit('fx:explosion', { x: this.tile.x, y: this.tile.y, color: '#ff2200', count: 30 });
        emit('fx:explosion', { x: this.tile.x, y: this.tile.y, color: '#ffaa00', count: 15 });
        emit('fx:screenShake', { strength: 4, duration: 150 });
        emit('match:unitKilled', deathSnapshot);
    }

    // 普攻/反击入口（保留旧签名，内部转入 applyDamage）
    takeDamage(dmg, attackerUnit, _skipAura = false) {
        let source = 'true';
        if (attackerUnit) source = isRangedAttackPresentation(attackerUnit) ? 'ranged' : 'melee';
        return this.applyDamage(dmg, { source, attacker: attackerUnit, skipAura: _skipAura });
    }

    // 查找相邻6格内己方铁卫
    _findAdjacentFriendlyIronGuard() {
        if (!this.tile || !_gameState) return null;
        const tileMap = _gameState.tileMap;
        const dirs = HEX_NEIGHBORS;
        for (const [dq, dr] of dirs) {
            const neighbor = tileMap.get(`${this.tile.q + dq},${this.tile.r + dr}`);
            if (neighbor && neighbor.unit && neighbor.unit.commander === 'ironGuard' && !areCommanderMechanicsSuppressed(neighbor.unit) && isFriendly(_gameState, neighbor.unit.camp, this.camp) && neighbor.unit._shield > 0) {
                return neighbor.unit;
            }
        }
        return null;
    }

    heal(amount) {
        // 殉道者进入倒计时后强制锁死hp=1，拒绝一切治疗
        if (this.commander === 'martyr' && this._martyrPrimed) return 0;
        const gs = _gameState;
        const oldHp = this.hp;
        const cap = this._campaignMaxHp || this.maxHp;
        this.hp = Math.min(this.maxHp, Math.min(cap, this.hp + amount));
        const actualHeal = this.hp - oldHp;

        if (actualHeal > 0) {
            emit('match:unitHpChanged', {
                unit: this, unitId: this.id, oldHp, newHp: this.hp, delta: actualHeal,
                source: 'heal', sourceUnit: null, sourceUnitId: null
            });
            gs.healTexts.push({
                x: this.tile.x,
                y: this.tile.y,
                value: actualHeal,
                timeLeft: 1000,
                lastUpdate: performance.now()
            });
            emit('fx:healFlash', { x: this.tile.x, y: this.tile.y });
            emit('fx:healParticles', { x: this.tile.x, y: this.tile.y });
            return actualHeal;
        }
        return 0;
    }

    addXP(amount) {
        if (this._rankLocked || this._rank >= 4 || amount <= 0) return;
        if (this.commander === 'centurion' && !areCommanderMechanicsSuppressed(this)) amount *= COMMANDER_CONFIG.centurion.balance.veteranXpMultiplier;
        this._xp += amount;
        this._checkRankUp();
    }

    _checkRankUp() {
        const rankRules = COMBAT_BALANCE.rank;
        const thresholds = rankRules.xpThresholds;
        const previousRank = this._rank;
        while (this._rank < thresholds.length && this._xp >= thresholds[this._rank]) {
            this._rank++;
            _pendingRankUps.push({ unitId: this.id, rank: this._rank, x: this.tile.x, y: this.tile.y });
            emit('fx:rankUp', { x: this.tile.x, y: this.tile.y, rank: this._rank });
        }
        if (this._rank === previousRank) return;

        this._rebuildRankProfile();
        if (this.pendingSpecialization && _allowAutoSpecialization(this)) {
            const defaultSpecialization = chooseDefaultSpecialization(this, _gameState);
            if (defaultSpecialization) this.chooseSpecialization(defaultSpecialization);
        }
        // 一次经验结算即使跨越多阶，也只按最终面板恢复一次已损失生命值。
        if (!(this.commander === 'martyr' && this._martyrPrimed)) {
            const lostHp = this.maxHp - this.hp;
            if (lostHp > 0) this.heal(Math.round(lostHp * rankRules.rankUpHealLostPct));
        }
    }

    _applyRankBonus() {
        return this._rebuildRankProfile();
    }
}
