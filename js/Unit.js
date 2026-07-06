import { HEX_SIZE, ctx, drawHexagonOutline, CAMP, UNIT_CONFIG, COUNTER_RELATION, settings, frameInfo, CAMP_FLAG_COLORS, MORALE_CONFIG, TERRAIN_CONFIG, roundRectPath, hexDistance, HEX_NEIGHBORS, getRoundIndex } from './config.js';
import { getCommander, getCommanderDefenseBonus, getCommanderAuraDefenseBonus, getCommanderAllyAuraDamage, getCommanderAttackBonus, getCommanderAuraAttackBonus, getCommanderWeatherImmunity, isCommanderGuaranteedCrit, triggerCommanderOnMoraleChange, triggerCommanderAllyDamage, triggerCommanderOnDamageTaken } from './commanderInterface.js';
import { getPortrait } from './portraitLoader.js';
import { nextId } from './uid.js';
import { isNetworkGame, getMyRole } from './network.js';
import { spawnExplosionParticles, spawnHealParticles, triggerAttackFlash, triggerHealFlash, triggerScreenShake, moraleEffects, spawnCommanderSkillEffect, spawnRankUpEffect, getRecoilOffset, getChargeOffset } from './effects.js';

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
        const glyphs = { infantry: '⚔', cavalry: '🐎', archer: '🎯', mgNest: '🏰' };
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

        // ── E2 亡灵法师标记 💀 ──
        if (this.commander === 'necromancer') {
            ctx.save();
            const necroY = visualY - HEX_SIZE * 0.55;
            const necroPulse = (Math.sin(time * 3.5 * Math.PI) + 1) / 2;
            ctx.fillStyle = `rgba(130,200,255,${0.5 + necroPulse * 0.3})`;
            ctx.font = 'bold 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#8844ff'; ctx.shadowBlur = 6;
            ctx.fillText('💀', visualX, necroY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── E4 空军上校标记 ✈️ ──
        if (this.commander === 'colonel') {
            ctx.save();
            const colY = visualY - HEX_SIZE * 0.55;
            const colPulse = (Math.sin(time * 2.5 * Math.PI) + 1) / 2;
            ctx.fillStyle = `rgba(100,180,255,${0.5 + colPulse * 0.3})`;
            ctx.font = 'bold 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#6688ff'; ctx.shadowBlur = 5;
            ctx.fillText('✈️', visualX, colY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── E1 占星者标记 🔮 ──
        if (this.commander === 'astrologer') {
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
    }

    // ① 攻击力乘区：基础面板 ×（1+「攻击力提高xx%」）+「攻击力+xx」固定加成
    //    百分比只作用于基础面板；士气不乘入攻击力，走 _resolveDamage 的增伤乘区
    getEffectiveAttack() {
        const auraAtk = getCommanderAuraAttackBonus(this);
        return Math.round(this.config.attack * (1 + auraAtk) + (this._atkBonus || 0) + getCommanderAttackBonus(this));
    }

    // 伤害浮动倍率（替代 critRate + critMulti 二值系统）
    _calcFloat(counterCoeff, isCounter = false, isCityCounter = false, guaranteedCrit = false) {
        const gs = _gameState;
        let lo, hi;

        if (isCounter) {
            lo = isCityCounter ? 1.00 : 0.90;
            hi = isCityCounter ? 1.70 : 1.70;
        } else if (counterCoeff > 1) {
            lo = 0.90; hi = 1.50;
        } else if (counterCoeff < 1) {
            lo = 0.85; hi = 1.20;
        } else {
            lo = 0.85; hi = 1.35;
        }

        // 风天：炮兵无法暴击（占星者星光力场免疫）
        if (gs && gs.weather === 'wind' && this.type === 'archer' && !isCounter
            && !getCommanderWeatherImmunity(this.tile, this.camp, gs.tileMap)) {
            hi = Math.min(hi, 1.05);
        }

        if (guaranteedCrit) {
            const threshold = isCounter ? 1.50 : 1.30;
            const width = hi - lo;
            lo = threshold + 0.001;
            hi = lo + width;
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
                   isCounter = false, isCityCounter = false) {
        const counterCoeff = COUNTER_RELATION[attacker.type][defender.type];

        // 魔术师：克制精通
        let effectiveCounterCoeff = counterCoeff;
        if (attacker.commander === 'magician') {
            if (counterCoeff === 1.25) effectiveCounterCoeff = 1.5;
            else if (counterCoeff === 0.75) effectiveCounterCoeff = 0.6;
        } else if (defender.commander === 'magician' && counterCoeff === 1.25) {
            // 幻形防御端：被克制时减免15%（1.25 → 1.10）
            effectiveCounterCoeff = 1.10;
        }

        // ② 增伤乘区
        const dmgUp = (effectiveCounterCoeff - 1)
            + MORALE_CONFIG[attacker.morale].dmgBonus
            + extraBonus;
        const offenseMulti = Math.max(0, 1 + dmgUp);

        // ③ 暴击/浮动乘区
        const phantomCrit = (attacker._phantomStacks || 0) * 0.10;
        const rankCrit = (attacker._rankCritBonus || 0) + phantomCrit;
        const _rng = _gameState && _gameState.rng;
        const guaranteedCrit = isCommanderGuaranteedCrit(attacker) || (rankCrit > 0 && (_rng ? _rng.chance(rankCrit) : Math.random() < rankCrit));
        const floatMult = attacker._calcFloat(counterCoeff, isCounter, isCityCounter, guaranteedCrit);
        const isCrit = floatMult > (isCounter ? 1.50 : 1.30);

        // ④ 防御乘区
        let defSum = TERRAIN_CONFIG[defender.tile.terrain].defenseBonus;
        // 森林掩蔽：对远程攻击（炮兵/要塞）额外+20%防御，与地形自带10%加算
        if (defender.tile.terrain === 'forest' && (attacker.type === 'archer' || attacker.type === 'mgNest')) {
            defSum += 0.20;
        }
        // 风天：步兵阵线不稳，通用防御-20%（占星者星光力场免疫）
        if (_gameState.weather === 'wind' && defender.type === 'infantry'
            && !getCommanderWeatherImmunity(defender.tile, defender.camp, _gameState.tileMap)) {
            defSum -= 0.20;
        }
        // 雾天：骑兵借雾突袭，攻击无视目标15%防御力（占星者星光力场免疫）
        if (_gameState.weather === 'fog' && attacker.type === 'cavalry'
            && !getCommanderWeatherImmunity(defender.tile, defender.camp, _gameState.tileMap)) {
            defSum -= 0.15;
        }
        if (defender.type === 'infantry' && defender.tile.isCity) defSum += 0.10;
        defSum += (defender.config.defense || 0);
        defSum += (defender._rankDefBonus || 0);
        defSum += MORALE_CONFIG[defender.morale].defBonus;
        defSum += getCommanderDefenseBonus(defender);
        // 停滞者力场 + 防空火力：2格内友军单位对远程攻击防御加成（统一计数器）
        if ((attacker.type === 'archer' || attacker.type === 'mgNest') && _gameState && _gameState.tileMap) {
            const dirs = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
            const dirs2 = [[2,0],[2,-1],[2,-2],[1,-2],[1,1],[0,2],[0,-2],[-1,2],[-1,-1],[-2,0],[-2,1],[-2,2]];
            let aaCount = 0;
            let hasStaller = false;
            for (const [dq, dr] of [...dirs, ...dirs2]) {
                const nb = _gameState.tileMap.get(`${defender.tile.q + dq},${defender.tile.r + dr}`);
                if (!nb || !nb.unit || nb.unit.camp !== defender.camp) continue;
                if (nb.unit.type === 'archer' || nb.unit.type === 'mgNest') {
                    if (aaCount < 3) aaCount++;
                }
                if (nb.unit.commander === 'staller' && !hasStaller) hasStaller = true;
            }
            if (hasStaller) defSum += 0.15;        // 停滞者力场：+15%
            if (aaCount > 0) defSum += aaCount * 0.15; // 防空火力：每层+15%，封顶3层=45%
        }
        defSum += getCommanderAuraDefenseBonus(defender);
        const defenseMulti = Math.max(0.1, 1 - defSum);

        return {
            dmg: attacker.getEffectiveAttack() * baseMulti * offenseMulti * floatMult * defenseMulti,
            isCrit
        };
    }

    calculateDamage(targetUnit) {
        const gs = _gameState;

        // 骑兵冲锋·势能制：本回合每移动1格，造成的伤害提高15%，上限45%（3格）；
        // moveDistance 随回合重置，势能回合结束消失
        const cavBonus = this.type === 'cavalry' ? Math.min(this.moveDistance, 3) * 0.15 : 0;
        const cityAtkBonus = (this.type === 'infantry' && this.tile.isCity) ? 0.15 : 0;

        const result = this._resolveDamage(this, targetUnit, 1, cavBonus + cityAtkBonus);

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

        if (this.counterAttackCount >= 1 || this.type === 'archer' || this.morale === 0) {
            return { dmg: 0, isCrit: false };
        }
        // 炮兵/要塞远程攻击（距离>1）时，被攻击方无法反击
        if ((attackerUnit.type === 'archer' || attackerUnit.type === 'mgNest') && hexDistance(attackerUnit.tile, this.tile) > 1) {
            return { dmg: 0, isCrit: false };
        }

        const isCityCounter = this.type === 'infantry' && this.tile.isCity;
        const cityAtkBonus = (this.type === 'infantry' && this.tile.isCity) ? 0.15 : 0;

        const result = this._resolveDamage(this, attackerUnit, 0.75, cityAtkBonus, true, isCityCounter);

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
    //   'ranged' 远程攻击(炮兵/要塞/空袭对策卡)    —— 同上
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
            }
            if (this.camp === CAMP.player1) _gameState.commanderP1 = null;
            else if (this.camp === CAMP.player2) _gameState.commanderP2 = null;
            else if (this.camp === CAMP.player3) _gameState.commanderP3 = null;
            const cmdInfo = getCommander(this.commander);
            log(`${this.camp.name}将领【${cmdInfo?.name || this.commander}】阵亡，效果消失`);
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
                    bornAt: getRoundIndex(_gameState)  // 回合数(0-indexed)，与老化检查一致
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
        const source = !attackerUnit ? 'true'
            : (attackerUnit.type === 'archer' || attackerUnit.type === 'mgNest') ? 'ranged' : 'melee';
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
            case 3: this._rankDefBonus = 0.10; this._rankCritBonus = 0.33; break;
            case 4: this._rankRegenPct = 0.15; break;
        }
    }
}
