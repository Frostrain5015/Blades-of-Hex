// 棋盘模块：半径 4 的尖顶六边形棋盘（61 格），手工设计 + 种子随机的地形布局。
// 地形：平原 / 森林（实例化树木）/ 山地 / 浅水 / 深水 / 城市 / 海岸沙地，
// 另有水面波浪动画与红蓝势力边界微光圈。
import * as THREE from 'three';
import { axialToWorld, hexKey, HEX_DIRS, rand, rng } from './util.js';

export const BOARD_RADIUS = 4;
export const WATER_Y = 0.28;            // 水面高度

// —— 手工地图（东侧湖泊、北侧山脊、西南森林、中西部小城）——
const DEEP = new Set(['3,0', '3,-1', '4,-1', '4,-2']);
const SHALLOW = new Set(['4,0', '2,0', '2,1', '3,1', '3,-2', '2,-1', '4,-3']);
const MOUNTAIN = new Set(['-1,-3', '0,-3', '0,-4', '-2,-2', '1,-4']);
const FOREST = new Set(['-3,2', '-2,2', '-1,3', '-4,3', '-3,4', '1,2', '2,-3', '0,3', '-4,2']);
const CITY = '-1,1';
const RED_TERR = new Set(['-4,0', '-4,1', '-4,2', '-4,3', '-4,4']);   // 西缘红线
const BLUE_TERR = new Set(['3,1', '3,-2', '3,-3', '2,2']);            // 湖岸蓝线

export const isWaterType = (t) => t === 'deep' || t === 'shallow';

// 低调材质工厂：低饱和、哑光、平直着色的战棋质感
function mat(color, rough = 0.95, metal = 0.0) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: rough, metalness: metal });
}
// 同色系抖动出几支材质，给相邻格子细微色差
function matVariants(base, n = 4, jitter = 0.05) {
  const c = new THREE.Color(base);
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = c.clone().offsetHSL(rand(-0.01, 0.01), rand(-0.03, 0.03), rand(-jitter, jitter));
    out.push(mat(v));
  }
  return out;
}

export function buildBoard(scene) {
  const tiles = new Map();          // "q,r" -> tile
  const tileMeshes = [];
  const nightMats = [];             // 夜晚发光材质（城市窗火）
  const group = new THREE.Group();
  scene.add(group);

  // 共享单位高度六棱柱，按地形 scale.y 拉伸
  const hexGeo = new THREE.CylinderGeometry(0.97, 0.97, 1, 6);

  const MATS = {
    plains: matVariants(0x55663e, 4, 0.04),
    forest: matVariants(0x47603a, 4, 0.04),
    mountain: matVariants(0x62625e),
    sand: matVariants(0xa89468),
    city: matVariants(0x7d7a5e),
    shallow: matVariants(0x54706e),
    deep: matVariants(0x39525c),
  };
  const pickMat = (type) => MATS[type][Math.floor(rng() * MATS[type].length)];

  // 第一遍：定地形类型（含海岸沙地判定）
  for (let q = -BOARD_RADIUS; q <= BOARD_RADIUS; q++) {
    for (let r = Math.max(-BOARD_RADIUS, -q - BOARD_RADIUS); r <= Math.min(BOARD_RADIUS, -q + BOARD_RADIUS); r++) {
      const key = hexKey(q, r);
      let type = 'plains';
      if (DEEP.has(key)) type = 'deep';
      else if (SHALLOW.has(key)) type = 'shallow';
      else if (MOUNTAIN.has(key)) type = 'mountain';
      else if (FOREST.has(key)) type = 'forest';
      else if (key === CITY) type = 'city';
      tiles.set(key, { q, r, type });
    }
  }
  // 邻水陆地 → 沙地
  for (const t of tiles.values()) {
    if (isWaterType(t.type) || t.type === 'mountain' || t.type === 'city') continue;
    const nearWater = HEX_DIRS.some(([dq, dr]) => {
      const n = tiles.get(hexKey(t.q + dq, t.r + dr));
      return n && isWaterType(n.type);
    });
    if (nearWater) t.type = 'sand';
  }

  // 第二遍：生成格子网格。不同地形不同厚度，水面格下沉
  const HEIGHTS = { plains: [0.5, 0.14], forest: [0.55, 0.1], mountain: [1.35, 0.35], sand: [0.42, 0.06], city: [0.55, 0], shallow: [0.2, 0.03], deep: [0.1, 0.02] };
  for (const t of tiles.values()) {
    const [base, jit] = HEIGHTS[t.type];
    const h = base + rand(0, jit);
    const mesh = new THREE.Mesh(hexGeo, pickMat(t.type));
    const { x, z } = axialToWorld(t.q, t.r);
    mesh.scale.y = h;
    mesh.position.set(x, h / 2, z);
    mesh.receiveShadow = true;
    mesh.castShadow = t.type === 'mountain';
    mesh.userData.tile = t;
    group.add(mesh);
    tileMeshes.push(mesh);
    Object.assign(t, { mesh, topY: h, x, z });
  }

  // —— 水面：圆形湖面（着色器按半径裁剪 + 中心深水渐变），顶点波浪动画 ——
  const waterUniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0x4e8794) },   // 浅水青
    uDeep: { value: new THREE.Color(0x294f67) },    // 深水蓝
    uNight: { value: 0 },
  };
  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      uniform float uTime;
      varying float vW;
      varying vec2 vXZ;
      void main() {
        vec3 p = position;
        float w = sin(p.x * 0.9 + uTime * 1.2) * 0.5
                + sin(p.y * 1.3 + uTime * 0.9) * 0.35
                + sin((p.x + p.y) * 0.5 + uTime * 1.7) * 0.25;
        p.z += w * 0.06;                       // 平面局部 z（旋转后为世界 y）
        vW = w;
        vXZ = vec2(p.x, p.y);                  // 局部坐标 = 距湖心偏移
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform vec3 uDeep;
      uniform float uNight;
      varying float vW;
      varying vec2 vXZ;
      void main() {
        float d = length(vXZ);
        float deepMix = 1.0 - smoothstep(0.0, 3.6, d);      // 湖心深、湖岸浅
        vec3 c = mix(uColor, uDeep, deepMix * 0.9);
        c += vW * 0.05;                                      // 波峰微亮
        c *= mix(1.0, 0.3, uNight);                          // 夜晚压暗
        float alpha = 0.82 * (1.0 - smoothstep(3.9, 4.9, d)); // 圆湖软边
        gl_FragColor = vec4(c, alpha);
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(13, 13, 56, 56), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(5.4, WATER_Y, -1.2);
  group.add(water);

  // —— 森林：两个 InstancedMesh（树干 + 双层松冠）——
  const forestTiles = [...tiles.values()].filter((t) => t.type === 'forest');
  const treeSpots = [];
  for (const t of forestTiles) {
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, d = rng() * 0.55;
      treeSpots.push({ x: t.x + Math.cos(a) * d, y: t.topY, z: t.z + Math.sin(a) * d, s: rand(0.7, 1.25) });
    }
  }
  const trunkGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.18, 5).translate(0, 0.09, 0);
  const crownGeo = new THREE.ConeGeometry(0.18, 0.34, 6).translate(0, 0.36, 0);
  const crown2Geo = new THREE.ConeGeometry(0.12, 0.26, 6).translate(0, 0.55, 0);
  const trunkIM = new THREE.InstancedMesh(trunkGeo, mat(0x4a3826), treeSpots.length);
  const crownIM = new THREE.InstancedMesh(crownGeo, mat(0x3d5c33), treeSpots.length);
  const crown2IM = new THREE.InstancedMesh(crown2Geo, mat(0x466b39), treeSpots.length);
  const m4 = new THREE.Matrix4(), quat = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  treeSpots.forEach((s, i) => {
    quat.setFromAxisAngle(up, rng() * Math.PI * 2);
    m4.compose(new THREE.Vector3(s.x, s.y, s.z), quat, new THREE.Vector3(s.s, s.s, s.s));
    trunkIM.setMatrixAt(i, m4); crownIM.setMatrixAt(i, m4); crown2IM.setMatrixAt(i, m4);
  });
  for (const im of [trunkIM, crownIM, crown2IM]) { im.castShadow = true; im.receiveShadow = true; group.add(im); }

  // —— 山地岩石：实例化十二面体 ——
  const mtTiles = [...tiles.values()].filter((t) => t.type === 'mountain');
  const rockGeo = new THREE.DodecahedronGeometry(0.22);
  const rockIM = new THREE.InstancedMesh(rockGeo, mat(0x54544f, 1.0), mtTiles.length * 2);
  let ri = 0;
  for (const t of mtTiles) {
    for (let i = 0; i < 2; i++) {
      const a = rng() * Math.PI * 2, d = rng() * 0.4;
      quat.setFromAxisAngle(up, rng() * Math.PI * 2);
      m4.compose(
        new THREE.Vector3(t.x + Math.cos(a) * d, t.topY + 0.08, t.z + Math.sin(a) * d),
        quat,
        new THREE.Vector3(rand(0.8, 1.6), rand(0.7, 1.4), rand(0.8, 1.6)),
      );
      rockIM.setMatrixAt(ri++, m4);
    }
  }
  rockIM.castShadow = true; rockIM.receiveShadow = true;
  group.add(rockIM);

  // —— 城市：米色小楼群 + 坡屋顶，窗户夜间发光 ——
  const cityTile = tiles.get(CITY);
  {
    const wallM = mat(0xc9b98f, 0.9);
    const roofM = mat(0x6b4f3a, 0.95);
    const winM = new THREE.MeshBasicMaterial({ color: 0xffd37a, transparent: true, opacity: 0 });
    nightMats.push(winM);
    const spots = [[-0.28, -0.2, 0.34], [0.26, -0.26, 0.26], [0.05, 0.24, 0.42], [-0.3, 0.26, 0.22], [0.34, 0.14, 0.3]];
    for (const [ox, oz, h] of spots) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, h, 0.2), wallM);
      b.position.set(cityTile.x + ox, cityTile.topY + h / 2, cityTile.z + oz);
      b.castShadow = b.receiveShadow = true;
      group.add(b);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.14, 4), roofM);
      roof.rotation.y = Math.PI / 4;
      roof.position.set(b.position.x, cityTile.topY + h + 0.07, b.position.z);
      roof.castShadow = true;
      group.add(roof);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.1, h * 0.5), winM);
      win.position.set(b.position.x, cityTile.topY + h * 0.5, b.position.z + 0.101);
      group.add(win);
    }
  }

  // —— flak 高射机枪工事：碉堡格的小哨塔（防空判定语义见 demo.findAaCover）——
  const flakTile = tiles.get('1,0');
  if (flakTile) {
    flakTile.flak = true;   // 地块携带 flak 工事标记
    const tg = new THREE.Group();
    const legM = mat(0x5a5148, 0.9), dkM = mat(0x33333a, 0.5, 0.7);
    for (const [sx, sz] of [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.5, 0.035), legM);
      leg.position.set(sx, 0.25, sz);
      tg.add(leg);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.26), legM);
    deck.position.y = 0.52; tg.add(deck);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.14, 4), mat(0x6b4f3a, 0.95));
    roof.rotation.y = Math.PI / 4; roof.position.y = 0.68; tg.add(roof);
    const mg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 6), dkM);
    mg.rotation.x = -1.1; mg.position.set(0, 0.58, 0.06); tg.add(mg);
    tg.position.set(flakTile.x + 0.52, flakTile.topY, flakTile.z + 0.3);
    tg.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(tg);
  }

  // —— 势力边界微光圈（红/蓝）——
  const terrRings = [];
  const mkRing = (color) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ringGeo = new THREE.RingGeometry(0.78, 0.9, 6, 1, -Math.PI / 2);
  ringGeo.rotateX(-Math.PI / 2);
  const redRingM = mkRing(0xc0392b), blueRingM = mkRing(0x2e5d8c);
  for (const [set, m] of [[RED_TERR, redRingM], [BLUE_TERR, blueRingM]]) {
    for (const key of set) {
      const t = tiles.get(key);
      if (!t) continue;
      const ring = new THREE.Mesh(ringGeo, m);
      ring.position.set(t.x, t.topY + 0.02, t.z);
      group.add(ring);
      terrRings.push(ring);
    }
  }

  return {
    tiles, tileMeshes, nightMats,
    update(dt, time, nightT) {
      waterUniforms.uTime.value = time;
      waterUniforms.uNight.value = nightT;
      const pulse = 0.16 + 0.1 * Math.sin(time * 1.6);       // 边界圈呼吸
      redRingM.opacity = pulse; blueRingM.opacity = pulse;
      for (const m of nightMats) m.opacity = nightT * 0.95;  // 夜晚窗火
    },
  };
}
