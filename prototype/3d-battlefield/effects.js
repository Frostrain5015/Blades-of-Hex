// 特效模块：炮弹弧线（带尾迹）、爆炸（粒子+冲击波+闪光+震屏）、
// 鱼雷与水柱、近战斩击弧光、曳光弹、上浮伤害数字（Canvas 纹理 Sprite）。
// 所有特效都是短命对象，由 update(dt) 推进并自动回收。
import * as THREE from 'three';
import { rand, rng, EASE, WIND } from './util.js';

let scene, camera;
const live = [];              // 活动特效 { update(dt)->bool 存活, dispose() }
let shakeMag = 0;             // 相机震动幅度（逐帧衰减）
let flashLight = null;        // 全局复用的爆炸点光源
let nightT = 0;

export function initEffects(sc, cam) {
  scene = sc; camera = cam;
  flashLight = new THREE.PointLight(0xffb060, 0, 14, 2);
  scene.add(flashLight);
}

export function setEffectsNight(t) { nightT = t; }

// —— 相机震动：主循环在 controls.update() 之后调用，把偏移叠加到相机位置 ——
const shakeVec = new THREE.Vector3();
export function applyCameraShake(dt) {
  if (shakeMag > 0.001) {
    shakeVec.set((rng() - 0.5), (rng() - 0.5) * 0.6, (rng() - 0.5)).multiplyScalar(shakeMag);
    camera.position.add(shakeVec);
    shakeMag *= Math.pow(0.0015, dt);   // 指数衰减
  } else shakeMag = 0;
}
export function shake(m) { shakeMag = Math.max(shakeMag, m); }

function add(obj, update, dispose) {
  scene.add(obj);
  live.push({ obj, update, dispose });
}
function removeFx(fx) {
  scene.remove(fx.obj);
  fx.dispose && fx.dispose();
}

// —— 粒子云通用构造：返回 Points 及属性数组 ——
function makePoints(n, { size = 0.08, color = 0xffffff, additive = true, opacity = 1 }) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const mat = new THREE.PointsMaterial({
    size, color, transparent: true, opacity, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;   // 位置每帧重写，关掉视锥剔除避免闪没
  return pts;
}

// ============================================================
// 炮弹：发光弹体 + 渐暗尾迹（加法混合下黑色即隐形）
// ============================================================
export function spawnShell(from, to, { arc = null, speed = 9, big = false, onHit = null } = {}) {
  const dist = from.distanceTo(to);
  const dur = Math.max(0.55, Math.min(1.7, dist / speed));
  const arcH = arc ?? (dist * 0.22 + 0.6);
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(big ? 0.09 : 0.06, 8, 6),
    new THREE.MeshBasicMaterial({ color: big ? 0xffc266 : 0xffd9a0 }),
  );
  const TRAIL = 22;
  const trail = makePoints(TRAIL, { size: big ? 0.09 : 0.06, color: 0xff9a4d, opacity: 0.9 });
  const group = new THREE.Group();
  group.add(shell, trail);
  const history = [];
  let t = 0;
  add(group, (dt) => {
    t += dt / dur;
    const k = Math.min(1, t);
    const e = EASE.inQuad(k) * 0.15 + k * 0.85;   // 略加速，炮弹感
    const p = new THREE.Vector3().lerpVectors(from, to, e);
    p.y += Math.sin(Math.PI * e) * arcH;
    shell.position.copy(p);
    history.unshift(p.clone());
    if (history.length > TRAIL) history.pop();
    const pos = trail.geometry.attributes.position;
    for (let i = 0; i < TRAIL; i++) {
      const h = history[Math.min(i, history.length - 1)] || p;
      pos.setXYZ(i, h.x, h.y, h.z);
    }
    pos.needsUpdate = true;
    trail.material.opacity = 0.9 * (1 - k * 0.4);
    if (k >= 1) { onHit && onHit(to); return false; }
    return true;
  });
}

// ============================================================
// 爆炸：火焰粒子 + 黑烟 + 扩散冲击波环 + 点光闪 + 震屏
// ============================================================
export function spawnExplosion(at, { scale = 1, water = false } = {}) {
  shake(0.22 * scale);
  // 点光闪
  flashLight.position.copy(at).add(new THREE.Vector3(0, 0.6, 0));
  flashLight.intensity = 90 * scale * (1 + nightT * 1.5);
  tweenLightDecay();

  // 火焰（加法）+ 烟（普通混合）
  const N = 42;
  const fire = makePoints(N, { size: 0.1 * scale, color: 0xffa445, opacity: 1 });
  const smoke = makePoints(18, { size: 0.16 * scale, color: 0x2e2a24, additive: false, opacity: 0.55 });
  const vel = [], svel = [];
  for (let i = 0; i < N; i++) {
    const a = rng() * Math.PI * 2, b = rng() * Math.PI, s = rand(1.5, 4.2) * scale;
    vel.push(new THREE.Vector3(Math.sin(b) * Math.cos(a), Math.abs(Math.cos(b)) + 0.6, Math.sin(b) * Math.sin(a)).multiplyScalar(s));
  }
  for (let i = 0; i < 18; i++) {
    // 烟雾初速 + 全局风向飘移
    svel.push(new THREE.Vector3(rand(-0.5, 0.5) + WIND.x * 0.9, rand(0.8, 1.8), rand(-0.5, 0.5) + WIND.z * 0.9).multiplyScalar(scale));
  }
  const fp = fire.geometry.attributes.position, sp = smoke.geometry.attributes.position;
  for (let i = 0; i < N; i++) fp.setXYZ(i, at.x, at.y, at.z);
  for (let i = 0; i < 18; i++) sp.setXYZ(i, at.x, at.y + 0.1, at.z);
  const group = new THREE.Group();
  group.add(fire, smoke);

  // 冲击波环
  const ringGeo = new THREE.RingGeometry(0.28, 0.5, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffcf8a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.position.copy(at).y += 0.06;
  group.add(ring);

  let t = 0;
  add(group, (dt) => {
    t += dt;
    for (let i = 0; i < N; i++) {
      vel[i].y -= 7.5 * dt;   // 重力
      fp.setXYZ(i, fp.getX(i) + vel[i].x * dt, fp.getY(i) + vel[i].y * dt, fp.getZ(i) + vel[i].z * dt);
    }
    fp.needsUpdate = true;
    for (let i = 0; i < 18; i++) sp.setXYZ(i, sp.getX(i) + svel[i].x * dt, sp.getY(i) + svel[i].y * dt, sp.getZ(i) + svel[i].z * dt);
    sp.needsUpdate = true;
    const k = Math.min(1, t / 0.8);
    fire.material.opacity = 1 - k;
    smoke.material.opacity = 0.55 * (1 - k * 0.7);
    ring.scale.setScalar(1 + k * 6.5 * scale);
    ring.material.opacity = 0.85 * (1 - k);
    return t < 0.9;
  }, () => { fire.geometry.dispose(); smoke.geometry.dispose(); ringGeo.dispose(); });
}

// 点光快速衰减（独立小补间，避免依赖外部 tween）
function tweenLightDecay() {
  const obj = new THREE.Object3D();
  let t = 0;
  add(obj, (dt) => {
    t += dt;
    flashLight.intensity *= Math.pow(0.0001, dt);
    return t < 0.4;
  });
}

// ============================================================
// 鱼雷：贴水面直线 + 白色尾迹，命中后水柱 + 白沫
// ============================================================
export function spawnTorpedo(from, to, { onHit = null } = {}) {
  const dist = from.distanceTo(to);
  const dur = dist / 6.5;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.3, 3, 6), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.4, metalness: 0.7 }));
  body.rotation.x = Math.PI / 2;
  const wake = makePoints(16, { size: 0.06, color: 0xdff2f5, opacity: 0.75 });
  const group = new THREE.Group();
  group.add(body, wake);
  const history = [];
  let t = 0;
  add(group, (dt) => {
    t += dt / dur;
    const k = Math.min(1, t);
    const p = new THREE.Vector3().lerpVectors(from, to, k);
    body.position.copy(p);
    body.lookAt(to.x, p.y, to.z);
    history.unshift(p.clone());
    if (history.length > 16) history.pop();
    const pos = wake.geometry.attributes.position;
    for (let i = 0; i < 16; i++) {
      const h = history[Math.min(i, history.length - 1)] || p;
      pos.setXYZ(i, h.x + rand(-0.05, 0.05), h.y + 0.02, h.z + rand(-0.05, 0.05));
    }
    pos.needsUpdate = true;
    if (k >= 1) { onHit && onHit(to); return false; }
    return true;
  });
}

export function spawnSplash(at, { scale = 1 } = {}) {
  shake(0.16 * scale);
  // 水柱：圆柱快速升高后回落消散
  const colGeo = new THREE.CylinderGeometry(0.22 * scale, 0.3 * scale, 1, 10);
  const col = new THREE.Mesh(colGeo, new THREE.MeshStandardMaterial({ color: 0xcfe6ea, transparent: true, opacity: 0.85, roughness: 0.6 }));
  col.position.copy(at);
  const spray = makePoints(30, { size: 0.08, color: 0xeaf7fa, opacity: 0.9 });
  const sp = spray.geometry.attributes.position;
  const vel = [];
  for (let i = 0; i < 30; i++) {
    sp.setXYZ(i, at.x, at.y, at.z);
    const a = rng() * Math.PI * 2;
    vel.push(new THREE.Vector3(Math.cos(a) * rand(0.5, 1.6), rand(2, 4.5), Math.sin(a) * rand(0.5, 1.6)).multiplyScalar(scale));
  }
  const group = new THREE.Group();
  group.add(col, spray);
  let t = 0;
  add(group, (dt) => {
    t += dt;
    const k = Math.min(1, t / 0.75);
    col.scale.set(1 - k * 0.5, 0.2 + Math.sin(Math.PI * k) * 2.2 * scale, 1 - k * 0.5);
    col.material.opacity = 0.85 * (1 - k);
    for (let i = 0; i < 30; i++) {
      vel[i].y -= 8 * dt;
      sp.setXYZ(i, sp.getX(i) + vel[i].x * dt, sp.getY(i) + vel[i].y * dt, sp.getZ(i) + vel[i].z * dt);
    }
    sp.needsUpdate = true;
    spray.material.opacity = 0.9 * (1 - k);
    return t < 0.85;
  }, () => colGeo.dispose());
}

// ============================================================
// 炮口焰：径向渐变 Sprite 一闪 + 火花
// ============================================================
let muzzleTex = null;
export function spawnMuzzleFlash(at, { scale = 1 } = {}) {
  if (!muzzleTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,240,200,1)');
    g.addColorStop(0.4, 'rgba(255,170,70,0.8)');
    g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    muzzleTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.SpriteMaterial({ map: muzzleTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const spr = new THREE.Sprite(m);
  spr.position.copy(at);
  const s = 0.55 * scale * (1 + nightT * 0.6);   // 夜里炮口焰更亮
  spr.scale.set(s, s, 1);
  let t = 0;
  add(spr, (dt) => {
    t += dt;
    const k = Math.min(1, t / 0.16);
    spr.scale.setScalar(s * (1 + k * 0.8));
    m.opacity = 1 - k;
    return t < 0.16;
  });
  spawnSlashSpark(at);
}

// ============================================================
// 近战挥击弧光：扇形 ribbon，加色混合，随挥击方向扫过
// ============================================================
export function spawnMeleeArc(at, dirYaw, { scale = 1, color = 0xffe9c8, sweep = 1.9 } = {}) {
  const geo = new THREE.RingGeometry(0.16 * scale, 0.78 * scale, 14, 1, -sweep / 2, sweep);
  geo.rotateX(-Math.PI / 2);   // 平放到 XZ 面，扇形中轴初始朝 +X
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  m.position.copy(at).y += 0.5;
  // 扇形中轴对准攻击方向：+X 经 rotation.y=a 映射为 (cos a, 0, -sin a)
  const baseYaw = dirYaw - Math.PI / 2;
  let t = 0;
  add(m, (dt) => {
    t += dt;
    const k = Math.min(1, t / 0.22);
    m.rotation.y = baseYaw - 0.4 + 0.8 * EASE.outCubic(k);   // 扫掠感
    m.scale.setScalar(0.85 + k * 0.35);
    m.material.opacity = 0.95 * (1 - k * k);
    return t < 0.24;
  }, () => geo.dispose());
}

// ============================================================
// 命中火花：短寿命拉伸粒子（细盒沿速度方向），受重力下落
// ============================================================
export function spawnSparkBurst(at, dirYaw, { n = 10, color = 0xffd98a, speed = 3.2 } = {}) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.018, 0.018, 0.13);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const items = [];
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(geo, mat);
    s.position.copy(at);
    // 以攻击反方向为中心锥形外溅，偏上
    const a = dirYaw + Math.PI + rand(-1.1, 1.1);
    const v = new THREE.Vector3(Math.sin(a) * rand(0.5, 1), rand(0.7, 1.6), Math.cos(a) * rand(0.5, 1)).multiplyScalar(speed * rand(0.6, 1));
    s.lookAt(at.clone().add(v));
    group.add(s);
    items.push({ s, v });
  }
  let t = 0;
  add(group, (dt) => {
    t += dt;
    const k = Math.min(1, t / 0.32);
    for (const { s, v } of items) {
      v.y -= 9.5 * dt;
      s.position.addScaledVector(v, dt);
      s.scale.z = Math.max(0.05, 1 - k);
    }
    mat.opacity = 1 - k * k;
    return t < 0.34;
  }, () => { geo.dispose(); mat.dispose(); });
}

// ============================================================
// 地面尘土：软 sprite 扩散，顺全局风飘移（马蹄/脚步扬尘共用）
// ============================================================
let dustTex = null;

// 黑灰浓烟纹理：比尘土更深的径向渐变，用于引擎烟与炮弹尾迹
let smokeTex = null;
function getSmokeTex() {
  if (!smokeTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 58);
    g.addColorStop(0, 'rgba(45,42,40,0.55)');
    g.addColorStop(0.45, 'rgba(35,32,30,0.32)');
    g.addColorStop(1, 'rgba(30,28,26,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    smokeTex = new THREE.CanvasTexture(c);
  }
  return smokeTex;
}

function getDustTex() {
  if (!dustTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(168,148,110,0.55)');
    g.addColorStop(0.6, 'rgba(150,132,98,0.28)');
    g.addColorStop(1, 'rgba(150,132,98,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    dustTex = new THREE.CanvasTexture(c);
  }
  return dustTex;
}
export function spawnDustPuff(at, { scale = 1, n = 4, strength = 1 } = {}) {
  const group = new THREE.Group();
  const items = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.SpriteMaterial({ map: getDustTex(), transparent: true, opacity: 0.5, depthWrite: false });
    const spr = new THREE.Sprite(m);
    spr.position.set(at.x + rand(-0.15, 0.15), at.y + rand(0.02, 0.12), at.z + rand(-0.15, 0.15));
    const s0 = rand(0.2, 0.35) * scale;
    spr.scale.set(s0, s0, 1);
    group.add(spr);
    items.push({ spr, m, s0, grow: rand(1.6, 2.4) * scale });
  }
  let t = 0;
  add(group, (dt) => {
    t += dt;
    const k = Math.min(1, t / 0.6);
    for (const it of items) {
      const s = it.s0 * (1 + k * it.grow);
      it.spr.scale.set(s, s, 1);
      it.spr.position.x += WIND.x * 0.4 * strength * dt;   // 尘土顺风飘
      it.spr.position.z += WIND.z * 0.4 * strength * dt;
      it.spr.position.y += 0.25 * dt;
      it.m.opacity = 0.5 * (1 - k);
    }
    return t < 0.6;
  }, () => items.forEach((it) => it.m.dispose()));
}

// ============================================================
// 骑兵冲锋尘环：贴地扩散尘圈 + 扬尘
// ============================================================
export function spawnDustRing(at, { scale = 1 } = {}) {
  const geo = new THREE.RingGeometry(0.24, 0.5, 24);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0xa89878, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
  }));
  m.position.copy(at).y += 0.05;
  spawnDustPuff(at, { scale: scale * 1.4, n: 6, strength: 1.2 });
  let t = 0;
  add(m, (dt) => {
    t += dt;
    const k = Math.min(1, t / 0.5);
    m.scale.setScalar(0.4 + EASE.outCubic(k) * 3.2 * scale);
    m.material.opacity = 0.55 * (1 - k);
    return t < 0.5;
  }, () => geo.dispose());
}

// ============================================================
// 曳光弹（碉堡扫射）：拉伸亮盒，一闪即逝
// ============================================================
export function spawnTracer(from, to, { thick = false, life = 0.14, color = 0xffe08a, spark = true } = {}) {
  const len = from.distanceTo(to);
  const thickness = thick ? 0.045 : 0.02;
  const geo = new THREE.BoxGeometry(thickness, thickness, len);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.lerpVectors(from, to, 0.5);
  m.lookAt(to);
  let t = 0;
  add(m, (dt) => {
    t += dt;
    m.material.opacity = 0.95 * (1 - t / life);
    return t < life;
  }, () => geo.dispose());
  if (spark) spawnSlashSpark(to);
}
function spawnSlashSpark(at) {
  const pts = makePoints(6, { size: 0.05, color: 0xffc46a, opacity: 0.9 });
  const p = pts.geometry.attributes.position;
  const vel = [];
  for (let i = 0; i < 6; i++) { p.setXYZ(i, at.x, at.y + 0.3, at.z); vel.push(new THREE.Vector3(rand(-1.5, 1.5), rand(0.5, 2), rand(-1.5, 1.5))); }
  let t = 0;
  add(pts, (dt) => {
    t += dt;
    for (let i = 0; i < 6; i++) { vel[i].y -= 8 * dt; p.setXYZ(i, p.getX(i) + vel[i].x * dt, p.getY(i) + vel[i].y * dt, p.getZ(i) + vel[i].z * dt); }
    p.needsUpdate = true;
    pts.material.opacity = 0.9 * (1 - t / 0.3);
    return t < 0.3;
  });
}

// ============================================================
// 高射炮幕炸点（flak puff）：黑灰球状爆烟 + 一瞬微光，顺风微飘
// ============================================================
export function spawnFlakPuff(at, { scale = 1 } = {}) {
  // 微光一闪
  const fm = new THREE.SpriteMaterial({ map: muzzleTex || getDustTex(), color: 0xffb060, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flash = new THREE.Sprite(fm);
  flash.position.copy(at);
  flash.scale.setScalar(0.22 * scale);
  let ft = 0;
  add(flash, (dt) => {
    ft += dt;
    fm.opacity = 0.9 * (1 - ft / 0.12);
    return ft < 0.12;
  });
  // 黑灰爆烟：几团软 sprite 缓慢膨胀、随风飘移
  const group = new THREE.Group();
  const items = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.SpriteMaterial({ map: getDustTex(), color: 0x2a2724, transparent: true, opacity: 0.75, depthWrite: false });
    const spr = new THREE.Sprite(m);
    spr.position.set(at.x + rand(-0.12, 0.12), at.y + rand(-0.08, 0.08), at.z + rand(-0.12, 0.12));
    const s0 = rand(0.16, 0.24) * scale;
    spr.scale.set(s0, s0, 1);
    group.add(spr);
    items.push({ spr, m, s0 });
  }
  let t = 0;
  add(group, (dt) => {
    t += dt;
    const k = Math.min(1, t / 0.75);
    for (const it of items) {
      const s = it.s0 * (1 + k * 2.2);
      it.spr.scale.set(s, s, 1);
      it.spr.position.x += WIND.x * 0.25 * dt;
      it.spr.position.z += WIND.z * 0.25 * dt;
      it.m.opacity = 0.75 * (1 - k);
    }
    return t < 0.75;
  }, () => items.forEach((it) => it.m.dispose()));
}

// ============================================================
// 伤害数字：Canvas 纹理 Sprite，上浮渐隐（金色普通 / 红色大号暴击）
// ============================================================
export function spawnDamageNumber(at, text, { crit = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${crit ? 64 : 48}px KaiTi, STKaiti, serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(20,12,4,0.9)';
  ctx.strokeText(text, 128, 64);
  ctx.fillStyle = crit ? '#ff5340' : '#ffd700';
  ctx.fillText(text, 128, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(m);
  spr.renderOrder = 999;
  const s = crit ? 2.0 : 1.35;
  spr.scale.set(s, s / 2, 1);
  spr.position.copy(at).y += 1.0;
  let t = 0;
  add(spr, (dt) => {
    t += dt;
    const k = Math.min(1, t / 1.25);
    spr.position.y += dt * 0.85;
    spr.material.opacity = 1 - EASE.inQuad(k);
    return t < 1.25;
  }, () => tex.dispose());
}

// 单位受击闪白：临时抬高自发光再还原（注意军旗自带势力色自发光，需完整恢复）
export function flashUnit(unit) {
  const mats = [];
  unit.body.traverse((o) => { if (o.isMesh && o.material.emissive) mats.push(o.material); });
  const saved = mats.map((m) => ({ hex: m.emissive.getHex(), k: m.emissiveIntensity }));
  mats.forEach((m) => { m.emissive.setHex(0xffffff); m.emissiveIntensity = 0.55; });
  setTimeout(() => mats.forEach((m, i) => { m.emissive.setHex(saved[i].hex); m.emissiveIntensity = saved[i].k; }), 110);
}



// ============================================================
// 引擎/炮弹浓烟：柔软灰黑 sprite 团，顺风飘散、扩张、渐隐
// ============================================================
export function spawnSmokePuff(at, { scale = 1, life = 1.1, drift = 1, color = 0x232220 } = {}) {
  const group = new THREE.Group();
  group.position.copy(at);
  const items = [];
  for (let i = 0; i < 2; i++) {
    const m = new THREE.SpriteMaterial({ map: getSmokeTex(), color, transparent: true, opacity: 0.78, depthWrite: false, blending: THREE.NormalBlending });
    const spr = new THREE.Sprite(m);
    spr.position.set(rand(-0.08, 0.08) * scale, rand(-0.05, 0.08) * scale, rand(-0.08, 0.08) * scale);
    const s0 = rand(0.55, 0.85) * scale;
    spr.scale.set(s0, s0, 1);
    group.add(spr);
    items.push({ spr, m, s0 });
  }
  let t = 0;
  add(group, (dt) => {
    t += dt;
    const k = Math.min(1, t / life);
    for (const it of items) {
      const s = it.s0 * (1 + k * 2.2);
      it.spr.scale.set(s, s, 1);
      it.spr.position.x += WIND.x * 0.35 * drift * dt;
      it.spr.position.z += WIND.z * 0.35 * drift * dt;
      it.spr.position.y += 0.18 * dt;
      it.m.opacity = 0.78 * (1 - k);
    }
    return t < life;
  }, () => items.forEach((it) => it.m.dispose()));
}

// ============================================================
// 机枪曳光弹：短小、不刺眼的暖白亮点 + 极短尾迹，避免激光感
// ============================================================
export function spawnMGTracer(from, to) {
  const dist = from.distanceTo(to);
  const dur = Math.max(0.06, Math.min(0.14, dist / 35));
  const bullet = new THREE.Mesh(
    new THREE.SphereGeometry(0.038, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff8e0 }),
  );
  const TRAIL = 6;
  const trail = makePoints(TRAIL, { size: 0.035, color: 0xffe0a0, opacity: 0.55, additive: true });
  const history = [];
  let t = 0;
  add(bullet, (dt) => {
    t += dt / dur;
    const k = Math.min(1, t);
    const p = new THREE.Vector3().lerpVectors(from, to, k);
    bullet.position.copy(p);
    history.unshift(p.clone());
    if (history.length > TRAIL) history.pop();
    const pos = trail.geometry.attributes.position;
    for (let i = 0; i < TRAIL; i++) {
      const h = history[Math.min(i, history.length - 1)] || p;
      pos.setXYZ(i, h.x, h.y, h.z);
    }
    pos.needsUpdate = true;
    trail.material.opacity = 0.65 * (1 - k);
    if (k >= 1) { scene.remove(trail); trail.geometry.dispose(); trail.material.dispose(); return false; }
    return true;
  }, () => bullet.geometry.dispose());
  scene.add(trail);
}

// ============================================================
// 高射炮弹：带重力的抛物线 + 灰白烟迹，命中点附近绽放 flak puff
// ============================================================
export function spawnAAShell(from, to) {
  const dist = from.distanceTo(to);
  const dur = Math.max(0.45, Math.min(1.1, dist / 7));
  const arcH = dist * 0.18 + 0.4;
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.14, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.4 }),
  );
  shell.rotation.x = Math.PI / 2;
  const TRAIL = 16;
  const trail = makePoints(TRAIL, { size: 0.13, color: 0x8a8580, opacity: 0.45, additive: false });
  // 给烟迹用柔软纹理
  trail.material.map = getSmokeTex();
  trail.material.alphaTest = 0.05;
  const history = [];
  let t = 0;
  const group = new THREE.Group();
  group.add(shell, trail);
  add(group, (dt) => {
    t += dt / dur;
    const k = Math.min(1, t);
    const p = new THREE.Vector3().lerpVectors(from, to, k);
    p.y += Math.sin(Math.PI * k) * arcH;
    shell.position.copy(p);
    shell.lookAt(to.x, p.y, to.z);
    history.unshift(p.clone());
    if (history.length > TRAIL) history.pop();
    const pos = trail.geometry.attributes.position;
    for (let i = 0; i < TRAIL; i++) {
      const h = history[Math.min(i, history.length - 1)] || p;
      pos.setXYZ(i, h.x, h.y, h.z);
    }
    pos.needsUpdate = true;
    trail.material.opacity = 0.45 * (1 - k * 0.5);
    if (k >= 1) { spawnFlakPuff(to, { scale: 0.95 }); return false; }
    return true;
  }, () => { shell.geometry.dispose(); shell.material.dispose(); trail.geometry.dispose(); trail.material.dispose(); });
}

// —— 主循环推进 ——
export function updateEffects(dt) {
  for (let i = live.length - 1; i >= 0; i--) {
    if (!live[i].update(dt)) { removeFx(live[i]); live.splice(i, 1); }
  }
}
