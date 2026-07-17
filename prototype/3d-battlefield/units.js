// 单位模块：6 种程序化低多边形兵种（纯图元拼装，无外部模型），
// 每个单位带势力军旗（世界系风向布料）、底座弧光血条、势力描边与军衔星。
// 支持专精变体（specialization）：同族兵种通过部件开关/叠加层区分。
// 所有模型默认朝向 +Z，移动/攻击时按朝向旋转 group.rotation.y。
import * as THREE from 'three';
import { axialToWorld, rand, rng, WIND, gustStrength, tween, EASE } from './util.js';
import { WATER_Y } from './board.js';

export const FACTION = {
  red: { main: 0xa8402f, flag: 0xc0392b, rim: 0xd4543c, name: '红军' },
  blue: { main: 0x31597f, flag: 0x2e5d8c, rim: 0x4d86b8, name: '蓝军' },
};
const METAL = 0x33333a, BASE = 0x232327, WOOD = 0x4f3b28, SKIN = 0xd9b38c;

// 兵种属性：血量 / 射程 / 移动力 / 血条环高度
export const UNIT_STATS = {
  infantry: { name: '步兵', hp: 100, range: 1, move: 2, ringY: 1.3, naval: false },
  cavalry: { name: '骑兵', hp: 120, range: 1, move: 3, ringY: 1.5, naval: false },
  artillery: { name: '炮兵', hp: 90, range: 3, move: 1, ringY: 1.15, naval: false },
  mgNest: { name: '碉堡', hp: 150, range: 2, move: 0, ringY: 1.0, naval: false },
  warship: { name: '战舰', hp: 160, range: 3, move: 2, ringY: 1.6, naval: true },
  submarine: { name: '潜艇', hp: 110, range: 3, move: 2, ringY: 0.95, naval: true },
  carrier: { name: '航母', hp: 250, range: 5, move: 2, ringY: 1.8, naval: true },
};

const mat = (color, rough = 0.8, metal = 0.15) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: rough, metalness: metal });
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cyl = (rt, rb, h, m, seg = 8) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);

// —— 军旗：真·布料模拟 ——
// 旗杆随单位，旗面高细分网格（16×10）每帧 CPU 布料波动：
// 主行波 3 倍频正弦叠加向自由边传播 + 纵向涟漪 + 阵风弱时自由边垂坠；
// 旗面 counter-rotate 抵消单位偏航，永远顺全局风（西北→东南）；
// 每帧重算法线，波峰波谷有光影层次；徽记纹理由 canvas 生成。
const flags = [];
const FLAG_W = 0.42, FLAG_H = 0.26;
const FLAG_SHAPE = { cavalry: 'pennant', warship: 'swallow', submarine: 'swallow' };  // 骑兵三角旗 / 舰船燕尾旗

// 徽记纹理缓存：双色旗面 + 中央兵种符号圆盘
const flagTexCache = new Map();
function flagTexture(fac, type, shape) {
  const key = fac.name + ':' + type + ':' + shape;
  if (flagTexCache.has(key)) return flagTexCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const ctx = c.getContext('2d');
  const dark = '#' + new THREE.Color(fac.flag).offsetHSL(0, 0, -0.12).getHexString();
  ctx.fillStyle = '#' + new THREE.Color(fac.flag).getHexString();
  ctx.fillRect(0, 0, 256, 160);
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(0, 0, 26, 160);          // 旗杆套深色
  const grad = ctx.createLinearGradient(180, 0, 256, 0);                    // 自由端渐暗
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = grad; ctx.fillRect(180, 0, 76, 160);
  // 中央徽记
  const cx = 132, cy = 80;
  ctx.fillStyle = 'rgba(240,232,210,0.92)';
  ctx.beginPath(); ctx.arc(cx, cy, 36, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dark; ctx.strokeStyle = dark;
  ctx.lineWidth = 7; ctx.lineCap = 'round';
  const S = 17;
  if (type === 'infantry') {          // 交叉线
    ctx.beginPath(); ctx.moveTo(cx - S, cy - S); ctx.lineTo(cx + S, cy + S);
    ctx.moveTo(cx + S, cy - S); ctx.lineTo(cx - S, cy + S); ctx.stroke();
  } else if (type === 'cavalry') {    // 三角（矛头）
    ctx.beginPath(); ctx.moveTo(cx, cy - S); ctx.lineTo(cx + S, cy + S * 0.8); ctx.lineTo(cx - S, cy + S * 0.8);
    ctx.closePath(); ctx.fill();
  } else if (type === 'artillery') {  // 圆环（车轮）
    ctx.beginPath(); ctx.arc(cx, cy, S * 0.75, 0, Math.PI * 2); ctx.stroke();
  } else if (type === 'mgNest') {     // 方块（碉堡）
    ctx.fillRect(cx - S * 0.8, cy - S * 0.8, S * 1.6, S * 1.6);
  } else if (type === 'warship') {    // 波浪
    ctx.beginPath(); ctx.moveTo(cx - S, cy);
    ctx.quadraticCurveTo(cx - S / 2, cy - S * 0.8, cx, cy);
    ctx.quadraticCurveTo(cx + S / 2, cy + S * 0.8, cx + S, cy); ctx.stroke();
  } else if (type === 'submarine') {  // 横杠 + 潜望塔
    ctx.beginPath(); ctx.moveTo(cx - S, cy); ctx.lineTo(cx + S, cy); ctx.stroke();
    ctx.fillRect(cx - 2.5, cy - S * 0.75, 5, S * 0.75);
  } else {                            // 默认星
    ctx.beginPath(); ctx.arc(cx, cy, S * 0.5, 0, Math.PI * 2); ctx.fill();
  }
  // 旗形裁剪（destination-out）
  ctx.globalCompositeOperation = 'destination-out';
  if (shape === 'pennant') {          // 三角旗：裁掉右上/右下，收成尖角
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(256, 0); ctx.lineTo(256, 80); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 160); ctx.lineTo(256, 160); ctx.lineTo(256, 80); ctx.closePath(); ctx.fill();
  } else if (shape === 'swallow') {   // 燕尾旗：自由端裁 V 形缺口
    ctx.beginPath(); ctx.moveTo(256, 0); ctx.lineTo(186, 80); ctx.lineTo(256, 160); ctx.closePath(); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  flagTexCache.set(key, tex);
  return tex;
}

function buildBanner(fac, type, poleH = 1.1) {
  const g = new THREE.Group();
  const pole = cyl(0.014, 0.018, poleH, mat(METAL, 0.5, 0.7), 6);
  pole.position.y = poleH / 2;
  g.add(pole);
  const geo = new THREE.PlaneGeometry(FLAG_W, FLAG_H, 16, 10);
  geo.translate(FLAG_W / 2, 0, 0);   // 左边缘对齐旗杆（钉边）
  const m = new THREE.MeshStandardMaterial({
    map: flagTexture(fac, type, FLAG_SHAPE[type] || 'rect'),
    side: THREE.DoubleSide, roughness: 0.85, metalness: 0,
    emissive: fac.flag, emissiveIntensity: 0.08,
    transparent: true, alphaTest: 0.35,
  });
  const flag = new THREE.Mesh(geo, m);
  flag.position.y = poleH - 0.16;
  flag.userData.cloth = true;   // createUnit 据此注册到所属单位
  // 让阴影也遵守 alpha 裁剪（三角旗/燕尾旗的影子形状正确）
  flag.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking, map: m.map, alphaTest: 0.35,
  });
  g.add(flag);
  return g;
}

// —— 底座弧光血条：HP 弧段整合在单位圆形底座外缘（去悬浮环）——
// 径向分层：0.27–0.35 为 HP 弧带（绿→黄→红），0.37–0.43 为势力描边细环，
// 底座正前方刻军衔金星。受击弧段闪白，掉血段碎裂消隐。
const HP_ARC_R = [0.27, 0.35];
const HP_GREEN = new THREE.Color(0x57b34c), HP_YELLOW = new THREE.Color(0xd4c23c), HP_RED = new THREE.Color(0xc0392b);
const hpArcColor = (frac, out) =>
  frac > 0.5 ? out.lerpColors(HP_YELLOW, HP_GREEN, (frac - 0.5) * 2) : out.lerpColors(HP_RED, HP_YELLOW, frac * 2);

function flatRing(ri, ro, seg, thetaStart, thetaLen) {
  const g = new THREE.RingGeometry(ri, ro, seg, 1, thetaStart, thetaLen);
  g.rotateX(-Math.PI / 2);
  return g;
}

function buildHpArc() {
  // 暗色底轨（掉血部分读作缺口）+ 前景弧段
  const track = new THREE.Mesh(
    flatRing(HP_ARC_R[0], HP_ARC_R[1], 40, 0, Math.PI * 2),
    new THREE.MeshBasicMaterial({ color: 0x14161a, transparent: true, opacity: 0.6, depthWrite: false }),
  );
  track.position.y = 0.088;
  const arc = new THREE.Mesh(
    flatRing(HP_ARC_R[0], HP_ARC_R[1], 40, -Math.PI / 2, Math.PI * 2),
    new THREE.MeshBasicMaterial({ color: 0x57b34c, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  arc.position.y = 0.092;
  return { track, arc };
}

export function updateHpArc(unit) {
  const frac = Math.max(0, unit.hp / unit.maxHp);
  const arc = unit.hpArc;
  arc.geometry.dispose();
  arc.geometry = flatRing(HP_ARC_R[0], HP_ARC_R[1], 40, -Math.PI / 2, Math.max(0.001, frac * Math.PI * 2));
  hpArcColor(frac, arc.material.color);
}

// 受击反馈：弧段闪白 + 掉血段碎裂（三块碎片弧旋转飘落消隐）
export function damageHpArcFeedback(unit, oldFrac, newFrac) {
  const arc = unit.hpArc;
  // 闪白后恢复当前血量色
  arc.material.color.setHex(0xffffff);
  arc.material.opacity = 1;
  setTimeout(() => { if (unit.alive) updateHpArc(unit); }, 130);
  const lost = oldFrac - newFrac;
  if (lost <= 0.005) return;
  for (let i = 0; i < 3; i++) {
    const subFrom = oldFrac - lost * (i / 3), subTo = oldFrac - lost * ((i + 1) / 3);
    const theta0 = -Math.PI / 2 + subTo * Math.PI * 2;
    const thetaLen = Math.max(0.02, (subFrom - subTo) * Math.PI * 2);
    const shard = new THREE.Mesh(
      flatRing(HP_ARC_R[0], HP_ARC_R[1], 6, theta0, thetaLen),
      new THREE.MeshBasicMaterial({ color: 0x8a2a1a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    shard.position.y = 0.092;
    unit.group.add(shard);
    const spin = rand(-0.7, 0.7);
    tween({
      dur: 0.45, delay: i * 0.06, ease: EASE.inQuad,
      onUpdate: (k) => {
        shard.rotation.y = spin * k;
        shard.position.y = 0.092 - k * 0.1;
        shard.material.opacity = 0.9 * (1 - k);
      },
      onDone: () => {
        unit.group.remove(shard);
        shard.geometry.dispose();
        shard.material.dispose();
      },
    });
  }
}

// —— 军衔星：底座正前方的金色小星（按兵种价值 1–3 颗）——
const RANK_STARS = { infantry: 1, cavalry: 2, artillery: 2, mgNest: 2, submarine: 3, warship: 3 };
let starGeo = null;
function getStarGeo() {
  if (!starGeo) {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 0.034 : 0.014;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
    }
    shape.closePath();
    starGeo = new THREE.ShapeGeometry(shape);
    starGeo.rotateX(-Math.PI / 2);
  }
  return starGeo;
}
const starMat = new THREE.MeshBasicMaterial({ color: 0xd8b34a, transparent: true, opacity: 0.9, depthWrite: false });

// —— 专精分支：同族兵种的部件/涂装变体（不整体重建）——
export const SPEC_NAMES = {
  infantry: { assault: '突击', garrison: '卫戍' },
  cavalry: { light: '轻', heavy: '重' },
  artillery: { field: '野战', rocket: '火箭', aa: '防空' },
  warship: { aa: '防空', asw: '反潜', sea: '制海', support: '支援' },
};

// ============================================================
// 六个兵种构建函数（均返回挂在 body 组下的模型，muzzle 为开火点）
// ============================================================
function buildInfantry(fac, nightMats, spec) {
  const b = new THREE.Group();
  // 卫戍涂装更深，突击保持本色
  const uniColor = spec === 'garrison' ? new THREE.Color(fac.main).offsetHSL(0, 0, -0.07) : fac.main;
  const uni = mat(uniColor), dk = mat(METAL, 0.5, 0.7);
  for (const sx of [-0.08, 0.08]) { const leg = box(0.09, 0.22, 0.12, uni); leg.position.set(sx, 0.19, 0); b.add(leg); }
  const torso = box(0.26, 0.3, 0.16, uni); torso.position.y = 0.45; b.add(torso);
  if (spec !== 'assault') {   // 突击轻装无背包
    const pack = box(0.18, 0.2, 0.08, mat(WOOD)); pack.position.set(0, 0.48, -0.13); b.add(pack);
  }
  if (spec === 'assault') {   // 突击：亮条纹 + 护目镜
    const stripe = box(0.27, 0.05, 0.17, mat(fac.rim, 0.6, 0.3)); stripe.position.y = 0.52; b.add(stripe);
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), mat(SKIN, 0.9)); head.position.y = 0.68; b.add(head);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.135, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), dk); helm.position.y = 0.71; b.add(helm);
  if (spec === 'assault') {
    const goggles = box(0.15, 0.04, 0.03, mat(0x1a1d22, 0.4, 0.6)); goggles.position.set(0, 0.69, 0.1); b.add(goggles);
  }
  const rifle = box(0.045, 0.045, 0.55, dk); rifle.position.set(0.14, 0.5, 0.08); rifle.rotation.x = -0.35; b.add(rifle);
  for (const s of [-1, 1]) { const arm = box(0.07, 0.2, 0.07, uni); arm.position.set(s * 0.17, 0.5, 0.05); arm.rotation.x = -0.5; b.add(arm); }
  if (spec === 'garrison') {  // 卫戍：防弹盾 + 脚前沙袋
    const shield = box(0.3, 0.44, 0.04, mat(0x3a3f45, 0.5, 0.7)); shield.position.set(-0.22, 0.4, 0.16); shield.rotation.y = 0.25; b.add(shield);
    const sandM = mat(0x8a7f5c, 1.0);
    for (let i = 0; i < 3; i++) {
      const bag = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), sandM);
      bag.scale.set(1.3, 0.65, 1);
      bag.position.set(-0.15 + i * 0.15, 0.05, 0.3);
      b.add(bag);
    }
  }
  const banner = buildBanner(fac, 'infantry'); banner.position.set(-0.24, 0.06, -0.18); b.add(banner);
  return { body: b, muzzle: null, anim: { rifle, torso } };
}

function buildCavalry(fac, nightMats, spec) {
  const b = new THREE.Group();
  const horse = mat(spec === 'light' ? 0x7d5636 : 0x6e4a2f, 0.9), uni = mat(fac.main), dk = mat(METAL, 0.5, 0.7);
  // 马体独立成组：轻骑瘦小、重骑高大约 15%
  const horseG = new THREE.Group();
  const bodyH = box(0.28, 0.3, 0.62, horse); bodyH.position.y = 0.48; horseG.add(bodyH);
  const neck = box(0.14, 0.3, 0.16, horse); neck.position.set(0, 0.66, 0.32); neck.rotation.x = 0.5; horseG.add(neck);
  const head = box(0.12, 0.14, 0.26, horse); head.position.set(0, 0.74, 0.46); horseG.add(head);
  const tail = box(0.05, 0.24, 0.05, horse); tail.position.set(0, 0.5, -0.34); tail.rotation.x = 0.5; horseG.add(tail);
  const legs = [];
  for (const [sx, sz] of [[-0.1, 0.22], [0.1, 0.22], [-0.1, -0.22], [0.1, -0.22]]) {
    const leg = cyl(0.04, 0.045, 0.34, horse, 6); leg.position.set(sx, 0.17, sz); horseG.add(leg); legs.push(leg);
  }
  if (spec === 'heavy') {   // 重骑：马甲板甲（侧甲片 + 马头甲）
    const plate = mat(0x4a4f57, 0.45, 0.7);
    for (const s of [-1, 1]) { const p = box(0.03, 0.2, 0.5, plate); p.position.set(s * 0.16, 0.46, 0); horseG.add(p); }
    const chamfron = box(0.14, 0.12, 0.2, plate); chamfron.position.set(0, 0.78, 0.48); horseG.add(chamfron);
    horseG.scale.setScalar(1.14);
  } else if (spec === 'light') {
    horseG.scale.set(0.9, 0.92, 0.94);
  }
  b.add(horseG);
  const saddle = box(0.24, 0.06, 0.24, mat(WOOD)); saddle.position.y = 0.66 * horseG.scale.y; b.add(saddle);
  const torso = box(0.22, 0.26, 0.14, uni); torso.position.y = 0.84 * horseG.scale.y; b.add(torso);
  const head2 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat(SKIN, 0.9)); head2.position.y = 1.03 * horseG.scale.y; b.add(head2);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), dk); helm.position.y = 1.06 * horseG.scale.y; b.add(helm);
  let lance;
  if (spec === 'light') {
    // 轻骑弯刀：弧形刀身（torus 段）
    lance = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.018, 6, 10, Math.PI * 0.55), mat(0xb8bcc2, 0.35, 0.85));
    blade.rotation.set(0, Math.PI / 2, -0.6);
    lance.add(blade);
    lance.position.set(0.18, 0.95 * horseG.scale.y, 0.2);
    b.add(lance);
  } else {
    // 长枪（重骑更粗更长）
    const sMul = spec === 'heavy' ? 1.18 : 1;
    lance = cyl(0.015 * sMul, 0.025 * sMul, 0.95 * sMul, mat(0x8a7a5a, 0.7), 6);
    lance.position.set(0.16, 0.92 * horseG.scale.y, 0.3); lance.rotation.x = -1.1; b.add(lance);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03 * sMul, 0.1 * sMul, 6), dk);
    tip.position.set(0.16, 0.92 * horseG.scale.y + 0.35 * sMul, 0.3 + 0.38 * sMul); tip.rotation.x = Math.PI / 2 - 1.1 + Math.PI / 2;
    b.add(tip);
  }
  const banner = buildBanner(fac, 'cavalry', 0.9); banner.position.set(-0.18, 0.6 * horseG.scale.y, -0.3); b.add(banner);
  return { body: b, muzzle: null, anim: { legs, lance, torso } };
}

function buildArtillery(fac, nightMats, spec) {
  const b = new THREE.Group();
  const dk = mat(METAL, 0.45, 0.75), wood = mat(WOOD, 0.85);
  const carriage = box(0.3, 0.12, 0.5, wood); carriage.position.y = 0.3; b.add(carriage);
  let muzzle = new THREE.Object3D();
  let barrel = null;
  if (spec === 'rocket') {
    // 火箭炮：多管火箭巢（2×3 发射管 + 框架），取代了单炮管
    const pod = new THREE.Group();
    const frame = box(0.36, 0.24, 0.55, mat(0x424a41, 0.6, 0.4)); pod.add(frame);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const tube = cyl(0.045, 0.045, 0.58, dk, 8);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(-0.11 + c * 0.11, -0.06 + r * 0.12, 0.03);
      pod.add(tube);
    }
    pod.rotation.x = -0.55;
    pod.position.set(0, 0.52, 0.05);
    b.add(pod);
    muzzle.position.set(0, 0.2, 0.35);
    pod.add(muzzle);
    barrel = pod;   // 后座动画作用于整个火箭巢
  } else if (spec === 'aa') {
    // 防空炮：高仰角细长炮管 + 雷达碟
    barrel = cyl(0.038, 0.05, 0.88, dk, 10);
    barrel.rotation.x = -1.35; barrel.position.set(0, 0.55, 0.08); b.add(barrel);
    muzzle.position.y = 0.46; barrel.add(muzzle);
    const pedestal = cyl(0.05, 0.07, 0.3, dk, 8); pedestal.position.set(-0.26, 0.4, -0.22); b.add(pedestal);
    const dish = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.09, 12), mat(0x555c60, 0.5, 0.6));
    dish.rotation.x = -0.7; dish.position.set(-0.26, 0.62, -0.22); b.add(dish);
  } else {
    // 野战炮：单管上仰（默认）
    barrel = cyl(0.055, 0.075, 0.62, dk, 10);
    barrel.rotation.x = -1.15; barrel.position.set(0, 0.44, 0.1); b.add(barrel);
    muzzle.position.y = 0.34; barrel.add(muzzle);
  }
  const wheels = [];
  for (const sx of [-0.26, 0.26]) {
    const w = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 6, 14), wood); rim.rotation.y = Math.PI / 2; w.add(rim);
    for (let i = 0; i < 3; i++) {
      const spoke = cyl(0.015, 0.015, 0.36, dk, 5); spoke.rotation.x = (i * Math.PI) / 3; w.add(spoke);
    }
    const hub = cyl(0.04, 0.04, 0.06, dk, 8); hub.rotation.z = Math.PI / 2; w.add(hub);
    w.position.set(sx, 0.19, 0.05);
    b.add(w); wheels.push(w);
  }
  for (const s of [-1, 1]) { const trail = box(0.05, 0.05, 0.55, wood); trail.position.set(s * 0.1, 0.24, -0.42); trail.rotation.x = 0.35; b.add(trail); }
  const crate = box(0.2, 0.14, 0.16, wood); crate.position.set(0.24, 0.13, -0.28); b.add(crate);
  const banner = buildBanner(fac, 'artillery', 0.95); banner.position.set(-0.3, 0.05, -0.35); b.add(banner);
  return { body: b, muzzle, anim: { wheels, barrel, barrelHome: barrel.position.clone() } };
}

function buildMgNest(fac, nightMats) {
  const b = new THREE.Group();
  const conc = mat(0x7a7a72, 1.0), dk = mat(METAL, 0.45, 0.75);
  const hut = box(0.7, 0.4, 0.6, conc); hut.position.y = 0.28; b.add(hut);
  const roof = box(0.78, 0.1, 0.68, mat(0x5f5f58, 1.0)); roof.position.y = 0.52; b.add(roof);
  const slit = box(0.4, 0.07, 0.03, mat(0x14140f, 1.0)); slit.position.set(0, 0.4, 0.31); b.add(slit);
  const mg = cyl(0.022, 0.022, 0.42, dk, 6); mg.rotation.x = Math.PI / 2; mg.position.set(0.05, 0.4, 0.48); b.add(mg);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.05, 0.4, 0.72); b.add(muzzle);
  // 沙袋
  const sandM = mat(0x8a7f5c, 1.0);
  for (let i = 0; i < 5; i++) {
    const a = -0.9 + i * 0.45;
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), sandM);
    bag.scale.set(1.3, 0.7, 1);
    bag.position.set(Math.sin(a) * 0.5, 0.08, Math.cos(a) * 0.46 + 0.08);
    b.add(bag);
  }
  // 瞭望孔夜火
  const winM = new THREE.MeshBasicMaterial({ color: 0xffd37a, transparent: true, opacity: 0 });
  nightMats.push(winM);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.04), winM);
  win.position.set(0, 0.4, 0.315); b.add(win);
  const banner = buildBanner(fac, 'mgNest', 0.9); banner.position.set(-0.3, 0.05, -0.28); b.add(banner);
  return { body: b, muzzle };
}

function buildWarship(fac, nightMats, spec) {
  const b = new THREE.Group();
  const steel = mat(0x4a5464, 0.6, 0.5), dk = mat(METAL, 0.45, 0.75), deckM = mat(0x5f6874, 0.8);
  const isCruiser = spec === 'sea' || spec === 'support';
  const hull = box(0.7, 0.34, 1.7, steel); hull.position.y = 0.1; b.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.55, 4), steel);
  bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.scale.set(1.35, 1, 0.62);
  bow.position.set(0, 0.1, 1.1); b.add(bow);
  const deck = box(0.6, 0.07, 1.5, deckM); deck.position.y = 0.3; b.add(deck);
  // 主炮塔：制海型 3 座，支援型仅前 1 座，其余 2 座
  const turrets = [];
  const turretZ = spec === 'sea' ? [0.62, 0.1, -0.5] : spec === 'support' ? [0.55] : [0.45, -0.45];
  for (const tz of turretZ) {
    const t = new THREE.Group();
    const base = cyl(0.15, 0.17, 0.1, steel, 10); t.add(base);
    for (const sx of [-0.05, 0.05]) {
      const gun = cyl(0.022, 0.026, 0.4, dk, 6); gun.rotation.x = Math.PI / 2 - 0.12; gun.position.set(sx, 0.08, 0.2); t.add(gun);
    }
    t.position.set(0, 0.38, tz);
    b.add(t); turrets.push(t);
  }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.46, 0.9); b.add(muzzle);
  const bridge = box(0.3, 0.3, 0.26, steel); bridge.position.set(0, 0.5, -0.05); b.add(bridge);
  const top = box(0.2, 0.1, 0.18, deckM); top.position.set(0, 0.68, -0.05); b.add(top);
  const stack = cyl(0.07, 0.09, 0.34, dk, 8); stack.position.set(0, 0.5, -0.34); b.add(stack);
  const mast = cyl(0.015, 0.02, 0.5, dk, 6); mast.position.set(0, 0.75, 0.15); b.add(mast);
  // —— 变体部件 ——
  if (spec === 'aa') {
    // 防空型：两舷高炮位 + 桅顶雷达碟
    for (const s of [-1, 1]) {
      const mount = cyl(0.06, 0.07, 0.06, steel, 8); mount.position.set(s * 0.28, 0.36, 0.05); b.add(mount);
      for (const off of [-0.025, 0.025]) {
        const aaGun = cyl(0.012, 0.012, 0.26, dk, 5);
        aaGun.rotation.x = -0.9; aaGun.position.set(s * 0.28 + off, 0.46, 0.05); b.add(aaGun);
      }
    }
    const radar = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.06, 10), deckM);
    radar.rotation.x = -0.5; radar.position.set(0, 1.02, 0.15); b.add(radar);
  } else if (spec === 'asw') {
    // 反潜型：舰艉深弹投射轨 + 舰艏刺猬炮
    for (const s of [-1, 1]) {
      const rail = box(0.05, 0.04, 0.42, dk); rail.position.set(s * 0.18, 0.36, -0.66); b.add(rail);
      for (let i = 0; i < 3; i++) {
        const drum = cyl(0.05, 0.05, 0.09, mat(0x2c3138, 0.5, 0.6), 8);
        drum.position.set(s * 0.18, 0.42, -0.52 - i * 0.14); b.add(drum);
      }
    }
    const hedgehog = box(0.2, 0.07, 0.2, dk); hedgehog.position.set(0, 0.37, 0.72); b.add(hedgehog);
    for (let i = 0; i < 6; i++) {
      const tube = cyl(0.014, 0.014, 0.12, dk, 5);
      tube.rotation.x = -0.5; tube.position.set(-0.06 + (i % 3) * 0.06, 0.44, 0.68 + Math.floor(i / 3) * 0.08); b.add(tube);
    }
  } else if (spec === 'support') {
    // 支援型：舰艉直升机甲板 + 补给吊臂
    const pad = box(0.5, 0.02, 0.55, mat(0x33383f, 0.8)); pad.position.set(0, 0.345, -0.55); b.add(pad);
    const padRing = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.15, 20), new THREE.MeshBasicMaterial({ color: 0xd8d8c8, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    padRing.geometry.rotateX(-Math.PI / 2); padRing.position.set(0, 0.36, -0.55); b.add(padRing);
    const cranePost = cyl(0.02, 0.025, 0.34, dk, 6); cranePost.position.set(0.24, 0.52, -0.15); b.add(cranePost);
    const craneArm = box(0.035, 0.035, 0.4, dk); craneArm.position.set(0.24, 0.66, -0.02); craneArm.rotation.x = 0.5; b.add(craneArm);
  }
  if (isCruiser) b.scale.setScalar(1.18);   // 巡洋舰体格更大
  const winM = new THREE.MeshBasicMaterial({ color: 0xffd37a, transparent: true, opacity: 0 });
  nightMats.push(winM);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.05), winM);
  win.position.set(0, 0.56, 0.085); b.add(win);
  const banner = buildBanner(fac, 'warship', 0.5); banner.position.set(0, 0.55, 0.15); b.add(banner);
  return { body: b, muzzle, anim: { turrets } };
}

function buildSubmarine(fac) {
  const b = new THREE.Group();
  const hullM = mat(0x3b4550, 0.55, 0.6), dk = mat(METAL, 0.45, 0.75);
  // 细长艇体：胶囊横放，半潜于水面
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 1.0, 4, 8), hullM);
  hull.rotation.x = Math.PI / 2; hull.position.y = -0.02; b.add(hull);
  const tower = box(0.13, 0.16, 0.3, hullM); tower.position.y = 0.14; b.add(tower);
  const peri = cyl(0.018, 0.018, 0.16, dk, 6); peri.position.set(0, 0.28, 0.05); b.add(peri);
  const periTop = box(0.05, 0.02, 0.02, dk); periTop.position.set(0, 0.36, 0.07); b.add(periTop);
  for (const s of [-1, 1]) { const fin = box(0.16, 0.03, 0.1, dk); fin.position.set(s * 0.18, 0.0, -0.42); b.add(fin); }
  const tailFin = box(0.03, 0.18, 0.08, dk); tailFin.position.set(0, 0.05, -0.58); b.add(tailFin);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, 0.72); b.add(muzzle); // 鱼雷发射点（艇艏）
  const banner = buildBanner(fac, 'submarine', 0.4); banner.position.set(0, 0.16, -0.08); b.add(banner);
  return { body: b, muzzle, anim: { peri } };
}

const BUILDERS = { infantry: buildInfantry, cavalry: buildCavalry, artillery: buildArtillery, mgNest: buildMgNest, warship: buildWarship, submarine: buildSubmarine, carrier: buildCarrier };

function buildCarrier(fac, nightMats) {
  const b = new THREE.Group();
  const steel = mat(0x46505e, 0.6, 0.45), dk = mat(METAL, 0.45, 0.75), deckM = mat(0x333a44, 0.85);
  // 大型舰体：扁平长箱 + 舰艏斜坡
  const hull = box(1.1, 0.42, 2.6, steel); hull.position.y = 0.12; b.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.7, 4), steel);
  bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.scale.set(1.45, 1, 0.55);
  bow.position.set(0, 0.12, 1.55); b.add(bow);
  // 飞行甲板
  const deck = box(1.0, 0.06, 2.35, deckM); deck.position.y = 0.36; b.add(deck);
  const deckLine = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 1.6), new THREE.MeshBasicMaterial({ color: 0xd8d0b8, transparent: true, opacity: 0.5, depthWrite: false }));
  deckLine.rotation.x = -Math.PI / 2; deckLine.position.set(0, 0.395, 0.1); b.add(deckLine);
  // 岛式舰桥（右舷偏后）
  const island = box(0.32, 0.55, 0.55, steel); island.position.set(0.32, 0.65, -0.35); b.add(island);
  const islandTop = box(0.22, 0.12, 0.38, deckM); islandTop.position.set(0.32, 0.94, -0.35); b.add(islandTop);
  const stack = cyl(0.08, 0.10, 0.42, dk, 8); stack.position.set(0.32, 0.72, -0.55); b.add(stack);
  const radar = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.08, 10), deckM);
  radar.rotation.x = -0.4; radar.position.set(0.32, 1.02, -0.25); b.add(radar);
  // 甲板舰载机：3 架小型双翼机，起飞时由动画隐藏/移动
  const planes = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const fuselage = box(0.12, 0.06, 0.38, mat(fac.main));
    const wing = box(0.42, 0.02, 0.12, mat(fac.main));
    wing.position.y = 0.03;
    const tail = box(0.1, 0.06, 0.04, mat(fac.main)); tail.position.set(0, 0.04, -0.2);
    const prop = new THREE.Mesh(new THREE.CircleGeometry(0.055, 8), new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    prop.rotation.y = Math.PI / 2; prop.position.set(0, 0.03, 0.21);
    g.add(fuselage, wing, tail, prop);
    g.position.set(-0.28 + i * 0.28, 0.42, 0.5 - i * 0.35);
    b.add(g);
    planes.push({ group: g, prop });
  }
  // 起飞弹射点 / 远程攻击枪口
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.42, 0.9); b.add(muzzle);
  const banner = buildBanner(fac, 'warship', 0.55); banner.position.set(0.45, 0.6, -0.1); b.add(banner);
  // 夜航舰桥窗
  const winM = new THREE.MeshBasicMaterial({ color: 0xffd37a, transparent: true, opacity: 0 });
  nightMats.push(winM);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.06), winM);
  win.position.set(0.32, 0.78, -0.05); b.add(win);
  return { body: b, muzzle, anim: { planes } };
}


// ============================================================
let nextId = 0;
export function createUnit(type, faction, tile, nightMats, { spec = null, parade = false } = {}) {
  const fac = FACTION[faction];
  const stats = UNIT_STATS[type];
  const { body, muzzle, anim } = BUILDERS[type](fac, nightMats, spec);

  const group = new THREE.Group();
  // 圆形底座 + 势力描边细环（外圈，低调，让位于 HP 弧）
  const base = cyl(0.42, 0.44, 0.08, mat(BASE, 0.9), 20);
  base.position.y = 0.04;
  group.add(base);
  const rim = new THREE.Mesh(
    flatRing(0.375, 0.43, 24, 0, Math.PI * 2),
    new THREE.MeshBasicMaterial({ color: fac.rim, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  rim.position.y = 0.085;
  group.add(rim);

  // 底座弧光血条（暗轨 + 前景弧）
  const { track, arc } = buildHpArc();
  group.add(track, arc);

  // 军衔金星：底座正前方（本地 +Z）
  const stars = RANK_STARS[type] || 1;
  for (let i = 0; i < stars; i++) {
    const s = new THREE.Mesh(getStarGeo(), starMat);
    s.position.set((i - (stars - 1) / 2) * 0.1, 0.088, 0.4);
    group.add(s);
  }

  body.position.y = 0.08;
  group.add(body);

  // 透明拾取柱：点击单位用
  const pickMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.7, 8), new THREE.MeshBasicMaterial({ visible: false }));
  pickMesh.position.y = 0.8;
  group.add(pickMesh);

  group.traverse((o) => { if (o.isMesh && o !== pickMesh) { o.castShadow = true; o.receiveShadow = true; } });

  const unit = {
    id: nextId++, type, faction, stats, spec, parade, group, body, muzzle, anim, hpArc: arc, pickMesh, rim,
    tile, home: { q: tile.q, r: tile.r },
    hp: stats.hp, maxHp: stats.hp, alive: true,
    moving: false, dead: false, frozen: false,
    phase: rand(Math.PI * 2),           // 待机动作相位错开
    baseYaw: rand(-0.3, 0.3),
  };
  // 注册军旗布料：记录所属单位，供世界系风向解耦波动
  body.traverse((o) => {
    if (o.isMesh && o.userData.cloth) {
      flags.push({ mesh: o, geo: o.geometry, mat: o.material, base: o.geometry.attributes.position.array.slice(), unit });
    }
  });
  pickMesh.userData.unit = unit;
  group.rotation.y = unit.baseYaw;
  updateHpArc(unit);
  placeOnTile(unit, tile);
  return unit;
}

// ============================================================
// 空军指令：低多边形螺旋桨攻击机（编队由 demo 编排）
// ============================================================
export function buildPlane(faction) {
  const fac = FACTION[faction];
  const g = new THREE.Group();
  const body = mat(fac.main, 0.7, 0.2), dk = mat(METAL, 0.5, 0.7);
  const fus = box(0.2, 0.2, 1.1, body); g.add(fus);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 8), dk);
  nose.rotation.x = Math.PI / 2; nose.position.z = 0.66; g.add(nose);
  const wing = box(1.5, 0.04, 0.32, body); wing.position.set(0, 0.02, 0.08); g.add(wing);
  // 翼尖阵营涂装
  for (const s of [-1, 1]) { const tip = box(0.2, 0.045, 0.32, mat(fac.rim, 0.6, 0.3)); tip.position.set(s * 0.65, 0.02, 0.08); g.add(tip); }
  const tail = box(0.55, 0.03, 0.2, body); tail.position.set(0, 0.06, -0.5); g.add(tail);
  const fin = box(0.03, 0.22, 0.2, body); fin.position.set(0, 0.16, -0.5); g.add(fin);
  const canopy = box(0.12, 0.08, 0.25, mat(0x22262c, 0.3, 0.6)); canopy.position.set(0, 0.14, 0.12); g.add(canopy);
  // 螺旋桨：三叶片高速旋转 + 半透明模糊盘
  const prop = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const bl = box(0.05, 0.34, 0.02, dk);
    bl.rotation.z = (i * Math.PI * 2) / 3;
    prop.add(bl);
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.19, 16),
    new THREE.MeshBasicMaterial({ color: 0xa8a8a8, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  prop.add(disc);
  prop.position.set(0, 0, 0.8);
  g.add(prop);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, prop };
}

export function placeOnTile(unit, tile) {
  unit.tile = tile;
  const y = unit.stats.naval ? WATER_Y : tile.topY;
  unit.group.position.set(tile.x, y, tile.z);
  unit.groundY = y;
}

// —— 每帧待机/移动动画 ——
export function updateUnits(units, dt, time, nightT) {
  // 军旗布料：钉住旗杆列，主行波 3 倍频叠加向自由边传播，纵向涟漪错相，
  // 阵风弱时自由边垂坠、强时绷平；gust 同时调制振幅/波速/垂坠量；
  // 相位按单位世界坐标错开；每帧重算法线呈现波峰波谷光影。
  const gust = gustStrength(time);                       // 0.45 ~ 1.2
  const gustN = Math.max(0, Math.min(1, (gust - 0.45) / 0.75));
  const amp = 0.55 + 0.65 * gustN;                       // 振幅因子
  const speed = 0.75 + 0.6 * gustN;                      // 波速因子
  const droop = (1 - gustN) * 0.16;                      // 垂坠深度
  for (const f of flags) {
    const pos = f.geo.attributes.position, base = f.base;
    f.mesh.rotation.y = WIND.yaw - f.unit.group.rotation.y;
    const phase = (f.unit.group.position.x + f.unit.group.position.z) * 0.7;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1];
      const u = bx / FLAG_W;                             // 0=钉边 1=自由边
      // 主行波：向自由边传播的三倍频正弦叠加，振幅沿 u 线性增大
      let z = Math.sin(bx * 9 - time * 6.0 * speed + phase) * 0.045
            + Math.sin(bx * 15 - time * 9.5 * speed + phase * 1.7) * 0.022
            + Math.sin(bx * 24 - time * 14.0 * speed + phase * 2.3) * 0.010;
      z *= u * amp;
      // 纵向涟漪：上下边缘卷动，与主波错相
      z += Math.sin(by * 26 + bx * 6 - time * 7.5 * speed + phase * 1.3) * 0.014 * u * amp;
      // 垂坠：自由边下垂（u^1.6 曲线），旗面略内卷
      const dy = -droop * Math.pow(u, 1.6);
      const dx = -bx * droop * 0.35 * u;
      pos.setXYZ(i, bx + dx, by + dy, z);
    }
    pos.needsUpdate = true;
    f.geo.computeVertexNormals();                        // 波峰波谷的光影层次
    f.mat.emissiveIntensity = 0.08 + nightT * 0.3;
  }
  for (const u of units) {
    if (!u.alive || u.frozen) continue;   // frozen：近战 hit-stop 期间冻结待机动作
    const t = time + u.phase;
    if (u.type === 'warship') {
      // 舰船随浪摇荡
      u.group.position.y = WATER_Y + Math.sin(t * 1.1) * 0.035;
      u.group.rotation.z = Math.sin(t * 0.9) * 0.03;
      u.group.rotation.x = Math.sin(t * 0.7) * 0.018;
    } else if (u.type === 'carrier') {
      u.group.position.y = WATER_Y + Math.sin(t * 0.9) * 0.045;
      u.group.rotation.z = Math.sin(t * 0.75) * 0.025;
      u.group.rotation.x = Math.sin(t * 0.55) * 0.015;
      u.anim.planes.forEach((pl, i) => { pl.prop.rotation.y += 0.25 + i * 0.05; });
    } else if (u.type === 'submarine') {
      u.group.position.y = (u.moving ? WATER_Y : u.group.position.y);
      if (!u.moving) u.group.position.y = WATER_Y - 0.06 + Math.sin(t * 0.8) * 0.02; // 半潜浮沉
      u.group.rotation.z = Math.sin(t * 0.8) * 0.02;
      u.anim.peri.position.y = 0.28 + Math.sin(t * 0.6) * 0.05;                        // 潜望镜伸缩
    } else {
      // 陆地单位呼吸起伏（移动时由跳跃动画接管 y）
      if (!u.moving) u.body.position.y = 0.08 + Math.sin(t * 2.0) * 0.012;
      if (u.type === 'cavalry' && u.anim.legs) {
        // 骑兵行进时四蹄摆动，静止时归位
        const swing = u.moving ? Math.sin(t * 12) * 0.55 : 0;
        u.anim.legs.forEach((leg, i) => { leg.rotation.x = swing * (i % 2 ? 1 : -1); });
      }
      if (u.type === 'artillery' && u.moving) {
        u.anim.wheels.forEach((w) => { w.rotation.x -= dt * 6; });
      }
    }
  }
}
