// 实体：玩家 / 商人 NPC / 敌人。负责移动、朝向、行走动画、简易 FSM 与绘制。
// 战斗结算不在这里——敌人只在该出手时回调 hooks.onEnemyAttack，由 combat.js 决定伤害。

import { ART, CHAR_ANCHOR, PALETTE, rgba } from './art.js';
import { ENEMIES } from './data.js';
import { resolveCollision } from './world.js';
import { clamp, damp } from './util.js';

export const ACTOR_RADIUS = 9;
const WALK_FPS = 8;

// ============ 构造 ============

export function createPlayer(x, y) {
    return {
        kind: 'player', sprite: 'marcus', name: '马库斯',
        x, y, radius: ACTOR_RADIUS, dir: 'up',
        vx: 0, vy: 0, kbx: 0, kby: 0,
        animTime: 0, moving: false,
        attackAnim: 0, flash: 0, invuln: 0,
        alive: true
    };
}

export function createNpc(def) {
    return {
        kind: 'npc', sprite: def.sprite, name: def.id,
        x: def.x, y: def.y, radius: ACTOR_RADIUS, dir: def.dir || 'down',
        animTime: 0, moving: false, attackAnim: 0, flash: 0, alive: true,
        idleSeed: Math.random() * 6
    };
}

export function createEnemy(type, x, y) {
    const cfg = ENEMIES[type];
    return {
        kind: 'enemy', type, cfg, sprite: cfg.sprite || null, name: cfg.name,
        homeX: x, homeY: y, x, y, radius: ACTOR_RADIUS, dir: 'down',
        hp: cfg.hp, maxHp: cfg.hp,
        vx: 0, vy: 0, kbx: 0, kby: 0,
        state: 'idle', stateTime: 0, cooldown: 0,
        animTime: 0, moving: false, attackAnim: 0, flash: 0, stagger: 0,
        alive: true, respawnTimer: 0, hpBarTime: 0
    };
}

// ============ 移动 ============

/** 朝向：取主导轴，避免斜向走路时朝向抖动。 */
export function faceFromVector(actor, dx, dy) {
    if (dx === 0 && dy === 0) return;
    if (Math.abs(dx) > Math.abs(dy)) actor.dir = dx > 0 ? 'right' : 'left';
    else actor.dir = dy > 0 ? 'down' : 'up';
}

export function moveActor(world, actor, dx, dy, speed, dt) {
    let mx = dx, my = dy;
    const len = Math.hypot(mx, my);
    if (len > 0) { mx /= len; my /= len; }

    // 击退：独立于输入的一段衰减速度
    const kb = Math.hypot(actor.kbx, actor.kby);
    if (kb > 1) {
        actor.x += actor.kbx * dt;
        actor.y += actor.kby * dt;
        actor.kbx = damp(actor.kbx, 0, 9, dt);
        actor.kby = damp(actor.kby, 0, 9, dt);
    } else {
        actor.kbx = 0; actor.kby = 0;
    }

    actor.x += mx * speed * dt;
    actor.y += my * speed * dt;

    const solved = resolveCollision(world, actor.x, actor.y, actor.radius);
    actor.x = solved.x;
    actor.y = solved.y;

    actor.moving = len > 0;
    if (actor.moving) {
        actor.animTime += dt;
        faceFromVector(actor, mx, my);
    } else {
        actor.animTime = 0;
    }
}

/** 施加一次击退冲量。 */
export function knockback(actor, fromX, fromY, force) {
    const dx = actor.x - fromX, dy = actor.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    actor.kbx += (dx / d) * force;
    actor.kby += (dy / d) * force;
}

// ============ 敌人 AI（idle → chase → windup → attack → recover） ============

export function stepEnemy(enemy, player, world, dt, hooks) {
    if (!enemy.alive) {
        enemy.respawnTimer -= dt;
        return;
    }
    enemy.stateTime += dt;
    enemy.cooldown = Math.max(0, enemy.cooldown - dt);
    enemy.flash = Math.max(0, enemy.flash - dt);
    enemy.stagger = Math.max(0, enemy.stagger - dt);
    enemy.attackAnim = Math.max(0, enemy.attackAnim - dt);
    enemy.hpBarTime = Math.max(0, enemy.hpBarTime - dt);

    const cfg = enemy.cfg;
    if (cfg.speed === 0) return;                 // 木桩：不动、不还手

    const dx = player.x - enemy.x, dy = player.y - enemy.y;
    const dist = Math.hypot(dx, dy);

    if (enemy.stagger > 0) {
        moveActor(world, enemy, 0, 0, 0, dt);
        return;
    }

    switch (enemy.state) {
        case 'idle': {
            // 归位巡逻：离出生点太远就慢慢走回去
            const hx = enemy.homeX - enemy.x, hy = enemy.homeY - enemy.y;
            const hd = Math.hypot(hx, hy);
            if (dist < cfg.senseRange && player.alive) setState(enemy, 'chase');
            else if (hd > 8) moveActor(world, enemy, hx, hy, cfg.speed * 0.45, dt);
            else moveActor(world, enemy, 0, 0, 0, dt);
            break;
        }
        case 'chase': {
            if (!player.alive || dist > cfg.senseRange * 1.5) { setState(enemy, 'idle'); break; }
            faceFromVector(enemy, dx, dy);
            if (cfg.ranged && dist < cfg.keepDistance) {
                moveActor(world, enemy, -dx, -dy, cfg.speed, dt);       // 眼线保持距离
            } else if (dist > cfg.attackRange * 0.85) {
                moveActor(world, enemy, dx, dy, cfg.speed, dt);
            } else {
                moveActor(world, enemy, 0, 0, 0, dt);
            }
            if (dist <= cfg.attackRange && enemy.cooldown <= 0) setState(enemy, 'windup');
            break;
        }
        case 'windup': {
            moveActor(world, enemy, 0, 0, 0, dt);
            faceFromVector(enemy, dx, dy);
            if (enemy.stateTime >= cfg.windup) {
                enemy.attackAnim = 0.22;
                enemy.cooldown = cfg.attackCooldown;
                if (hooks && hooks.onEnemyAttack) hooks.onEnemyAttack(enemy, player, dist);
                setState(enemy, 'chase');
            }
            break;
        }
        default:
            setState(enemy, 'idle');
    }
}

function setState(enemy, state) {
    enemy.state = state;
    enemy.stateTime = 0;
}

export function respawnEnemy(enemy) {
    enemy.alive = true;
    enemy.hp = enemy.maxHp;
    enemy.x = enemy.homeX;
    enemy.y = enemy.homeY;
    enemy.kbx = 0; enemy.kby = 0;
    enemy.flash = 0; enemy.stagger = 0; enemy.hpBarTime = 0;
    setState(enemy, 'idle');
}

// ============ 绘制 ============

function frameOf(actor) {
    const sheet = ART.actors[actor.sprite];
    if (!sheet) return null;
    if (actor.attackAnim > 0) return sheet.attack[actor.dir];
    const phase = actor.moving ? Math.floor(actor.animTime * WALK_FPS) % 4 : 0;
    return sheet.walk[actor.dir][phase];
}

export function drawActor(ctx, actor, t) {
    if (!actor.alive && actor.kind === 'enemy') return;

    // 木桩用道具精灵
    if (actor.kind === 'enemy' && actor.cfg.prop) {
        const sp = ART.props[actor.cfg.prop];
        const sway = Math.sin(t * 9) * (actor.flash > 0 ? 2.4 : 0);
        ctx.save();
        ctx.translate(actor.x + sway, actor.y);
        ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h + 6, sp.w, sp.h);
        if (actor.flash > 0) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = actor.flash * 2.2;
            ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h + 6, sp.w, sp.h);
        }
        ctx.restore();
        drawHpBar(ctx, actor);
        return;
    }

    const frame = frameOf(actor);
    if (!frame) return;

    // NPC 呼吸式上下浮动，让静止的商人不像木头
    const idleBob = actor.kind === 'npc' ? Math.sin(t * 1.6 + actor.idleSeed) * 0.8 : 0;

    ctx.save();
    ctx.translate(Math.round(actor.x), Math.round(actor.y + idleBob));
    if (actor.invuln > 0 && Math.floor(actor.invuln * 20) % 2 === 0) ctx.globalAlpha = 0.55;
    ctx.drawImage(frame.canvas, -CHAR_ANCHOR.x, -CHAR_ANCHOR.y, frame.w, frame.h);
    if (actor.flash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = clamp(actor.flash * 2.6, 0, 1);
        ctx.drawImage(frame.canvas, -CHAR_ANCHOR.x, -CHAR_ANCHOR.y, frame.w, frame.h);
    }
    ctx.restore();

    if (actor.kind === 'enemy') drawHpBar(ctx, actor);
}

function drawHpBar(ctx, enemy) {
    if (enemy.hp >= enemy.maxHp && enemy.hpBarTime <= 0) return;
    const w = 30, h = 4;
    const x = enemy.x - w / 2, y = enemy.y - 62;
    ctx.save();
    ctx.fillStyle = 'rgba(10,7,4,0.72)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = rgba(PALETTE.irisRedDark, 0.9);
    ctx.fillRect(x, y, w, h);
    const ratio = clamp(enemy.hp / enemy.maxHp, 0, 1);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#d4645a');
    g.addColorStop(1, '#9e3438');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w * ratio, h);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x, y, w * ratio, 1);
    ctx.restore();
}

/** 交互提示：站到范围内时在头顶浮出 E 键提示。 */
export function drawInteractHint(ctx, target, t) {
    const bob = Math.sin(t * 4) * 2;
    const x = target.x, y = target.y - 66 + bob;
    ctx.save();
    ctx.fillStyle = 'rgba(12,8,4,0.82)';
    ctx.strokeStyle = PALETTE.warmGold;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(x - 13, y - 11, 26, 20, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PALETTE.gold;
    ctx.font = 'bold 13px "Noto Serif SC",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('E', x, y - 0.5);
    ctx.restore();
}
