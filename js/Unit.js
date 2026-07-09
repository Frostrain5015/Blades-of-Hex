import { HEX_SIZE, ctx, hexPath, drawHexagonOutline, CAMP, UNIT_CONFIG, COUNTER_RELATION, settings, frameInfo, CAMP_FLAG_COLORS, MORALE_CONFIG, TERRAIN_CONFIG, roundRectPath, hexDistance, HEX_NEIGHBORS, getRoundIndex } from './config.js';
import { getCommander, getCommanderDefenseBonus, getCommanderAuraDefenseBonus, getCommanderAllyAuraDamage, getCommanderAttackBonus, getCommanderAuraAttackBonus, getCommanderWeatherImmunity, getCommanderWeatherDebuff, isCommanderGuaranteedCrit, getCommanderCritRateBonus, triggerCommanderOnMoraleChange, triggerCommanderAllyDamage, triggerCommanderOnDamageTaken } from './commanderInterface.js';
import { getPortrait } from './portraitLoader.js';
import { nextId } from './uid.js';
import { isNetworkGame, getMyRole } from './network.js';
import { spawnExplosionParticles, spawnHealParticles, triggerAttackFlash, triggerHealFlash, triggerScreenShake, moraleEffects, spawnCommanderSkillEffect, spawnRankUpEffect, getRecoilOffset, getChargeOffset, spawnMoraleEffect, triggerFactionMoraleFlash } from './effects.js';

// 延迟引用，由游戏逻辑设置(避免循环依赖)
let _logMessage = null;
let _gameState = null;
// 晋升事件收集（供联机同步，每轮 action 前清空）
export let _pendingRankUps = [];
export function setLogMessageRef(fn) { _logMessage = fn; }
export function setGameStateRef(ref) { _gameState = ref; }

function _isHumanTurn(gs) {
    if (isNetworkGame()) {
        const role = getMyRole();
        if (role === 'player1') return gs.currentCamp === CAMP.player1;
        if (role === 'player2') return gs.currentCamp === CAMP.player2;
        if (role === 'player3') return gs.currentCamp === CAMP.player3;
        return false;
    }
    if (gs.gameMode === 'pve' && gs.aiOpponentCamp) {
        return gs.currentCamp !== CAMP.neutral && gs.currentCamp !== gs.aiOpponentCamp;
    }
    return gs.currentCamp !== CAMP.neutral;
}

export class Unit {
    constructor(type, camp, tile, isNewRecruit = false, idOverride = null, commander = null) {
        this.id = idOverride ?? nextId();
        this.type = type;
        this.config = UNIT_CONFIG[type];
        this.camp = camp;
        this.commander = commander;
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
        this.godMode = false;
        this._xp = 0;
        this._rank = 0;
        this._rankDefBonus = 0;
        this._rankCritBonus = 0;
        this._rankRegenPct = 0;
        this._fallen = false;
        this._gongxinStacks = 0;
        this._shieldPulseUntil = 0;
        this.activeSkillCD = 0;
        this.activeSkillDur = 0;
        this._imprisoned = false;
        this._isImmobile = false;
        this._phantomStacks = 0;
        this._shield = 0;
        this._shieldMax = 0;
        this._shieldTurns = 0;
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

        // 攻心持续效果（永久士气debuff）
        if (this._gongxinStacks > 0) {
            effects.push({
                label: '攻心',
                desc: `士气-${this._gongxinStacks}`,
                color: '#cc44ff',
                remaining: '永久'
            });
        }

        // 主动技能持续中
        if (this.activeSkillDur > 0 && this.commander) {
            const cmdCfg = getCommander(this.commander);
            if (cmdCfg && cmdCfg.activeSkill) {
                const buffParts = [];
                if (cmdCfg.activeSkill.buffs) {
                    const b = cmdCfg.activeSkill.buffs;
                    if (b.atk) buffParts.push(`攻击力+${b.atk}`);
                    if (b.def) buffParts.push(`防御力+${Math.round(b.def * 100)}%`);
                }
                effects.push({
                    label: cmdCfg.activeSkill.name,
                    desc: buffParts.length ? buffParts.join('，') : '',
                    color: '#ff8844',
                    remaining: this.activeSkillDur
                });
            }
        }

        // 护盾（铁卫永久护盾不在效果区显示，已在HP条中体现）
        if (this._shield > 0 && !(this.commander === 'ironGuard' && this._shieldTurns >= 999)) {
            effects.push({ label: '护盾', desc: `${Math.round(this._shield)}/${this._shieldMax}（${this._shieldTurns}回合）`, color: '#66bbff' });
        }
        if (this._imprisoned) {
            effects.push({ label: '禁锢', desc: '本回合无法移动', color: '#ff8844' });
        }
        if (this._isImmobile) {
            effects.push({ label: '不可移动', desc: '该单位无法移动', color: '#888' });
        }

        // 圣骑士誓言 + 勇气灵光
        if (this.commander === 'paladin') {
            effects.push({ label: '誓言', desc: `${this._faith}/3`, color: '#ffd700' });
            effects.push({ label: '勇气灵光', desc: '自身及相邻友军攻击+10%，士气保护', color: '#ffd700' });
        }
        if (this._smiteReady) {
            const smiteLabel = this._smiteCharged ? '至圣斩·誓约' : '至圣斩';
            effects.push({ label: smiteLabel, desc: '每层下次攻击附加伤害', color: '#ffd700' });
        }

        // 勇气灵光 — 受相邻圣骑士影响
        if (this.commander !== 'paladin' && gameState && gameState.tileMap && this.tile) {
            let hasPaladinAura = false;
            for (const [dq, dr] of HEX_NEIGHBORS) {
                const nb = gameState.tileMap.get(`${this.tile.q + dq},${this.tile.r + dr}`);
                if (nb && nb.unit && nb.unit.commander === 'paladin' && nb.unit.camp === this.camp) {
                    hasPaladinAura = true;
                    break;
                }
            }
            if (hasPaladinAura) {
                effects.push({ label: '勇气灵光', desc: '攻击力+10%，士气保护', color: '#ffd700' });
            }
        }

        // 牧师治愈灵光
        if (this._healingAura > 0) {
            effects.push({ label: '治愈灵光', desc: `每回合回复20%最大生命值；受致命一击时提前释放全部剩余治疗，仍不足则保底20%生命`, color: '#44dd88', remaining: this._healingAura });
        }

        return effects;
    }

    // 返回主动技能冷却剩余轮数（供 tooltip 属性栏展示）
    getCooldownRounds() {
        return this.activeSkillCD > 0 ? this.activeSkillCD : 0;
    }

    getVisualPos() {
        const baseX = this.tile.x, baseY = this.tile.y;
        let vx = baseX, vy = baseY;

        if (this.movePath) {
            const path = this.movePath;
            const elapsed = frameInfo.now - this.movePathStart;
            if (elapsed >= this.movePathDuration) {
                vx = path[path.length - 1].x;
                vy = path[path.length - 1].y;
            } else {
                const segs = [];
                let totalLen = 0;
                for (let i = 1; i < path.length; i++) {
                    const dx = path[i].x - path[i-1].x;
                    const dy = path[i].y - path[i-1].y;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    segs.push({ from: path[i-1], to: path[i], len, acc: totalLen });
                    totalLen += len;
                }
                if (totalLen === 0) {
                    vx = baseX; vy = baseY;
                } else {
                    const tTotal = elapsed / this.movePathDuration;
                    const target = tTotal * totalLen;
                    let found = false;
                    for (const seg of segs) {
                        if (target <= seg.acc + seg.len) {
                            const t = Math.max(0, Math.min(1, (target - seg.acc) / seg.len));
                            const eased = 1 - Math.pow(1 - t, 3);
                            vx = seg.from.x + (seg.to.x - seg.from.x) * eased;
                            vy = seg.from.y + (seg.to.y - seg.from.y) * eased;
                            found = true;
                            break;
                        }
                    }
                    if (!found) { vx = baseX; vy = baseY; }
                }
            }
        }

        // 后坐力偏移（炮兵开火时）
        const recoil = getRecoilOffset(baseX, baseY, frameInfo.now);
        if (recoil) {
            vx += recoil.x;
            vy += recoil.y;
        }

        // 近战突进偏移（撞击目标）
        const charge = getChargeOffset(this.id, frameInfo.now);
        if (charge) {
            vx += charge.x;
            vy += charge.y;
        }

        return { x: vx, y: vy };
    }

    startMovePath(path) {
        if (!path || path.length < 2) return;
        this.movePath = path;
        this.movePathStart = frameInfo.now;
        this.movePathDuration = (path.length - 1) * 120 / (settings.animationSpeed || 1);
    }

    draw(tileX, tileY) {
        if (this._airdropWaiting) return; // invisible until parachute lands
        if (this._airliftLandAt) {         // E4 空运途中：落地前隐藏，落地时现身
            if (frameInfo.now < this._airliftLandAt) return;
            this._airliftLandAt = 0;
        }
        if (this._soulRecallLandAt) {      // E2 魂卒召回：黑烟飞抵后才现身
            if (frameInfo.now < this._soulRecallLandAt) return;
            this._soulRecallLandAt = 0;
        }
        const now = frameInfo.now;
        const pos = this.getVisualPos();
        let visualX = pos.x, visualY = pos.y;
        if (this.movePath) {
            if (now - this.movePathStart >= this.movePathDuration) {
                this.movePath = null;
            }
        }

        const gs = _gameState;
        const time = now / 1000;

        const isP1 = this.camp === CAMP.player1;
        const isP2 = this.camp === CAMP.player2;
        const isP3 = this.camp === CAMP.player3;
        const campKey = isP1 ? 'p1' : isP2 ? 'p2' : isP3 ? 'p3' : 'neu';
        const cc = CAMP_FLAG_COLORS[campKey];

        ctx.save();
        ctx.translate(visualX, visualY);

        // ── Flag (below badge and ring) ──
        if (!this.tile.isCity && !this.tile.isVillage) {
            const poleX = -13;
            const poleTop = -30;
            const poleBottom = 2;
            ctx.beginPath();
            ctx.moveTo(poleX, poleTop);
            ctx.lineTo(poleX, poleBottom);
            ctx.strokeStyle = '#bbb';
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(poleX, poleTop, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffd700';
            ctx.fill();

            const wave = Math.sin(time * 7 + this.id * 1.3) * 2.0;
            const flagLeft = poleX + 1;
            const flagRight = flagLeft + 10;
            const flagTop = poleTop + 2;
            const flagMid = flagTop + 4;
            const flagBot = flagTop + 10;
            ctx.beginPath();
            ctx.moveTo(flagLeft, flagTop);
            ctx.quadraticCurveTo(flagLeft + 3, flagMid - 2 + wave, flagRight, flagMid + wave);
            ctx.lineTo(flagRight, flagBot + wave * 0.7);
            ctx.quadraticCurveTo(flagLeft + 3, flagMid + 2 + wave * 0.7, flagLeft, flagBot);
            ctx.closePath();
            const flagGrad = ctx.createLinearGradient(flagLeft, 0, flagRight, 0);
            flagGrad.addColorStop(0, cc.main);
            flagGrad.addColorStop(1, cc.dark);
            ctx.fillStyle = flagGrad;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 0.6;
            ctx.stroke();

            // 将领星标（跟随旗帜飘动+扭曲）
            if (this.commander) {
                ctx.save();
                ctx.translate(flagLeft + 5, flagTop + 5 + wave * 0.5);
                const waveTilt = Math.cos(time * 7 + this.id * 1.3) * 0.14;
                ctx.rotate(waveTilt);
                ctx.fillStyle = '#ffd700';
                ctx.font = 'bold 9px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = '#ffd700';
                ctx.shadowBlur = 5;
                ctx.fillText('★', 0, 0);
                ctx.restore();
            }
        }

        // ── Badge ──
        // ── Floating shadow for entire badge+ring group ──
        ctx.save();
        if (this._isDrone || this.type === 'drone') {
            ctx.translate(0, Math.sin(time * 2.5) * 3);
        }
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;

        const badgeR = 15;
        const badgeY = 1;
        ctx.beginPath();
        ctx.arc(0, badgeY, badgeR, 0, Math.PI * 2);
        const badgeGrad = ctx.createRadialGradient(-1, badgeY - 2, badgeR * 0.05, 0, badgeY, badgeR);
        badgeGrad.addColorStop(0, cc.light);
        badgeGrad.addColorStop(1, cc.dark);
        ctx.fillStyle = badgeGrad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // ── Unit type character ──
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const glyphs = { infantry: '⚔', cavalry: '🐎', archer: '🎯', mgNest: '🏰', drone: '✈' };
        ctx.fillText(glyphs[this.type] || '?', 0, badgeY + 1);

        // ── Ring HP bar ──
        const lerpFactor = 0.18;
        this.displayHp += (this.hp - this.displayHp) * lerpFactor;
        if (Math.abs(this.hp - this.displayHp) < 0.3) this.displayHp = this.hp;
        this._displayShield += (this._shield - this._displayShield) * lerpFactor;
        if (Math.abs(this._shield - this._displayShield) < 0.3) this._displayShield = this._shield;
        this._displayShield += (this._shield - this._displayShield) * lerpFactor;
        if (Math.abs(this._shield - this._displayShield) < 0.3) this._displayShield = this._shield;

        this.displaySpeed += (this.remainingMP - this.displaySpeed) * lerpFactor;
        if (Math.abs(this.remainingMP - this.displaySpeed) < 0.3) this.displaySpeed = this.remainingMP;

        const hpRatio = this.displayHp / this.maxHp;
        const ringR = badgeR;
        const ringW = 3.5;
        const startAngle = -Math.PI / 2;
        const sweepAngle = hpRatio * Math.PI * 2;

        // Background ring
        ctx.beginPath();
        ctx.arc(0, badgeY, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = ringW;
        ctx.stroke();

        // HP arc
        if (hpRatio > 0.005) {
            let hpColor;
            if (hpRatio > 0.7) hpColor = '#4CAF50';
            else if (hpRatio > 0.35) hpColor = '#FFC107';
            else hpColor = '#f44336';

            ctx.beginPath();
            ctx.arc(0, badgeY, ringR, startAngle, startAngle + sweepAngle);
            ctx.strokeStyle = hpColor;
            ctx.lineWidth = ringW;
            ctx.lineCap = 'round';
            ctx.stroke();
        }

        // Shield overlay arc
        const shieldRatio = this._displayShield > 0.5 ? this._displayShield / this.maxHp : 0;
        if (shieldRatio > 0.003) {
            const shieldSweep = shieldRatio * Math.PI * 2;
            const shieldStart = startAngle + sweepAngle;
            ctx.beginPath();
            ctx.arc(0, badgeY, ringR, shieldStart, shieldStart + shieldSweep);
            ctx.strokeStyle = '#66bbff';
            ctx.lineWidth = ringW;
            ctx.lineCap = 'round';
            ctx.stroke();
        }

        ctx.restore(); // end floating shadow group

        // Morale marker — hex corner badge (top-right)
        const hasMoraleAnim = moraleEffects.some(fx => fx.unitId === this.id);
        if (this.morale !== 2 && !hasMoraleAnim) {
            const mc = MORALE_CONFIG[this.morale];
            const mx = HEX_SIZE * 0.55 + (this.morale === 0 ? 2 : 0);
            const my = -HEX_SIZE * 0.35;
            ctx.fillStyle = mc.color;
            ctx.font = this.morale === 0 ? 'bold 14px Arial' : 'bold 11px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = 3;
            ctx.fillText(mc.icon, mx, my + 1);
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        }

        // Imprisoned lock — same position as Iron Guard shield
        if (this._imprisoned) {
            ctx.fillStyle = '#ff8844';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = 3;
            ctx.fillText('🔒', 0, -HEX_SIZE * 0.82);
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        }

        ctx.restore();

        // ── Actionable glow（仅己方回合显示）──
        if (this.canAct && gs && this.camp === gs.currentCamp && !this.isNewRecruit && _isHumanTurn(gs)) {
            ctx.save();
            const pulse = (Math.sin(time * 3.2 * Math.PI) + 1) / 2;
            const alpha1 = 0.18 + pulse * 0.45;
            const alpha2 = 0.08 + (1 - pulse) * 0.25;
            const r1 = HEX_SIZE + 2 + pulse * 3;
            const r2 = HEX_SIZE + 6 + (1 - pulse) * 4;
            drawHexagonOutline(ctx, visualX, visualY, r1, `rgba(255,215,0,${alpha1})`, 2.5);
            drawHexagonOutline(ctx, visualX, visualY, r2, `rgba(255,255,200,${alpha2})`, 1.5);
            ctx.restore();
        }

        // ── Berserker blood rage glow（已损HP越多越明显） ──
        if (this.commander === 'berserker' && this.hp < this.maxHp) {
            const hpLostPct = ((this.maxHp - this.hp) / this.maxHp) * 100;
            const stacks = Math.min(50, Math.floor(hpLostPct / 1.5));
            if (stacks > 0) {
                ctx.save();
                const intensity = stacks / 50;
                const ragePulse = (Math.sin(time * 6 * Math.PI) + 1) / 2;
                ctx.fillStyle = `rgba(255,80,20,${(0.4 + ragePulse * 0.4) * intensity})`;
                ctx.font = 'bold 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = '#ff4400'; ctx.shadowBlur = 4 + 4 * intensity;
                ctx.fillText('💢', visualX, visualY - HEX_SIZE * 0.55);
                ctx.shadowBlur = 0;
                ctx.restore();
            }
        }

        // ── Iron Guard shield marker (above flag, same layer as berserker rage) ──
        if (this.commander === 'ironGuard') {
            ctx.save();
            const shieldRatio = Math.min(1, this._shield / Math.max(this._shieldMax, 1));
            const shieldPulse = (Math.sin(time * 3 * Math.PI) + 1) / 2;
            const shieldY = visualY - HEX_SIZE * 0.82;
            const inFlash = performance.now() < this._shieldPulseUntil;
            const flashT = inFlash ? 1 - (this._shieldPulseUntil - performance.now()) / 800 : 0;

            // 承伤扩散环（呼吸灯式向外扩散）— 强度随护盾比例
            if (inFlash) {
                const ringR = HEX_SIZE * 0.2 + flashT * HEX_SIZE * 1.5;
                const ringAlpha = (1 - flashT) * 0.7 * shieldRatio;
                ctx.beginPath();
                ctx.arc(visualX, shieldY, ringR, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(140,200,255,${ringAlpha})`;
                ctx.lineWidth = (3 * (1 - flashT) + 1) * shieldRatio;
                ctx.stroke();
                const ring2R = ringR + HEX_SIZE * 0.25;
                const ring2Alpha = (1 - flashT) * 0.35 * shieldRatio;
                ctx.beginPath();
                ctx.arc(visualX, shieldY, ring2R, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(180,220,255,${ring2Alpha})`;
                ctx.lineWidth = (2 * (1 - flashT)) * shieldRatio;
                ctx.stroke();
            }

            // shield glyph — 强度随护盾比例
            const glyphAlpha = shieldRatio * (inFlash ? 0.9 + flashT * 0.1 : 0.7 + shieldPulse * 0.3);
            ctx.fillStyle = `rgba(130,200,255,${glyphAlpha})`;
            const glyphSize = 13 * (0.6 + 0.4 * shieldRatio);
            ctx.font = `bold ${Math.round(glyphSize)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = inFlash ? '#aaddff' : '#5599cc';
            ctx.shadowBlur = shieldRatio * (inFlash ? 8 + flashT * 8 : 5);
            ctx.fillText('🛡', visualX, shieldY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── Paladin smite ready marker ──
        if (this._smiteReady) {
            ctx.save();
            const smitePulse = (Math.sin(time * 5 * Math.PI) + 1) / 2;
            const smiteY = visualY - HEX_SIZE * 0.55;
            ctx.fillStyle = `rgba(255,215,0,${0.7 + smitePulse * 0.3})`;
            ctx.font = 'bold 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 6;
            ctx.fillText('✗', visualX, smiteY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── Priest healing aura glow ──
        if (this._healingAura > 0) {
            ctx.save();
            const healPulse = (Math.sin(time * 4 * Math.PI) + 1) / 2;
            const healY = visualY - HEX_SIZE * 0.55;
            ctx.fillStyle = `rgba(68,221,136,${0.5 + healPulse * 0.3})`;
            ctx.font = 'bold 11px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#44dd88'; ctx.shadowBlur = 5;
            ctx.fillText('\u{1F54A}\u{FE0F}', visualX, healY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── E3 纵横家标记 📜 ──
        if (this.commander === 'diplomat') {
            ctx.save();
            const dipY = visualY - HEX_SIZE * 0.55;
            const inEnemyTerritory = this.tile && this.tile.camp !== this.camp;
            const dipPulse = inEnemyTerritory ? (Math.sin(time * 4 * Math.PI) + 1) / 2 : 0.5;
            ctx.fillStyle = `rgba(255,200,50,${0.5 + dipPulse * 0.3})`;
            ctx.font = 'bold 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#ffd700'; ctx.shadowBlur = inEnemyTerritory ? 8 : 3;
            ctx.fillText('📜', visualX, dipY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── E1 占星者标记 🔮（仅天气锁定期展示） ──
        if (this.commander === 'astrologer' && _gameState && _gameState.weatherLockUntil > 0
            && getRoundIndex(_gameState) < _gameState.weatherLockUntil) {
            ctx.save();
            const astroPulse = (Math.sin(time * 3 * Math.PI) + 1) / 2;
            const astroY = visualY - HEX_SIZE * 0.55;
            ctx.fillStyle = `rgba(180,160,255,${0.5 + astroPulse * 0.3})`;
            ctx.font = 'bold 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 6;
            ctx.fillText('🔮', visualX, astroY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── E3 纵横家连横提示 ⚡（仅处于非己方地块时展示） ──
        if (this.commander === 'diplomat' && this.tile && this.tile.camp !== this.camp) {
            ctx.save();
            const dipY = visualY - HEX_SIZE * 0.55;
            const dipPulse = (Math.sin(time * 2.5 * Math.PI) + 1) / 2;
            ctx.fillStyle = `rgba(255,215,80,${0.5 + dipPulse * 0.3})`;
            ctx.font = 'bold 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#d4a017'; ctx.shadowBlur = 5;
            ctx.fillText('⚡', visualX, dipY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── New recruit label ──
        if (this.isNewRecruit) {
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,120,0.75)';
            ctx.font = 'bold 9px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('NEW', visualX, visualY - badgeR - 2);
            ctx.restore();
        }

        // ── Rank insignia ──
        if (this._rank > 0) {
            ctx.save();
            const chX = visualX + HEX_SIZE * 0.48, chY = visualY + HEX_SIZE * 0.38;
            if (this._rank >= 4) {
                const outerR = 7, innerR = outerR * 0.382;
                ctx.beginPath();
                for (let i = 0; i < 5; i++) {
                    const aOut = -Math.PI / 2 + i * 2 * Math.PI / 5;
                    const aIn = aOut + Math.PI / 5;
                    if (i === 0) ctx.moveTo(chX + outerR * Math.cos(aOut), chY + outerR * Math.sin(aOut));
                    else ctx.lineTo(chX + outerR * Math.cos(aOut), chY + outerR * Math.sin(aOut));
                    ctx.lineTo(chX + innerR * Math.cos(aIn), chY + innerR * Math.sin(aIn));
                }
                ctx.closePath();
                ctx.fillStyle = '#ffd700';
                ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 1.5; ctx.shadowOffsetY = 1;
                ctx.fill();
                ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 0;
                ctx.fill();
            } else {
                ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2;
                ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                for (let lv = 0; lv < this._rank; lv++) {
                    const dy = lv * 5;
                    ctx.beginPath();
                    ctx.moveTo(chX - 5.5, chY + 2 + dy);
                    ctx.lineTo(chX,       chY - 2 + dy);
                    ctx.lineTo(chX + 5.5, chY + 2 + dy);
                    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 1.5; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 1;
                    ctx.stroke();
                    ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 2.5; ctx.shadowOffsetY = 0;
                    ctx.stroke();
                }
            }
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
            ctx.restore();
        }

        // ── Commander name badge ──
        if (this.commander) {
            const cmdCfg = getCommander(this.commander);
            if (cmdCfg) {
                const cx = visualX - HEX_SIZE * 0.40;
                const cy = visualY + HEX_SIZE * 0.22;
                const text = cmdCfg.name;
                ctx.save();
                ctx.font = 'bold 7.5px Arial';
                const m = ctx.measureText(text);
                const bw = m.width + 8;
                const bh = 13;
                const bx = cx - bw / 2;
                const by = cy;
                ctx.fillStyle = 'rgba(0,0,0,0.78)';
                roundRectPath(ctx, bx, by, bw, bh, 3);
                ctx.fill();
                ctx.strokeStyle = cc.main;
                ctx.lineWidth = 1.2;
                roundRectPath(ctx, bx, by, bw, bh, 3);
                ctx.stroke();
                ctx.fillStyle = cc.main;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, cx, cy + bh / 2);
                ctx.restore();

            }
        }

        // ── 天眼无人机 ──
        if (this._isDrone) {
            ctx.save();
            const dy = visualY - HEX_SIZE * 0.75;
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.shadowColor = this._disoriented ? 'rgba(255,50,50,0.5)' : 'rgba(100,200,255,0.5)';
            ctx.shadowBlur = 0;
            const bw = 24, bh = 4, bx = -bw / 2, by = dy + 12;
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, bh);
            const r = this.hp / this.maxHp;
            ctx.fillStyle = r > 0.5 ? '#4CAF50' : (r > 0.25 ? '#FF9800' : '#f44336');
            ctx.fillRect(bx, by, bw * r, bh);
            if (this._disoriented) { ctx.fillStyle = '#ff6666'; ctx.font = 'bold 10px sans-serif'; ctx.fillText('混乱', visualX, dy - 14); }
            ctx.restore();
        }

        // 魂卒：黑烟缭绕粒子（亡灵法师本人不显示） + 头顶骷髅标志
        if (this._isSoulMinion && this.commander !== 'necromancer') {
            ctx.save();
            const seed = this.id || 1;
            // 多股黑烟绕身盘旋上升
            for (let i = 0; i < 5; i++) {
                const angle = time * 0.6 + (i / 5) * Math.PI * 2 + seed * 0.07;
                const drift = Math.sin(time * 1.1 + i + seed) * 0.4;
                const rise = (time * 0.8 + i * 1.3 + seed) % 3;
                const px = Math.cos(angle) * (10 + rise * 4 + drift * 6);
                const py = -rise * 12 + drift * 4;
                const r = 3 + rise * 2.5 + Math.sin(time + i) * 0.8;
                const alpha = Math.max(0, 0.3 - rise * 0.1 + Math.sin(time * 1.5 + i * 2) * 0.05);
                ctx.fillStyle = `rgba(15,10,25,${alpha})`;
                ctx.shadowColor = 'rgba(40,20,60,0.3)';
                ctx.shadowBlur = 6 + rise * 2;
                ctx.beginPath();
                ctx.arc(px, py, r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.shadowBlur = 0;
            ctx.restore();
            // 骷髅图标（头顶上方）
            ctx.save();
            ctx.globalAlpha = 0.4 + Math.sin(time * 1.5) * 0.12;
            ctx.font = '20px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('💀', 0, -HEX_SIZE * 0.8);
            ctx.restore();
        }
    }

    // ① 攻击力乘区：基础面板 ×（1+「攻击力提高xx%」）+「攻击力+xx」固定加成
    //    百分比只作用于基础面板；士气不乘入攻击力，走 _resolveDamage 的增伤乘区
    getEffectiveAttack() {
        const auraAtk = getCommanderAuraAttackBonus(this);
        return Math.round(this.config.attack * (1 + auraAtk) + (this._atkBonus || 0) + getCommanderAttackBonus(this));
    }

    // 伤害浮动倍率（替代 critRate + critMulti 二值系统）
    // 浮动倍率区间 —— 暴击率完全由区间体现（阈值以上占比即暴击概率），不做独立随机判定
    _calcFloat(isCounter = false, isCityCounter = false, critRateBonus = 0, noCrit = false, forceCrit = false) {
        const gs = _gameState;
        let lo, hi;

        if (isCounter) {
            lo = isCityCounter ? 1.00 : 0.90;
            hi = 1.70;
        } else {
            lo = 0.85; hi = 1.35;
        }

        // 士气影响浮动区间（进而改变暴击概率与伤害浮动）
        if (this.morale === 3)      { lo += 0.05; hi += 0.10; }
        else if (this.morale === 1) { lo -= 0.05; hi -= 0.10; }
        else if (this.morale === 0) { lo -= 0.10; hi -= 0.20; }

        const threshold = isCounter ? 1.50 : 1.30;
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

        return (gs && gs.rng) ? gs.rng.range(lo, hi) : lo + Math.random() * (hi - lo);
    }

    // ===== 伤害计算管线（四层乘算） =====================
    // 伤害 = ①攻击力乘区 × ②增伤乘区 × ③暴击/浮动乘区 × ④防御乘区 （反击另乘 baseMulti=0.75）
    //   ① 攻击力：getEffectiveAttack()，「攻击力+xx」「攻击力提高xx%」
    //   ② 增伤（层内加算）：兵种克制 + 士气 + 冲锋/城市攻坚等，「造成的伤害提高xx%」
    //   ③ 暴击/浮动：_calcFloat()，「暴击率提高/降低xx%」
    //   ④ 防御（层内加算后 1-Σ）：地形/守城/兵种/军衔/士气/将领/灵光，「防御力提高xx%」
    _resolveDamage(attacker, defender, baseMulti = 1, extraBonus = 0,
                   isCounter = false, isCityCounter = false, isAirDamage = false, ignoreDef = 0) {
        const counterCoeff = COUNTER_RELATION[attacker.type]?.[defender.type] ?? 1;

        // ② 增伤乘区
        let dmgUp = extraBonus;
        // 兵种克制：顺克 +20% / 逆克 −20%（归入②增伤乘区）；暴击率另在③处理（顺克+25%/逆克锁0）
        if (counterCoeff > 1) dmgUp += 0.20;
        else if (counterCoeff < 1) dmgUp -= 0.20;
        // 魔术师·千面：攻击克制目标时伤害提高25%（与基础顺克+20%叠加→+45%）
        if (attacker.commander === 'magician' && counterCoeff > 1) dmgUp += 0.25;
        // 魔术师幻形：每层+5%增伤（上限30%），归入②乘区
        if (attacker.commander === 'magician' && attacker._phantomStacks) {
            dmgUp += Math.min(attacker._phantomStacks * 0.05, 0.30);
        }
        const offenseMulti = Math.max(0, 1 + dmgUp);

        // ③ 暴击/浮动乘区：暴击率完全由浮动区间体现，无独立随机判定
        //    各暴击率来源累加 → 在 _calcFloat 内整体上移浮动区间，使阈值以上占比≈基础+加成
        const phantomCrit = (attacker._phantomStacks || 0) * 0.10;      // 魔术师幻形 +10%/层
        const cmdCrit = getCommanderCritRateBonus(attacker);            // 堕天使黑形态 +60% 等
        const counterCrit = counterCoeff > 1 ? 0.25 : 0;               // 顺克 +25%
        const counterNoCrit = counterCoeff < 1;                        // 逆克 无法暴击
        const critRateBonus = (attacker._rankCritBonus || 0) + phantomCrit + cmdCrit + counterCrit;
        const forceCrit = !counterNoCrit && isCommanderGuaranteedCrit(attacker);
        const floatMult = attacker._calcFloat(isCounter, isCityCounter, critRateBonus, counterNoCrit, forceCrit);
        const isCrit = floatMult > (isCounter ? 1.50 : 1.30);

        // ④ 防御乘区
        let defSum = TERRAIN_CONFIG[defender.tile.terrain].defenseBonus;
        // 森林掩蔽：对远程攻击（炮兵/碉堡/无人机）额外+15%防御，与地形自带10%加算
        if (defender.tile.terrain === 'forest' && (attacker.type === 'archer' || attacker.type === 'mgNest' || attacker.type === 'drone')) {
            defSum += 0.15;
        }
        // 风天：步兵防御-15%（星移期间扩展至敌方全兵种；占星者星光力场免疫）；星移减益区内额外-15%
        if (_gameState.weather === 'wind' && (defender.type === 'infantry' || (_gameState.weatherLockUntil > 0 && getRoundIndex(_gameState) < _gameState.weatherLockUntil && defender.camp !== attacker.camp))
            && !getCommanderWeatherImmunity(defender.tile, defender.camp, _gameState.tileMap)) {
            defSum -= 0.15;
            if (getCommanderWeatherDebuff(defender.tile, defender.camp, _gameState)) defSum -= 0.15;
        }
        if (defender.type === 'infantry' && defender.tile.isCity) defSum += 0.10;
        // 雨天：步兵守城防御力额外+10%（占星者星光力场免疫）
        if (_gameState.weather === 'rain' && defender.type === 'infantry' && defender.tile.isCity
            && !getCommanderWeatherImmunity(defender.tile, defender.camp, _gameState.tileMap)) {
            defSum += 0.10;
        }
        defSum += (defender.config.defense || 0);
        defSum += (defender._rankDefBonus || 0);
        defSum += MORALE_CONFIG[defender.morale].defBonus;
        defSum += getCommanderDefenseBonus(defender);
        // 魔术师·千面：被克制目标攻击时受伤降低15%
        if (defender.commander === 'magician' && counterCoeff > 1) defSum += 0.15;
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
                if (nb.unit.commander === 'staller') { hasStaller = true; break; }
            }
            if (hasStaller) defSum += 0.25;        // 停滞者力场：+25%
        }
        // 防空火力：2格内友军 炮兵/碉堡/停滞者单位 → 仅对空军(上校空军卡)伤害 +25%/层（封顶2层=50%）
        if (isAirDamage && _gameState && _gameState.tileMap) {
            const dirs = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
            const dirs2 = [[2,0],[2,-1],[2,-2],[1,-2],[1,1],[0,2],[0,-2],[-1,2],[-1,-1],[-2,0],[-2,1],[-2,2]];
            let aaCount = 0;
            for (const [dq, dr] of [...dirs, ...dirs2]) {
                const nb = _gameState.tileMap.get(`${defender.tile.q + dq},${defender.tile.r + dr}`);
                if (!nb || !nb.unit || nb.unit.camp !== defender.camp) continue;
                if (nb.unit.type === 'archer' || nb.unit.type === 'mgNest' || nb.unit.commander === 'staller') {
                    if (aaCount < 2) aaCount++;
                }
            }
            if (aaCount > 0) defSum += aaCount * 0.25; // 防空火力：每层+25%，封顶50%
        }
        defSum += getCommanderAuraDefenseBonus(defender);
        // 空军上校俯冲扫射：无视目标防御力
        if (ignoreDef > 0) defSum -= ignoreDef;
        const defenseMulti = Math.max(0.3, 1 - defSum);

        return {
            dmg: attacker.getEffectiveAttack() * baseMulti * offenseMulti * floatMult * defenseMulti,
            isCrit
        };
    }

    calculateDamage(targetUnit) {
        const gs = _gameState;

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
        const chargeRate = gs && gs.weather === 'fog' ? 0.15 : 0.10;
        const cavBonus = this.type === 'cavalry' ? Math.min(this.moveDistance, 3) * chargeRate : 0;
        const cityAtkBonus = (this.type === 'infantry' && this.tile.isCity) ? 0.15 : 0;
        // 天气条件增伤：雾天骑兵+20%、风天炮兵+20%（归入②增伤乘区）
        const weatherBonus = (gs && gs.weather === 'fog' && this.type === 'cavalry') ? 0.20
            : (gs && gs.weather === 'wind' && this.type === 'archer') ? 0.20 : 0;

        const result = this._resolveDamage(this, targetUnit, 1, cavBonus + cityAtkBonus + weatherBonus);

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

        if (this.counterAttackCount >= 1 || this.morale === 0 || this._disoriented) {
            return { dmg: 0, isCrit: false };
        }
        // 无人机攻击地面单位时，地面单位无法反击
        if (attackerUnit && attackerUnit._isDrone && !this._isDrone) {
            return { dmg: 0, isCrit: false };
        }
        // 反击可达性：攻击者必须落在防守方自身射程内才能还击
        //   近战单位(步/骑) 射程1 → 仅贴脸攻击可被反击
        //   远程单位(炮/碉堡) 射程2 → 2格内的攻击者（含远程炮击/近战贴脸）均可被反击
        const counterRange = this._isDrone ? 2 : ((this.type === 'archer' || this.type === 'mgNest') ? 2 : 1);
        if (hexDistance(attackerUnit.tile, this.tile) > counterRange) {
            return { dmg: 0, isCrit: false };
        }

        const isCityCounter = this.type === 'infantry' && this.tile.isCity;
        const cityAtkBonus = (this.type === 'infantry' && this.tile.isCity) ? 0.15 : 0;

        const result = this._resolveDamage(this, attackerUnit, 0.75, cityAtkBonus, true, isCityCounter, this._isDrone);

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

        if (this.godMode) return false;

        let actualDmg = dmg;

        // 护盾优先吸收伤害（真实伤害绕过）
        if (!ignoreShield && this._shield > 0 && actualDmg > 0) {
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

        // 受击钩子（谋士攻心等）：受伤后对攻击者触发效果
        if (auraApplies && actualDmg > 0 && attacker) {
            triggerCommanderOnDamageTaken(this, attacker, actualDmg);
        }

        // 牧师治愈灵光·临终迸发：致命一击时提前释放剩余 HoT，若仍不足抵扣或治疗后
        // 仍低于20%最大生命，则血量固定为20%最大生命；灵光随之消耗。
        // （minHp>0 的伤害本就不致死，如堕天使灼烧，不触发此保底）
        if (this._healingAura > 0 && minHp <= 0 && (this.hp - actualDmg) <= 0) {
            const burst = Math.round(this.maxHp * 0.20 * this._healingAura);
            const floor = Math.round(this.maxHp * 0.20);
            this._healingAura = 0;
            this.hp = Math.max(Math.round(this.hp - actualDmg + burst), floor);
            if (_gameState && _gameState.healTexts) {
                _gameState.healTexts.push({
                    x: this.tile.x, y: this.tile.y, value: burst,
                    timeLeft: 1000, lastUpdate: performance.now()
                });
            }
            triggerHealFlash(this.tile.x, this.tile.y);
            spawnHealParticles(this.tile.x, this.tile.y);
            spawnCommanderSkillEffect(this.tile.x, this.tile.y, '\u{1F54A}\u{FE0F}', '临终迸发');
            log(`${this.camp.name}${this.config.name}兵的【治愈灵光】临终迸发，从致命一击中幸存（+${burst}HP）`);
            return false;
        }

        this.hp = Math.round(Math.max(minHp, this.hp - actualDmg));
        // 殉道者：HP≤1时进入自爆倒计时（包括致死伤害）
        if (this.commander === 'martyr' && !this._martyrPrimed && this.hp <= 1) {
            this._martyrPrimed = true;
            this.hp = 1;
            this.canAct = false;
            this.remainingMP = 0;
            log(`${this.camp.name}殉道者【${this.config.name}兵】生命垂危，进入殉道倒计时！`);
            spawnCommanderSkillEffect(this.tile.x, this.tile.y, '💥', '殉道倒计时');
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
        if (this.commander) {
            // 空军上校阵亡 → 禁用对应玩家的专属空军卡
            if (this.commander === 'colonel' && _gameState && _gameState._colonelDeployed) {
                const campKey = this.camp === CAMP.player1 ? 'player1' :
                                this.camp === CAMP.player2 ? 'player2' : 'player3';
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
            if (this.camp === CAMP.player1) _gameState.commanderP1 = null;
            else if (this.camp === CAMP.player2) _gameState.commanderP2 = null;
            else if (this.camp === CAMP.player3) _gameState.commanderP3 = null;
            const cmdInfo = getCommander(this.commander);
            log(`${this.camp.name}将领【${cmdInfo?.name || this.commander}】阵亡，效果消失`);
        }

        // 所有来源击杀将领：全军士气+1（攻击方阵营；无明确攻击者时以当前回合阵营为准）
        if (this.commander) {
            let killerCamp = null;
            if (attackerUnit && attackerUnit.camp !== this.camp) {
                killerCamp = attackerUnit.camp;
            } else if (!attackerUnit && _gameState && _gameState.currentCamp !== this.camp) {
                killerCamp = _gameState.currentCamp;
            }
            if (killerCamp) {
                const kKey = killerCamp === CAMP.player1 ? 'player1' : killerCamp === CAMP.player2 ? 'player2' : killerCamp === CAMP.player3 ? 'player3' : null;
                if (kKey) {
                    if (!_gameState.factionMoraleBoost) _gameState.factionMoraleBoost = {};
                    _gameState.factionMoraleBoost[kKey] = getRoundIndex(_gameState) + 2;
                    for (const tile of _gameState.tiles) {
                        const u = tile.unit;
                        if (u && u.camp === killerCamp && u.morale !== 0 && u.morale < 3) {
                            const oldM = u.morale;
                            u.morale = Math.min(3, u.morale + 1);
                            if (u.morale === 3) u.moraleBoostUntil = getRoundIndex(_gameState) + 2;
                            if (u.morale !== oldM) spawnMoraleEffect(u);
                        }
                    }
                    triggerFactionMoraleFlash('#ffd700');
                    log(`⚔ ${killerCamp.name}斩杀敌方将领，全军士气+1！`);
                }
            }
        }

        // 己方阵营 key（供留魂标记 + 殉道者挽歌被动共用）
        const ownKey = this.camp === CAMP.player1 ? 'player1' : this.camp === CAMP.player2 ? 'player2' : this.camp === CAMP.player3 ? 'player3' : null;

        // E2 亡灵法师留魂：非魂卒、非将领单位阵亡时留下亡魂标记
        if (!this._isSoulMinion && !this.commander && this.tile && _gameState && _gameState.tileMap) {
            // 检查是否有亡灵法师在场上
            let hasNecromancer = false;
            for (const t of _gameState.tiles) {
                // 仅同阵营亡灵法师能牵引本方亡魂 → 只有同阵营在场才留标记
                if (t.unit && t.unit.commander === 'necromancer' && t.unit.camp === this.camp && t.unit.hp > 0) {
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
            const key = attackerUnit.camp === CAMP.player1 ? 'player1' : attackerUnit.camp === CAMP.player2 ? 'player2' : attackerUnit.camp === CAMP.player3 ? 'player3' : 'neutral';
            _gameState.killCount[key]++;
        }
        spawnExplosionParticles(this.tile.x, this.tile.y, '#ff2200', 30);
        spawnExplosionParticles(this.tile.x, this.tile.y, '#ffaa00', 15);
        triggerScreenShake(4, 150);
    }

    // 普攻/反击入口（保留旧签名，内部转入 applyDamage）
    takeDamage(dmg, attackerUnit, _skipAura = false) {
        let source = 'true';
        if (attackerUnit) {
            if (attackerUnit._isDrone || attackerUnit.type === 'drone') source = 'ranged';
            else if (attackerUnit.type === 'archer' || attackerUnit.type === 'mgNest') source = 'ranged';
            else source = 'melee';
        }
        return this.applyDamage(dmg, { source, attacker: attackerUnit, skipAura: _skipAura });
    }

    // 查找相邻6格内己方铁卫
    _findAdjacentFriendlyIronGuard() {
        if (!this.tile || !_gameState) return null;
        const tileMap = _gameState.tileMap;
        const dirs = HEX_NEIGHBORS;
        for (const [dq, dr] of dirs) {
            const neighbor = tileMap.get(`${this.tile.q + dq},${this.tile.r + dr}`);
            if (neighbor && neighbor.unit && neighbor.unit.commander === 'ironGuard' && neighbor.unit.camp === this.camp && neighbor.unit._shield > 0) {
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
        this.hp = Math.min(this.maxHp, this.hp + amount);
        const actualHeal = this.hp - oldHp;

        if (actualHeal > 0) {
            gs.healTexts.push({
                x: this.tile.x,
                y: this.tile.y,
                value: actualHeal,
                timeLeft: 1000,
                lastUpdate: performance.now()
            });
            triggerHealFlash(this.tile.x, this.tile.y);
            spawnHealParticles(this.tile.x, this.tile.y);
            return actualHeal;
        }
        return 0;
    }

    addXP(amount) {
        if (this._rank >= 4 || amount <= 0) return;
        if (this.commander === 'centurion') amount *= 2.0;
        this._xp += amount;
        this._checkRankUp();
    }

    _checkRankUp() {
        const thresholds = [8, 18, 30, 48];
        while (this._rank < 4 && this._xp >= thresholds[this._rank]) {
            this._rank++;
            this._applyRankBonus(this._rank);
            // 晋升时恢复已损失生命值的30%（殉道者倒计时中不回复）
            if (!(this.commander === 'martyr' && this._martyrPrimed)) {
                const lostHp = this.maxHp - this.hp;
                if (lostHp > 0) {
                    this.hp = Math.min(this.maxHp, this.hp + Math.round(lostHp * 0.30));
                }
            }
            _pendingRankUps.push({ unitId: this.id, rank: this._rank, x: this.tile.x, y: this.tile.y });
            spawnRankUpEffect(this.tile.x, this.tile.y, this._rank);
            if (_gameState && _gameState.hoveredTile === this.tile) {
                const evt = new CustomEvent('rankUpTooltipRefresh', { detail: { tile: this.tile } });
                document.dispatchEvent(evt);
            }
        }
    }

    _applyRankBonus(rank) {
        switch (rank) {
            case 1: this.maxHp += 20; if (!(this.commander === 'martyr' && this._martyrPrimed)) this.hp += 20; break;
            case 2: this._atkBonus += 10; break;
            case 3: this._rankDefBonus = 0.10; this._rankCritBonus = 0.25; break;
            case 4: this._rankRegenPct = 0.15; break;
        }
    }
}
