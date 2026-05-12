import { HEX_SIZE, ctx, drawHexagonOutline, CAMP, UNIT_CONFIG, COUNTER_RELATION, settings, frameInfo, CAMP_FLAG_COLORS, MORALE_CONFIG, TERRAIN_CONFIG, roundRectPath, hexDistance } from './config.js';
import { getCommander, getCommanderDefenseBonus, getCommanderAuraDefenseBonus, getCommanderAllyAuraDamage, getCommanderAttackBonus, getCommanderAuraAttackBonus, isCommanderGuaranteedCrit, triggerCommanderOnMoraleChange, triggerCommanderAllyDamage } from './commanderInterface.js';
import { getPortrait } from './portraitLoader.js';
import { nextId } from './state.js';
import { spawnExplosionParticles, spawnHealParticles, triggerAttackFlash, triggerHealFlash, triggerScreenShake, moraleEffects, spawnCommanderSkillEffect, spawnRankUpEffect, getRecoilOffset, getChargeOffset } from './effects.js';

// 延迟引用，由游戏逻辑设置(避免循环依赖)
let _logMessage = null;
let _gameState = null;
// 晋升事件收集（供联机同步，每轮 action 前清空）
export let _pendingRankUps = [];
export function setLogMessageRef(fn) { _logMessage = fn; }
export function setGameStateRef(ref) { _gameState = ref; }

export class Unit {
    constructor(type, camp, tile, isNewRecruit = false, idOverride = null, commander = null) {
        this.id = idOverride ?? nextId();
        this.type = type;
        this.config = UNIT_CONFIG[type];
        this.camp = camp;
        this.commander = commander;
        this._centurionTriggered = false;
        // 应用将领属性加成
        const cmdCfg = commander ? getCommander(commander) : null;
        const hpBonus = cmdCfg ? (cmdCfg.hpBonus || 0) : 0;
        const atkBonus = cmdCfg ? (cmdCfg.atkBonus || 0) : 0;
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
        const currentTurn = gameState ? gameState.turnCounter : 0;

        // 击杀士气上升
        if (this.morale === 3 && this.moraleBoostUntil > currentTurn) {
            const remainingRounds = Math.ceil((this.moraleBoostUntil - currentTurn) / 3);
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
            for (const [dq, dr] of [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]]) {
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
            effects.push({ label: '治愈灵光', desc: `每回合回复12.5%最大生命值`, color: '#44dd88', remaining: this._healingAura });
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
        if (!this.tile.isCity) {
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
        const glyphs = { infantry: '⚔', cavalry: '🐎', archer: '💣', mgNest: '🏰' };
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

        // ── Actionable glow ──
        if (this.canAct && gs && this.camp === gs.currentCamp && !this.isNewRecruit) {
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

        // ── Berserker rage glow ──
        if (this.activeSkillDur > 0 && this.commander === 'berserker') {
            ctx.save();
            const ragePulse = (Math.sin(time * 6 * Math.PI) + 1) / 2;
            // 💢 glyph
            ctx.fillStyle = `rgba(255,80,20,${0.6 + ragePulse * 0.4})`;
            ctx.font = 'bold 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#ff4400'; ctx.shadowBlur = 6;
            ctx.fillText('💢', visualX, visualY - HEX_SIZE * 0.55);
            ctx.shadowBlur = 0;
            ctx.restore();
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

    getEffectiveAttack() {
        const baseAtk = this.config.attack + (this._atkBonus || 0) + getCommanderAttackBonus(this);
        const auraAtk = getCommanderAuraAttackBonus(this);
        return Math.round(baseAtk * (1 + auraAtk) * MORALE_CONFIG[this.morale].atkMulti);
    }

    // 伤害浮动倍率（替代 critRate + critMulti 二值系统）
    _calcFloat(counterCoeff, isCounter = false, isCityCounter = false, guaranteedCrit = false) {
        const gs = _gameState;
        let lo, hi;

        if (isCounter) {
            lo = isCityCounter ? 1.05 : 0.90;
            hi = isCityCounter ? 1.85 : 1.70;
        } else if (counterCoeff > 1) {
            lo = 0.90; hi = 1.50;
        } else if (counterCoeff < 1) {
            lo = 0.85; hi = 1.20;
        } else {
            lo = 0.85; hi = 1.35;
        }

        if (gs && gs.weather === 'wind' && this.type === 'infantry' && !isCounter) {
            hi = Math.min(hi, 1.05);
        }

        if (guaranteedCrit) {
            const threshold = isCounter ? 1.50 : 1.30;
            const width = hi - lo;
            lo = threshold + 0.001;
            hi = lo + width;
        }

        return lo + Math.random() * (hi - lo);
    }

    // Shared damage resolution: attacker → defender
    _resolveDamage(attacker, defender, baseMulti = 1, extraBonus = 0,
                   isCounter = false, isCityCounter = false) {
        const counterCoeff = COUNTER_RELATION[attacker.type][defender.type];

        // 魔术师：克制精通
        let effectiveCounterCoeff = counterCoeff;
        if (attacker.commander === 'magician') {
            if (counterCoeff === 1.25) effectiveCounterCoeff = 1.5;
            else if (counterCoeff === 0.75) effectiveCounterCoeff = 0.6;
        } else if (defender.commander === 'magician' && counterCoeff === 1.25) {
            effectiveCounterCoeff = 1.5;
        }

        let dmgBonus = effectiveCounterCoeff - 1 + extraBonus;
        dmgBonus -= TERRAIN_CONFIG[defender.tile.terrain].defenseBonus;
        if (defender.type === 'infantry' && defender.tile.isCity) dmgBonus -= 0.05;
        dmgBonus -= (defender.config.defense || 0);
        dmgBonus -= (defender._rankDefBonus || 0);
        dmgBonus -= MORALE_CONFIG[defender.morale].defBonus;
        dmgBonus -= getCommanderDefenseBonus(defender);
        if (defender.commander === 'staller' && attacker.type === 'archer') dmgBonus -= 0.50;
        dmgBonus -= getCommanderAuraDefenseBonus(defender);
        if (attacker.type === 'archer' && attacker.tile.terrain === 'mountain') dmgBonus += 0.05;
        const dmgMulti = Math.max(0.1, 1 + dmgBonus);

        const rankCrit = attacker._rankCritBonus || 0;
        const guaranteedCrit = isCommanderGuaranteedCrit(attacker) || (rankCrit > 0 && Math.random() < rankCrit);
        const floatMult = attacker._calcFloat(counterCoeff, isCounter, isCityCounter, guaranteedCrit);
        const isCrit = floatMult > (isCounter ? 1.50 : 1.30);

        return {
            dmg: attacker.getEffectiveAttack() * baseMulti * dmgMulti * floatMult,
            isCrit
        };
    }

    calculateDamage(targetUnit) {
        const gs = _gameState;

        const chargeThreshold = gs.weather === 'fog' ? 1 : 2;
        const chargeAmount    = gs.weather === 'fog' ? 0.30 : 0.25;
        const cavBonus = (this.type === 'cavalry' && this.moveDistance >= chargeThreshold) ? chargeAmount : 0;

        let weatherAtkBonus = 0;
        if (gs.weather === 'wind' && this.type === 'archer') weatherAtkBonus = +0.15;

        const result = this._resolveDamage(this, targetUnit, 1, cavBonus + weatherAtkBonus);

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
        // 炮兵远程攻击（距离>1）时，被攻击方无法反击
        if (attackerUnit.type === 'archer' && hexDistance(attackerUnit.tile, this.tile) > 1) {
            return { dmg: 0, isCrit: false };
        }

        const isCityCounter = this.type === 'infantry' && this.tile.isCity;

        const result = this._resolveDamage(this, attackerUnit, 0.75, 0, true, isCityCounter);

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

    takeDamage(dmg, attackerUnit, _skipAura = false) {
        const log = _logMessage;

        if (this.godMode) return false;

        let actualDmg = dmg;

        // 护盾优先吸收伤害
        if (this._shield > 0 && actualDmg > 0) {
            const absorbed = Math.min(this._shield, actualDmg);
            this._shield -= absorbed;
            actualDmg -= absorbed;
            if (actualDmg <= 0) return false;
        }

        // 铁卫灵光：相邻友军所受伤害由铁卫护盾承担
        if (!_skipAura && this.commander !== 'ironGuard' && _gameState) {
            const ironGuard = this._findAdjacentFriendlyIronGuard();
            if (ironGuard && ironGuard._shield > 0) {
                getCommanderAllyAuraDamage(this, actualDmg, ironGuard);
                // 移除友军头顶伤害数字（伤害已由铁卫护盾吸收）
                const dts = _gameState.damageTexts;
                for (let i = dts.length - 1; i >= 0; i--) {
                    if (dts[i].x === this.tile.x && dts[i].y === this.tile.y) {
                        dts.splice(i, 1);
                        break;
                    }
                }
                actualDmg = 0;
            }
        }

        // 圣骑士誓言：友军受击概率获得誓言
        if (!_skipAura && actualDmg > 0) {
            triggerCommanderAllyDamage(this, actualDmg);
        }

        this.hp = Math.round(Math.max(0, this.hp - actualDmg));
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
            // 将领死亡：清除所有效果
            if (this.commander) {
                if (this.camp === CAMP.player1) _gameState.commanderP1 = null;
                else if (this.camp === CAMP.player2) _gameState.commanderP2 = null;
                else if (this.camp === CAMP.player3) _gameState.commanderP3 = null;
                const cmdInfo = getCommander(this.commander);
                log(`${this.camp.name}将领【${cmdInfo?.name || this.commander}】阵亡，效果消失`);
            }
            this.tile.unit = null;
            log(`${this.camp.name} ${this.config.name}兵被消灭`);
            if (attackerUnit) {
                const key = attackerUnit.camp === CAMP.player1 ? 'player1' : attackerUnit.camp === CAMP.player2 ? 'player2' : attackerUnit.camp === CAMP.player3 ? 'player3' : 'neutral';
                _gameState.killCount[key]++;
            }
            spawnExplosionParticles(this.tile.x, this.tile.y, '#ff2200', 30);
            spawnExplosionParticles(this.tile.x, this.tile.y, '#ffaa00', 15);
            triggerScreenShake(4, 150);
            return true;
        }
        return false;
    }

    // 查找相邻6格内己方铁卫
    _findAdjacentFriendlyIronGuard() {
        if (!this.tile || !_gameState) return null;
        const tileMap = _gameState.tileMap;
        const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
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
