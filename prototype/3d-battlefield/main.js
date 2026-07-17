// 主入口：渲染器 / 相机 / 灯光 / 昼夜交替 / HUD / 主循环。
// 场景氛围： muted 战棋质感 —— 暖色夕阳直射光 + 冷色天光补光 + 薄雾。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { updateTweens, tween, EASE } from './util.js';
import { buildBoard } from './board.js';
import { createUnit, updateUnits } from './units.js';
import { initEffects, updateEffects, applyCameraShake, setEffectsNight } from './effects.js';
import { initDemo } from './demo.js';

// ============ 渲染器 ============
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));   // 像素比封顶 2
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 120);
const CAM_HOME = new THREE.Vector3(8.2, 10.2, 11.8);
const TGT_HOME = new THREE.Vector3(0.5, 0.2, 0.1);
camera.position.copy(CAM_HOME);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(TGT_HOME);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 6;
controls.maxDistance = 34;
controls.maxPolarAngle = 1.42;          // 不许钻到地面以下
controls.autoRotate = true;             // 缓慢环绕，用户一拖拽即停
controls.autoRotateSpeed = 0.45;
controls.addEventListener('start', () => { controls.autoRotate = false; });

// ============ 灯光 / 雾 / 昼夜 ============
const DAY = {
  bg: new THREE.Color(0xb3a896),        // 白日：霾黄羊皮纸色天空
  sun: new THREE.Color(0xffd9a8), sunI: 2.6,
  hemiSky: new THREE.Color(0xcdd6dd), hemiGnd: new THREE.Color(0x5c5346), hemiI: 0.55,
  fog: [26, 58],
};
const NIGHT = {
  bg: new THREE.Color(0x0b1220),        // 夜晚：深蓝夜空
  sun: new THREE.Color(0x8fa8d8), sunI: 0.78,
  hemiSky: new THREE.Color(0x2a3a55), hemiGnd: new THREE.Color(0x0c0f14), hemiI: 0.34,
  fog: [20, 46],
};

scene.background = DAY.bg.clone();
scene.fog = new THREE.Fog(DAY.bg.clone(), DAY.fog[0], DAY.fog[1]);

const sun = new THREE.DirectionalLight(DAY.sun, DAY.sunI);
sun.position.set(12, 16, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -13; sun.shadow.camera.right = 13;
sun.shadow.camera.top = 13; sun.shadow.camera.bottom = -13;
sun.shadow.camera.near = 2; sun.shadow.camera.far = 45;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);

const hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGnd, DAY.hemiI);
scene.add(hemi);

// 大地底盘（承接阴影、融入雾中）
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(34, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x3f3b33, roughness: 1 }),
);
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);

// ============ 场景内容 ============
const board = buildBoard(scene);
const nightMats = [...board.nightMats];
initEffects(scene, camera);

// 4v4 布阵：红军（西）步兵/骑兵/炮兵/碉堡 vs 蓝军（东）战舰/潜艇/步兵/炮兵
// 第 5 列为专精分支（战斗单位也带变体：蓝军火箭炮可在自动演示中齐射）
const unitDefs = [
  ['infantry', 'red', -3, 1, 'assault'], ['cavalry', 'red', -2, 0, 'heavy'], ['artillery', 'red', -2, -1, 'field'], ['mgNest', 'red', 1, 0],
  ['warship', 'blue', 3, -1, 'sea'], ['submarine', 'blue', 3, 0], ['infantry', 'blue', 0, 2, 'garrison'], ['artillery', 'blue', 0, -2, 'rocket'],
  ['artillery', 'blue', 1, -2, 'aa'],   // 蓝军防空炮：为东侧提供区域防空（不能普攻）
];
const units = unitDefs.map(([type, fac, q, r, spec]) =>
  createUnit(type, fac, board.tiles.get(q + ',' + r), nightMats, { spec }));

// —— 阅兵展示区：专精变体成对陈列（棋盘南侧地面 + 湖岸水面，纯展示不参与战斗）——
const paradeLand = [
  ['infantry', 'red', 'garrison', -5.2, 8.3], ['infantry', 'blue', 'assault', -3.8, 8.3],
  ['cavalry', 'red', 'light', -2.2, 8.3], ['cavalry', 'blue', 'heavy', -0.6, 8.3],
  ['artillery', 'red', 'field', 1.2, 8.3], ['artillery', 'blue', 'rocket', 2.8, 8.3], ['artillery', 'red', 'aa', 4.4, 8.3],
];
paradeLand.forEach(([type, fac, spec, x, z], i) => {
  // 棋盘外的虚拟格：groundY=0 落在地面上
  const fakeTile = { q: 100 + i, r: 100, x, z, topY: 0, type: 'plains' };
  const u = createUnit(type, fac, fakeTile, nightMats, { spec, parade: true });
  u.baseYaw = 0; u.group.rotation.y = 0;   // 面向南侧镜头
  units.push(u);
});
const paradeNavy = [
  ['warship', 'blue', 'aa', '4,-3'], ['warship', 'red', 'asw', '3,-2'],
  ['warship', 'blue', 'sea', '2,1'], ['warship', 'red', 'support', '3,1'],
];
paradeNavy.forEach(([type, fac, spec, key]) => {
  units.push(createUnit(type, fac, board.tiles.get(key), nightMats, { spec, parade: true }));
});

units.forEach((u) => scene.add(u.group));
// 双方初始对向（阅兵陆队列除外，已在上面朝南）
units.forEach((u) => { if (!u.parade) { u.baseYaw = u.faction === 'red' ? Math.PI / 2 : -Math.PI / 2; u.group.rotation.y = u.baseYaw; } });

const hud = {
  info: document.getElementById('hud-info'),
  btnDemo: document.getElementById('btn-demo'),
  btnNight: document.getElementById('btn-night'),
  btnCam: document.getElementById('btn-cam'),
  btnAir: document.getElementById('btn-air'),
};
const demo = initDemo({ scene, camera, controls, board, units, hud, dom: renderer.domElement });

// ============ HUD 交互 ============
hud.btnDemo.addEventListener('click', () => {
  demo.setAuto(!demo.state.auto);
  hud.btnDemo.textContent = demo.state.auto ? '自动演示：开' : '自动演示：关';
  hud.btnDemo.classList.toggle('off', !demo.state.auto);
});

hud.btnAir.addEventListener('click', () => demo.toggleAirstrikeAim());

let nightTarget = 0, nightT = 0;
hud.btnNight.addEventListener('click', () => {
  nightTarget = nightTarget > 0.5 ? 0 : 1;
  hud.btnNight.classList.toggle('off', nightTarget < 0.5);
});

hud.btnCam.addEventListener('click', () => {
  // 平滑飞回初始机位
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  tween({
    dur: 0.9, ease: EASE.inOut,
    onUpdate: (k) => {
      camera.position.lerpVectors(p0, CAM_HOME, k);
      controls.target.lerpVectors(t0, TGT_HOME, k);
    },
  });
});

// ============ 窗口 / 上下文丢失 ============
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  document.getElementById('overlay-ctx').style.display = 'flex';
});

// ============ 昼夜插值 ============
function applyDayNight(t) {
  scene.background.lerpColors(DAY.bg, NIGHT.bg, t);
  scene.fog.color.copy(scene.background);
  scene.fog.near = DAY.fog[0] + (NIGHT.fog[0] - DAY.fog[0]) * t;
  scene.fog.far = DAY.fog[1] + (NIGHT.fog[1] - DAY.fog[1]) * t;
  sun.color.lerpColors(DAY.sun, NIGHT.sun, t);
  sun.intensity = DAY.sunI + (NIGHT.sunI - DAY.sunI) * t;
  hemi.color.lerpColors(DAY.hemiSky, NIGHT.hemiSky, t);
  hemi.groundColor.lerpColors(DAY.hemiGnd, NIGHT.hemiGnd, t);
  hemi.intensity = DAY.hemiI + (NIGHT.hemiI - DAY.hemiI) * t;
  renderer.toneMappingExposure = 1.06 - t * 0.06;
  for (const m of nightMats) m.opacity = t * 0.95;   // 建筑/舰桥窗火
  setEffectsNight(t);
}

// ============ 主循环 ============
const clock = new THREE.Clock();
let firstFrame = true;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  nightT += (nightTarget - nightT) * Math.min(1, dt * 2.2);   // 昼夜渐变
  applyDayNight(nightT);

  updateTweens(dt);
  board.update(dt, time, nightT);
  updateUnits(units, dt, time, nightT);
  updateEffects(dt);
  demo.update(dt);
  controls.update();
  applyCameraShake(dt);

  renderer.render(scene, camera);
  if (firstFrame) {
    firstFrame = false;
    document.getElementById('overlay-loading').style.display = 'none';
  }
}
loop();

// 供自动化验证脚本探查场景状态
window.__proto = { renderer, scene, camera, controls, units, board, demo, setNight: (v) => { nightTarget = v ? 1 : 0; } };
