// 演示与交互模块：
//  · 射线拾取：悬停高亮格子；点击单位选择；点击高亮格移动；点击敌人攻击
//  · 自动演示：按脚本循环展示炮击对射、骑兵冲锋、鱼雷突袭、步兵突击等
//  · 战斗编排：转身 → 后座/蓄力 → 弹体飞行 → 爆炸 → 伤害/阵亡 → 重生
import * as THREE from 'three';
import { tween, EASE, lerpAngle, hexDist, hexKey, HEX_DIRS, findPath, demoRng, rand, WIND } from './util.js';
import { isWaterType, WATER_Y } from './board.js';
import { updateHpArc, damageHpArcFeedback, placeOnTile, SPEC_NAMES, buildPlane } from './units.js';
import * as fx from './effects.js';

const V3 = () => new THREE.Vector3();

export function initDemo({ scene, camera, controls, board, units, hud, dom }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const state = {
    auto: true,
    busy: 0,                 // >0 表示有战斗/移动编排进行中（自动演示等待）
    selected: null,
    hoverTile: null,
    lastManual: -99,         // 上次手动操作时间（手动后暂停自动演示 8 秒）
    scriptIdx: 0,
    nextAutoAt: 2.5,         // 开场 2.5 秒后开始自动演示
    time: 0,
  };

  // —— 高亮件：悬停环 / 选择环 / 移动范围格 / 目标圈 / 路径点 ——
  const hexRingGeo = (ri, ro, seg = 6) => {
    const g = new THREE.RingGeometry(ri, ro, seg, 1, -Math.PI / 2);
    g.rotateX(-Math.PI / 2);
    return g;
  };
  const hoverRing = new THREE.Mesh(hexRingGeo(0.8, 0.92),
    new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  hoverRing.visible = false;
  scene.add(hoverRing);

  const selRing = new THREE.Mesh(hexRingGeo(0.5, 0.62),
    new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  selRing.visible = false;
  scene.add(selRing);

  const destRing = new THREE.Mesh(hexRingGeo(0.7, 0.88),
    new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  destRing.visible = false;
  scene.add(destRing);

  // 移动范围高亮格（复用池，半径 2 最多 19 格）
  const rangeGeo = new THREE.CircleGeometry(0.86, 6, -Math.PI / 2);
  rangeGeo.rotateX(-Math.PI / 2);
  const rangeMat = new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const rangePool = [];
  for (let i = 0; i < 19; i++) {
    const m = new THREE.Mesh(rangeGeo, rangeMat);
    m.visible = false;
    scene.add(m);
    rangePool.push(m);
  }
  // 可攻击敌人标记圈
  const enemyRingMat = new THREE.MeshBasicMaterial({ color: 0xff5340, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const enemyRings = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(hexRingGeo(0.55, 0.7), enemyRingMat);
    m.visible = false;
    scene.add(m);
    enemyRings.push(m);
  }
  // 移动路径虚线（发光点串）
  const PATH_N = 26;
  const pathGeo = new THREE.BufferGeometry();
  pathGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PATH_N * 3), 3));
  const pathDots = new THREE.Points(pathGeo, new THREE.PointsMaterial({ color: 0xffe9a8, size: 0.09, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  pathDots.visible = false;
  pathDots.frustumCulled = false;
  scene.add(pathDots);

  // ============ 预览线体系（悬停驱动）============
  // chevron 箭头纹理（朝"上"，贴地后指 -Z，使用时按切向旋转）
  function makeChevronTex(color) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(14, 46); ctx.lineTo(32, 20); ctx.lineTo(50, 46);
    ctx.stroke();
    return new THREE.CanvasTexture(c);
  }
  // 流动 chevron 池：沿曲线/直线循环滚动的小箭头
  function makeFlowPool(tex, n, size = 0.26) {
    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const pool = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      scene.add(m);
      pool.push(m);
    }
    return pool;
  }
  const pathFlow = makeFlowPool(makeChevronTex('#ffe9a8'), 18);   // 行进路径·金白
  const atkFlow = makeFlowPool(makeChevronTex('#ff8a6a'), 12);    // 近战攻击·红
  const wakeFlow = makeFlowPool(makeChevronTex('#9fd8e8'), 12);   // 鱼雷尾流·青

  // 预览折线（路径/抛物线/直线共用，64 点缓冲）
  const previewLineGeo = new THREE.BufferGeometry();
  previewLineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
  const previewLine = new THREE.Line(previewLineGeo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  previewLine.visible = false;
  previewLine.frustumCulled = false;
  scene.add(previewLine);
  // 近战攻击的粗红线（贴地扁带）
  const meleeLineGeo = new THREE.PlaneGeometry(1, 0.09);
  meleeLineGeo.rotateX(-Math.PI / 2);
  const meleeLine = new THREE.Mesh(meleeLineGeo, new THREE.MeshBasicMaterial({ color: 0xff5340, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  meleeLine.visible = false;
  scene.add(meleeLine);
  // 幽灵炮弹 / 落点圈 / 目标红圈 / 鱼雷水柱标记 / 曳光脉冲串
  const ghostShell = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc266, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  ghostShell.visible = false;
  scene.add(ghostShell);
  const mkFlatRing = (ri, ro, color, seg = 32, thetaStart = 0) => {
    const g = new THREE.RingGeometry(ri, ro, seg, 1, thetaStart);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.visible = false;
    scene.add(m);
    return m;
  };
  const impactRing = mkFlatRing(0.5, 0.68, 0xffa050);              // 火炮落点
  const targetRing = mkFlatRing(0.62, 0.78, 0xff5340, 6, -Math.PI / 2); // 近战目标红圈（六边形，对齐格子）
  const torpMark = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, 0.6, 10),
    new THREE.MeshBasicMaterial({ color: 0xbfeeff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  torpMark.visible = false;
  scene.add(torpMark);
  const tracerPulses = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.visible = false;
    scene.add(s);
    tracerPulses.push(s);
  }

  const preview = { key: null, kind: null, curve: null, arcPts: null, from: null, to: null };

  function clearPreview() {
    preview.key = null; preview.kind = null; preview.curve = null; preview.arcPts = null;
    previewLine.visible = false;
    meleeLine.visible = false;
    ghostShell.visible = false;
    impactRing.visible = false;
    targetRing.visible = false;
    torpMark.visible = false;
    destRing.visible = false;
    tracerPulses.forEach((s) => { s.visible = false; });
    for (const m of [...pathFlow, ...atkFlow, ...wakeFlow]) m.visible = false;
  }

  function setLinePoints(points, color, opacity = 0.45) {
    const pos = previewLine.geometry.attributes.position;
    const n = Math.min(points.length, 64);
    for (let i = 0; i < 64; i++) {
      const p = points[Math.min(i, n - 1)];
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    previewLine.geometry.setDrawRange(0, n);
    previewLine.material.color.setHex(color);
    previewLine.material.opacity = opacity;
    previewLine.visible = true;
  }

  // 行进路径预览：Catmull-Rom 平滑折线 + 金白 chevron 流向终点
  function showPathPreview(unit, path) {
    const pts = [unit.group.position.clone()];
    for (const t of path) pts.push(new THREE.Vector3(t.x, unit.stats.naval ? WATER_Y : t.topY, t.z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
    const lift = unit.stats.naval ? 0.12 : 0.22;
    const samples = curve.getPoints(40);
    for (const p of samples) p.y += lift;
    setLinePoints(samples, 0xffe9a8, 0.35);
    preview.curve = curve;
    preview.kind = 'path';
    preview.lift = lift;
    const dest = path[path.length - 1];
    destRing.position.set(dest.x, (unit.stats.naval ? WATER_Y : dest.topY) + 0.06, dest.z);
    destRing.visible = true;
  }

  // 攻击预览：按武器类型分派
  function showAttackPreview(att, tgt) {
    const kind = att.stats.range <= 1 ? 'melee'
      : att.type === 'mgNest' ? 'tracer'
      : att.type === 'submarine' ? 'torpedo' : 'cannon';
    preview.kind = 'atk-' + kind;
    const from = muzzleWorld(att);
    const to = targetPoint(tgt);
    if (kind === 'cannon') {
      // 完整抛物线预览弧 + 幽灵炮弹循环飞行 + 落点标记
      const arcH = from.distanceTo(to) * 0.25 + 0.6;
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const k = i / 40;
        const p = new THREE.Vector3().lerpVectors(from, to, k);
        p.y += Math.sin(Math.PI * k) * arcH;
        pts.push(p);
      }
      setLinePoints(pts, 0xffc266, 0.55);
      preview.arcPts = pts;
      ghostShell.visible = true;
      impactRing.position.set(tgt.group.position.x, tgt.groundY + 0.06, tgt.group.position.z);
      impactRing.visible = true;
    } else if (kind === 'tracer') {
      setLinePoints([from, to], 0xffe08a, 0.7);
      preview.from = from; preview.to = to;
      tracerPulses.forEach((s) => { s.visible = true; });
    } else if (kind === 'torpedo') {
      from.y = WATER_Y + 0.03; to.y = WATER_Y + 0.05;
      const pts = [];
      for (let i = 0; i <= 24; i++) pts.push(new THREE.Vector3().lerpVectors(from, to, i / 24));
      setLinePoints(pts, 0x9fd8e8, 0.5);
      preview.from = from; preview.to = to;
      torpMark.position.set(tgt.group.position.x, WATER_Y + 0.3, tgt.group.position.z);
      torpMark.visible = true;
    } else {
      // 近战：粗红线 + 流向目标的红色箭头 + 目标格红圈闪烁
      const a = att.group.position.clone(); a.y = att.groundY + 0.28;
      const b = tgt.group.position.clone(); b.y = tgt.groundY + 0.28;
      const len = a.distanceTo(b);
      meleeLine.scale.x = len;
      meleeLine.position.copy(a).lerp(b, 0.5);
      meleeLine.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;  // 平面长轴对齐连线
      meleeLine.visible = true;
      preview.from = a; preview.to = b;
      targetRing.position.set(tgt.group.position.x, tgt.groundY + 0.06, tgt.group.position.z);
      targetRing.visible = true;
    }
  }

  // 悬停驱动的预览状态机：结果按 key 缓存，悬停不变则不重建（稳定不闪）
  function updateHoverPreview(hoverUnit) {
    const sel = state.selected;
    if (!sel || !sel.alive || state.busy > 0) { if (preview.key) clearPreview(); return; }
    if (hoverUnit && hoverUnit !== sel && hoverUnit.faction !== sel.faction && hoverUnit.alive && canAttack(sel)) {
      const d = hexDist(sel.tile, hoverUnit.tile);
      const reach = sel.stats.range <= 1 ? 3 : sel.stats.range;
      if (d <= reach) {
        const key = 'atk:' + sel.id + '>' + hoverUnit.id;
        if (preview.key !== key) { clearPreview(); preview.key = key; showAttackPreview(sel, hoverUnit); }
        return;
      }
    }
    const t = state.hoverTile;
    if (t && sel.stats.move > 0 && !occupiedBy(t) && !(t.q === sel.tile.q && t.r === sel.tile.r)) {
      const path = computePath(sel, t);
      if (path) {
        const key = 'path:' + hexKey(t.q, t.r);
        if (preview.key !== key) { clearPreview(); preview.key = key; showPathPreview(sel, path); }
        return;
      }
    }
    if (preview.key) clearPreview();
  }

  // 直线上的 chevron 流动（近战/鱼雷预览用）
  function flowAlongLine(pool, from, to, speed, time, count) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const ry = Math.atan2(-dx, -dz);
    for (let i = 0; i < pool.length; i++) {
      const m = pool[i];
      if (i >= count) { m.visible = false; continue; }
      const t = (i / count + time * speed) % 1;
      m.visible = true;
      m.position.lerpVectors(from, to, t);
      m.rotation.y = ry;
    }
  }

  // 每帧预览动画
  function updatePreviewFx() {
    if (preview.kind === 'path' && preview.curve) {
      for (let i = 0; i < pathFlow.length; i++) {
        const m = pathFlow[i];
        const t = (i / pathFlow.length + state.time * 0.32) % 1;
        const p = preview.curve.getPointAt(t);
        const p2 = preview.curve.getPointAt(Math.min(1, t + 0.02));
        m.visible = true;
        m.position.set(p.x, p.y + preview.lift, p.z);
        m.rotation.y = Math.atan2(-(p2.x - p.x), -(p2.z - p.z));
      }
    } else if (preview.kind === 'atk-cannon' && preview.arcPts) {
      const pts = preview.arcPts;
      const t = (state.time * 0.45) % 1;
      const fi = t * (pts.length - 1);
      const i0 = Math.floor(fi);
      ghostShell.position.lerpVectors(pts[i0], pts[Math.min(pts.length - 1, i0 + 1)], fi - i0);
      impactRing.scale.setScalar(1 + 0.18 * Math.sin(state.time * 6));
    } else if (preview.kind === 'atk-tracer') {
      tracerPulses.forEach((s, i) => {
        const t = (state.time * 1.7 + i / tracerPulses.length) % 1;
        s.position.lerpVectors(preview.from, preview.to, t);
      });
    } else if (preview.kind === 'atk-torpedo') {
      flowAlongLine(wakeFlow, preview.from, preview.to, 0.28, state.time, 10);
      torpMark.scale.y = 1 + 0.3 * Math.sin(state.time * 5);
      torpMark.material.opacity = 0.3 + 0.18 * Math.sin(state.time * 5);
    } else if (preview.kind === 'atk-melee') {
      flowAlongLine(atkFlow, preview.from, preview.to, 0.6, state.time, 10);
      targetRing.material.opacity = 0.35 + 0.35 * Math.abs(Math.sin(state.time * 5));
    }
  }

  // ============ 工具 ============
  const passableFor = (unit) => (tile) => {
    const water = isWaterType(tile.type);
    if (unit.stats.naval) return water;
    if (water || tile.type === 'mountain') return false;
    return true;
  };
  // 阅兵展示单位不参与战斗判定（不占格、不可拾取、不进脚本）
  const occupiedBy = (tile) => units.find((u) => u.alive && !u.dead && !u.parade && u.tile === tile);
  const unitAt = (tile) => occupiedBy(tile);

  function faceTowards(unit, x, z, dur = 0.28, done = null) {
    const from = unit.group.rotation.y;
    const to = Math.atan2(x - unit.group.position.x, z - unit.group.position.z);
    tween({ dur, ease: EASE.inOut, onUpdate: (k) => { unit.group.rotation.y = lerpAngle(from, to, k); }, onDone: done });
  }

  // ============ 伤害 / 阵亡 / 重生 ============
  // 时间轴调度器：sec 秒后执行 fn（近战编舞的骨架）
  function after(sec, fn) { return tween({ dur: 0.001, delay: sec, onDone: fn }); }

  function rollDamage({ min = 26, max = 58, critChance = 0.22 } = {}) {
    const crit = demoRng() < critChance;
    let dmg = Math.round(min + demoRng() * (max - min));
    if (crit) dmg = Math.round(dmg * 1.6);
    return { dmg, crit };
  }

  // 扣血统一入口：血弧 / 闪白 / 伤害数字 / 死亡判定
  function applyDamage(target, dmg, { crit = false } = {}) {
    if (!target.alive) return;
    const oldFrac = target.hp / target.maxHp;
    target.hp = Math.max(0, target.hp - dmg);
    updateHpArc(target);
    fx.flashUnit(target);
    damageHpArcFeedback(target, oldFrac, target.hp / target.maxHp);   // 弧段闪白 + 掉血碎裂
    fx.spawnDamageNumber(target.group.position.clone(), crit ? `暴击 -${dmg}` : `-${dmg}`, { crit });
    if (target.hp <= 0) killUnit(target);
    refreshHud();
  }

  function dealDamage(target, range = {}) {
    const { dmg, crit } = rollDamage(range);
    applyDamage(target, dmg, { crit });
    // 远程命中的轻微顿挫
    const ux = target.group.userData;
    if (target.alive && ux.lastAttackerX !== undefined) {
      knockback(target, { x: ux.lastAttackerX, z: ux.lastAttackerZ }, {});
    }
  }

  // 受击击退：向后滑动 + 后仰倾斜，再缓缓回正。heavy = 骑兵级大幅踉跄；
  // 碉堡/战舰惯性大，幅度衰减。位置/旋转均从快照绝对插值，不会累积漂移。
  function knockback(target, fromPos, { heavy = false } = {}) {
    const g = target.group;
    const dx = g.position.x - fromPos.x, dz = g.position.z - fromPos.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len, nz = dz / len;
    const inertia = (target.type === 'mgNest' || target.type === 'warship') ? 0.35 : 1;
    const slide = (heavy ? 0.34 : 0.16) * inertia;
    const tilt = (heavy ? 0.45 : 0.2) * inertia;
    const sx = g.position.x, sz = g.position.z;
    tween({
      dur: 0.1, ease: EASE.outQuad,
      onUpdate: (k) => {
        g.position.x = sx + nx * slide * k;
        g.position.z = sz + nz * slide * k;
        g.rotation.x = nz * tilt * k;
        g.rotation.z = -nx * tilt * k;
      },
      onDone: () => {
        if (!target.alive) return;   // 已阵亡则交给倒地动画
        const px = g.position.x, pz = g.position.z, rx = g.rotation.x, rz = g.rotation.z;
        tween({
          dur: heavy ? 0.55 : 0.38, ease: EASE.inOut,
          onUpdate: (k) => {
            g.position.x = px + (sx - px) * k;
            g.position.z = pz + (sz - pz) * k;
            g.rotation.x = rx * (1 - k);
            g.rotation.z = rz * (1 - k);
          },
        });
      },
    });
  }

  // hit-stop：命中瞬间双方冻结数十毫秒（打击感关键）
  function hitStop(pair, sec = 0.08) {
    for (const u of pair) u.frozen = true;
    after(sec, () => { for (const u of pair) u.frozen = false; });
  }

  function killUnit(unit) {
    unit.alive = false;
    unit.dead = true;
    const g = unit.group;
    const pos = g.position.clone();
    if (unit.stats.naval) {
      // 舰船/潜艇：缓缓下沉 + 气泡
      fx.spawnSplash(pos.clone().setY(WATER_Y), { scale: 1.2 });
      tween({
        dur: 1.6, ease: EASE.inQuad,
        onUpdate: (k) => { g.position.y = unit.groundY - k * 1.4; g.rotation.z = k * 0.6; },
        onDone: () => { g.visible = false; },
      });
    } else {
      // 陆地单位：翻倒 + 尘雾
      fx.spawnExplosion(pos, { scale: 0.6 });
      tween({
        dur: 0.9, ease: EASE.inQuad,
        onUpdate: (k) => { g.rotation.z = k * Math.PI / 2.2; g.position.y = unit.groundY - k * 0.25; },
        onDone: () => { g.visible = false; },
      });
    }
    if (state.selected === unit) select(null);
    // 数秒后在出生点复活（演示循环）
    tween({
      dur: 0.01, delay: 3.6, onDone: () => respawnUnit(unit),
    });
  }

  function respawnUnit(unit) {
    const homeTile = board.tiles.get(hexKey(unit.home.q, unit.home.r));
    unit.hp = unit.maxHp;
    unit.alive = true; unit.dead = false;
    unit.group.visible = true;
    unit.group.rotation.set(0, unit.baseYaw, 0);
    placeOnTile(unit, homeTile);
    updateHpArc(unit);
    unit.group.scale.setScalar(0.01);
    tween({ dur: 0.6, ease: EASE.outBack, onUpdate: (k) => unit.group.scale.setScalar(Math.max(0.01, k)) });
    fx.spawnDamageNumber(unit.group.position.clone(), '增援抵达', {});
  }

  // ============ 攻击编排 ============
  function muzzleWorld(unit) {
    if (unit.muzzle) return unit.muzzle.getWorldPosition(V3());
    return unit.group.position.clone().add(new THREE.Vector3(0, 0.8, 0));
  }
  function targetPoint(unit) {
    return unit.group.position.clone().add(new THREE.Vector3(0, unit.stats.naval ? 0.35 : 0.45, 0));
  }

  
  // ============ 航母舰载机扫射：甲板起飞 → 低空突防 → 扫射链 → 离场 ============
  function carrierStrike(att, tgt, done) {
    const fromDeck = att.muzzle ? att.muzzle.getWorldPosition(new THREE.Vector3()) : att.group.position.clone().add(new THREE.Vector3(0, 0.5, 0));
    const to = targetPoint(tgt);
    const flyY = 2.4;
    const dir = new THREE.Vector3().subVectors(to, fromDeck).normalize();
    dir.y = 0; dir.normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);

    const flight = new THREE.Group();
    scene.add(flight);
    const planes = [];
    for (let i = 0; i < 2; i++) {
      const { group, prop } = buildPlane(att.faction);
      group.position.copy(fromDeck).add(new THREE.Vector3((i - 0.5) * 0.35, 0, -0.2 - i * 0.25));
      group.lookAt(group.position.clone().add(dir));
      flight.add(group);
      planes.push({ group, prop, launched: false });
    }

    const DUR = 3.2;
    // 起飞 → 平飞 → 扫射 → 爬升离场
    const p0 = fromDeck.clone();
    const pStrafe = to.clone().addScaledVector(dir, -1.2).setY(flyY);
    const pExit = to.clone().addScaledVector(dir, 2.5).setY(flyY + 1.8);
    const curve = new THREE.CatmullRomCurve3([p0, p0.clone().add(new THREE.Vector3(0, 0.8, 0)), pStrafe, pExit]);

    tween({
      dur: DUR, ease: EASE.inOut,
      onUpdate: (k) => {
        const tNow = k * DUR;
        for (let i = 0; i < planes.length; i++) {
          const pl = planes[i];
          const offset = (i - 0.5) * 0.55;
          const kk = Math.max(0, Math.min(1, k * 1.1 - i * 0.08));
          const pos = curve.getPointAt(kk).addScaledVector(perp, offset);
          if (kk < 0.15) pos.y = p0.y + kk / 0.15 * 0.8; // 起飞段
          pl.group.position.copy(pos);
          const tan = curve.getTangentAt(kk);
          pl.group.lookAt(pos.clone().add(tan));
          pl.prop.rotation.y += 0.6;
        }
        // 扫射段：过目标前 0.3s 开始沿攻线炸点
        if (k > 0.45 && k < 0.72) {
          const strafeK = (k - 0.45) / 0.27;
          if (Math.floor(strafeK * 8) > (carrierStrike._last || -1)) {
            carrierStrike._last = Math.floor(strafeK * 8);
            const ip = to.clone().addScaledVector(dir, (strafeK - 0.5) * 1.6).addScaledVector(perp, rand(-0.25, 0.25));
            ip.y = tgt.groundY + 0.1;
            fx.spawnTracer(ip.clone().add(new THREE.Vector3(0, flyY - 0.5, 0)), ip);
            fx.spawnExplosion(ip, { scale: 0.5 });
            fx.spawnDustPuff(ip, { scale: 0.9, n: 3 });
          }
        }
      },
      onDone: () => {
        carrierStrike._last = -1;
        scene.remove(flight);
        flight.traverse((o) => { if (o.isMesh || o.isPoints) { o.geometry?.dispose(); o.material?.dispose(); } });
        dealDamage(tgt, { min: 38, max: 68 });
        done();
      },
    });
  }
  carrierStrike._last = -1;

  // 远程：炮兵/战舰 = 抛物线炮弹；潜艇 = 鱼雷；碉堡 = 曳光扫射
  function rangedAttack(att, tgt, { big = false } = {}) {
    if (!att.alive || !tgt.alive) return false;
    state.busy++;
    tgt.group.userData.lastAttackerX = att.group.position.x;
    tgt.group.userData.lastAttackerZ = att.group.position.z;
    faceTowards(att, tgt.group.position.x, tgt.group.position.z, 0.3, () => {
      const from = muzzleWorld(att);
      const to = targetPoint(tgt);
      const done = () => { state.busy--; };
      if (att.type === 'submarine') {
        from.y = WATER_Y + 0.02;
        to.y = WATER_Y + 0.05;
        // 鱼雷：陆上目标则打到岸边溅射
        const hitAt = tgt.stats.naval ? to : to.clone().setY(WATER_Y + 0.05);
        fx.spawnTorpedo(from, hitAt, {
          onHit: (p) => {
            fx.spawnSplash(p, { scale: 1.2 });
            if (!tgt.stats.naval) fx.spawnExplosion(tgt.group.position.clone().add(new THREE.Vector3(0, 0.3, 0)), { scale: 0.8 });
            dealDamage(tgt, { min: 34, max: 62 });
            done();
          },
        });
      } else if (att.type === 'mgNest') {
        // 三连发曳光
        let shots = 0;
        const fireOne = () => {
          const mz = muzzleWorld(att);
          fx.spawnMuzzleFlash(mz, { scale: 0.5 });
          fx.spawnTracer(mz, to);
          if (++shots < 3) tween({ dur: 0.01, delay: 0.16, onDone: fireOne });
          else { dealDamage(tgt, { min: 20, max: 40 }); done(); }
        };
        fireOne();
      } else if (att.type === 'carrier') {
        carrierStrike(att, tgt, done);
      } else if (att.spec === 'rocket') {
        // 火箭炮齐射：4 发小抛物线连射，集火爆炸链，伤害分摊到每发
        const roll = rollDamage({ min: 30, max: 58 });
        const per = Math.max(1, Math.round(roll.dmg / 4));
        for (let i = 0; i < 4; i++) {
          after(i * 0.14, () => {
            fx.spawnMuzzleFlash(from, { scale: 0.6 });
            const jitter = new THREE.Vector3(rand(-0.35, 0.35), 0, rand(-0.35, 0.35));
            fx.spawnShell(from, to.clone().add(jitter), {
              arc: from.distanceTo(to) * 0.32 + 0.7,
              speed: 11,
              onHit: (hp) => {
                fx.spawnExplosion(hp.clone().setY(tgt.groundY + 0.25), { scale: 0.55 });
                applyDamage(tgt, per, { crit: i === 3 && roll.crit });
                if (i === 3) done();
              },
            });
          });
        }
      } else {
        // 炮兵 / 战舰主炮：后座 + 炮口焰 + 抛物线
        if (att.anim && att.anim.barrel) {
          const b = att.anim.barrel, home = att.anim.barrelHome;
          tween({ dur: 0.35, ease: EASE.outQuad, onUpdate: (k) => { const s = Math.sin(Math.PI * Math.min(1, k * 1.4)) * 0.12; b.position.z = home.z - s; } });
        }
        fx.spawnMuzzleFlash(from, { scale: att.type === 'warship' ? 1.5 : 1 });
        fx.spawnShell(from, to, {
          big: big || att.type === 'warship',
          arc: att.type === 'warship' ? from.distanceTo(to) * 0.3 + 0.9 : null,
          onHit: (p) => {
            const naval = tgt.stats.naval;
            if (naval) { fx.spawnSplash(p.clone().setY(WATER_Y + 0.05), { scale: 0.9 }); fx.spawnExplosion(p, { scale: 0.9 }); }
            else fx.spawnExplosion(tgt.group.position.clone().add(new THREE.Vector3(0, 0.35, 0)), { scale: att.type === 'warship' ? 1.25 : 1 });
            dealDamage(tgt, att.type === 'warship' ? { min: 40, max: 70 } : { min: 30, max: 58 });
            done();
          },
        });
      }
    });
    return true;
  }

  // ============ 近战编舞：接近 → 蓄势 → 挥击 → 收势 ============
  // 距离 >1 时先寻路机动到目标邻格，再进入兵种专属演出
  function meleeAttack(att, tgt, { charge = true } = {}) {
    if (!att.alive || !tgt.alive) return false;
    state.busy++;
    clearPreview();
    const startChoreo = () => {
      if (att.type === 'cavalry') cavalryCharge(att, tgt, () => { state.busy--; });
      else infantryAssault(att, tgt, () => { state.busy--; });
    };
    const d = hexDist(att.tile, tgt.tile);
    if (charge && d > 1) {
      // 找目标旁可站的格子
      const pass = passableFor(att);
      let bestPath = null;
      for (const [dq, dr] of HEX_DIRS) {
        const t = board.tiles.get(hexKey(tgt.tile.q + dq, tgt.tile.r + dr));
        if (!t || !pass(t) || occupiedBy(t)) continue;
        const path = findPath(att.tile, t, board.tiles, (x) => pass(x) && (!occupiedBy(x) || x === att.tile));
        if (path && (!bestPath || path.length < bestPath.length)) bestPath = path;
      }
      if (!bestPath) { state.busy--; return false; }   // 无路径（被围死）
      moveAlong(att, bestPath, startChoreo);
    } else startChoreo();
    return true;
  }

  // —— 步兵突击：冲刺接近 → 收枪蓄势 → 突刺(快) → 挥砍(重) → 退回本格，约 1.6s ——
  function infantryAssault(att, tgt, done) {
    const g = att.group, tg = tgt.group;
    const home = g.position.clone();
    const dir = tg.position.clone().sub(home); dir.y = 0;
    dir.normalize();
    const edge = tg.position.clone().addScaledVector(dir, -0.62);   // 目标格边缘停步点
    edge.y = att.groundY;
    const yaw = Math.atan2(dir.x, dir.z);
    const arcColor = att.faction === 'red' ? 0xffe2c4 : 0xe6eeff;   // 阵营偏暖白弧光
    const rifle = att.anim.rifle;
    const rp = rifle.position.clone(), rr = rifle.rotation.clone();
    const roll = rollDamage({ min: 30, max: 55 });
    const dmg1 = Math.round(roll.dmg * 0.35), dmg2 = roll.dmg - dmg1;   // 快-重两段伤害

    // 阶段1 接近（0–0.4s）：转向 + 加速冲刺，跑步起伏 + 脚步扬尘
    faceTowards(att, tg.position.x, tg.position.z, 0.22);
    tween({
      dur: 0.4, ease: EASE.inQuad,
      onUpdate: (k) => {
        g.position.lerpVectors(home, edge, k);
        g.position.y = att.groundY + Math.abs(Math.sin(k * 14)) * 0.05;
      },
    });
    after(0.15, () => fx.spawnDustPuff(home.clone(), { scale: 0.5, n: 2 }));
    after(0.32, () => fx.spawnDustPuff(g.position.clone(), { scale: 0.5, n: 2 }));

    // 阶段2 蓄势（0.42–0.62s）：步枪后拉上抬，停顿一瞬
    after(0.42, () => tween({
      dur: 0.16, ease: EASE.outQuad,
      onUpdate: (k) => {
        rifle.position.z = rp.z - 0.1 * k;
        rifle.position.y = rp.y + 0.08 * k;
        rifle.rotation.x = rr.x - 0.5 * k;
      },
    }));

    // 阶段3a 突刺·快（0.62–0.71s）
    after(0.62, () => tween({
      dur: 0.09, ease: EASE.inQuad,
      onUpdate: (k) => {
        rifle.position.z = rp.z - 0.1 + 0.4 * k;
        rifle.position.y = rp.y + 0.08 * (1 - k);
        rifle.rotation.x = rr.x - 0.5 + 0.45 * k;
        g.position.copy(edge).addScaledVector(dir, 0.12 * k);
      },
    }));
    after(0.71, () => {   // 第一击命中帧
      const hitAt = tg.position.clone().add(new THREE.Vector3(0, 0.45, 0));
      fx.spawnMeleeArc(tg.position.clone(), yaw, { scale: 0.7, sweep: 1.4, color: arcColor });
      fx.spawnSparkBurst(hitAt, yaw, { n: 7, speed: 2.6 });
      fx.shake(0.05);
      hitStop([att, tgt], 0.07);
      after(0.07, () => knockback(tgt, g.position, {}));   // 冻结结束后再击退
      applyDamage(tgt, dmg1, {});
    });

    // 阶段3b 挥砍·重（0.8–1.02s）：枪身横扫
    after(0.8, () => tween({
      dur: 0.12, ease: EASE.outQuad,
      onUpdate: (k) => { rifle.rotation.y = -0.75 * k; rifle.position.x = rp.x - 0.16 * k; },
    }));
    after(0.92, () => tween({
      dur: 0.1, ease: EASE.inQuad,
      onUpdate: (k) => {
        rifle.rotation.y = -0.75 + 1.5 * k;
        rifle.position.x = rp.x - 0.16 + 0.3 * k;
        g.position.copy(edge).addScaledVector(dir, 0.12 + 0.06 * k);
      },
    }));
    after(1.02, () => {   // 重击命中帧
      if (tgt.alive) {
        const hitAt = tg.position.clone().add(new THREE.Vector3(0, 0.5, 0));
        fx.spawnMeleeArc(tg.position.clone(), yaw, { scale: 1.15, sweep: 2.2, color: arcColor });
        fx.spawnSparkBurst(hitAt, yaw, { n: 12, speed: 3.4 });
        fx.spawnDustPuff(new THREE.Vector3(tg.position.x, tgt.groundY + 0.02, tg.position.z), { scale: 1, n: 5 });
        fx.shake(0.11);
        hitStop([att, tgt], 0.09);
        after(0.09, () => knockback(tgt, g.position, { heavy: true }));
        applyDamage(tgt, dmg2, { crit: roll.crit });
      }
    });

    // 阶段4 收势（1.15s 起）：收枪 + 退回本格
    after(1.15, () => {
      const p0 = rifle.position.clone(), r0 = rifle.rotation.clone();
      tween({
        dur: 0.2, ease: EASE.inOut,
        onUpdate: (k) => {
          rifle.position.lerpVectors(p0, rp, k);
          rifle.rotation.set(rr.x + (r0.x - rr.x) * (1 - k), rr.y + (r0.y - rr.y) * (1 - k), rr.z + (r0.z - rr.z) * (1 - k));
        },
      });
    });
    after(1.22, () => tween({
      dur: 0.35, ease: EASE.inOut,
      onUpdate: (k) => {
        g.position.lerpVectors(edge, home, k);
        g.position.y = att.groundY + Math.abs(Math.sin(k * 10)) * 0.04;
      },
      onDone: () => { g.position.copy(home); g.position.y = att.groundY; done(); },
    }));
  }

  // —— 骑兵冲锋：勒马平持长枪(蓄势) → 加速冲过目标(命中帧大尘环+撞飞) → 兜半圈回本格，约 1.7s ——
  function cavalryCharge(att, tgt, done) {
    const g = att.group, tg = tgt.group;
    const home = g.position.clone();
    const dir = tg.position.clone().sub(home); dir.y = 0;
    const dist = dir.length(); dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const beyond = tg.position.clone().addScaledVector(dir, 1.15).addScaledVector(side, 0.25);
    beyond.y = att.groundY;
    const yaw = Math.atan2(dir.x, dir.z);
    const arcColor = att.faction === 'red' ? 0xffe2c4 : 0xe6eeff;
    const lance = att.anim.lance, torso = att.anim.torso;
    const lp = lance.position.clone(), lr = lance.rotation.clone();
    const trx = torso.rotation.x;
    const roll = rollDamage({ min: 36, max: 62, critChance: 0.25 });
    const CHARGE_AT = 0.5, CHARGE_DUR = 0.45;
    const crossFrac = dist / (dist + 1.15);
    const hitTime = CHARGE_AT + CHARGE_DUR * Math.sqrt(crossFrac);   // inQuad 下经过目标的时刻

    att.moving = true;   // 马蹄摆动逻辑激活
    faceTowards(att, tg.position.x, tg.position.z, 0.2);
    // 阶段2 蓄势（0.18–0.5s）：长枪放平 + 骑手前倾（冲锋前的凝滞感）
    after(0.18, () => tween({
      dur: 0.3, ease: EASE.inOut,
      onUpdate: (k) => {
        lance.rotation.x = lr.x + (-1.5 - lr.x) * k;   // 放平平持
        lance.position.z = lp.z + 0.12 * k;
        torso.rotation.x = trx + 0.3 * k;
      },
    }));
    // 阶段1+3 冲锋（0.5–0.95s）：加速冲过目标，奔驰扬尘
    after(CHARGE_AT, () => tween({
      dur: CHARGE_DUR, ease: EASE.inQuad,
      onUpdate: (k) => {
        g.position.lerpVectors(home, beyond, k);
        g.position.y = att.groundY + Math.abs(Math.sin(k * 16)) * 0.09;
      },
    }));
    after(0.62, () => fx.spawnDustPuff(g.position.clone(), { scale: 0.7, n: 2, strength: 1.4 }));
    after(0.74, () => fx.spawnDustPuff(g.position.clone(), { scale: 0.7, n: 2, strength: 1.4 }));
    // 命中帧：火花 + 大尘环 + 撞飞 + 震屏
    after(hitTime, () => {
      const hitPos = tg.position.clone().add(new THREE.Vector3(0, 0.5, 0));
      fx.spawnMeleeArc(tg.position.clone(), yaw, { scale: 1.2, sweep: 2.0, color: arcColor });
      fx.spawnSparkBurst(hitPos, yaw, { n: 12, speed: 3.6 });
      fx.spawnDustRing(new THREE.Vector3(tg.position.x, tgt.groundY, tg.position.z), { scale: 1.1 });
      fx.shake(0.14);
      hitStop([att, tgt], 0.09);
      after(0.09, () => knockback(tgt, g.position, { heavy: true }));
      applyDamage(tgt, roll.dmg, { crit: roll.crit });
    });
    // 阶段4 收势（0.95s 起）：冲过后侧向兜半圈回本格（二次贝塞尔），长枪回举
    after(CHARGE_AT + CHARGE_DUR, () => {
      const p0 = g.position.clone();
      const mid = beyond.clone().addScaledVector(side, 0.9);
      tween({
        dur: 0.5, ease: EASE.inOut,
        onUpdate: (k) => {
          const a = p0.clone().lerp(mid, k), b = mid.clone().lerp(home, k);
          g.position.copy(a.lerp(b, k));
          g.position.y = att.groundY + Math.abs(Math.sin(k * 10)) * 0.06;
          const toHome = Math.atan2(home.x - g.position.x, home.z - g.position.z);
          g.rotation.y = lerpAngle(yaw, toHome, Math.min(1, k * 1.6));
        },
        onDone: () => {
          g.position.copy(home);
          g.position.y = att.groundY;
          att.moving = false;
          const ry0 = g.rotation.y;
          tween({
            dur: 0.28, ease: EASE.inOut,
            onUpdate: (k) => {
              lance.rotation.x = lr.x + (-1.5 - lr.x) * (1 - k);
              lance.position.z = lp.z + 0.12 * (1 - k);
              torso.rotation.x = trx + 0.3 * (1 - k);
              g.rotation.y = lerpAngle(ry0, att.baseYaw, k);
            },
            onDone: done,
          });
        },
      });
    });
  }

  // ============ 空袭指令：点击释放，编队进场 → 弹着链 → 离场 ============
  state.aiming = false;          // 瞄准态
  state.airFaction = 'red';      // 演示中双方轮换出场
  // 瞄准标记：同心双环 + 旋转扫描扇 + 中心点
  const airMarker = new THREE.Group();
  {
    const mkM = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const r1 = new THREE.Mesh(flatRingGeo(0.5, 0.56), mkM(0xffc266, 0.8));
    const r2 = new THREE.Mesh(flatRingGeo(0.74, 0.78), mkM(0xffc266, 0.5));
    const scan = new THREE.Mesh(flatRingGeo(0.58, 0.72, 0.75), mkM(0xffe9a8, 0.85));
    const dotGeo = new THREE.CircleGeometry(0.07, 12); dotGeo.rotateX(-Math.PI / 2);
    const dot = new THREE.Mesh(dotGeo, mkM(0xffc266, 0.9));
    airMarker.add(r1, r2, scan, dot);
    airMarker.userData.scan = scan;
    airMarker.visible = false;
    scene.add(airMarker);
  }
  function flatRingGeo(ri, ro, thetaLen = Math.PI * 2) {
    const g = new THREE.RingGeometry(ri, ro, 32, 1, 0, thetaLen);
    g.rotateX(-Math.PI / 2);
    return g;
  }
  function setAiming(v) {
    state.aiming = v;
    airMarker.visible = false;
    if (hud.btnAir) {
      hud.btnAir.textContent = v ? '✈ 空袭：选择目标' : '✈ 空袭指令';
      hud.btnAir.classList.toggle('off', !v);
    }
  }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setAiming(false); });

  // 防空语义（对标 rules/antiAir.js）：
  //   防空炮(artillery·aa 专精)：半径 2，只提供区域防空，不能普通攻击；
  //   防空驱逐舰(warship·aa 专精)：半径 2，可普攻（演示中仅阅兵区展示）；
  //   flak 高射机枪工事：保护所在格（30% 语义），碉堡格有哨塔模型；
  //   多来源覆盖叠加（规则上限 85%，原型只做视觉编舞，不改伤害结算）。
  const AA_RADIUS = 2;
  const canAttack = (u) => !(u.type === 'artillery' && u.spec === 'aa');   // 防空炮不能普攻
  function findAaCover(targetTile) {
    const cover = [];
    for (const u of units) {
      if (u.parade || !u.alive) continue;
      const isAa = (u.type === 'artillery' && u.spec === 'aa') || (u.type === 'warship' && u.spec === 'aa');
      if (isAa && hexDist(u.tile, targetTile) <= AA_RADIUS) cover.push({ kind: 'aa', unit: u });
    }
    if (targetTile.flak) cover.push({ kind: 'flak', tile: targetTile });
    return cover;
  }

  function airstrike(faction, tile) {
    state.busy++;
    const groundY = isWaterType(tile.type) ? WATER_Y : tile.topY;
    const target = new THREE.Vector3(tile.x, groundY, tile.z);
    // —— 防空覆盖判定 ——
    const cover = findAaCover(tile);
    if (cover.length) {
      fx.spawnDamageNumber(target.clone().add(new THREE.Vector3(0, 1.2, 0)), '防空拦截！', { crit: true });
      fx.shake(0.06);
    }
    // 单机顺全局风向（西北→东南）高空进入，掠过目标后爬升离场
    const dir = new THREE.Vector3(WIND.x, 0, WIND.z);
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const p = (d, y) => target.clone().addScaledVector(dir, d).setY(y);
    const curve = new THREE.CatmullRomCurve3([p(-17, 8.5), p(-6, 3.4), p(0.2, 1.9), p(5, 4.4), p(17, 9.5)]);
    const flight = new THREE.Group();
    scene.add(flight);
    const { group, prop } = buildPlane(faction);
    flight.add(group);
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18 * 3), 3));
    const trail = new THREE.Points(tGeo, new THREE.PointsMaterial({ color: 0xdfe8ea, size: 0.06, transparent: true, opacity: 0.4, depthWrite: false }));
    trail.frustumCulled = false;
    flight.add(trail);
    const pl = { group, prop, trail, hist: [], off: 0, lag: 0, damaged: cover.length > 0, flame: null, smoking: false, smokeTimer: 0 };

    // 防空单位炮管跟踪准备：记录各炮管初始姿态
    for (const c of cover) {
      if (c.kind === 'aa' && c.unit.anim && c.unit.anim.barrel) {
        c.barrel = c.unit.anim.barrel;
        c.barrelHome = { x: c.barrel.rotation.x, y: c.barrel.rotation.y };
      }
    }
    // 弹着链：飞机过顶时刻起，沿攻线逐段炸开（有防空时散布更大）
    const victim = occupiedBy(tile);
    const spread = cover.length ? 0.75 : 0.35;
    for (let i = 0; i < 6; i++) {
      after(1.72 + i * 0.12, () => {
        const ip = target.clone().addScaledVector(dir, (i - 2.5) * 0.55).addScaledVector(perp, rand(-spread, spread));
        ip.y = groundY + 0.1;
        fx.spawnTracer(ip.clone().addScaledVector(dir, -1.4).add(new THREE.Vector3(0, 1.7, 0)), ip);
        fx.spawnExplosion(ip, { scale: 0.55 });
        fx.spawnDustPuff(ip, { scale: 1.2, n: 3 });
      });
    }
    after(2.0, () => {
      if (victim && victim.alive) {
        victim.group.userData.lastAttackerX = target.x - dir.x * 5;
        victim.group.userData.lastAttackerZ = target.z - dir.z * 5;
        dealDamage(victim, { min: 42, max: 78 });
      }
    });
    // 飞行推进 + 防空编舞
    const DUR = 3.6;
    let nextShotAt = 0.32;
    let nextShellAt = 0.45;
    tween({
      dur: DUR, ease: EASE.linear,
      onUpdate: (k) => {
        const tNow = k * DUR;
        const tt = Math.max(0, Math.min(1, k));
        const pos = curve.getPointAt(tt);
        // 防空扰动：单机规避抖动
        if (cover.length) {
          pos.x += Math.sin(tNow * 19) * 0.09;
          pos.y += Math.cos(tNow * 15) * 0.07;
          pos.z += Math.sin(tNow * 17) * 0.09;
        }
        pl.group.position.copy(pos);
        const tan = curve.getTangentAt(tt);
        pl.group.lookAt(pos.clone().add(tan));
        let roll = Math.sin(tt * Math.PI * 2) * 0.18;
        if (cover.length) roll += Math.sin(tNow * 12) * 0.16;
        if (pl.damaged && tt > 0.55) roll += Math.sin(tNow * 21) * 0.18;
        pl.group.rotateZ(roll);
        pl.prop.rotation.z = k * 260;
        pl.hist.unshift(pos.clone());
        if (pl.hist.length > 18) pl.hist.pop();
        const tp = pl.trail.geometry.attributes.position;
        for (let i = 0; i < 18; i++) {
          const h = pl.hist[Math.min(i, pl.hist.length - 1)] || pos;
          tp.setXYZ(i, h.x, h.y, h.z);
        }
        tp.needsUpdate = true;

        // 引擎起火：过顶后开始挂火舌 + 点光源 + sprite 浓烟
        if (pl.damaged && !pl.smoking && tt > 0.55) {
          pl.smoking = true;
          pl.trail.material.color.setHex(0x6a6660);
          pl.trail.material.size = 0.12;
          pl.trail.material.opacity = 0.45;
          const flame = new THREE.Mesh(
            new THREE.ConeGeometry(0.10, 0.48, 8),
            new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
          );
          flame.rotation.x = -Math.PI / 2;
          flame.position.set(0, 0.03, 0.44);
          pl.group.add(flame);
          pl.flame = flame;
          const plight = new THREE.PointLight(0xff4a08, 1.8, 3.2);
          plight.position.set(0, 0.05, 0.38);
          flame.add(plight);
          pl.plight = plight;
        }
        if (pl.flame) {
          const fl = 0.85 + Math.sin(tNow * 31) * 0.45;
          pl.flame.scale.set(fl, fl, fl);
          if (pl.plight) pl.plight.intensity = 1.3 + Math.sin(tNow * 37) * 0.7;
        }
        // 持续排放柔软浓烟（越往后越浓）
        if (pl.smoking) {
          pl.smokeTimer += 0.016;
          if (pl.smokeTimer > 0.035) {
            pl.smokeTimer = 0;
            const engineWorld = pl.group.localToWorld(new THREE.Vector3(0, 0.04, 0.44));
            fx.spawnSmokePuff(engineWorld, { scale: rand(1.0, 1.5), life: rand(1.2, 1.8), drift: 1.4, color: 0x1a1816 });
          }
        }

        // —— 防空火力：炮管跟踪 + 机枪曳光弹流 / 高射炮弹 ——
        if (cover.length && tNow > nextShotAt && tNow < DUR - 0.7) {
          nextShotAt += 0.05 + rand(0, 0.03);
          const lead = pl.group.position.clone();
          for (const c of cover) {
            let from;
            if (c.kind === 'aa' && c.unit.alive) {
              from = muzzleWorld(c.unit);
              if (c.barrel) {
                const u = c.unit;
                const dx = lead.x - u.group.position.x, dz = lead.z - u.group.position.z;
                const yawTo = Math.atan2(dx, dz) - u.group.rotation.y;
                c.barrel.rotation.y = lerpAngle(c.barrel.rotation.y, yawTo, 0.13);
                const dist = Math.hypot(dx, dz);
                const pitch = Math.atan2(lead.y - (u.groundY + 0.6), Math.max(0.5, dist));
                c.barrel.rotation.x = -Math.max(0.35, Math.min(1.45, Math.PI / 2 - pitch));
              }
            } else if (c.kind === 'flak') {
              from = new THREE.Vector3(c.tile.x + 0.52, c.tile.topY + 0.62, c.tile.z + 0.3);
            } else continue;

            const isShell = c.kind === 'aa' && c.unit.type === 'artillery' && c.unit.spec === 'aa';
            const aim = lead.clone().addScaledVector(dir, rand(0.2, 0.8))
              .add(new THREE.Vector3(rand(-0.55, 0.55), rand(-0.35, 0.45), rand(-0.55, 0.55)));
            if (isShell) {
              // 高射炮弹：单发、带抛物线烟迹，定时控制射速
              if (tNow > nextShellAt) {
                nextShellAt = tNow + 0.35 + rand(0, 0.15);
                fx.spawnAAShell(from, aim);
                fx.spawnMuzzleFlash(from, { scale: 0.55 });
              }
            } else {
              // 机枪子弹流：每 tick 4–5 发短小曳光弹
              for (let b = 0; b < (4 + Math.floor(rand(0, 2))); b++) {
                const mAim = aim.clone().add(new THREE.Vector3(rand(-0.35, 0.35), rand(-0.25, 0.25), rand(-0.35, 0.35)));
                fx.spawnMGTracer(from, mAim);
              }
              fx.spawnMuzzleFlash(from, { scale: 0.35 });
            }
            // 机群附近黑烟炸点
            const bp = lead.clone().add(new THREE.Vector3(rand(-1.2, 1.2), rand(-0.2, 0.8), rand(-1.2, 1.2)));
            fx.spawnFlakPuff(bp, { scale: rand(0.9, 1.3) });
          }
        }
      },
      onDone: () => {
        for (const c of cover) {
          if (c.barrel && c.barrelHome) {
            const b = c.barrel, h = c.barrelHome;
            tween({ dur: 0.5, ease: EASE.inOut, onUpdate: (kk) => {
              b.rotation.x = b.rotation.x + (h.x - b.rotation.x) * kk;
              b.rotation.y = b.rotation.y + (h.y - b.rotation.y) * kk;
            } });
          }
        }
        scene.remove(flight);
        flight.traverse((o) => { if (o.isMesh || o.isPoints || o.isLight) { o.geometry?.dispose(); o.material?.dispose(); } });
        state.busy--;
      },
    });
    return true;
  }
  // ============ 移动编排（路径点 + 目的圈 + 逐格跳跃）============
  function moveAlong(unit, path, done = null) {
    if (!path.length) { done && done(); return; }
    state.busy++;
    unit.moving = true;
    if (state.selected === unit) showRange(unit);   // 选中态下刷新范围显示
    // 绘制路径虚线：逐格中心插值
    const pts = [];
    const from = unit.group.position.clone();
    for (const t of path) pts.push(new THREE.Vector3(t.x, 0, t.z));
    const curvePts = [];
    let prev = from;
    for (const p of pts) {
      for (let i = 1; i <= 4; i++) curvePts.push(prev.clone().lerp(p, i / 4));
      prev = p;
    }
    const pos = pathDots.geometry.attributes.position;
    for (let i = 0; i < PATH_N; i++) {
      const p = curvePts[Math.min(i, curvePts.length - 1)];
      pos.setXYZ(i, p.x, (unit.stats.naval ? WATER_Y : 0) + 0.25, p.z);
    }
    pos.needsUpdate = true;
    pathDots.visible = true;
    const dest = path[path.length - 1];
    destRing.position.set(dest.x, (unit.stats.naval ? WATER_Y : dest.topY) + 0.06, dest.z);
    destRing.visible = true;

    let idx = 0;
    const stepNext = () => {
      if (idx >= path.length) {
        unit.moving = false;
        pathDots.visible = false;
        destRing.visible = false;
        state.busy--;
        done && done();
        return;
      }
      const t = path[idx++];
      const sx = unit.group.position.x, sz = unit.group.position.z;
      const sy = unit.group.position.y;
      const ty = unit.stats.naval ? WATER_Y : t.topY;
      const yaw0 = unit.group.rotation.y, yaw1 = Math.atan2(t.x - sx, t.z - sz);
      tween({
        dur: 0.34, ease: EASE.inOut,
        onUpdate: (k) => {
          unit.group.position.x = sx + (t.x - sx) * k;
          unit.group.position.z = sz + (t.z - sz) * k;
          // 逐格小跳跃；海军不跳，改为轻微纵摇
          if (unit.stats.naval) unit.group.position.y = sy + (ty - sy) * k;
          else unit.group.position.y = sy + (ty - sy) * k + Math.sin(Math.PI * k) * (unit.type === 'cavalry' ? 0.22 : 0.13);
          unit.group.rotation.y = lerpAngle(yaw0, yaw1, k);
        },
        onDone: () => { unit.tile = t; unit.groundY = ty; stepNext(); },
      });
    };
    stepNext();
  }

  // BFS 可达路径（移动力约束），供移动与路径预览共用
  function computePath(unit, dest) {
    const pass = passableFor(unit);
    const path = findPath(unit.tile, dest, board.tiles, (x) => pass(x) && (!occupiedBy(x) || x === unit.tile));
    if (!path || path.length === 0 || path.length > unit.stats.move) return null;
    return path;
  }

  function moveTo(unit, dest, done = null) {
    const path = computePath(unit, dest);
    if (!path) return false;
    moveAlong(unit, path, done);
    return true;
  }

  // ============ 选择 / 高亮 ============
  function showRange(unit) {
    let i = 0;
    if (unit && unit.alive) {
      const pass = passableFor(unit);
      for (const t of board.tiles.values()) {
        if (i >= rangePool.length) break;
        const d = hexDist(unit.tile, t);
        if (d === 0 || d > unit.stats.move || !pass(t) || occupiedBy(t)) continue;
        // 可达性粗判：BFS 路径存在
        const path = findPath(unit.tile, t, board.tiles, (x) => pass(x) && (!occupiedBy(x) || x === unit.tile));
        if (!path || path.length > unit.stats.move) continue;
        const m = rangePool[i++];
        m.position.set(t.x, (unit.stats.naval ? WATER_Y : t.topY) + 0.05, t.z);
        m.visible = true;
      }
    }
    for (; i < rangePool.length; i++) rangePool[i].visible = false;
    // 可攻击的敌人圈（防空炮不能普攻，不显示）
    let j = 0;
    if (unit && unit.alive && canAttack(unit)) {
      for (const u of units) {
        if (j >= enemyRings.length) break;
        if (!u.alive || u.faction === unit.faction) continue;
        const d = hexDist(unit.tile, u.tile);
        const meleeReach = unit.stats.range <= 1 ? 3 : unit.stats.range; // 近战允许冲锋(≤3)
        if (d <= meleeReach) {
          const m = enemyRings[j++];
          m.position.set(u.group.position.x, (u.stats.naval ? WATER_Y : u.groundY) + 0.06, u.group.position.z);
          m.visible = true;
        }
      }
    }
    for (; j < enemyRings.length; j++) enemyRings[j].visible = false;
  }

  function select(unit) {
    state.selected = unit;
    clearPreview();
    selRing.visible = !!unit;
    if (unit) {
      selRing.position.set(unit.group.position.x, unit.groundY + 0.06, unit.group.position.z);
      showRange(unit);
    } else showRange(null);
    refreshHud();
  }

  function refreshHud() {
    const el = hud.info;
    const u = state.selected;
    if (!u) { el.textContent = '未选中单位'; return; }
    const facCls = u.faction === 'red' ? 'fac-r' : 'fac-b';
    const facName = u.faction === 'red' ? '红军' : '蓝军';
    const specName = (SPEC_NAMES[u.type] && SPEC_NAMES[u.type][u.spec]) || '';   // 专精前缀（如"突击"步兵）
    el.innerHTML = `<span class="${facCls}">${facName} · ${specName}${u.stats.name}</span>　<span class="hp">HP ${u.hp}/${u.maxHp}</span>　射程 ${u.stats.range} · 机动 ${u.stats.move}`;
  }

  // ============ 指针交互 ============
  function setPointer(e) {
    const r = dom.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  dom.addEventListener('pointermove', (e) => {
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    // 悬停单位（攻击预览需要）；仅在已有选中单位时拾取，减少无谓射线
    let hoverUnit = null;
    if (state.selected && state.selected.alive) {
      const uHits = raycaster.intersectObjects(units.filter((u) => u.alive && !u.parade).map((u) => u.pickMesh), false);
      if (uHits.length) hoverUnit = uHits[0].object.userData.unit;
    }
    const hits = raycaster.intersectObjects(board.tileMeshes, false);
    if (hits.length) {
      const t = hits[0].object.userData.tile;
      state.hoverTile = t;
      hoverRing.visible = true;
      hoverRing.position.set(t.x, t.topY + 0.04, t.z);
      dom.style.cursor = 'pointer';
    } else {
      state.hoverTile = null;
      hoverRing.visible = false;
      dom.style.cursor = hoverUnit ? 'pointer' : 'default';
    }
    updateHoverPreview(hoverUnit);
    // 空袭瞄准态：悬停格显示目标标记
    if (state.aiming && state.hoverTile) {
      airMarker.position.set(state.hoverTile.x, state.hoverTile.topY + 0.06, state.hoverTile.z);
      airMarker.visible = true;
    } else {
      airMarker.visible = false;
    }
  });

  dom.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    state.downX = e.clientX; state.downY = e.clientY;
  });
  dom.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    // 拖拽旋转视角时不触发点击
    if (Math.hypot(e.clientX - state.downX, e.clientY - state.downY) > 6) return;
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    // 空袭瞄准态：点击格子确认空袭
    if (state.aiming) {
      const airHits = raycaster.intersectObjects(board.tileMeshes, false);
      if (airHits.length) {
        airstrike(state.airFaction, airHits[0].object.userData.tile);
        state.airFaction = state.airFaction === 'red' ? 'blue' : 'red';   // 双方轮换出场
        state.lastManual = state.time;
      }
      setAiming(false);
      return;
    }
    // 先点单位
    const pickMeshes = units.filter((u) => u.alive && !u.parade).map((u) => u.pickMesh);
    const uHits = raycaster.intersectObjects(pickMeshes, false);
    if (uHits.length) {
      const u = uHits[0].object.userData.unit;
      const sel = state.selected;
      if (sel && sel !== u && u.faction !== sel.faction && sel.alive && canAttack(sel)) {
        const d = hexDist(sel.tile, u.tile);
        const reach = sel.stats.range <= 1 ? 3 : sel.stats.range;
        if (d <= reach) {
          state.lastManual = state.time;
          if (sel.stats.range <= 1) meleeAttack(sel, u);
          else rangedAttack(sel, u);
          return;
        }
      }
      select(u);
      state.lastManual = state.time;
      return;
    }
    // 再点格子：有选中且格子在高亮范围内 → 移动
    const tHits = raycaster.intersectObjects(board.tileMeshes, false);
    if (tHits.length && state.selected && state.selected.alive) {
      const t = tHits[0].object.userData.tile;
      if (state.selected.stats.move > 0 && !occupiedBy(t) && moveTo(state.selected, t)) {
        state.lastManual = state.time;
        return;
      }
    }
    select(null);
  });

  // ============ 自动演示脚本 ============
  const byId = {};
  // 防空炮(artillery·aa)不能普通攻击，不作为脚本普攻执行者
  units.forEach((u) => { if (!u.parade && canAttack(u)) byId[u.type + '_' + u.faction] = u; });
  const alive = (u) => u && u.alive && !u.dead;

  // 每一步返回 true 表示成功发起；被跳过则立刻试下一步
  const script = [
    () => alive(byId.artillery_red) && alive(byId.artillery_blue) && rangedAttack(byId.artillery_red, byId.artillery_blue),   // 炮兵对射
    () => alive(byId.warship_blue) && alive(byId.mgNest_red) && rangedAttack(byId.warship_blue, byId.mgNest_red, { big: true }), // 舰炮轰岸
    () => alive(byId.artillery_blue) && airstrike('red', byId.artillery_blue.tile),                                                  // 空袭桥段（目标在防空覆盖内）
    () => alive(byId.cavalry_red) && alive(byId.infantry_blue) && meleeAttack(byId.cavalry_red, byId.infantry_blue),          // 骑兵冲锋
    () => alive(byId.submarine_blue) && alive(byId.mgNest_red) && rangedAttack(byId.submarine_blue, byId.mgNest_red),          // 鱼雷突袭
    () => alive(byId.artillery_blue) && alive(byId.artillery_red) && rangedAttack(byId.artillery_blue, byId.artillery_red),    // 蓝炮反击
    () => alive(byId.infantry_red) && alive(byId.infantry_blue) && meleeAttack(byId.infantry_red, byId.infantry_blue),         // 步兵突击
    () => alive(byId.mgNest_red) && alive(byId.infantry_blue) && rangedAttack(byId.mgNest_red, byId.infantry_blue),            // 机枪扫射
    () => alive(byId.warship_blue) && alive(byId.artillery_red) && rangedAttack(byId.warship_blue, byId.artillery_red, { big: true }), // 舰炮压制
    () => { // 战术机动：骑兵向中场游走
      const cav = byId.cavalry_red;
      if (!alive(cav)) return false;
      const cand = [...board.tiles.values()].filter((t) => !isWaterType(t.type) && t.type !== 'mountain' && !occupiedBy(t) && hexDist(cav.tile, t) === 2);
      if (!cand.length) return false;
      return moveTo(cav, cand[Math.floor(demoRng() * cand.length)]);
    },
  ];

  function update(dt) {
    state.time += dt;
    // 选择环跟隨 + 呼吸
    if (state.selected && state.selected.alive) {
      selRing.position.set(state.selected.group.position.x, state.selected.groundY + 0.06, state.selected.group.position.z);
      selRing.rotation.y += dt * 1.2;
      selRing.material.opacity = 0.6 + Math.sin(state.time * 4) * 0.25;
    } else if (state.selected) select(null);
    destRing.material.opacity = 0.5 + Math.sin(state.time * 6) * 0.3;
    pathDots.material.opacity = 0.6 + Math.sin(state.time * 8) * 0.3;
    enemyRingMat.opacity = 0.4 + Math.sin(state.time * 5) * 0.2;
    updatePreviewFx();
    if (airMarker.visible) airMarker.userData.scan.rotation.y += dt * 3;   // 瞄准扫描环旋转

    // 自动演示调度：空闲且距手动操作超过 8 秒
    if (state.auto && state.busy === 0 && state.time > state.nextAutoAt && state.time - state.lastManual > 8) {
      let fired = false;
      for (let tries = 0; tries < script.length && !fired; tries++) {
        fired = script[state.scriptIdx]();
        state.scriptIdx = (state.scriptIdx + 1) % script.length;
      }
      state.nextAutoAt = state.time + (fired ? 2.6 : 0.8);
    }
  }

  return {
    state, update, select,
    setAuto(v) { state.auto = v; },
    toggleAirstrikeAim() { setAiming(!state.aiming); return state.aiming; },
    // 供截图脚本直接触发指定攻击（window.__proto.demo.debugAttack）
    debugAttack(ai, ti) {
      const a = units[ai], t = units[ti];
      if (!a || !t) return 'bad-index';
      if (a.stats.range <= 1) meleeAttack(a, t);
      else rangedAttack(a, t, { big: a.type === 'warship' });
      return `${a.type} -> ${t.type}`;
    },
    debugMove(ui, q, r) {
      const u = units[ui], t = board.tiles.get(hexKey(q, r));
      if (!u || !t) return 'bad-args';
      return moveTo(u, t) ? 'ok' : 'unreachable';
    },
    // 截图/调试：模拟悬停某格（路径预览）或某单位（攻击预览）
    debugHoverTile(q, r) {
      state.hoverTile = board.tiles.get(hexKey(q, r)) || null;
      updateHoverPreview(null);
      return preview.key;
    },
    debugHoverUnit(ui) {
      updateHoverPreview(units[ui] || null);
      return preview.key;
    },
    // 截图/调试：把攻击方瞬移到目标邻格后演出完整近战编舞
    debugMeleeStrike(ai, ti) {
      const a = units[ai], t = units[ti];
      if (!a || !t) return 'bad-index';
      if (hexDist(a.tile, t.tile) > 1) {
        let spot = null;
        for (const [dq, dr] of HEX_DIRS) {
          const cand = board.tiles.get(hexKey(t.tile.q + dq, t.tile.r + dr));
          if (cand && passableFor(a)(cand) && !occupiedBy(cand)) { spot = cand; break; }
        }
        if (!spot) return 'no-adjacent';
        placeOnTile(a, spot);
      }
      meleeAttack(a, t);
      return 'ok';
    },
    // 截图/调试：直接扣血（展示底座弧光掉血/碎裂）
    debugDamage(ui, dmg) {
      const u = units[ui];
      if (!u || !u.alive) return 'bad-index';
      applyDamage(u, dmg, {});
      return 'ok';
    },
    // 截图/调试：直接设定血量（不致死），并播放掉血碎裂反馈
    debugSetHp(ui, hp) {
      const u = units[ui];
      if (!u || !u.alive) return 'bad-index';
      const oldFrac = u.hp / u.maxHp;
      u.hp = Math.max(1, Math.min(u.maxHp, hp));
      updateHpArc(u);
      fx.flashUnit(u);
      damageHpArcFeedback(u, oldFrac, u.hp / u.maxHp);
      return 'ok';
    },
    debugCarrierStrike(ai, ti) {
      const a = units[ai], t = units[ti];
      if (!a || !t) return 'bad-index';
      rangedAttack(a, t);
      return 'carrier strike';
    },
    debugAirstrike(faction, q, r) {
      const t = board.tiles.get(hexKey(q, r));
      if (!t) return 'bad-args';
      return airstrike(faction || 'red', t) ? 'ok' : 'fail';
    },
  };
}
