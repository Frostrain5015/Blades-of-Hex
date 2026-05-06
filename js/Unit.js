import { HEX_SIZE, ctx, drawHexagonOutline, CAMP, UNIT_CONFIG, COUNTER_RELATION, settings, frameInfo, CAMP_FLAG_COLORS, MORALE_CONFIG, TERRAIN_CONFIG, COMMANDER_CONFIG, roundRectPath } from './config.js';
import { nextId } from './state.js';
import { spawnExplosionParticles, spawnHealParticles, triggerAttackFlash, triggerHealFlash, triggerScreenShake, moraleEffects, spawnCommanderSkillEffect } from './effects.js';

// 延迟引用，由游戏逻辑设置(避免循环依赖)
let _logMessage = null;
let _gameState = null;
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
        const cmdCfg = commander ? COMMANDER_CONFIG[commander] : null;
        const hpBonus = cmdCfg ? cmdCfg.hpBonus : 0;
        const atkBonus = cmdCfg ? cmdCfg.atkBonus : 0;
        const spdBonus = cmdCfg ? cmdCfg.spdBonus : 0;
        this.hp = this.config.hp + hpBonus;
        this.maxHp = this.config.hp + hpBonus;
        this._atkBonus = atkBonus;
        this.canAct = true;
        this.tile = tile;
        this.movedThisTurn = false;
        this.moveDistance = 0;
        this.counterAttackCount = 0;
        this.isNewRecruit = isNewRecruit;
        this.morale = 2;
        this.moraleBoostUntil = 0;
        this.godMode = false;
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

    getVisualPos() {
        if (!this.movePath) return { x: this.tile.x, y: this.tile.y };
        const path = this.movePath;
        const elapsed = frameInfo.now - this.movePathStart;
        if (elapsed >= this.movePathDuration) return { x: path[path.length - 1].x, y: path[path.length - 1].y };

        const segs = [];
        let totalLen = 0;
        for (let i = 1; i < path.length; i++) {
            const dx = path[i].x - path[i-1].x;
            const dy = path[i].y - path[i-1].y;
            const len = Math.sqrt(dx * dx + dy * dy);
            segs.push({ from: path[i-1], to: path[i], len, acc: totalLen });
            totalLen += len;
        }
        if (totalLen === 0) return { x: this.tile.x, y: this.tile.y };

        const tTotal = elapsed / this.movePathDuration;
        const target = tTotal * totalLen;

        for (const seg of segs) {
            if (target <= seg.acc + seg.len) {
                const t = Math.max(0, Math.min(1, (target - seg.acc) / seg.len));
                const eased = 1 - Math.pow(1 - t, 3);
                return {
                    x: seg.from.x + (seg.to.x - seg.from.x) * eased,
                    y: seg.from.y + (seg.to.y - seg.from.y) * eased
                };
            }
        }
        return { x: this.tile.x, y: this.tile.y };
    }

    startMovePath(path) {
        if (!path || path.length < 2) return;
        this.movePath = path;
        this.movePathStart = frameInfo.now;
        this.movePathDuration = (path.length - 1) * 120 / (settings.animationSpeed || 1);
    }

    draw(tileX, tileY) {
        const now = frameInfo.now;
        let visualX = tileX, visualY = tileY;
        if (this.movePath) {
            const elapsed = now - this.movePathStart;
            if (elapsed >= this.movePathDuration) {
                this.movePath = null;
            } else {
                const pos = this.getVisualPos();
                visualX = pos.x;
                visualY = pos.y;
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
                ctx.font = 'bold 9px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = '#ffd700';
                ctx.shadowBlur = 5;
                ctx.fillText('★', 0, 0);
                ctx.restore();
            }
        }

        // ── Badge ──
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
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 2;
        const glyphs = { infantry: '⚔️', cavalry: '🐎', archer: '💣' };
        ctx.fillText(glyphs[this.type] || '?', 0, badgeY + 1);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // Morale marker — hex corner badge (top-right)
        const hasMoraleAnim = moraleEffects.some(fx => fx.unitId === this.id);
        if (this.morale !== 2 && !hasMoraleAnim) {
            const mc = MORALE_CONFIG[this.morale];
            const mx = HEX_SIZE * 0.55 + (this.morale === 0 ? 2 : 0);
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

        // ── Ring HP bar ──
        const lerpFactor = 0.18;
        this.displayHp += (this.hp - this.displayHp) * lerpFactor;
        if (Math.abs(this.hp - this.displayHp) < 0.3) this.displayHp = this.hp;

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
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
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

        ctx.restore();

        // ── Actionable glow ──
        if (this.canAct && gs && this.camp === gs.currentCamp && !this.isNewRecruit && gs.commanderPhase !== 'deployment') {
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

        // ── Commander name badge ──
        if (this.commander) {
            const cmdCfg = COMMANDER_CONFIG[this.commander];
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
        const baseAtk = this.config.attack + (this._atkBonus || 0);
        return Math.round(baseAtk * MORALE_CONFIG[this.morale].dmgMulti);
    }

    // Shared damage resolution: attacker → defender
    _resolveDamage(attacker, defender, critRate, critMultiCrit, baseMulti = 1, extraBonus = 0) {
        const counterCoeff = COUNTER_RELATION[attacker.type][defender.type];

        let dmgBonus = counterCoeff - 1 + extraBonus;
        dmgBonus -= TERRAIN_CONFIG[defender.tile.terrain].defenseBonus;
        if (defender.type === 'infantry' && defender.tile.isCity) dmgBonus -= 0.30;
        const dmgMulti = Math.max(0.1, 1 + dmgBonus);

        const isCrit = Math.random() < critRate;
        const critM = isCrit ? critMultiCrit : 1;

        return {
            dmg: attacker.getEffectiveAttack() * baseMulti * dmgMulti * critM,
            isCrit
        };
    }

    calculateDamage(targetUnit) {
        const gs = _gameState;
        const counterCoeff = COUNTER_RELATION[this.type][targetUnit.type];

        let critRate = 0.2;
        if (counterCoeff > 1) critRate = 0.4;
        else if (counterCoeff < 1) critRate = 0.05;

        if (gs.weather === 'wind' && this.type === 'infantry') {
            critRate = Math.min(critRate, 0.05);
        }

        const chargeThreshold = gs.weather === 'fog' ? 1 : 2;
        const chargeAmount    = gs.weather === 'fog' ? 0.30 : 0.25;
        const cavBonus = (this.type === 'cavalry' && this.moveDistance >= chargeThreshold) ? chargeAmount : 0;

        let weatherAtkBonus = 0;
        if (gs.weather === 'fog'  && this.type === 'archer') weatherAtkBonus = -0.25;
        if (gs.weather === 'wind' && this.type === 'archer') weatherAtkBonus = +0.15;

        const result = this._resolveDamage(this, targetUnit, critRate, 1.5, 1, cavBonus + weatherAtkBonus);

        gs.damageTexts.push({
            x: targetUnit.tile.x,
            y: targetUnit.tile.y,
            value: result.dmg,
            isCrit: result.isCrit,
            timeLeft: 900,
            lastUpdate: Date.now()
        });
        return result;
    }

    calculateCounterDamage(attackerUnit) {
        const log = _logMessage;
        const gs = _gameState;

        if (this.counterAttackCount >= 1 || attackerUnit.type === 'archer' || this.morale === 0) {
            return { dmg: 0, isCrit: false };
        }

        let critRate = 0.33;
        if (this.type === 'infantry' && this.tile.isCity) critRate = 0.50;

        const result = this._resolveDamage(this, attackerUnit, critRate, 1.8, 0.75);

        if (this.hp > 0) {
            this.counterAttackCount++;
            log(`${this.camp.name} ${this.config.name}兵反击造成${Math.round(result.dmg)}伤害${result.isCrit ? '，反击暴击！' : ''}`);

            gs.damageTexts.push({
                x: attackerUnit.tile.x,
                y: attackerUnit.tile.y,
                value: result.dmg,
                isCrit: result.isCrit,
                timeLeft: 750,
                lastUpdate: Date.now()
            });
        }
        return result;
    }

    takeDamage(dmg, attackerUnit, _skipAura = false) {
        const log = _logMessage;

        if (this.godMode) return false;

        let actualDmg = dmg;

        // 铁卫自身：受到伤害−30%
        if (this.commander === 'ironGuard') {
            actualDmg = Math.round(dmg * 0.7);
        }

        // 铁卫灵光：相邻友军受伤−20%，50%转由铁卫承担
        if (!_skipAura && this.commander !== 'ironGuard' && _gameState) {
            const ironGuard = this._findAdjacentFriendlyIronGuard();
            if (ironGuard && ironGuard.hp > 0) {
                actualDmg = Math.round(dmg * 0.8);
                const transferred = Math.round(actualDmg * 0.5);
                actualDmg -= transferred;
                ironGuard.takeDamage(transferred, attackerUnit, true);
                // 铁卫承担伤害的反馈
                _gameState.damageTexts.push({
                    x: ironGuard.tile.x,
                    y: ironGuard.tile.y,
                    value: transferred,
                    isCrit: false,
                    timeLeft: 800,
                    lastUpdate: Date.now()
                });
                // 触发铁卫技能护盾特效
                spawnCommanderSkillEffect(ironGuard.tile.x, ironGuard.tile.y, '🛡');
            }
        }

        this.hp = Math.round(Math.max(0, this.hp - actualDmg));
        if (this.hp <= 0) {
            // 将领死亡：清除所有效果
            if (this.commander) {
                if (this.camp === CAMP.player1) _gameState.commanderP1 = null;
                else if (this.camp === CAMP.player2) _gameState.commanderP2 = null;
                log(`${this.camp.name}将领【${COMMANDER_CONFIG[this.commander]?.name || this.commander}】阵亡，效果消失`);
            }
            this.tile.unit = null;
            log(`${this.camp.name} ${this.config.name}兵被消灭`);
            if (attackerUnit) {
                const key = attackerUnit.camp === CAMP.player1 ? 'player1' : attackerUnit.camp === CAMP.player2 ? 'player2' : 'neutral';
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
            if (neighbor && neighbor.unit && neighbor.unit.commander === 'ironGuard' && neighbor.unit.camp === this.camp && neighbor.unit.hp > 0) {
                return neighbor.unit;
            }
        }
        return null;
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
