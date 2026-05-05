import { HEX_SIZE, ctx, drawHexagonOutline, CAMP, UNIT_CONFIG, COUNTER_RELATION, settings, frameInfo, CAMP_FLAG_COLORS, MORALE_CONFIG, TERRAIN_CONFIG } from './config.js';
import { nextId } from './state.js';
import { spawnExplosionParticles, spawnHealParticles, triggerAttackFlash, triggerHealFlash, triggerScreenShake, moraleEffects } from './effects.js';

// 延迟引用，由游戏逻辑设置
let _logMessage = null;
let _gameState = null;
export function setLogMessageRef(fn) { _logMessage = fn; }
export function setGameStateRefForUnit(ref) { _gameState = ref; }

export class Unit {
    constructor(type, camp, tile, isNewRecruit = false, idOverride = null) {
        this.id = idOverride ?? nextId();
        this.type = type;
        this.config = UNIT_CONFIG[type];
        this.camp = camp;
        this.hp = this.config.hp;
        this.maxHp = this.config.hp;
        this.canAct = true;
        this.tile = tile;
        this.movedThisTurn = false;
        this.counterAttackCount = 0;
        this.isNewRecruit = isNewRecruit;
        this.morale = 'normal';
        this.moraleBoostUntil = 0;
        this.godMode = false;
        this.remainingMP = this.config.speed;
        this.displaySpeed = this.config.speed;
        // 移动动画状态（瞬时，不参与序列化）
        this.movePath = null;       // [{x, y}, ...] waypoints
        this.movePathIdx = 0;
        this.moveStepStart = 0;
        this.moveStepDuration = 0;
        // HP 显示平滑过渡
        this.displayHp = this.hp;
        tile.unit = this;
    }

    startMovePath(path) {
        if (!path || path.length < 2) return;
        this.movePath = path;
        this.movePathIdx = 0;
        this.moveStepStart = frameInfo.now;
        this.moveStepDuration = 130 / (settings.animationSpeed || 1);
    }

    draw(tileX, tileY) {
        const now = frameInfo.now;
        // Path-based movement animation
        let visualX = tileX, visualY = tileY;
        if (this.movePath) {
            const idx = this.movePathIdx;
            const path = this.movePath;
            if (idx >= path.length - 1) {
                this.movePath = null;
            } else {
                const from = path[idx];
                const to = path[idx + 1];
                const t = Math.min((now - this.moveStepStart) / this.moveStepDuration, 1);
                const eased = 1 - Math.pow(1 - t, 2);
                visualX = from.x + (to.x - from.x) * eased;
                visualY = from.y + (to.y - from.y) * eased;
                if (t >= 1) {
                    this.movePathIdx++;
                    this.moveStepStart = now;
                    if (this.movePathIdx >= path.length - 1) {
                        this.movePath = null;
                    }
                }
            }
        }

        const gs = _gameState;
        const time = now / 1000;

        const isP1 = this.camp === CAMP.player1;
        const isP2 = this.camp === CAMP.player2;
        const campKey = isP1 ? 'p1' : isP2 ? 'p2' : 'neu';
        const cc = CAMP_FLAG_COLORS[campKey];

        ctx.save();
        ctx.translate(visualX, visualY);

        // ── Flag (hidden when unit is on a city — city has its own flag) ──
        if (!this.tile.isCity) {
            const poleX = -9;
            const poleTop = -24;
            const poleBottom = 8;
            ctx.beginPath();
            ctx.moveTo(poleX, poleTop);
            ctx.lineTo(poleX, poleBottom);
            ctx.strokeStyle = '#bbb';
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.stroke();
            // Pole finial
            ctx.beginPath();
            ctx.arc(poleX, poleTop, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffd700';
            ctx.fill();

            // Waving flag
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
        }

        // ── Badge ──
        const badgeR = 12;
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
        ctx.font = 'bold 14px "Microsoft YaHei", "Noto Sans CJK SC", "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 2;
        const glyphs = { infantry: '步', cavalry: '骑', archer: '炮' };
        ctx.fillText(glyphs[this.type] || '?', 0, badgeY);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // Morale marker — hex corner badge (top-right)
        const hasMoraleAnim = moraleEffects.some(fx => fx.unitId === this.id);
        if (this.morale !== 'normal' && !hasMoraleAnim) {
            const mc = MORALE_CONFIG[this.morale];
            const mx = HEX_SIZE * 0.55 + (this.morale === 'chaos' ? 2 : 0);
            const my = -HEX_SIZE * 0.35;
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.beginPath();
            ctx.arc(mx, my, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = mc.color;
            ctx.font = 'bold 11px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = mc.color;
            ctx.shadowBlur = 3;
            ctx.fillText(mc.icon, mx, my + 1);
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        }

        ctx.restore();

        // ── HP bar (smooth animated) ──
        const hpWidth = HEX_SIZE * 1.6;
        const hpHeight = 5;
        const hpX = visualX - hpWidth / 2;
        const hpY = visualY + HEX_SIZE / 2 - 3.5;

        // Smooth interpolation toward actual HP
        const lerpFactor = 0.18;
        this.displayHp += (this.hp - this.displayHp) * lerpFactor;
        if (Math.abs(this.hp - this.displayHp) < 0.3) this.displayHp = this.hp;

        this.displaySpeed += (this.remainingMP - this.displaySpeed) * lerpFactor;
        if (Math.abs(this.remainingMP - this.displaySpeed) < 0.3) this.displaySpeed = this.remainingMP;

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.beginPath();
        ctx.roundRect(hpX - 1, hpY - 1, hpWidth + 2, hpHeight + 2, 2.5);
        ctx.fill();

        const displayRatio = this.displayHp / this.maxHp;
        if (displayRatio > 0.005) {
            if (displayRatio > 0.5) ctx.fillStyle = '#4CAF50';
            else if (displayRatio > 0.25) ctx.fillStyle = '#FF9800';
            else ctx.fillStyle = '#f44336';
            ctx.beginPath();
            ctx.roundRect(hpX, hpY, hpWidth * displayRatio, hpHeight, 1.5);
            ctx.fill();
        }

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 2;
        ctx.fillText(Math.round(this.displayHp), visualX, hpY + hpHeight / 2);
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

        // ── New recruit label ──
        if (this.isNewRecruit) {
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,120,0.75)';
            ctx.font = 'bold 9px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('NEW', visualX, visualY - badgeR - 2);
            ctx.restore();
        }
    }

    calculateDamage(targetUnit) {
        const gs = _gameState;
        const counterCoeff = COUNTER_RELATION[this.type][targetUnit.type];
        let baseDmg = this.config.attack * counterCoeff;

        let critRate = 0.2;
        if (counterCoeff > 1) {
            critRate = 0.4;
        } else if (counterCoeff < 1) {
            critRate = 0.05;
        }

        const isCrit = Math.random() < critRate;
        const critMulti = isCrit ? 1.5 : 1;

        let moveMulti = 1;
        if (this.type === 'cavalry' && this.movedThisTurn) {
            moveMulti += 0.3;
        }

        const moraleMulti = MORALE_CONFIG[this.morale].dmgMulti;
        const finalDmg = baseDmg * critMulti * moveMulti * moraleMulti;

        gs.damageTexts.push({
            x: targetUnit.tile.x,
            y: targetUnit.tile.y,
            value: finalDmg,
            isCrit: isCrit,
            timeLeft: 900,
            lastUpdate: Date.now()
        });
        return { dmg: finalDmg, isCrit };
    }

    calculateCounterDamage(attackerUnit) {
        const log = _logMessage;
        const gs = _gameState;

        if (this.counterAttackCount >= 1 || attackerUnit.type === 'archer' || this.morale === 'chaos') {
            return { dmg: 0, isCrit: false };
        }

        const counterCoeff = COUNTER_RELATION[this.type][attackerUnit.type];
        let baseDmg = this.config.attack * 0.75 * counterCoeff;

        let critRate = 0.33;
        if (this.type === 'infantry' && this.tile.isCity) {
            critRate = 0.66;
        }
        critRate = this.counterAttackCount === 0 ? critRate : 0;

        const isCrit = Math.random() < critRate;
        const critMulti = isCrit ? 1.8 : 1;

        let finalDmg = baseDmg * critMulti;

        if (this.hp > 0) {
            this.counterAttackCount++;
            log(`${this.camp.name}的${this.config.name}兵反击造成${Math.round(finalDmg)}伤害${isCrit ? '，反击暴击！' : ''}`);

            gs.damageTexts.push({
                x: attackerUnit.tile.x,
                y: attackerUnit.tile.y,
                value: finalDmg,
                isCrit: isCrit,
                timeLeft: 750,
                lastUpdate: Date.now()
            });
        }
        return { dmg: finalDmg, isCrit };
    }

    takeDamage(dmg, attackerUnit) {
        const log = _logMessage;

        if (this.godMode) return false;

        let finalDmg = dmg;

        const cityBonus = (this.type === 'infantry' && this.tile.isCity) ? 0.33 : 0;
        const terrainBonus = TERRAIN_CONFIG[this.tile.terrain].defenseBonus;
        const defense = cityBonus + terrainBonus;
        if (defense > 0) {
            finalDmg = dmg * (1 - defense);
        }

        this.hp = Math.round(Math.max(0, this.hp - finalDmg));
        if (this.hp <= 0) {
            this.tile.unit = null;
            log(`${this.camp.name} ${this.config.name}兵被消灭`);
            spawnExplosionParticles(this.tile.x, this.tile.y, '#ff2200', 30);
            spawnExplosionParticles(this.tile.x, this.tile.y, '#ffaa00', 15);
            triggerScreenShake(4, 150);
            return true;
        }
        return false;
    }

    heal(amount) {
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
                lastUpdate: Date.now()
            });
            triggerHealFlash(this.tile.x, this.tile.y);
            spawnHealParticles(this.tile.x, this.tile.y);
            return actualHeal;
        }
        return 0;
    }
}
