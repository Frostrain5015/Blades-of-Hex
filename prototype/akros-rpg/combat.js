// 即时战斗：普攻扇形判定、两个技能、冷却、无敌帧、击退、投射物、死亡与掉落。
//
// 伤害管线与本体同口径（数值见 data.js COMBAT，源自 rules/constants.js）：
//   dmg = attack × floatMult × (1 − 减伤) × 增伤乘区
//   floatMult ∈ [0.85, 1.35]；暴击率以"浮动区间上移"体现，超过 1.30 即暴击。

import { COMBAT, SKILLS, ENEMIES, CENTURION } from './data.js';
import { PALETTE, rgba } from './art.js';
import { knockback, respawnEnemy } from './actors.js';
import { resolveCollision } from './world.js';
import { addMoney, gainXp, onDeath, rankName } from './character.js';
import { createRng, clamp } from './util.js';
import * as FX from './fx.js';

const rng = createRng(0xa147);

const DIR_ANGLE = Object.freeze({ right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 });

export function createCombatState() {
    return {
        cooldowns: { slash: 0, press: 0, formation: 0 },
        formationTimer: 0,
        dashTimer: 0, dashVx: 0, dashVy: 0,
        projectiles: [],
        pressPending: false,
        log: []
    };
}

// ============ 伤害 ============

/** 单次伤害掷点。critRate 以浮动区间上移体现，对齐本体「克制改浮动平移」的口径。 */
export function rollDamage(attack, defenseReduction, critRate, extraMult) {
    const f = COMBAT.float;
    const base = f.min + rng.next() * (f.max - f.min);
    const floatMult = clamp(base + critRate * 0.6, f.min, f.max + 0.4);
    const crit = floatMult > f.critThreshold;
    const mitigation = Math.max(COMBAT.defense.minimumMultiplier, 1 - clamp(defenseReduction, 0, COMBAT.defense.maximumReduction));
    const damage = Math.max(1, Math.round(attack * floatMult * mitigation * (extraMult || 1)));
    return { damage, crit, floatMult };
}

// ============ 玩家出手 ============

function coneHits(game, arc, range) {
    const p = game.player;
    const facing = DIR_ANGLE[p.dir];
    const hits = [];
    for (const e of game.enemies) {
        if (!e.alive) continue;
        const dx = e.x - p.x, dy = e.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist > range + e.radius) continue;
        let delta = Math.atan2(dy, dx) - facing;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        if (Math.abs(delta) <= arc / 2 || dist < 18) hits.push(e);
    }
    return hits;
}

export function performSlash(game) {
    const c = game.combat;
    const b = SKILLS.slash.balance;
    if (c.cooldowns.slash > 0 || c.dashTimer > 0 || !game.player.alive) return false;
    c.cooldowns.slash = b.cooldown;
    game.player.attackAnim = 0.2;
    FX.spawnSlashArc(game.player.x, game.player.y, DIR_ANGLE[game.player.dir], b.arc, b.range + 12, '#fff0cf');
    resolveHits(game, coneHits(game, b.arc, b.range), b.multiplier, 'slash');
    return true;
}

export function performPress(game) {
    const c = game.combat;
    const b = SKILLS.press.balance;
    if (c.cooldowns.press > 0 || c.dashTimer > 0 || !game.player.alive) return false;
    c.cooldowns.press = b.cooldown;
    const angle = DIR_ANGLE[game.player.dir];
    c.dashTimer = b.dashSec;
    c.dashVx = Math.cos(angle) * (b.dashPx / b.dashSec);
    c.dashVy = Math.sin(angle) * (b.dashPx / b.dashSec);
    game.player.attackAnim = 0.28;
    game.player.invuln = Math.max(game.player.invuln, b.dashSec * 0.9);   // 突进期间短暂霸体
    FX.spawnSlashArc(game.player.x, game.player.y, angle, b.arc, b.range + 18, PALETTE.gold);
    FX.spawnDust(game.player.x, game.player.y, 8);
    FX.addShake(3);

    const hits = coneHits(game, b.arc, b.range);
    const result = resolveHits(game, hits, b.multiplier, 'press');
    // 【乘胜】：击杀必定重置，命中 30% 概率重置——直译 commander/centurion.js 的 onKill / onAttack
    if (result.killed > 0 || (result.hit > 0 && rng.chance(b.resetChance))) {
        c.cooldowns.press = 0;
        FX.spawnNoticeText(game.player.x, game.player.y, '乘胜', PALETTE.gold);
    }
    return true;
}

export function performFormation(game) {
    const c = game.combat;
    const b = SKILLS.formation.balance;
    if (c.cooldowns.formation > 0 || !game.player.alive) return false;
    c.cooldowns.formation = b.cooldown;
    c.formationTimer = b.duration;
    FX.spawnNoticeText(game.player.x, game.player.y, '结阵', '#9fc4e8');
    return true;
}

function endFormation(game) {
    const b = SKILLS.formation.balance;
    const p = game.player;
    let pushed = 0;
    for (const e of game.enemies) {
        if (!e.alive || e.cfg.speed === 0) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) > b.range) continue;
        knockback(e, p.x, p.y, b.knockbackPx * 6);
        e.stagger = Math.max(e.stagger, 0.35);
        pushed++;
    }
    if (pushed > 0) {
        FX.addShake(5);
        FX.spawnDust(p.x, p.y, 14);
    }
}

/** 结算一组命中。返回 { hit, killed }。 */
function resolveHits(game, hits, multiplier, source) {
    const stats = game.character.stats;
    let hit = 0, killed = 0;
    let buffMult = 1;
    if (game.character.buffs.nextHitBonus > 0 && hits.length > 0) {
        buffMult = 1 + game.character.buffs.nextHitBonus;
        game.character.buffs.nextHitBonus = 0;
    }

    for (const e of hits) {
        const { damage, crit } = rollDamage(stats.attack, e.cfg.defense, stats.critRate, multiplier * buffMult);
        e.hp -= damage;
        e.flash = 0.16;
        e.hpBarTime = 3;
        e.stagger = Math.max(e.stagger, crit ? 0.22 : 0.12);
        if (e.cfg.speed > 0) knockback(e, game.player.x, game.player.y, crit ? 200 : 130);

        const angle = Math.atan2(e.y - game.player.y, e.x - game.player.x);
        FX.spawnHitSparks(e.x, e.y, angle, crit ? 12 : 7, crit ? PALETTE.gold : '#ffd9a0');
        FX.spawnDamageText(e.x, e.y, damage, crit);
        FX.addHitStop(crit ? 0.075 : 0.045);
        FX.addShake(crit ? 7 : 3.5);
        hit++;

        if (e.hp <= 0) { killEnemy(game, e); killed++; }
    }
    if (hit === 0 && source === 'slash') FX.addShake(0.8);
    return { hit, killed };
}

function killEnemy(game, enemy) {
    enemy.alive = false;
    enemy.hp = 0;
    enemy.respawnTimer = enemy.cfg.respawnSec;

    // 掉落
    const [lo, hi] = enemy.cfg.drop;
    if (hi > 0) {
        const cents = rng.int(lo, hi);
        addMoney(game.character, cents);
        FX.spawnMoneyText(enemy.x, enemy.y, cents);
        FX.spawnCoinBurst(enemy.x, enemy.y);
    }
    // 经验：【老兵】使晋升速度提高 100%
    const xp = enemy.cfg.xp * CENTURION.veteranXpMultiplier;
    if (xp > 0) {
        const promoted = gainXp(game.character, xp);
        if (promoted > 0) {
            FX.spawnNoticeText(game.player.x, game.player.y - 14, `晋升 · ${rankName(game.character.rank)}`, PALETTE.gold);
            FX.addShake(6);
            game.log(`晋升为${rankName(game.character.rank)}——攻击 ${game.character.stats.attack}、生命 ${game.character.stats.maxHp}`);
        }
    }
    FX.spawnDust(enemy.x, enemy.y, 12);
    FX.addShake(5);
    game.log(`击败${enemy.name}`);
}

// ============ 敌人出手 ============

export function enemyAttack(game, enemy, player, dist) {
    if (!player.alive) return;
    if (enemy.cfg.ranged) {
        const angle = Math.atan2(player.y - 22 - (enemy.y - 22), player.x - enemy.x);
        game.combat.projectiles.push({
            x: enemy.x, y: enemy.y - 22,
            vx: Math.cos(angle) * enemy.cfg.projectileSpeed,
            vy: Math.sin(angle) * enemy.cfg.projectileSpeed,
            attack: enemy.cfg.attack, life: 1.6, from: enemy
        });
        return;
    }
    if (dist > enemy.cfg.attackRange * 1.3) return;      // 玩家已躲开
    damagePlayer(game, enemy.cfg.attack, enemy.x, enemy.y);
}

export function damagePlayer(game, attack, fromX, fromY) {
    const p = game.player;
    const ch = game.character;
    if (!p.alive || p.invuln > 0) return 0;

    let reduction = ch.stats.defense;
    if (game.combat.formationTimer > 0) {
        reduction += SKILLS.formation.balance.damageReduction + ch.stats.formationBonus;
    }
    const { damage, crit } = rollDamage(attack, reduction, 0, 1);
    ch.hp = Math.max(0, ch.hp - damage);
    p.invuln = COMBAT.invulnerableSec;
    p.flash = 0.2;
    knockback(p, fromX, fromY, COMBAT.knockbackPx * 4);

    FX.spawnDamageText(p.x, p.y, damage, false);
    FX.spawnHitSparks(p.x, p.y, Math.atan2(p.y - fromY, p.x - fromX), 6, crit ? '#ff9c6a' : '#ffb98a');
    FX.addShake(game.combat.formationTimer > 0 ? 3 : 8);
    FX.addHitStop(0.05);

    if (ch.hp <= 0) playerDeath(game);
    return damage;
}

function playerDeath(game) {
    const lost = onDeath(game.character);
    game.player.alive = false;
    game.player.deathTimer = 1.4;
    FX.addShake(12);
    game.log(`倒在了${game.districtName()}。搜身损失 ${(lost / 100).toFixed(2)} —— 在南门醒来。`);
}

// ============ 每帧推进 ============

export function updateCombat(game, dt) {
    const c = game.combat;
    const p = game.player;

    for (const key of Object.keys(c.cooldowns)) {
        c.cooldowns[key] = Math.max(0, c.cooldowns[key] - dt);
    }
    p.attackAnim = Math.max(0, p.attackAnim - dt);
    p.flash = Math.max(0, p.flash - dt);
    p.invuln = Math.max(0, p.invuln - dt);

    if (c.formationTimer > 0) {
        c.formationTimer -= dt;
        if (c.formationTimer <= 0) { c.formationTimer = 0; endFormation(game); }
    }

    if (c.dashTimer > 0) {
        c.dashTimer -= dt;
        const step = Math.min(dt, c.dashTimer + dt);
        const nx = p.x + c.dashVx * step;
        const ny = p.y + c.dashVy * step;
        const solved = resolveCollision(game.world, nx, ny, p.radius);
        p.x = solved.x; p.y = solved.y;
        if (c.dashTimer <= 0) c.dashTimer = 0;
    }

    // 投射物
    for (let i = c.projectiles.length - 1; i >= 0; i--) {
        const pr = c.projectiles[i];
        pr.life -= dt;
        pr.x += pr.vx * dt;
        pr.y += pr.vy * dt;
        const blocked = resolveCollision(game.world, pr.x, pr.y + 22, 4);
        const hitWall = Math.abs(blocked.x - pr.x) > 0.5 || Math.abs(blocked.y - (pr.y + 22)) > 0.5;
        const hitPlayer = p.alive && Math.hypot(pr.x - p.x, pr.y - (p.y - 22)) < p.radius + 6;
        if (hitPlayer) damagePlayer(game, pr.attack, pr.x, pr.y + 22);
        if (pr.life <= 0 || hitWall || hitPlayer) {
            FX.spawnHitSparks(pr.x, pr.y + 22, Math.atan2(-pr.vy, -pr.vx), 4, '#cfd6de');
            c.projectiles.splice(i, 1);
        }
    }

    // 敌人复活
    for (const e of game.enemies) {
        if (!e.alive && e.respawnTimer <= 0) respawnEnemy(e);
    }
}

// ============ 绘制 ============

export function drawCombat(ctx, game, t) {
    const c = game.combat;

    // 结阵盾墙
    if (c.formationTimer > 0) {
        const p = game.player;
        const angle = DIR_ANGLE[p.dir];
        const k = clamp(c.formationTimer / SKILLS.formation.balance.duration, 0, 1);
        ctx.save();
        ctx.translate(p.x, p.y - 22);
        ctx.rotate(angle);
        ctx.globalAlpha = 0.30 + 0.24 * k;
        const g = ctx.createLinearGradient(6, 0, 34, 0);
        g.addColorStop(0, rgba('#cfe3f5', 0.9));
        g.addColorStop(1, rgba('#5b7fa8', 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 30, -0.9, 0.9);
        ctx.arc(0, 0, 14, 0.9, -0.9, true);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = rgba(PALETTE.warmGold, 0.8);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 30, -0.9, 0.9);
        ctx.stroke();
        ctx.restore();
    }

    // 投射物：眼线的石弹
    for (const pr of c.projectiles) {
        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.fillStyle = 'rgba(12,8,4,0.3)';
        ctx.beginPath(); ctx.ellipse(0, 24, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = PALETTE.stoneHi;
        ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgba(PALETTE.regencyPurpleHi, 0.5);
        ctx.beginPath(); ctx.arc(-pr.vx * 0.012, -pr.vy * 0.012, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
    void t;
}

/** 木桩不还手，但要吃伤害——供交互键触发的教学攻击复用。 */
export function isTrainingDummy(enemy) { return enemy.cfg === ENEMIES.trainingDummy; }
