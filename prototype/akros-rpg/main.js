// 入口：烘焙美术 → 造世界 → 建角色 → 绑输入 → 主循环。
// 场景层次（世界坐标系内）：静态层 → 水波 → 挥砍弧 → 角色（按 y 排序）→ 火焰 → 战斗覆盖 → 特效。
// 屏幕坐标系再叠一层暗角。调试接口挂在 window.__rpg，供 shoot.mjs 驱动与断言。

import { bakeAll, drawFlame, PALETTE, rgba } from './art.js';
import { createWorld, PLAYER_SPAWN, districtAt, drawWaterOverlay, WORLD_W, WORLD_H, STATIC_SS } from './world.js';
import {
    createPlayer, createNpc, createEnemy, moveActor, drawActor, stepEnemy,
    drawInteractHint, faceFromVector
} from './actors.js';
import { createCharacter, equip, unequip, addItem, consume, previewEquip, derive } from './character.js';
import {
    createCombatState, updateCombat, drawCombat,
    performSlash, performPress, performFormation, enemyAttack
} from './combat.js';
import { createShops, buy, sell } from './shop.js';
import * as UI from './ui.js';
import * as FX from './fx.js';
import { INTRO, MERCHANTS, NPCS, HERO } from './data.js';
import { clamp, damp, updateTweens } from './util.js';

// ============ 画布 ============

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// 镜头 2 倍缩放：世界按 32px 格子建模，但屏幕上按 64px 呈现，
// 角色与道具才有足够的体积感。静态层按同倍率烘焙，因此不会被放大糊掉。
const ZOOM = 2;

/** view 是屏幕像素；viewW/viewH 是它换算到世界单位后的可视范围。 */
const view = { w: 1280, h: 720, worldW: 640, worldH: 360 };
let dpr = 1;

function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    view.worldW = view.w / ZOOM;
    view.worldH = view.h / ZOOM;
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
}
window.addEventListener('resize', resize);
resize();

// ============ 世界与角色 ============

bakeAll();
const world = createWorld();
const character = createCharacter();
const player = createPlayer(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
player.deathTimer = 0;

const npcs = [];
const enemies = [];
for (const it of world.interactables) {
    if (it.kind === 'dummy') {
        enemies.push(createEnemy('trainingDummy', it.x, it.y));
    } else {
        npcs.push(createNpc(it));
    }
}
for (const spawn of world.enemySpawns) enemies.push(createEnemy(spawn.type, spawn.x, spawn.y));
// 市民只是布景：会呼吸、不会动、不可交互
for (const a of world.ambient) npcs.push(createNpc({ id: 'townsfolk', sprite: a.sprite, x: a.x, y: a.y, dir: a.dir }));

const game = {
    world, player, enemies, npcs, character,
    combat: createCombatState(),
    shops: createShops(),
    camera: { x: 0, y: 0 },
    time: 0,
    log: (message) => UI.toast(message),
    districtName: () => districtAt(player.y).name
};

game.camera.x = clamp(player.x - view.worldW / 2, 0, Math.max(0, WORLD_W - view.worldW));
game.camera.y = clamp(player.y - view.worldH / 2, 0, Math.max(0, WORLD_H - view.worldH));

UI.initUi(game);
UI.bindPanelEvents();
UI.setHint('WASD 行走 · 左键劈砍 · 1 乘胜 · 2 结阵 · E 交谈/交易 · I 行囊');

const enemyHooks = {
    onEnemyAttack: (enemy, target, dist) => enemyAttack(game, enemy, target, dist)
};

// ============ 输入 ============

const keys = new Set();
const mouse = { x: view.w / 2, y: view.h / 2, down: false };

const MOVE_KEYS = Object.freeze({
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0]
});

window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    keys.add(event.code);
    if (MOVE_KEYS[event.code] || event.code === 'Space') event.preventDefault();

    if (UI.ui.mode === 'dialogue') {
        if (event.code === 'Space' || event.code === 'KeyE' || event.code === 'Enter' || event.code === 'Escape') UI.advanceDialogue();
        return;
    }
    if (UI.isBlocking()) {
        if (event.code === 'Escape' || event.code === 'KeyE' || event.code === 'KeyI') UI.closePanel();
        return;
    }
    switch (event.code) {
        case 'Digit1': skillPress(); break;
        case 'Digit2': skillFormation(); break;
        case 'KeyE': interact(); break;
        case 'KeyI': UI.openBag(); break;
        default: break;
    }
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); mouse.down = false; });

canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
});
canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    mouse.down = true;
    if (UI.ui.mode === 'dialogue') { UI.advanceDialogue(); return; }
    if (!UI.isBlocking()) attackTowardMouse();
});
window.addEventListener('pointerup', () => { mouse.down = false; });
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

function faceMouse() {
    const wx = game.camera.x + mouse.x / ZOOM;
    const wy = game.camera.y + mouse.y / ZOOM;
    faceFromVector(player, wx - player.x, wy - (player.y - 22));
}

function attackTowardMouse() {
    if (!player.alive) return;
    faceMouse();
    performSlash(game);
}

function skillPress() {
    if (!player.alive) return;
    faceMouse();
    performPress(game);
}

function skillFormation() {
    if (!player.alive) return;
    faceMouse();
    performFormation(game);
}

// ============ 交互 ============

function nearestInteractable() {
    let best = null;
    let bestDist = Infinity;
    for (const it of world.interactables) {
        if (it.kind === 'dummy') continue;
        const d = Math.hypot(it.x - player.x, it.y - player.y);
        if (d < it.radius && d < bestDist) { best = it; bestDist = d; }
    }
    return best;
}

function interact() {
    const target = nearestInteractable();
    if (!target) return false;
    if (target.kind === 'merchant') {
        const def = MERCHANTS[target.id];
        UI.toast(def.greeting);
        UI.openShop(target.id);
        return true;
    }
    const def = NPCS[target.id];
    UI.showDialogue(def.name, def.portrait, def.lines);
    return true;
}

// ============ 主循环 ============

const metrics = { frames: 0, totalDt: 0, maxDt: 0, avgDt: 0 };
let lastTime = performance.now();

function update(rawDt) {
    const dt = FX.consumeHitStop(rawDt);
    game.time += rawDt;

    // 命中停顿期间只推进特效，冻结玩法
    if (dt > 0) {
        if (player.alive && !UI.isBlocking()) {
            let dx = 0, dy = 0;
            for (const code of keys) {
                const vec = MOVE_KEYS[code];
                if (vec) { dx += vec[0]; dy += vec[1]; }
            }
            const dashing = game.combat.dashTimer > 0;
            moveActor(world, player, dashing ? 0 : dx, dashing ? 0 : dy, character.stats.moveSpeed, dt);
            if (mouse.down) attackTowardMouse();
        } else {
            moveActor(world, player, 0, 0, 0, dt);
        }

        updateCombat(game, dt);
        for (let i = 0, len = enemies.length; i < len; i++) stepEnemy(enemies[i], player, world, dt, enemyHooks);

        if (!player.alive) {
            player.deathTimer -= dt;
            if (player.deathTimer <= 0) respawnPlayer();
        }
        updateTweens(dt);
    }

    FX.updateFx(rawDt);
    UI.tickToasts(rawDt);
    updateCamera(dt || rawDt);
    UI.updateHud(false);

    const target = UI.isBlocking() ? null : nearestInteractable();
    UI.setHint(target
        ? `E 与${target.kind === 'merchant' ? MERCHANTS[target.id].name : NPCS[target.id].name}交谈`
        : 'WASD 行走 · 左键劈砍 · 1 乘胜 · 2 结阵 · E 交谈/交易 · I 行囊');
}

function respawnPlayer() {
    player.alive = true;
    player.x = PLAYER_SPAWN.x;
    player.y = PLAYER_SPAWN.y;
    player.kbx = 0; player.kby = 0;
    player.invuln = 1.2;
    game.combat.formationTimer = 0;
    game.combat.dashTimer = 0;
    UI.updateHud(true);
}

/** 跟随三件套：死区矩形 → 指数平滑 → 世界边界钳制。 */
function updateCamera(dt) {
    const cam = game.camera;
    const dz = { w: 72, h: 48 };
    const cx = cam.x + view.worldW / 2;
    const cy = cam.y + view.worldH / 2;
    let tx = cam.x, ty = cam.y;
    if (player.x < cx - dz.w / 2) tx = player.x + dz.w / 2 - view.worldW / 2;
    else if (player.x > cx + dz.w / 2) tx = player.x - dz.w / 2 - view.worldW / 2;
    if (player.y < cy - dz.h / 2) ty = player.y + dz.h / 2 - view.worldH / 2;
    else if (player.y > cy + dz.h / 2) ty = player.y - dz.h / 2 - view.worldH / 2;

    cam.x = damp(cam.x, tx, 9, dt);
    cam.y = damp(cam.y, ty, 9, dt);
    cam.x = WORLD_W <= view.worldW ? (WORLD_W - view.worldW) / 2 : clamp(cam.x, 0, WORLD_W - view.worldW);
    cam.y = WORLD_H <= view.worldH ? (WORLD_H - view.worldH) / 2 : clamp(cam.y, 0, WORLD_H - view.worldH);
}

const drawables = [];

function render() {
    const cam = game.camera;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0906';
    ctx.fillRect(0, 0, view.w, view.h);

    ctx.save();
    ctx.scale(ZOOM, ZOOM);
    ctx.translate(-cam.x + FX.fx.shakeX, -cam.y + FX.fx.shakeY);

    // 只画可见的一块静态位图；源矩形在 2 倍烘焙画布上，目标矩形按世界单位
    const sx = clamp(Math.floor(cam.x) - 4, 0, WORLD_W);
    const sy = clamp(Math.floor(cam.y) - 4, 0, WORLD_H);
    const sw = clamp(Math.ceil(view.worldW) + 8, 0, WORLD_W - sx);
    const sh = clamp(Math.ceil(view.worldH) + 8, 0, WORLD_H - sy);
    if (sw > 0 && sh > 0) {
        ctx.drawImage(world.staticCanvas,
            sx * STATIC_SS, sy * STATIC_SS, sw * STATIC_SS, sh * STATIC_SS,
            sx, sy, sw, sh);
    }

    drawWaterOverlay(ctx, game.time, { x: cam.x, y: cam.y, w: view.worldW, h: view.worldH });
    FX.drawSlashes(ctx);

    // 角色按 y 排序，靠下的后画
    drawables.length = 0;
    for (let i = 0; i < npcs.length; i++) drawables.push(npcs[i]);
    for (let i = 0; i < enemies.length; i++) if (enemies[i].alive) drawables.push(enemies[i]);
    if (player.alive) drawables.push(player);
    drawables.sort((a, b) => a.y - b.y);
    for (let i = 0, len = drawables.length; i < len; i++) drawActor(ctx, drawables[i], game.time);

    // 火盆火焰（动态）
    for (const b of world.braziers) {
        if (b.x < cam.x - 60 || b.x > cam.x + view.worldW + 60) continue;
        if (b.y < cam.y - 60 || b.y > cam.y + view.worldH + 60) continue;
        drawFlame(ctx, b.x + 10, b.y + 9, game.time + b.x * 0.01, 1);
    }

    drawCombat(ctx, game, game.time);
    FX.drawFx(ctx);

    const target = UI.isBlocking() ? null : nearestInteractable();
    if (target) drawInteractHint(ctx, target, game.time);

    ctx.restore();

    drawVignette();
    if (!player.alive) drawDeathOverlay();
}

function drawVignette() {
    ctx.save();
    const g = ctx.createRadialGradient(
        view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.34,
        view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.76
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(6,4,2,0.62)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.restore();
}

function drawDeathOverlay() {
    ctx.save();
    ctx.fillStyle = rgba(PALETTE.irisRedDark, 0.30);
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.fillStyle = PALETTE.warmGold;
    ctx.font = '26px "Noto Serif SC",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('倒下了', view.w / 2, view.h / 2 - 12);
    ctx.font = '14px "Noto Serif SC",serif';
    ctx.fillStyle = '#c0b8ac';
    ctx.fillText('在南门醒来，钱袋轻了两成', view.w / 2, view.h / 2 + 20);
    ctx.restore();
}

function frame(now) {
    const rawDt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    metrics.frames += 1;
    metrics.totalDt += rawDt;
    metrics.maxDt = Math.max(metrics.maxDt, rawDt);
    metrics.avgDt = metrics.totalDt / metrics.frames;

    update(rawDt);
    render();
    requestAnimationFrame(frame);
}

// ============ 启动 ============

const loading = document.getElementById('loading');
requestAnimationFrame((now) => {
    lastTime = now;
    loading.classList.add('hide');
    setTimeout(() => loading.remove(), 600);
    UI.showDialogue(INTRO.speaker, INTRO.portrait, INTRO.lines);
    requestAnimationFrame(frame);
});

// ============ 调试接口（shoot.mjs 用） ============

window.__rpg = {
    game, view, metrics,
    ui: UI.ui,
    get character() { return game.character; },
    get stats() { return game.character.stats; },
    world, player, enemies, npcs,
    hero: HERO,

    // —— 驱动 ——
    teleport(x, y) {
        player.x = x; player.y = y;
        game.camera.x = clamp(x - view.worldW / 2, 0, Math.max(0, WORLD_W - view.worldW));
        game.camera.y = clamp(y - view.worldH / 2, 0, Math.max(0, WORLD_H - view.worldH));
    },
    goTo(id) {
        const it = world.interactables.find(i => i.id === id);
        if (it) this.teleport(it.x, it.y + 34);
        return !!it;
    },
    face(dir) { player.dir = dir; },
    slash() { return performSlash(game); },
    press() { return performPress(game); },
    formation() { return performFormation(game); },
    interact() { return interact(); },
    openShop(id) { UI.openShop(id); },
    openBag() { UI.openBag(); },
    closePanel() { UI.closePanel(); },
    skipDialogue() { while (UI.ui.mode === 'dialogue') UI.advanceDialogue(); },
    /** 选中某一行，用来展示面板差值预览。 */
    select(source, itemId) { UI.ui.selected = { source, itemId }; UI.refreshPanel(); },

    /** 连续挥砍（无视冷却），返回本次击杀数。用于验收脚本，不影响正常玩法。 */
    strike(times) {
        let killed = 0;
        for (let i = 0; i < (times || 1); i++) {
            const before = enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
            game.combat.cooldowns.slash = 0;
            performSlash(game);
            if (enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0) < before) killed += 1;
        }
        return killed;
    },

    // —— 交易与装备 ——
    buy(shopId, itemId) { const r = buy(game.shops[shopId], character, itemId); UI.refreshPanel(); UI.updateHud(true); return r; },
    sell(shopId, itemId) { const r = sell(game.shops[shopId], character, itemId); UI.refreshPanel(); UI.updateHud(true); return r; },
    equip(itemId) { const ok = equip(character, itemId); UI.refreshPanel(); UI.updateHud(true); return ok; },
    unequip(slot) { const ok = unequip(character, slot); UI.refreshPanel(); UI.updateHud(true); return ok; },
    give(itemId, count) { addItem(character, itemId, count || 1); UI.refreshPanel(); return true; },
    use(itemId) { const t = consume(character, itemId); UI.updateHud(true); return t; },
    derive() { return derive(character); },
    preview(itemId) { return previewEquip(character, itemId); },

    // —— 战斗辅助 ——
    nearestEnemy(type) {
        let best = null, bestDist = Infinity;
        for (const e of enemies) {
            if (!e.alive) continue;
            if (type && e.type !== type) continue;
            const d = Math.hypot(e.x - player.x, e.y - player.y);
            if (d < bestDist) { best = e; bestDist = d; }
        }
        return best;
    },
    /** 传送到某类敌人身旁并面向它，供截图脚本摆拍。 */
    engage(type) {
        const target = enemies.find(e => e.type === type && e.alive) || enemies.find(e => e.type === type);
        if (!target) return null;
        this.teleport(target.homeX - 34, target.homeY);
        player.dir = 'right';
        return target;
    },
    snapshot() {
        return {
            hp: character.hp,
            maxHp: character.stats.maxHp,
            attack: character.stats.attack,
            defense: character.stats.defense,
            moneyCents: character.moneyCents,
            moneyIsInteger: Number.isInteger(character.moneyCents),
            rank: character.rank,
            xp: character.xp,
            inventory: character.inventory.map(r => ({ ...r })),
            equipment: { ...character.equipment },
            enemiesAlive: enemies.filter(e => e.alive).length,
            district: game.districtName(),
            avgDt: metrics.avgDt,
            maxDt: metrics.maxDt,
            frames: metrics.frames
        };
    }
};
