(() => {
  'use strict';

  const SQRT3 = Math.sqrt(3);
  const HEX_DIRECTIONS = [
    { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 },
    { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }
  ];
  const PALETTES = {
    red: { tile: '#ffaaaa', line: '#8b1a1a', flag: '#d44040' },
    orange: { tile: '#fcd6b0', line: '#a05510', flag: '#e88430' },
    yellow: { tile: '#fff5c0', line: '#908010', flag: '#d4c420' },
    green: { tile: '#aaffaa', line: '#1a601a', flag: '#40a040' },
    cyan: { tile: '#aaffdd', line: '#107060', flag: '#30b8a0' },
    blue: { tile: '#aaaaff', line: '#1a2a80', flag: '#4060d0' },
    purple: { tile: '#d8aaff', line: '#602890', flag: '#9050c8' }
  };
  const RELATION_COLORS = {
    self: '#55c66a',
    ally: '#5a8dff',
    neutral: '#dfb844',
    enemy: '#e04c45'
  };
  const state = {
    style: 'relief',
    palette: 'red',
    texture: .72,
    units: true,
    grid: true,
    healthStyle: 'dial',
    health: .68,
    relation: 'enemy',
    shield: .42,
    interaction: 'march',
    targeting: 'attack',
    targetingHoverKey: null,
    airTargeting: 'airstrike',
    airTargetingHoverKey: null,
    interactionMotion: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    interactionElapsed: 0,
    interactionLastFrame: performance.now()
  };

  const specimenCanvases = [...document.querySelectorAll('.specimen')].map(article => ({
    kind: article.dataset.kind,
    canvas: article.querySelector('canvas')
  }));
  const battlefieldCanvas = document.getElementById('battlefield');
  const interactionCanvas = document.getElementById('interactionPreview');
  const targetingCanvas = document.getElementById('targetingPreview');
  const airTargetingCanvas = document.getElementById('airTargetingPreview');
  const interactionMotionInput = document.getElementById('interactionMotion');
  const waterCanvas = document.getElementById('waterPreview');
  const hudCards = [...document.querySelectorAll('.hud-card')].map((button, index) => ({
    button,
    canvas: button.querySelector('canvas'),
    healthStyle: button.dataset.healthStyle,
    index
  }));

  function tileKey(q, r) { return `${q},${r}`; }
  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function hashNumber(a, b, salt = 0) {
    let value = Math.imul(a + 0x7ed55d16, 0x27d4eb2d) ^ Math.imul(b + 0x165667b1, 0x85ebca6b) ^ salt;
    value ^= value >>> 15;
    value = Math.imul(value, 0x2c1b3c6d);
    value ^= value >>> 12;
    return (value >>> 0) / 4294967295;
  }

  function seeded(tile, salt) {
    return hashNumber(tile.q || 0, tile.r || 0, salt);
  }

  function hexPoint(cx, cy, size, index) {
    const angle = -Math.PI / 2 + index * Math.PI / 3;
    return { x: cx + Math.cos(angle) * size, y: cy + Math.sin(angle) * size };
  }

  function appendHexPath(ctx, cx, cy, size) {
    for (let index = 0; index < 6; index++) {
      const point = hexPoint(cx, cy, size, index);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
  }

  function hexPath(ctx, cx, cy, size) {
    ctx.beginPath();
    appendHexPath(ctx, cx, cy, size);
  }

  function clipToGrid(ctx, grid, inset = 1.005) {
    ctx.beginPath();
    for (const tile of grid.tiles) appendHexPath(ctx, tile.x, tile.y, grid.size * inset);
    ctx.clip();
  }

  function axialToPixel(q, r, size, originX, originY) {
    return {
      x: originX + SQRT3 * size * (q + r * .5),
      y: originY + 1.5 * size * r
    };
  }

  function prepareCanvas(canvas, preferredRatio) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, preferredRatio ? width / preferredRatio : rect.height);
    const pixelW = Math.round(width * dpr);
    const pixelH = Math.round(height * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    if (preferredRatio) canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    return { ctx, width, height };
  }

  function styleProfile() {
    if (state.style === 'chronicle') {
      return {
        wash: .52, shadow: .16, stroke: .9, detail: .85,
        ink: '#4a4033', light: '#ddcda7', foliage: '#5e6650', rock: '#6d665d', roof: '#8b5a45'
      };
    }
    if (state.style === 'texture') {
      return {
        wash: .24, shadow: .08, stroke: .45, detail: .58,
        ink: '#534c40', light: '#d9cba9', foliage: '#66705a', rock: '#777168', roof: '#8a6b55'
      };
    }
    return {
      wash: .68, shadow: .34, stroke: 1, detail: 1,
      ink: '#3e392f', light: '#e7d8b3', foliage: '#596649', rock: '#716b63', roof: '#8f5540'
    };
  }

  function roundedPolygon(ctx, points, fill, stroke, lineWidth = 1) {
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  function drawTileBase(ctx, tile, size, palette) {
    const profile = styleProfile();
    ctx.save();
    hexPath(ctx, tile.x + size * .035, tile.y + size * .07, size);
    ctx.fillStyle = `rgba(15,14,12,${.12 + profile.shadow * .22})`;
    ctx.fill();
    hexPath(ctx, tile.x, tile.y, size);
    ctx.fillStyle = palette.tile;
    ctx.fill();
    ctx.clip();

    const vignette = ctx.createRadialGradient(tile.x - size * .22, tile.y - size * .35, size * .08, tile.x, tile.y, size * 1.2);
    vignette.addColorStop(0, `rgba(255,247,220,${.17 * state.texture})`);
    vignette.addColorStop(1, `rgba(42,36,28,${.11 * state.texture})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(tile.x - size, tile.y - size, size * 2, size * 2);

    drawPaperTexture(ctx, tile, size, profile);
    drawGroundWash(ctx, tile, size, profile);
    ctx.restore();
  }

  function drawPaperTexture(ctx, tile, size, profile) {
    const alpha = state.texture * profile.detail;
    ctx.save();
    ctx.lineCap = 'round';
    for (let index = 0; index < 18; index++) {
      const px = tile.x + (seeded(tile, 100 + index) - .5) * size * 1.7;
      const py = tile.y + (seeded(tile, 220 + index) - .5) * size * 1.8;
      const length = size * (.06 + seeded(tile, 350 + index) * .16);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + length, py + length * .18);
      ctx.strokeStyle = `rgba(50,43,33,${alpha * (.025 + seeded(tile, 480 + index) * .045)})`;
      ctx.lineWidth = .45 + seeded(tile, 620 + index) * .65;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGroundWash(ctx, tile, size, profile) {
    const alpha = state.texture * profile.wash;
    if (tile.terrain === 'forest') {
      ctx.fillStyle = `rgba(57,76,48,${.18 * alpha})`;
      ctx.fillRect(tile.x - size, tile.y - size, size * 2, size * 2);
    } else if (tile.terrain === 'mountain') {
      ctx.fillStyle = `rgba(75,69,62,${.13 * alpha})`;
      ctx.fillRect(tile.x - size, tile.y - size, size * 2, size * 2);
    } else if (tile.urban) {
      ctx.fillStyle = `rgba(91,78,61,${.2 * alpha})`;
      ctx.fillRect(tile.x - size, tile.y - size, size * 2, size * 2);
      drawCobble(ctx, tile, size, alpha);
    } else {
      drawContourHatching(ctx, tile, size, alpha);
    }
  }

  function drawContourHatching(ctx, tile, size, alpha) {
    ctx.save();
    ctx.strokeStyle = `rgba(65,57,42,${.075 * alpha})`;
    ctx.lineWidth = .75;
    for (let offset = -2; offset <= 2; offset++) {
      ctx.beginPath();
      const y = tile.y + offset * size * .23;
      ctx.moveTo(tile.x - size, y - size * .08);
      ctx.bezierCurveTo(tile.x - size * .35, y + size * .12, tile.x + size * .28, y - size * .13, tile.x + size, y + size * .05);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCobble(ctx, tile, size, alpha) {
    ctx.save();
    ctx.strokeStyle = `rgba(54,46,37,${.1 * alpha})`;
    ctx.lineWidth = .55;
    const step = Math.max(5, size * .16);
    for (let y = tile.y - size; y <= tile.y + size; y += step) {
      const row = Math.round((y - tile.y) / step);
      for (let x = tile.x - size; x <= tile.x + size; x += step * 1.55) {
        ctx.strokeRect(x + (row % 2) * step * .75, y, step * 1.35, step * .72);
      }
    }
    ctx.restore();
  }

  function drawGrass(ctx, tile, size) {
    const profile = styleProfile();
    const alpha = state.texture * profile.detail;
    ctx.save();
    ctx.strokeStyle = `rgba(58,70,45,${.28 * alpha})`;
    ctx.lineWidth = .75;
    ctx.lineCap = 'round';
    for (let index = 0; index < 11; index++) {
      const x = tile.x + (seeded(tile, 800 + index) - .5) * size * 1.3;
      const y = tile.y + (seeded(tile, 900 + index) - .5) * size * 1.15;
      const h = size * (.05 + seeded(tile, 1000 + index) * .05);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x - h * .4, y - h * .55, x - h * .15, y - h);
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + h * .35, y - h * .5, x + h * .18, y - h * .9);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTree(ctx, x, y, scale, front = false) {
    const profile = styleProfile();
    const alpha = state.texture * profile.detail;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = .45 + alpha * .55;
    ctx.fillStyle = `rgba(45,35,25,${.38 * profile.shadow})`;
    ctx.beginPath();
    ctx.ellipse(scale * .08, scale * .38, scale * .62, scale * .22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#68513a';
    ctx.fillRect(-scale * .08, scale * .03, scale * .16, scale * .48);
    const grad = ctx.createRadialGradient(-scale * .18, -scale * .25, scale * .08, 0, 0, scale * .72);
    grad.addColorStop(0, profile.light);
    grad.addColorStop(.22, front ? '#697453' : '#758061');
    grad.addColorStop(1, profile.foliage);
    ctx.fillStyle = grad;
    ctx.strokeStyle = profile.ink;
    ctx.lineWidth = Math.max(.55, scale * .035) * profile.stroke;
    [[-.28, .02, .42], [.25, .01, .46], [-.03, -.28, .52]].forEach(part => {
      ctx.beginPath();
      ctx.arc(part[0] * scale, part[1] * scale, part[2] * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawForestBack(ctx, tile, size) {
    const placements = [
      [-.44, -.26, .27], [-.08, -.42, .32], [.35, -.26, .28],
      [-.55, .10, .25], [.53, .08, .24], [-.22, .03, .26], [.21, -.02, .28]
    ];
    placements.forEach((item, index) => {
      const jitterX = (seeded(tile, 1200 + index) - .5) * size * .08;
      const jitterY = (seeded(tile, 1300 + index) - .5) * size * .06;
      drawTree(ctx, tile.x + item[0] * size + jitterX, tile.y + item[1] * size + jitterY, size * item[2], false);
    });
  }

  function drawForestFront(ctx, tile, size) {
    drawTree(ctx, tile.x - size * .36, tile.y + size * .36, size * .27, true);
    drawTree(ctx, tile.x + size * .32, tile.y + size * .39, size * .3, true);
  }

  function drawPeak(ctx, x, y, scale, height, variant = 0) {
    const profile = styleProfile();
    const alpha = .55 + state.texture * .45;
    const left = { x: x - scale, y: y + scale * .45 };
    const top = { x: x + scale * (variant - .5) * .18, y: y - height };
    const right = { x: x + scale, y: y + scale * .45 };
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgba(28,24,21,${.18 * profile.shadow})`;
    ctx.beginPath();
    ctx.ellipse(x + scale * .08, y + scale * .52, scale * 1.05, scale * .26, 0, 0, Math.PI * 2);
    ctx.fill();
    roundedPolygon(ctx, [left, top, { x: x + scale * .08, y: y + scale * .45 }], profile.rock, profile.ink, 1.05 * profile.stroke);
    roundedPolygon(ctx, [top, right, { x: x + scale * .08, y: y + scale * .45 }], '#837b70', profile.ink, 1.05 * profile.stroke);
    roundedPolygon(ctx, [
      top,
      { x: x - scale * .18, y: y - height * .52 },
      { x: x + scale * .03, y: y - height * .62 },
      { x: x + scale * .27, y: y - height * .40 }
    ], profile.light, null);
    ctx.strokeStyle = `rgba(52,45,38,${.42 * profile.stroke})`;
    ctx.lineWidth = .7;
    ctx.beginPath();
    ctx.moveTo(x - scale * .32, y - height * .18);
    ctx.lineTo(x - scale * .02, y + scale * .16);
    ctx.moveTo(x + scale * .34, y - height * .1);
    ctx.lineTo(x + scale * .16, y + scale * .2);
    ctx.stroke();
    ctx.restore();
  }

  function drawMountains(ctx, tile, size) {
    drawPeak(ctx, tile.x - size * .3, tile.y + size * .08, size * .42, size * .58, -1);
    drawPeak(ctx, tile.x + size * .28, tile.y + size * .05, size * .48, size * .72, 1);
    drawPeak(ctx, tile.x + size * .02, tile.y - size * .12, size * .54, size * .84, 0);
  }

  function drawRoad(ctx, tile, size, horizontal = false) {
    const profile = styleProfile();
    ctx.save();
    ctx.strokeStyle = `rgba(73,59,43,${.46 * state.texture})`;
    ctx.lineWidth = size * .13;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(tile.x - size, tile.y + size * .1);
      ctx.bezierCurveTo(tile.x - size * .3, tile.y - size * .08, tile.x + size * .35, tile.y + size * .12, tile.x + size, tile.y - size * .04);
    } else {
      ctx.moveTo(tile.x - size * .25, tile.y + size);
      ctx.bezierCurveTo(tile.x + size * .2, tile.y + size * .25, tile.x - size * .08, tile.y - size * .25, tile.x + size * .18, tile.y - size);
    }
    ctx.stroke();
    ctx.strokeStyle = `rgba(224,204,161,${.35 * state.texture * profile.detail})`;
    ctx.lineWidth = size * .035;
    ctx.setLineDash([size * .07, size * .09]);
    ctx.stroke();
    ctx.restore();
  }

  function drawHouse(ctx, x, y, scale, rotation = 0) {
    const profile = styleProfile();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.globalAlpha = .58 + state.texture * .42;
    ctx.fillStyle = `rgba(35,29,24,${.24 * profile.shadow})`;
    ctx.fillRect(-scale * .45 + scale * .08, -scale * .1 + scale * .13, scale, scale * .65);
    ctx.fillStyle = '#c0ad86';
    ctx.strokeStyle = profile.ink;
    ctx.lineWidth = .75 * profile.stroke;
    ctx.fillRect(-scale * .45, -scale * .1, scale * .9, scale * .6);
    ctx.strokeRect(-scale * .45, -scale * .1, scale * .9, scale * .6);
    roundedPolygon(ctx, [
      { x: -scale * .58, y: -scale * .12 },
      { x: 0, y: -scale * .58 },
      { x: scale * .58, y: -scale * .12 }
    ], profile.roof, profile.ink, .85 * profile.stroke);
    ctx.fillStyle = profile.ink;
    ctx.fillRect(-scale * .08, scale * .14, scale * .16, scale * .36);
    ctx.restore();
  }

  function drawFarmland(ctx, tile, size) {
    ctx.save();
    ctx.translate(tile.x - size * .32, tile.y + size * .28);
    ctx.rotate(-.18);
    ctx.strokeStyle = `rgba(100,78,42,${.28 * state.texture})`;
    ctx.lineWidth = 1;
    for (let index = -3; index <= 3; index++) {
      ctx.beginPath();
      ctx.moveTo(-size * .36, index * size * .07);
      ctx.lineTo(size * .36, index * size * .07);
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(223,195,115,${.34 * state.texture})`;
    ctx.strokeRect(-size * .4, -size * .24, size * .8, size * .48);
    ctx.restore();
  }

  function drawVillage(ctx, tile, size) {
    drawRoad(ctx, tile, size, false);
    drawFarmland(ctx, tile, size);
    drawHouse(ctx, tile.x - size * .32, tile.y - size * .22, size * .27, -.08);
    drawHouse(ctx, tile.x + size * .28, tile.y - size * .30, size * .23, .06);
    drawHouse(ctx, tile.x + size * .38, tile.y + size * .15, size * .2, -.04);
  }

  function drawUrbanGround(ctx, tile, size, neighborMask = 0) {
    const profile = styleProfile();
    ctx.save();
    hexPath(ctx, tile.x, tile.y, size);
    ctx.clip();
    ctx.strokeStyle = `rgba(74,58,44,${.34 * state.texture})`;
    ctx.lineWidth = size * .16;
    ctx.lineCap = 'round';
    for (let index = 0; index < 6; index++) {
      if (!(neighborMask & (1 << index))) continue;
      const direction = HEX_DIRECTIONS[index];
      const dx = SQRT3 * size * (direction.q + direction.r * .5);
      const dy = 1.5 * size * direction.r;
      ctx.beginPath();
      ctx.moveTo(tile.x, tile.y);
      ctx.lineTo(tile.x + dx * .62, tile.y + dy * .62);
      ctx.stroke();
      ctx.strokeStyle = `rgba(220,202,168,${.24 * state.texture * profile.detail})`;
      ctx.lineWidth = size * .025;
      ctx.stroke();
      ctx.strokeStyle = `rgba(74,58,44,${.34 * state.texture})`;
      ctx.lineWidth = size * .16;
    }
    ctx.restore();
  }

  function drawUrbanBlocks(ctx, tile, size, core = false) {
    const profile = styleProfile();
    const buildings = core
      ? [[-.48,-.18,.2], [.46,-.22,.19], [-.42,.34,.16], [.43,.32,.16]]
      : [[-.43,-.33,.17], [.12,-.44,.19], [.45,-.13,.16], [-.4,.29,.18], [.22,.36,.2]];
    buildings.forEach((item, index) => {
      const w = size * item[2] * 1.7;
      const h = size * item[2];
      const x = tile.x + size * item[0];
      const y = tile.y + size * item[1];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((seeded(tile, 1600 + index) - .5) * .18);
      ctx.fillStyle = `rgba(32,27,23,${.23 * profile.shadow})`;
      ctx.fillRect(-w * .45 + 2, -h * .4 + 3, w, h);
      ctx.fillStyle = index % 2 ? '#aa8a68' : '#b79a73';
      ctx.strokeStyle = profile.ink;
      ctx.lineWidth = .65 * profile.stroke;
      ctx.fillRect(-w * .5, -h * .5, w, h);
      ctx.strokeRect(-w * .5, -h * .5, w, h);
      ctx.strokeStyle = `rgba(235,218,178,${.5 * state.texture})`;
      ctx.beginPath();
      ctx.moveTo(-w * .38, 0);
      ctx.lineTo(w * .38, 0);
      ctx.stroke();
      ctx.restore();
    });
    if (core) drawCitadel(ctx, tile.x, tile.y - size * .03, size * .31);
  }

  function drawCitadel(ctx, x, y, scale) {
    const profile = styleProfile();
    ctx.save();
    ctx.globalAlpha = .62 + state.texture * .38;
    ctx.fillStyle = `rgba(28,24,20,${.28 * profile.shadow})`;
    ctx.fillRect(x - scale * .74 + 2, y - scale * .28 + 3, scale * 1.5, scale * .9);
    ctx.fillStyle = '#b8a27c';
    ctx.strokeStyle = profile.ink;
    ctx.lineWidth = 1 * profile.stroke;
    ctx.fillRect(x - scale * .7, y - scale * .3, scale * 1.4, scale * .82);
    ctx.strokeRect(x - scale * .7, y - scale * .3, scale * 1.4, scale * .82);
    [-.58, .58].forEach(offset => {
      ctx.fillRect(x + scale * offset - scale * .22, y - scale * .65, scale * .44, scale * 1.08);
      ctx.strokeRect(x + scale * offset - scale * .22, y - scale * .65, scale * .44, scale * 1.08);
      for (let index = -1; index <= 1; index += 2) {
        ctx.fillRect(x + scale * offset + index * scale * .16 - scale * .07, y - scale * .79, scale * .14, scale * .18);
      }
    });
    ctx.fillStyle = '#4a3d31';
    ctx.beginPath();
    ctx.arc(x, y + scale * .52, scale * .18, Math.PI, 0);
    ctx.fill();
    ctx.restore();
  }

  function drawWallEdge(ctx, tile, size, directionIndex) {
    const profile = styleProfile();
    const pointA = hexPoint(tile.x, tile.y, size * .9, directionIndex);
    const pointB = hexPoint(tile.x, tile.y, size * .9, (directionIndex + 1) % 6);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(37,31,25,${.36 + profile.shadow * .25})`;
    ctx.lineWidth = size * .15;
    ctx.beginPath();
    ctx.moveTo(pointA.x + 1.5, pointA.y + 2.3);
    ctx.lineTo(pointB.x + 1.5, pointB.y + 2.3);
    ctx.stroke();
    ctx.strokeStyle = '#9b8b70';
    ctx.lineWidth = size * .11;
    ctx.beginPath();
    ctx.moveTo(pointA.x, pointA.y);
    ctx.lineTo(pointB.x, pointB.y);
    ctx.stroke();
    ctx.strokeStyle = `rgba(235,218,178,${.64 * state.texture})`;
    ctx.lineWidth = size * .025;
    ctx.stroke();
    [pointA, pointB].forEach(point => {
      ctx.fillStyle = '#95846a';
      ctx.strokeStyle = profile.ink;
      ctx.lineWidth = .7 * profile.stroke;
      ctx.beginPath();
      ctx.arc(point.x, point.y, size * .105, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawTrench(ctx, tile, size, frontOnly = false) {
    const profile = styleProfile();
    const yShift = size * .08;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const from = frontOnly ? 0 : Math.PI;
    const to = frontOnly ? Math.PI : Math.PI * 2;
    const steps = 18;
    for (let index = 0; index <= steps; index++) {
      const angle = from + (to - from) * index / steps;
      const jitter = index % 2 ? size * .035 : -size * .035;
      const radius = size * .61 + jitter;
      const x = tile.x + Math.cos(angle) * radius;
      const y = tile.y + yShift + Math.sin(angle) * radius * .55;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = frontOnly ? '#806b49' : `rgba(64,47,30,${.6 * state.texture})`;
    ctx.lineWidth = frontOnly ? size * .11 : size * .18;
    ctx.stroke();
    ctx.strokeStyle = frontOnly ? profile.light : '#c19e61';
    ctx.lineWidth = frontOnly ? size * .025 : size * .045;
    ctx.setLineDash([size * .09, size * .045]);
    ctx.stroke();
    ctx.restore();
  }

  function drawFlak(ctx, tile, size, frontOnly = false) {
    const profile = styleProfile();
    ctx.save();
    ctx.translate(tile.x, tile.y + size * .06);
    if (!frontOnly) {
      ctx.strokeStyle = `rgba(68,52,34,${.65 * state.texture})`;
      ctx.lineWidth = size * .16;
      ctx.beginPath();
      ctx.ellipse(0, 0, size * .6, size * .36, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#645d50';
      ctx.strokeStyle = profile.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, size * .19, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      // Keep the barrels readable after a production-size unit badge is drawn:
      // lean them to the upper-right and let the muzzles clear the HUD footprint.
      ctx.rotate(.34);
      ctx.fillStyle = '#484944';
      ctx.fillRect(-size * .045, -size * .79, size * .09, size * .76);
      ctx.fillRect(size * .085, -size * .75, size * .075, size * .71);
      ctx.restore();
      for (let index = 0; index < 5; index++) {
        const angle = Math.PI + index * Math.PI / 4;
        ctx.fillStyle = '#967a4f';
        ctx.fillRect(Math.cos(angle) * size * .52 - size * .055, Math.sin(angle) * size * .28 - size * .035, size * .11, size * .07);
      }
    } else {
      ctx.strokeStyle = '#826b47';
      ctx.lineWidth = size * .13;
      ctx.beginPath();
      ctx.ellipse(0, 0, size * .6, size * .36, 0, 0, Math.PI);
      ctx.stroke();
      ctx.strokeStyle = profile.light;
      ctx.lineWidth = size * .025;
      ctx.setLineDash([size * .08, size * .04]);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawUnitFlag(ctx, tile, size, palette) {
    if (tile.urban || tile.village) return;
    const poleX = tile.x - size * .5;
    const poleTop = tile.y - size;
    const poleBottom = tile.y + size * .067;
    ctx.save();
    ctx.strokeStyle = '#aaa49a';
    ctx.lineWidth = Math.max(1, size * .05);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(poleX, poleTop);
    ctx.lineTo(poleX, poleBottom);
    ctx.stroke();
    const flagX = poleX + size * .035;
    const flagY = poleTop + size * .067;
    const flagW = size * .5;
    const flagH = size / 3;
    const flagGrad = ctx.createLinearGradient(flagX, flagY, flagX + flagW, flagY + flagH);
    flagGrad.addColorStop(0, palette.flag);
    flagGrad.addColorStop(1, palette.line);
    ctx.fillStyle = flagGrad;
    ctx.strokeStyle = 'rgba(41,31,22,.72)';
    ctx.lineWidth = Math.max(.6, size * .018);
    ctx.beginPath();
    ctx.moveTo(flagX, flagY);
    ctx.quadraticCurveTo(flagX + flagW * .52, flagY - flagH * .08, flagX + flagW, flagY + flagH * .12);
    ctx.lineTo(flagX + flagW, flagY + flagH);
    ctx.quadraticCurveTo(flagX + flagW * .48, flagY + flagH * .84, flagX, flagY + flagH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d9bc6b';
    ctx.beginPath();
    ctx.arc(poleX, poleTop, size * .055, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSettlementFlag(ctx, tile, size, palette) {
    if (!tile.cityCore && !tile.village) return;
    const poleX = tile.x - size * .55;
    const poleTop = tile.y - size * 1.1;
    const poleBottom = tile.y - size * .167;
    ctx.save();
    ctx.strokeStyle = '#c0b9aa';
    ctx.lineWidth = Math.max(1.2, size * .065);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(poleX, poleTop);
    ctx.lineTo(poleX, poleBottom);
    ctx.stroke();
    const flagX = poleX + size * .05;
    const flagY = poleTop + size * .033;
    const flagW = size * .8;
    const flagH = size * .533;
    const flagGrad = ctx.createLinearGradient(flagX, flagY, flagX + flagW, flagY + flagH);
    flagGrad.addColorStop(0, palette.flag);
    flagGrad.addColorStop(1, palette.line);
    ctx.fillStyle = flagGrad;
    ctx.strokeStyle = 'rgba(41,31,22,.72)';
    ctx.lineWidth = Math.max(.7, size * .02);
    ctx.beginPath();
    ctx.moveTo(flagX, flagY);
    ctx.quadraticCurveTo(flagX + flagW * .5, flagY - flagH * .08, flagX + flagW, flagY + flagH * .14);
    ctx.lineTo(flagX + flagW, flagY + flagH);
    ctx.quadraticCurveTo(flagX + flagW * .48, flagY + flagH * .84, flagX, flagY + flagH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e2c46f';
    ctx.beginPath();
    ctx.arc(poleX, poleTop, size * .07, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawGroundGauge(ctx, size, color, health, shield) {
    const radius = size * .5;
    const y = radius * .68;
    const radiusX = size * .57;
    const radiusY = size * .205;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(0, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(12,13,12,.82)';
    ctx.lineWidth = size * .12;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `${color}52`;
    ctx.lineWidth = size * .072;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, y, radiusX, radiusY, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * health);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * .076;
    ctx.shadowColor = color;
    ctx.shadowBlur = size * .09;
    ctx.stroke();
    if (shield > .003) {
      ctx.beginPath();
      ctx.ellipse(0, y, radiusX + size * .055, radiusY + size * .035, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, shield));
      ctx.strokeStyle = '#76e7ff';
      ctx.lineWidth = size * .045;
      ctx.shadowColor = '#76e7ff';
      ctx.shadowBlur = size * .09;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDialGauge(ctx, size, color, health, shield) {
    // Keep the complete badge/HUD footprint inside the production envelope:
    // HEX_SIZE 30, badgeR 15, shield outer edge about 20.2 px.
    const radius = size * .5;
    const startAngle = -Math.PI / 2;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(13,14,12,.92)';
    ctx.lineWidth = size * .12;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `${color}52`;
    ctx.lineWidth = size * .078;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius, startAngle, startAngle + Math.PI * 2 * health);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * .082;
    ctx.shadowColor = color;
    ctx.shadowBlur = size * .08;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(245,228,188,.34)';
    ctx.lineWidth = Math.max(.6, size * .018);
    for (let index = 0; index < 4; index++) {
      const angle = -Math.PI / 2 + index * Math.PI / 2;
      ctx.beginPath();
      ctx.arc(0, 0, radius, angle - .012, angle + .012);
      ctx.stroke();
    }
    if (shield > .003) {
      ctx.beginPath();
      ctx.arc(0, 0, size * .62, startAngle, startAngle + Math.PI * 2 * Math.min(1, shield));
      ctx.strokeStyle = '#76e7ff';
      ctx.lineWidth = size * .05;
      ctx.shadowColor = '#76e7ff';
      ctx.shadowBlur = size * .09;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCrescentGauge(ctx, size, color, health, shield) {
    const radius = size * .51;
    const start = Math.PI * .08;
    const sweep = Math.PI * .84;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, start + sweep);
    ctx.strokeStyle = 'rgba(13,14,12,.92)';
    ctx.lineWidth = size * .13;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, start + sweep);
    ctx.strokeStyle = `${color}52`;
    ctx.lineWidth = size * .078;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, start + sweep * health);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * .082;
    ctx.shadowColor = color;
    ctx.shadowBlur = size * .08;
    ctx.stroke();
    if (shield > .003) {
      ctx.beginPath();
      ctx.arc(0, 0, size * .62, start, start + sweep * Math.min(1, shield));
      ctx.strokeStyle = '#76e7ff';
      ctx.lineWidth = size * .05;
      ctx.shadowColor = '#76e7ff';
      ctx.shadowBlur = size * .09;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawUnit(ctx, tile, size, palette, options = {}) {
    // Production ratio: HEX_SIZE=30, badgeR=15. HP and shield rings extend
    // farther still, so the tile center cannot carry terrain identity.
    const radius = size * .5;
    const healthStyle = options.healthStyle || state.healthStyle;
    const health = Number.isFinite(options.health) ? options.health : state.health;
    const relation = options.relation || state.relation;
    const relationColor = RELATION_COLORS[relation] || RELATION_COLORS.enemy;
    const shield = Number.isFinite(options.shield) ? options.shield : state.shield;
    ctx.save();
    drawUnitFlag(ctx, tile, size, palette);
    ctx.translate(tile.x, tile.y + size * .035);
    if (healthStyle === 'ground') drawGroundGauge(ctx, size, relationColor, health, shield);
    ctx.fillStyle = 'rgba(22,18,14,.32)';
    ctx.beginPath();
    ctx.ellipse(2, radius * .7, radius * 1.2, radius * .42, 0, 0, Math.PI * 2);
    ctx.fill();
    const grad = ctx.createRadialGradient(-radius * .3, -radius * .42, radius * .08, 0, 0, radius * 1.15);
    grad.addColorStop(0, '#796d55');
    grad.addColorStop(.7, '#474239');
    grad.addColorStop(1, palette.line);
    ctx.fillStyle = grad;
    ctx.strokeStyle = '#30291e';
    ctx.lineWidth = Math.max(1, size * .04);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e4d1a3';
    ctx.beginPath();
    ctx.arc(0, -radius * .28, radius * .17, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-radius * .38, radius * .39);
    ctx.quadraticCurveTo(-radius * .28, -radius * .03, 0, -radius * .02);
    ctx.quadraticCurveTo(radius * .28, -radius * .03, radius * .38, radius * .39);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#30291e';
    ctx.lineWidth = Math.max(.75, size * .018);
    ctx.beginPath();
    ctx.arc(0, -radius * .3, radius * .2, Math.PI, Math.PI * 2);
    ctx.stroke();
    if (healthStyle === 'dial') drawDialGauge(ctx, size, relationColor, health, shield);
    if (healthStyle === 'crescent') drawCrescentGauge(ctx, size, relationColor, health, shield);
    ctx.restore();
  }

  function drawHexOutline(ctx, tile, size, strong = false) {
    if (!state.grid) return;
    ctx.save();
    hexPath(ctx, tile.x, tile.y, size);
    ctx.strokeStyle = strong ? 'rgba(54,45,34,.5)' : 'rgba(55,47,36,.22)';
    ctx.lineWidth = strong ? 1.35 : .75;
    ctx.stroke();
    ctx.restore();
  }

  function drawFeatureBack(ctx, tile, size, neighborMask = 0) {
    if (tile.urban) {
      drawUrbanGround(ctx, tile, size, neighborMask);
      drawUrbanBlocks(ctx, tile, size, tile.cityCore);
    } else if (tile.village) {
      drawVillage(ctx, tile, size);
    } else if (tile.terrain === 'forest') {
      drawForestBack(ctx, tile, size);
    } else if (tile.terrain === 'mountain') {
      drawMountains(ctx, tile, size);
    } else {
      drawGrass(ctx, tile, size);
    }
    if (tile.fortification === 'trench') drawTrench(ctx, tile, size, false);
    if (tile.fortification === 'flak') drawFlak(ctx, tile, size, false);
  }

  function drawFeatureFront(ctx, tile, size) {
    if (tile.terrain === 'forest') drawForestFront(ctx, tile, size);
    if (tile.fortification === 'trench') drawTrench(ctx, tile, size, true);
    if (tile.fortification === 'flak') drawFlak(ctx, tile, size, true);
  }

  function buildBattlefield(width, height) {
    const size = Math.min(width / 18.3, height / 10.2);
    const originX = width * .49;
    const originY = height * .51;
    const tiles = [];
    for (let r = -3; r <= 3; r++) {
      for (let q = -5; q <= 5; q++) {
        if (Math.abs(q + r) > 6) continue;
        const point = axialToPixel(q, r, size, originX, originY);
        tiles.push({ q, r, x: point.x, y: point.y, terrain: 'plains', camp: q + r * .25 < .6 ? 'selected' : 'blue' });
      }
    }
    const tileMap = new Map(tiles.map(tile => [tileKey(tile.q, tile.r), tile]));

    const forests = [[-5,-2],[-4,-2],[-4,-1],[-3,-2],[-3,-1],[-2,-2]];
    const mountains = [[-5,1],[-4,0],[-4,1],[-3,0],[-2,-1]];
    const city = [[1,0],[2,0],[1,1],[0,1],[0,0],[1,-1],[2,-1]];
    forests.forEach(coord => { const tile = tileMap.get(tileKey(...coord)); if (tile) tile.terrain = 'forest'; });
    mountains.forEach(coord => { const tile = tileMap.get(tileKey(...coord)); if (tile) tile.terrain = 'mountain'; });
    city.forEach(coord => {
      const tile = tileMap.get(tileKey(...coord));
      if (tile) { tile.urban = true; tile.camp = 'blue'; }
    });
    const core = tileMap.get('1,0');
    if (core) core.cityCore = true;
    const village = tileMap.get('-1,2');
    if (village) village.village = true;
    const trenchA = tileMap.get('3,1');
    const trenchB = tileMap.get('4,1');
    if (trenchA) trenchA.fortification = 'trench';
    if (trenchB) trenchB.fortification = 'trench';
    const flak = tileMap.get('4,-1');
    if (flak) flak.fortification = 'flak';

    const units = ['-3,-1', '-4,1', '-1,2', '1,0', '2,-1', '3,1', '4,-1'];
    units.forEach(key => { const tile = tileMap.get(key); if (tile) tile.hasUnit = true; });
    return { size, tiles, tileMap, citySet: new Set(city.map(coord => tileKey(...coord))) };
  }

  function urbanNeighborMask(tile, citySet) {
    let mask = 0;
    HEX_DIRECTIONS.forEach((direction, index) => {
      if (citySet.has(tileKey(tile.q + direction.q, tile.r + direction.r))) mask |= 1 << index;
    });
    return mask;
  }

  function drawCampFrontier(ctx, tile, grid, size) {
    const directionIndices = [0, 1, 2];
    directionIndices.forEach(directionIndex => {
      const direction = HEX_DIRECTIONS[directionIndex];
      const neighbor = grid.tileMap.get(tileKey(tile.q + direction.q, tile.r + direction.r));
      if (!neighbor || neighbor.camp === tile.camp) return;
      const a = hexPoint(tile.x, tile.y, size, directionIndex);
      const b = hexPoint(tile.x, tile.y, size, (directionIndex + 1) % 6);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(35,29,22,.62)';
      ctx.lineWidth = size * .085;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(238,218,169,.55)';
      ctx.lineWidth = size * .018;
      ctx.setLineDash([size * .11, size * .07]);
      ctx.stroke();
      ctx.restore();
    });
  }

  function renderBattlefield() {
    const { ctx, width, height } = prepareCanvas(battlefieldCanvas, 1.72);
    ctx.clearRect(0, 0, width, height);
    const backdrop = ctx.createLinearGradient(0, 0, 0, height);
    backdrop.addColorStop(0, '#171914');
    backdrop.addColorStop(1, '#0f100e');
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, width, height);
    const grid = buildBattlefield(width, height);
    const selectedPalette = PALETTES[state.palette];

    for (const tile of grid.tiles) {
      const palette = tile.camp === 'selected' ? selectedPalette : PALETTES.blue;
      drawTileBase(ctx, tile, grid.size, palette);
    }
    for (const tile of grid.tiles) {
      const mask = tile.urban ? urbanNeighborMask(tile, grid.citySet) : 0;
      drawFeatureBack(ctx, tile, grid.size, mask);
    }
    for (const tile of grid.tiles) drawCampFrontier(ctx, tile, grid, grid.size);
    for (const tile of grid.tiles) drawHexOutline(ctx, tile, grid.size);
    for (const tile of grid.tiles) {
      if (!tile.urban) continue;
      HEX_DIRECTIONS.forEach((direction, index) => {
        if (!grid.citySet.has(tileKey(tile.q + direction.q, tile.r + direction.r))) {
          drawWallEdge(ctx, tile, grid.size, index);
        }
      });
    }
    for (const tile of grid.tiles) {
      if (!tile.cityCore && !tile.village) continue;
      const palette = tile.camp === 'selected' ? selectedPalette : PALETTES.blue;
      drawSettlementFlag(ctx, tile, grid.size, palette);
    }
    if (state.units) {
      for (const tile of grid.tiles) {
        if (!tile.hasUnit) continue;
        const palette = tile.camp === 'selected' ? selectedPalette : PALETTES.blue;
        drawUnit(ctx, tile, grid.size, palette);
      }
    }
    for (const tile of grid.tiles) drawFeatureFront(ctx, tile, grid.size);
  }

  function specimenTile(kind, x, y) {
    const tile = { q: kind.length, r: kind.charCodeAt(0) % 5, x, y, terrain: 'plains' };
    if (kind === 'forest') tile.terrain = 'forest';
    if (kind === 'mountain') tile.terrain = 'mountain';
    if (kind === 'village') tile.village = true;
    if (kind === 'city') { tile.urban = true; tile.cityCore = true; }
    if (kind === 'urban') tile.urban = true;
    if (kind === 'trench') tile.fortification = 'trench';
    if (kind === 'flak') tile.fortification = 'flak';
    return tile;
  }

  function renderSpecimen(specimen) {
    const { ctx, width, height } = prepareCanvas(specimen.canvas);
    ctx.clearRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width * .5, height * .54, 0, width * .5, height * .54, Math.max(width, height) * .6);
    glow.addColorStop(0, 'rgba(103,85,50,.12)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    const size = Math.min(width * .285, height * .33);
    const tile = specimenTile(specimen.kind, width * .5, height * .58);
    const palette = PALETTES[state.palette];
    drawTileBase(ctx, tile, size, palette);
    drawFeatureBack(ctx, tile, size, specimen.kind === 'urban' ? 0b100110 : 0);
    drawHexOutline(ctx, tile, size, true);
    if (specimen.kind === 'city') {
      for (let index = 0; index < 6; index++) drawWallEdge(ctx, tile, size, index);
    } else if (specimen.kind === 'urban') {
      [0, 3, 4].forEach(index => drawWallEdge(ctx, tile, size, index));
    }
    drawSettlementFlag(ctx, tile, size, palette);
    if (state.units) drawUnit(ctx, tile, size, palette);
    drawFeatureFront(ctx, tile, size);
  }

  function renderHudCard(card) {
    const { ctx, width, height } = prepareCanvas(card.canvas);
    ctx.clearRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width * .5, height * .64, 0, width * .5, height * .64, Math.max(width, height) * .54);
    glow.addColorStop(0, 'rgba(150,120,65,.15)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    const size = Math.min(width * .255, height * .245);
    const tile = {
      q: card.index + 3,
      r: card.index - 1,
      x: width * .5,
      y: height * .65,
      terrain: card.index === 1 ? 'forest' : 'plains'
    };
    const palette = PALETTES[state.palette];
    drawTileBase(ctx, tile, size, palette);
    drawFeatureBack(ctx, tile, size, 0);
    drawHexOutline(ctx, tile, size, true);
    drawUnit(ctx, tile, size, palette, {
      healthStyle: card.healthStyle,
      health: state.health,
      relation: state.relation,
      shield: state.shield
    });
    drawFeatureFront(ctx, tile, size);

    ctx.fillStyle = 'rgba(10,11,9,.72)';
    ctx.fillRect(width * .5 - 46, height - 33, 92, 20);
    ctx.fillStyle = '#c9b98f';
    ctx.font = '700 10px "Palatino Linotype", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(state.health * 100)} / 100`, width * .5, height - 23);
  }

  function buildSystemGrid(width, height) {
    const size = Math.min(width / 11.4, height / 7.3);
    const originX = width * .48;
    const originY = height * .53;
    const tiles = [];
    for (let r = -2; r <= 2; r++) {
      for (let q = -3; q <= 3; q++) {
        if (Math.abs(q + r) > 4) continue;
        const point = axialToPixel(q, r, size, originX, originY);
        tiles.push({ q, r, x: point.x, y: point.y, terrain: 'plains', camp: 'selected' });
      }
    }
    return { size, tiles, tileMap: new Map(tiles.map(tile => [tileKey(tile.q, tile.r), tile])) };
  }

  function axialPreviewDistance(a, b) {
    const dq = b.q - a.q;
    const dr = b.r - a.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(-dq - dr)) / 2;
  }

  function previewEntry(tile, origin, time) {
    const distance = origin && tile ? axialPreviewDistance(origin, tile) : 0;
    const progress = state.interactionMotion
      ? clamp((time * 1000 - distance * 26) / 220, 0, 1)
      : 1;
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const jelly = easeOut + Math.sin(progress * Math.PI * 2.25) * (1 - progress) * .07;
    return { progress, alpha: clamp(progress * 1.55, 0, 1), scale: .82 + .18 * jelly };
  }

  function drawConnectedRegion(ctx, grid, keys, color, time = Infinity, origin = null) {
    const keySet = new Set(keys);
    ctx.save();
    ctx.fillStyle = color;
    for (const key of keySet) {
      const tile = grid.tileMap.get(key);
      if (!tile) continue;
      const distance = origin ? axialPreviewDistance(origin, tile) : 0;
      const elapsed = time * 1000 - distance * 34;
      const progress = Number.isFinite(time) ? clamp(elapsed / 250, 0, 1) : 1;
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const jelly = easeOut + Math.sin(progress * Math.PI * 2.25) * (1 - progress) * .075;
      const scale = .7 + (1.008 - .7) * jelly;
      const alpha = .13 * clamp(progress * 1.65, 0, 1);
      if (alpha <= 0) continue;
      // Slightly overlap adjacent cells: the fill reads as one reachable field,
      // while the thick stroke below remains exclusive to its outer boundary.
      ctx.globalAlpha = alpha;
      hexPath(ctx, tile.x, tile.y, grid.size * scale);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (const key of keySet) {
      const tile = grid.tileMap.get(key);
      if (!tile) continue;
      HEX_DIRECTIONS.forEach((direction, index) => {
        const neighborKey = tileKey(tile.q + direction.q, tile.r + direction.r);
        if (!grid.tileMap.has(neighborKey) || keySet.has(neighborKey)) return;
        const a = hexPoint(tile.x, tile.y, grid.size * .96, index);
        const b = hexPoint(tile.x, tile.y, grid.size * .96, (index + 1) % 6);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      });
    }
    ctx.strokeStyle = 'rgba(8,18,17,.92)';
    ctx.lineWidth = grid.size * .13;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = grid.size * .052;
    ctx.shadowColor = color;
    ctx.shadowBlur = grid.size * .18;
    ctx.stroke();
    ctx.restore();
  }

  function buildOperationRoute(points) {
    if (points.length < 2) return [];
    const anchors = points.map(point => ({ x: point.x, y: point.y }));

    const curveSegments = [];
    const tension = .78;
    for (let index = 0; index < anchors.length - 1; index++) {
      const p0 = anchors[Math.max(0, index - 1)];
      const p1 = anchors[index];
      const p2 = anchors[index + 1];
      const p3 = anchors[Math.min(anchors.length - 1, index + 2)];
      curveSegments.push({
        p0: p1,
        p1: {
          x: p1.x + (p2.x - p0.x) * tension / 6,
          y: p1.y + (p2.y - p0.y) * tension / 6
        },
        p2: {
          x: p2.x - (p3.x - p1.x) * tension / 6,
          y: p2.y - (p3.y - p1.y) * tension / 6
        },
        p3: p2
      });
    }

    const sampled = [];
    let total = 0;
    const stepsPerSegment = 28;
    curveSegments.forEach((segment, segmentIndex) => {
      for (let step = 0; step <= stepsPerSegment; step++) {
        if (segmentIndex > 0 && step === 0) continue;
        const t = step / stepsPerSegment;
        const u = 1 - t;
        const point = {
          x: u * u * u * segment.p0.x
            + 3 * u * u * t * segment.p1.x
            + 3 * u * t * t * segment.p2.x
            + t * t * t * segment.p3.x,
          y: u * u * u * segment.p0.y
            + 3 * u * u * t * segment.p1.y
            + 3 * u * t * t * segment.p2.y
            + t * t * t * segment.p3.y
        };
        if (sampled.length) {
          const previous = sampled[sampled.length - 1];
          total += Math.hypot(point.x - previous.x, point.y - previous.y);
        }
        sampled.push({ ...point, distance: total });
      }
    });
    sampled.total = total;
    sampled.anchors = anchors;
    return sampled;
  }

  function traceOperationRoute(ctx, route) {
    ctx.beginPath();
    ctx.moveTo(route[0].x, route[0].y);
    for (let index = 1; index < route.length; index++) ctx.lineTo(route[index].x, route[index].y);
  }

  function routePoint(route, fraction) {
    const target = Math.max(0, Math.min(1, fraction)) * route.total;
    let low = 0;
    let high = route.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (route[middle].distance < target) low = middle + 1;
      else high = middle;
    }
    const index = Math.max(1, low);
    const previous = route[index - 1];
    const current = route[index];
    const span = Math.max(.001, current.distance - previous.distance);
    const mix = (target - previous.distance) / span;
    return {
      x: previous.x + (current.x - previous.x) * mix,
      y: previous.y + (current.y - previous.y) * mix,
      angle: Math.atan2(current.y - previous.y, current.x - previous.x)
    };
  }

  function routeFractionBeforeEnd(route, inset) {
    if (!route.total) return 1;
    return Math.max(0, Math.min(1, (route.total - inset) / route.total));
  }

  function unitVisualCenter(tile, size) {
    return { x: tile.x, y: tile.y + size * .035 };
  }

  function buildRangedPreviewTrajectory(start, target, size) {
    const points = [];
    const dx = target.x - start.x;
    const dy = target.y - start.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) return points;
    const unitX = dx / distance;
    const unitY = dy / distance;
    const normalX = -unitY;
    const normalY = unitX;
    const bendDirection = normalY > 0 ? -1 : 1;
    const routeDx = target.x - start.x;
    const routeDy = target.y - start.y;
    const bend = Math.min(size * .62, distance * .075) * bendDirection;
    const steps = 72;
    let total = 0;
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const arc = Math.sin(t * Math.PI) * bend;
      const point = {
        x: start.x + routeDx * t + normalX * arc,
        y: start.y + routeDy * t + normalY * arc
      };
      if (points.length) {
        const previous = points[points.length - 1];
        total += Math.hypot(point.x - previous.x, point.y - previous.y);
      }
      points.push({ ...point, distance: total });
    }
    points.total = total;
    return points;
  }

  function drawOperationHead(ctx, route, color, size, open = false, fraction = 1) {
    const tip = routePoint(route, fraction);
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(tip.angle);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, size * .58);
    if (!open) ctx.lineTo(-size * .68, 0);
    ctx.lineTo(-size, -size * .58);
    if (!open) ctx.closePath();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = open ? Math.max(2, size * .26) : Math.max(1.2, size * .08);
    if (open) ctx.stroke();
    else ctx.fill();
    ctx.restore();
  }

  function drawRouteChevron(ctx, route, fraction, color, size, alpha = 1) {
    const point = routePoint(route, fraction);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(point.angle);
    ctx.beginPath();
    ctx.moveTo(-size, -size * .56);
    ctx.lineTo(0, 0);
    ctx.lineTo(-size, size * .56);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, size * .29);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.restore();
  }

  function drawMarchArrow(ctx, route, size, color, time) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Operation prototype gold sample: one subdued same-hue bed keeps the
    // route cohesive, while the narrow animated rail carries the direction.
    traceOperationRoute(ctx, route);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * .433;
    ctx.globalAlpha = .11;
    ctx.stroke();

    traceOperationRoute(ctx, route);
    ctx.lineWidth = size * .12;
    ctx.setLineDash([size * .6, size * .367]);
    ctx.lineDashOffset = -time * size * 1.533;
    ctx.globalAlpha = .92;
    ctx.shadowColor = color;
    ctx.shadowBlur = size * .08;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    [0, 1 / 3, 2 / 3].forEach(offset => drawRouteChevron(ctx, route, (time * .115 + offset) % .92, color, size * .3, .72));
    const destination = routePoint(route, 1);
    const destinationPulse = (time * .68) % 1;
    ctx.beginPath();
    ctx.arc(destination.x, destination.y, size * (.32 + destinationPulse * .42), 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * .05;
    ctx.globalAlpha = (1 - destinationPulse) * .58;
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawOperationHead(ctx, route, color, size * .54);
    ctx.restore();
  }

  function drawAssaultArrow(ctx, route, size, color, time, targetPoint, targetContactFraction) {
    const left = [];
    const right = [];
    const bodyEnd = Math.max(.08, targetContactFraction - size * .62 / route.total);
    const bodyPoints = route.filter(point => point.distance < route.total * bodyEnd);
    bodyPoints.push({ ...routePoint(route, bodyEnd), distance: route.total * bodyEnd });
    bodyPoints.forEach((point, index) => {
      const previous = bodyPoints[Math.max(0, index - 1)];
      const next = bodyPoints[Math.min(bodyPoints.length - 1, index + 1)];
      const angle = Math.atan2(next.y - previous.y, next.x - previous.x);
      const progress = index / Math.max(1, bodyPoints.length - 1);
      const width = size * (.34 - progress * .22);
      left.push({ x: point.x - Math.sin(angle) * width, y: point.y + Math.cos(angle) * width });
      right.push({ x: point.x + Math.sin(angle) * width, y: point.y - Math.cos(angle) * width });
    });
    ctx.save();
    ctx.beginPath();
    left.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
    right.reverse().forEach(point => ctx.lineTo(point.x, point.y));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = .3;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = size * .06;
    ctx.globalAlpha = .88;
    ctx.stroke();
    ctx.globalAlpha = 1;
    [ 0, .26, .52 ].forEach(offset => {
      const fraction = (time * .2 + offset) % bodyEnd;
      drawRouteChevron(ctx, route, fraction, '#ffe2de', size * .25, .86);
    });
    drawOperationHead(ctx, route, color, size * .92, false, targetContactFraction);
    const target = targetPoint || routePoint(route, 1);
    const pulse = (time * .78) % 1;
    ctx.beginPath();
    ctx.arc(target.x, target.y, size * (.277 + pulse * .596), 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * .053;
    ctx.globalAlpha = (1 - pulse) * .62;
    ctx.stroke();
    ctx.restore();
  }

  function firePreviewTiming(time) {
    const cycleDuration = 2.35;
    const flightDuration = 1.55;
    const impactDuration = .46;
    const cycle = ((time % cycleDuration) + cycleDuration) % cycleDuration;
    const impactProgress = (cycle - flightDuration) / impactDuration;
    return {
      flightProgress: Math.min(1, cycle / flightDuration),
      tracerVisible: cycle <= flightDuration,
      impactProgress,
      impactVisible: impactProgress >= 0 && impactProgress <= 1
    };
  }

  function drawFireArrow(ctx, route, size, color, time, targetContactFraction) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    traceOperationRoute(ctx, route);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * .086;
    ctx.setLineDash([size * .075, size * .22]);
    ctx.lineDashOffset = -time * size * .72;
    ctx.globalAlpha = .96;
    ctx.shadowColor = color;
    ctx.shadowBlur = size * .09;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    drawOperationHead(ctx, route, color, size * .277, true, targetContactFraction);
    ctx.shadowBlur = 0;

    const timing = firePreviewTiming(time);
    if (timing.tracerVisible) {
      const tracer = routePoint(route, timing.flightProgress * targetContactFraction);
      ctx.shadowColor = color;
      ctx.shadowBlur = size * .18;
      [size * .213, size * .128, size * .064].forEach((radius, index) => {
        ctx.beginPath();
        ctx.arc(tracer.x, tracer.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = .1 + index * .18;
        ctx.fill();
      });
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  function drawFireTargetPulse(ctx, target, size, color, time) {
    const timing = firePreviewTiming(time);
    if (!timing.impactVisible) return;
    const eased = 1 - (1 - timing.impactProgress) * (1 - timing.impactProgress);
    ctx.save();
    ctx.beginPath();
    ctx.arc(target.x, target.y, size * (.54 + eased * .64), 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * (.06 - timing.impactProgress * .025);
    ctx.globalAlpha = (1 - timing.impactProgress) * .76;
    ctx.shadowColor = color;
    ctx.shadowBlur = size * .18;
    ctx.stroke();
    ctx.restore();
  }

  function drawOperationArrow(ctx, points, size, kind, color, time = 0) {
    const anchoredPoints = points.map((point, index) => {
      const isSourceUnit = index === 0;
      const isTargetUnit = index === points.length - 1 && kind !== 'march';
      return isSourceUnit || isTargetUnit ? unitVisualCenter(point, size) : { x: point.x, y: point.y };
    });
    const targetPoint = anchoredPoints[anchoredPoints.length - 1];
    const route = kind === 'fire'
      ? buildRangedPreviewTrajectory(anchoredPoints[0], targetPoint, size)
      : buildOperationRoute(anchoredPoints);
    if (route.length < 2) return;
    const targetContactFraction = kind === 'march' ? 1 : routeFractionBeforeEnd(route, size * .5);
    if (kind === 'march') drawMarchArrow(ctx, route, size, color, time);
    if (kind === 'assault') drawAssaultArrow(ctx, route, size, color, time, targetPoint, targetContactFraction);
    if (kind === 'fire') drawFireArrow(ctx, route, size, color, time, targetContactFraction);
  }

  function drawSourceSelection(ctx, tile, size, kind, color, time) {
    const wave = (Math.sin(time * (kind === 'march' ? 2.1 : 2.65)) + 1) / 2;
    const innerRadius = size * (.66 + wave * .018);
    const outerRadius = size * (.83 + wave * .025);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = size * (.06 + wave * .055);

    ctx.beginPath();
    ctx.arc(tile.x, tile.y, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = .14 + wave * .025;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(tile.x, tile.y, innerRadius * .94, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size * .026);
    ctx.globalAlpha = .28 + wave * .05;
    const spacing = size * .18;
    for (let offset = -size * 1.35; offset <= size * 1.35; offset += spacing) {
      ctx.beginPath();
      ctx.moveTo(tile.x - size, tile.y + offset + size * .7);
      ctx.lineTo(tile.x + size, tile.y + offset - size * .7);
      ctx.stroke();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(tile.x, tile.y, innerRadius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * .082;
    ctx.globalAlpha = .9;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(tile.x, tile.y, outerRadius, 0, Math.PI * 2);
    ctx.lineWidth = size * .055;
    ctx.setLineDash([size * .1, size * .16]);
    ctx.lineDashOffset = -time * size * .12;
    ctx.globalAlpha = .5 + wave * .09;
    ctx.stroke();
    ctx.restore();
  }

  function drawHologramMotif(ctx, center, size, color, motif, active, wave, entryAlpha = 1) {
    const scale = (active ? 1.08 : .94) + wave * (active ? .045 : .025);
    const crispAlpha = active ? .98 : .72 + wave * .1;
    const baseStroke = size * (active ? .052 : .042);

    function drawPass(soft) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';
      ctx.lineWidth = baseStroke * (soft ? 2.2 : 1);
      ctx.globalAlpha = entryAlpha * (soft ? crispAlpha * .2 : crispAlpha);
      ctx.shadowColor = color;
      ctx.shadowBlur = soft ? size * (active ? .24 : .13) : size * (active ? .08 : .025);

      if (motif === 'attack') {
        const inner = size * .105;
        const outer = size * .35;
        ctx.beginPath();
        ctx.moveTo(-outer, 0); ctx.lineTo(-inner, 0);
        ctx.moveTo(inner, 0); ctx.lineTo(outer, 0);
        ctx.moveTo(0, -outer); ctx.lineTo(0, -inner);
        ctx.moveTo(0, inner); ctx.lineTo(0, outer);
        ctx.stroke();
      } else if (motif === 'heal') {
        const length = size * .46;
        const thickness = size * .145;
        ctx.globalAlpha = entryAlpha * (soft ? crispAlpha * .18 : crispAlpha * .94);
        ctx.fillRect(-thickness / 2, -length / 2, thickness, length);
        ctx.fillRect(-length / 2, -thickness / 2, length, thickness);
      } else if (motif === 'march') {
        ctx.lineWidth = size * (active ? .064 : .052) * (soft ? 2.1 : 1);
        for (const y of [-size * .105, size * .135]) {
          ctx.beginPath();
          ctx.moveTo(-size * .21, y + size * .115);
          ctx.lineTo(0, y - size * .095);
          ctx.lineTo(size * .21, y + size * .115);
          ctx.stroke();
        }
      } else if (motif === 'commander') {
        const radius = size * .245;
        ctx.beginPath();
        ctx.moveTo(0, -radius);
        ctx.lineTo(radius * .78, 0);
        ctx.lineTo(0, radius);
        ctx.lineTo(-radius * .78, 0);
        ctx.closePath();
        ctx.stroke();
        if (!soft) {
          ctx.globalAlpha = entryAlpha * crispAlpha * .28;
          ctx.fill();
          ctx.globalAlpha = entryAlpha * crispAlpha;
          ctx.beginPath();
          ctx.moveTo(0, -radius * .48);
          ctx.lineTo(0, radius * .48);
          ctx.stroke();
        }
      } else if (motif === 'shield') {
        const width = size * .25;
        const top = -size * .255;
        ctx.beginPath();
        ctx.moveTo(0, top);
        ctx.bezierCurveTo(width * .42, top + size * .04, width, top + size * .09, width, top + size * .18);
        ctx.bezierCurveTo(width, size * .13, width * .52, size * .25, 0, size * .315);
        ctx.bezierCurveTo(-width * .52, size * .25, -width, size * .13, -width, top + size * .18);
        ctx.bezierCurveTo(-width, top + size * .09, -width * .42, top + size * .04, 0, top);
        ctx.closePath();
        ctx.stroke();
        if (!soft) {
          ctx.globalAlpha = entryAlpha * crispAlpha * .22;
          ctx.fill();
        }
      } else if (motif === 'plane') {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * (active ? .052 : .043) * (soft ? 2.15 : 1);
        ctx.beginPath();
        ctx.moveTo(0, -size * .37);
        ctx.quadraticCurveTo(size * .045, -size * .31, size * .055, -size * .19);
        ctx.lineTo(size * .075, -size * .065);
        ctx.lineTo(size * .36, size * .085);
        ctx.lineTo(size * .36, size * .17);
        ctx.lineTo(size * .075, size * .105);
        ctx.lineTo(size * .055, size * .285);
        ctx.lineTo(size * .16, size * .34);
        ctx.lineTo(size * .16, size * .39);
        ctx.lineTo(0, size * .36);
        ctx.lineTo(-size * .16, size * .39);
        ctx.lineTo(-size * .16, size * .34);
        ctx.lineTo(-size * .055, size * .285);
        ctx.lineTo(-size * .075, size * .105);
        ctx.lineTo(-size * .36, size * .17);
        ctx.lineTo(-size * .36, size * .085);
        ctx.lineTo(-size * .075, -size * .065);
        ctx.lineTo(-size * .055, -size * .19);
        ctx.quadraticCurveTo(-size * .045, -size * .31, 0, -size * .37);
        ctx.closePath();
        ctx.stroke();
        if (!soft) {
          ctx.globalAlpha = entryAlpha * crispAlpha * .16;
          ctx.fill();
        }
      } else if (motif === 'paratrooper') {
        const radius = size * .235;
        ctx.beginPath();
        ctx.arc(0, -size * .105, radius, Math.PI, 0);
        ctx.moveTo(-radius, -size * .105);
        ctx.lineTo(-size * .085, size * .105);
        ctx.moveTo(radius, -size * .105);
        ctx.lineTo(size * .085, size * .105);
        ctx.moveTo(0, -size * .34);
        ctx.lineTo(0, size * .105);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, size * .145, size * .055, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, size * .2);
        ctx.lineTo(0, size * .34);
        ctx.moveTo(-size * .11, size * .25);
        ctx.lineTo(size * .11, size * .25);
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.scale(scale, scale);
    ctx.globalCompositeOperation = 'screen';
    drawPass(true);
    drawPass(false);
    ctx.restore();
  }

  function drawTargetReticle(ctx, tile, size, color, time, active) {
    drawTargetingFrame(ctx, tile, size, color, time, active, 'attack');
  }

  const TARGETING_PROFILES = {
    attack: {
      color: '#e95b50', title: '敌方单位目标',
      contract: 'attackableTiles / enemyGlobal',
      note: '红色角框中央保留四臂准星；悬停时角框放大并增强全息辉光。',
      motif: 'attack'
    },
    heal: {
      color: '#62d98b', title: '疗愈单位目标',
      contract: 'heal · anyUnit（当前规则：敌我皆可）',
      note: '绿色粗实心十字常驻角框中央，以全息软边保留单位球体可读性。',
      motif: 'heal'
    },
    forceMarch: {
      color: '#58c9b3', title: '机动增益目标',
      contract: 'forceMarch · friendlyAny',
      note: '两个向上的折形符号垂直叠放在角框中央，作为增益类统一图案。',
      motif: 'march'
    },
    commanderDeploy: {
      color: '#d9b55c', title: '将领挂载目标',
      contract: 'commanderDeploy · friendlyAny · 无将领单位',
      note: '任务金角框中央使用军衔菱形与挂载竖线；已挂载单位不进入候选。',
      motif: 'commander'
    },
    shield: {
      color: '#7fbaff', title: '护盾单位目标',
      contract: 'shield · shieldTarget（当前规则：敌我皆可）',
      note: '冷蓝盾形符号位于角框中央；预览只表达目标语义，不修改护盾值。',
      motif: 'shield'
    },
    tileDeploy: {
      color: '#69c7e8', title: '地块部署目标',
      contract: 'engineer_bunker · 相邻 emptyTile',
      note: '青蓝落点插槽与半透明占位轮廓表达施工位置，不使用单位瞄准框。',
      motif: 'placement'
    },
    area: {
      color: '#a0c8ff', title: '区域中心目标',
      contract: 'scout · anyTileGlobal',
      note: '高对比中心刻度标出全部合法格；悬停后再展开目标及周围六格边界。',
      motif: 'area'
    }
  };

  let targetingHitRegions = [];

  function drawTargetingFrame(ctx, tile, size, color, time, active, motif, origin = null) {
    const center = unitVisualCenter(tile, size);
    const entry = previewEntry(tile, origin, time);
    const frameSize = size * entry.scale;
    const wave = (Math.sin(time * 2.15 + tile.q * .48 + tile.r * .31) + 1) / 2;
    const half = frameSize * ((active ? .72 : .665) + wave * (active ? .038 : .018));
    const arm = frameSize * (active ? .225 : .19);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = frameSize * (active ? .058 : .044);
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.globalAlpha = entry.alpha * (active ? .99 : .7 + wave * .12);
    ctx.shadowColor = color;
    ctx.shadowBlur = active ? frameSize * (.18 + wave * .1) : frameSize * (.04 + wave * .035);
    for (const [sx, sy] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      ctx.beginPath();
      ctx.moveTo(center.x + sx * (half - arm), center.y + sy * half);
      ctx.lineTo(center.x + sx * half, center.y + sy * half);
      ctx.lineTo(center.x + sx * half, center.y + sy * (half - arm));
      ctx.stroke();
    }
    ctx.restore();
    drawHologramMotif(ctx, center, frameSize, color, motif, active, wave, entry.alpha);
  }

  function drawAreaCenterTarget(ctx, tile, size, color, time, active, origin = null) {
    const entry = previewEntry(tile, origin, time);
    size *= entry.scale;
    const wave = (Math.sin(time * 3.1 + tile.q * .64 - tile.r * .41) + 1) / 2;
    const half = size * (active ? .56 + wave * .025 : .34);
    const arm = size * (active ? .18 : .11);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = size * (active ? .045 : .03);
    ctx.globalAlpha = entry.alpha * (active ? .94 : .5);
    ctx.lineCap = 'square';
    ctx.shadowColor = color;
    ctx.shadowBlur = active ? size * .13 : size * .025;
    for (const [sx, sy] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      ctx.beginPath();
      ctx.moveTo(tile.x + sx * (half - arm), tile.y + sy * half);
      ctx.lineTo(tile.x + sx * half, tile.y + sy * half);
      ctx.lineTo(tile.x + sx * half, tile.y + sy * (half - arm));
      ctx.stroke();
    }
    if (active) {
      ctx.shadowBlur = 0;
      ctx.globalAlpha = entry.alpha * .82;
      ctx.beginPath();
      ctx.moveTo(tile.x - size * .12, tile.y);
      ctx.lineTo(tile.x + size * .12, tile.y);
      ctx.moveTo(tile.x, tile.y - size * .12);
      ctx.lineTo(tile.x, tile.y + size * .12);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlacementSocket(ctx, tile, size, color, time, active, origin = null) {
    const entry = previewEntry(tile, origin, time);
    size *= entry.scale;
    const wave = (Math.sin(time * 3 + tile.q * .8 - tile.r * .45) + 1) / 2;
    ctx.save();
    hexPath(ctx, tile.x, tile.y, size * .88);
    ctx.fillStyle = color;
    ctx.globalAlpha = entry.alpha * (active ? .12 : .085);
    ctx.fill();
    ctx.globalAlpha = entry.alpha * (active ? .88 : .62);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * (active ? .045 : .036);
    ctx.shadowColor = color;
    ctx.shadowBlur = active ? size * .1 : size * .025;
    ctx.setLineDash([size * .12, size * .105]);
    ctx.lineDashOffset = active ? -time * size * .34 : 0;
    ctx.stroke();
    ctx.setLineDash([]);

    const half = size * (active ? .5 + wave * .035 : .47);
    const arm = size * .16;
    for (const [sx, sy] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      ctx.beginPath();
      ctx.moveTo(tile.x + sx * (half - arm), tile.y + sy * half);
      ctx.lineTo(tile.x + sx * half, tile.y + sy * half);
      ctx.lineTo(tile.x + sx * half, tile.y + sy * (half - arm));
      ctx.stroke();
    }

    if (active) {
      ctx.globalAlpha = entry.alpha * .52;
      ctx.fillStyle = color;
      ctx.strokeStyle = '#dff7ff';
      ctx.lineWidth = size * .025;
      ctx.beginPath();
      ctx.rect(tile.x - size * .28, tile.y - size * .08, size * .56, size * .3);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tile.x - size * .32, tile.y - size * .08);
      ctx.lineTo(tile.x, tile.y - size * .28);
      ctx.lineTo(tile.x + size * .32, tile.y - size * .08);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = entry.alpha * .76;
      ctx.beginPath();
      ctx.arc(tile.x, tile.y + size * .06, size * .055, 0, Math.PI * 2);
      ctx.fillStyle = '#e6fbff';
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTargetingModePlate(ctx, width, height, profile) {
    const x = width * .028;
    const y = height * .045;
    const plateWidth = Math.min(width * .4, 430);
    const plateHeight = Math.min(76, height * .19);
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,9,.88)';
    ctx.fillRect(x, y, plateWidth, plateHeight);
    ctx.fillStyle = profile.color;
    ctx.fillRect(x, y, 4, plateHeight);
    ctx.fillStyle = '#eadfca';
    ctx.font = '800 13px "Palatino Linotype", serif';
    ctx.textBaseline = 'top';
    ctx.fillText(profile.title, x + 16, y + 12);
    ctx.fillStyle = profile.color;
    ctx.font = '700 9px ui-monospace, "Cascadia Mono", monospace';
    ctx.fillText(profile.contract, x + 16, y + 33);
    ctx.fillStyle = '#8d8370';
    ctx.font = '600 9px "Microsoft YaHei", sans-serif';
    ctx.fillText(profile.note, x + 16, y + 51, plateWidth - 28);
    ctx.restore();
  }

  function renderTargetingPreview(time = state.interactionElapsed) {
    const { ctx, width, height } = prepareCanvas(targetingCanvas);
    ctx.clearRect(0, 0, width, height);
    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#171914');
    background.addColorStop(1, '#0c0e0d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const grid = buildSystemGrid(width, height);
    const friendlyPalette = PALETTES[state.palette];
    for (const tile of grid.tiles) drawTileBase(ctx, tile, grid.size, tile.q >= 1 ? PALETTES.blue : friendlyPalette);
    for (const tile of grid.tiles) drawGrass(ctx, tile, grid.size);
    for (const tile of grid.tiles) drawHexOutline(ctx, tile, grid.size);

    const unitSpecs = [
      { key: '-2,0', side: 'friendly', health: .82, commander: true },
      { key: '-1,-1', side: 'friendly', health: .44, commander: false },
      { key: '0,1', side: 'friendly', health: .7, commander: false },
      { key: '1,-1', side: 'enemy', health: .68, commander: false },
      { key: '2,0', side: 'enemy', health: .36, commander: false },
      { key: '1,1', side: 'enemy', health: .9, commander: false }
    ].map(spec => ({ ...spec, tile: grid.tileMap.get(spec.key) })).filter(spec => spec.tile);

    const profile = TARGETING_PROFILES[state.targeting] || TARGETING_PROFILES.attack;
    let legalKeys;
    if (state.targeting === 'attack') legalKeys = unitSpecs.filter(spec => spec.side === 'enemy').map(spec => spec.key);
    else if (state.targeting === 'heal') legalKeys = unitSpecs.map(spec => spec.key);
    else if (state.targeting === 'forceMarch') legalKeys = unitSpecs.filter(spec => spec.side === 'friendly').map(spec => spec.key);
    else if (state.targeting === 'commanderDeploy') legalKeys = unitSpecs.filter(spec => spec.side === 'friendly' && !spec.commander).map(spec => spec.key);
    else if (state.targeting === 'shield') legalKeys = unitSpecs.map(spec => spec.key);
    else if (state.targeting === 'area') legalKeys = grid.tiles.map(tile => tileKey(tile.q, tile.r));
    else legalKeys = ['-1,0', '-2,1', '-3,1'].filter(key => grid.tileMap.has(key));
    const legalSet = new Set(legalKeys);
    const hoverKey = legalSet.has(state.targetingHoverKey) ? state.targetingHoverKey : null;
    const selectionOrigin = grid.tileMap.get('-2,0');

    if (state.targeting === 'tileDeploy') {
      const engineerTile = selectionOrigin;
      if (engineerTile) drawSourceSelection(ctx, engineerTile, grid.size, 'march', profile.color, time);
      for (const key of legalKeys) {
        const tile = grid.tileMap.get(key);
        if (tile) drawPlacementSocket(ctx, tile, grid.size, profile.color, time, key === hoverKey, selectionOrigin);
      }
    } else if (state.targeting === 'area') {
      const centerTile = grid.tileMap.get(hoverKey);
      if (centerTile) {
        const affectedKeys = grid.tiles
          .filter(tile => Math.max(Math.abs(tile.q - centerTile.q), Math.abs(tile.r - centerTile.r), Math.abs((tile.q + tile.r) - (centerTile.q + centerTile.r))) <= 1)
          .map(tile => tileKey(tile.q, tile.r));
        drawConnectedRegion(ctx, grid, affectedKeys, profile.color, state.interactionMotion ? time : Infinity, selectionOrigin);
      }
    }

    for (const spec of unitSpecs) {
      const palette = spec.side === 'friendly' ? friendlyPalette : PALETTES.blue;
      drawUnit(ctx, spec.tile, grid.size, palette, {
        healthStyle: 'dial', health: spec.health,
        relation: spec.side === 'friendly' ? 'self' : 'enemy', shield: 0
      });
    }

    if (state.targeting === 'area') {
      for (const key of legalKeys) {
        const tile = grid.tileMap.get(key);
        if (tile) drawAreaCenterTarget(ctx, tile, grid.size, profile.color, time, key === hoverKey, selectionOrigin);
      }
    } else if (state.targeting !== 'tileDeploy') {
      for (const key of legalKeys) {
        const spec = unitSpecs.find(item => item.key === key);
        if (spec) drawTargetingFrame(ctx, spec.tile, grid.size, profile.color, time, key === hoverKey, profile.motif, selectionOrigin);
      }
    }

    drawTargetingModePlate(ctx, width, height, profile);

    targetingHitRegions = legalKeys.map(key => {
      const tile = grid.tileMap.get(key);
      return tile ? { key, x: tile.x, y: tile.y, radius: grid.size * (state.targeting === 'area' ? .56 : .78) } : null;
    }).filter(Boolean);
  }

  const AIR_TARGETING_PROFILES = {
    airstrike: {
      color: '#e95b50', title: '空袭 · 红色区域中心',
      contract: 'airstrike · enemyGlobal · 中心 + 周围 6 格',
      note: '全图可见敌军均可作为区域中心；无上校航程限制，防空只降低伤害。'
    },
    airdrop: {
      color: '#69c7e8', title: '空降 · 伞兵落点',
      contract: 'airdrop · emptyTile',
      note: '全图可见空地均可选择；防空覆盖不禁选，但会降低空降步兵生命。'
    },
    diveStrafe: {
      color: '#e95b50', title: '扫射 · 攻击角框',
      contract: 'diveStrafe · enemyGlobal · 上校 6 格',
      note: '仅航程内可见敌军显示攻击准星；防空覆盖不禁选，只降低伤害。'
    },
    carpetBomb: {
      color: '#e95b50', title: '轰炸 · 红色区域中心',
      contract: 'carpetBomb · enemyGlobal · 上校 6 格',
      note: '航程内可见敌军才是合法中心；悬停展开中心及周围六格。'
    },
    airliftPickup: {
      color: '#69c7e8', title: '空运第一段 · 伞兵拾取',
      contract: 'airlift · friendlyAny · 上校 6 格',
      note: '排除上校自身与被禁锢单位；伞兵徽章复用于单位拾取语义。'
    },
    airliftDestination: {
      color: '#69c7e8', title: '空运第二段 · 伞兵落点',
      contract: 'airlift_dest · emptyTile · 上校 6 格',
      note: '仅航程内可见空地合法；防空不阻止落点，但会造成额外生命损失。'
    }
  };

  let airTargetingHitRegions = [];
  let airStaticSceneCache = null;

  function airDistance(a, b) {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  }

  function buildAirGrid(width, height) {
    const size = Math.min(width / 25, height / 10.5);
    const originX = width * .5;
    const originY = height * .51;
    const tiles = [];
    for (let r = -3; r <= 3; r++) {
      for (let q = -6; q <= 6; q++) {
        if (Math.abs(q + r) > 7) continue;
        const point = axialToPixel(q, r, size, originX, originY);
        tiles.push({ q, r, x: point.x, y: point.y, terrain: 'plains', camp: 'selected', visible: q <= 4 });
      }
    }
    return { size, tiles, tileMap: new Map(tiles.map(tile => [tileKey(tile.q, tile.r), tile])) };
  }

  function getAirStaticScene(width, height) {
    const dpr = airTargetingCanvas.width / Math.max(1, width);
    const key = [
      Math.round(width), Math.round(height), dpr.toFixed(2), state.palette,
      state.style, state.texture.toFixed(3), state.grid ? 1 : 0
    ].join('|');
    if (airStaticSceneCache?.key === key) return airStaticSceneCache;

    const grid = buildAirGrid(width, height);
    const unitSpecs = [
      { key: '-4,0', side: 'friendly', health: .88, colonel: true },
      { key: '-2,-1', side: 'friendly', health: .72, pickup: true },
      { key: '-2,2', side: 'friendly', health: .61 },
      { key: '-1,1', side: 'friendly', health: .55, imprisoned: true },
      { key: '3,2', side: 'friendly', health: .76 },
      { key: '0,-2', side: 'enemy', health: .64 },
      { key: '2,0', side: 'enemy', health: .48 },
      { key: '1,1', side: 'enemy', health: .82, antiAir: true },
      { key: '4,-1', side: 'enemy', health: .7, antiAir: true },
      { key: '4,-2', side: 'enemy', health: .42 },
      { key: '3,-3', side: 'enemy', health: .68, flak: true },
      { key: '5,-2', side: 'enemy', health: .9 }
    ].map(spec => ({ ...spec, tile: grid.tileMap.get(spec.key) })).filter(spec => spec.tile);
    const antiAirSpecs = unitSpecs.filter(spec => spec.antiAir);
    const flakSpecs = unitSpecs.filter(spec => spec.flak);
    const antiAirLayerByKey = new Map();
    for (const tile of grid.tiles) {
      let layers = flakSpecs.some(spec => spec.key === tileKey(tile.q, tile.r)) ? 1 : 0;
      for (const spec of antiAirSpecs) {
        if (airDistance(spec.tile, tile) <= 2) layers++;
        if (layers >= 2) break;
      }
      if (layers > 0) antiAirLayerByKey.set(tileKey(tile.q, tile.r), Math.min(2, layers));
    }

    const backing = document.createElement('canvas');
    backing.width = airTargetingCanvas.width;
    backing.height = airTargetingCanvas.height;
    const staticCtx = backing.getContext('2d');
    staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const background = staticCtx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#151914');
    background.addColorStop(1, '#0b0e0d');
    staticCtx.fillStyle = background;
    staticCtx.fillRect(0, 0, width, height);
    const friendlyPalette = PALETTES[state.palette];
    for (const tile of grid.tiles) drawTileBase(staticCtx, tile, grid.size, tile.q >= 0 ? PALETTES.blue : friendlyPalette);
    for (const tile of grid.tiles) drawGrass(staticCtx, tile, grid.size);
    for (const tile of grid.tiles) drawHexOutline(staticCtx, tile, grid.size);

    airStaticSceneCache = {
      key, backing, grid, unitSpecs, antiAirSpecs, flakSpecs, antiAirLayerByKey,
      coverageLayers: new Map()
    };
    return airStaticSceneCache;
  }

  function getAirCoverageLayer(scene, isColonelMode, colonel) {
    const cacheKey = isColonelMode ? 'colonel' : 'global';
    if (scene.coverageLayers.has(cacheKey)) return scene.coverageLayers.get(cacheKey);
    const { grid, antiAirLayerByKey } = scene;
    const backing = document.createElement('canvas');
    backing.width = airTargetingCanvas.width;
    backing.height = airTargetingCanvas.height;
    const width = airTargetingCanvas.getBoundingClientRect().width;
    const dpr = backing.width / Math.max(1, width);
    const layerCtx = backing.getContext('2d');
    layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const antiAirKeys = new Set(antiAirLayerByKey.keys());
    drawAirRegion(layerCtx, grid, antiAirKeys, '#c83b36', '#ff746a', .045, grid.size * .042);
    drawAntiAirTierTexture(layerCtx, grid, antiAirLayerByKey);
    if (isColonelMode && colonel) {
      const rangeKeys = new Set(grid.tiles
        .filter(tile => airDistance(colonel, tile) <= 6)
        .map(tile => tileKey(tile.q, tile.r)));
      drawAirRegion(layerCtx, grid, rangeKeys, '#4ea7d8', '#79c9ff', .025, grid.size * .05);
    }
    scene.coverageLayers.set(cacheKey, backing);
    return backing;
  }

  function drawAirRegion(ctx, grid, keys, fillColor, strokeColor, fillAlpha, lineWidth, time = Infinity, origin = null) {
    const keySet = keys instanceof Set ? keys : new Set(keys);
    ctx.save();
    // Range geometry is a projection onto existing render tiles. Clipping the
    // complete pass also contains glow/blur that would otherwise leak past an
    // outer tile even when no out-of-board edge is explicitly stroked.
    clipToGrid(ctx, grid);
    ctx.fillStyle = fillColor;
    for (const key of keySet) {
      const tile = grid.tileMap.get(key);
      if (!tile) continue;
      const entry = previewEntry(tile, origin, time);
      ctx.globalAlpha = fillAlpha * entry.alpha;
      hexPath(ctx, tile.x, tile.y, grid.size * .965);
      ctx.fill();
    }
    const groupEntry = previewEntry(origin || grid.tiles[0], origin || grid.tiles[0], time);
    ctx.globalAlpha = .92 * groupEntry.alpha;
    ctx.beginPath();
    for (const key of keySet) {
      const tile = grid.tileMap.get(key);
      if (!tile) continue;
      HEX_DIRECTIONS.forEach((direction, index) => {
        const neighborKey = tileKey(tile.q + direction.q, tile.r + direction.r);
        if (!grid.tileMap.has(neighborKey) || keySet.has(neighborKey)) return;
        const a = hexPoint(tile.x, tile.y, grid.size * .97, index);
        const b = hexPoint(tile.x, tile.y, grid.size * .97, (index + 1) % 6);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      });
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = strokeColor;
    ctx.shadowBlur = grid.size * .1;
    ctx.stroke();
    ctx.restore();
  }

  function drawAntiAirSource(ctx, tile, size, time, origin = null) {
    const entry = previewEntry(tile, origin, time);
    const wave = (Math.sin(time * 2.2 + tile.q * .5) + 1) / 2;
    ctx.save();
    ctx.translate(tile.x, tile.y - size * .78);
    ctx.fillStyle = '#ff6e61';
    ctx.strokeStyle = '#ffe0dc';
    ctx.lineWidth = Math.max(1, size * .025);
    ctx.globalAlpha = entry.alpha * (.82 + wave * .18);
    ctx.shadowColor = '#ff4636';
    ctx.shadowBlur = size * (.1 + wave * .08);
    ctx.beginPath();
    ctx.moveTo(0, -size * .14);
    ctx.lineTo(size * .16, size * .13);
    ctx.lineTo(-size * .16, size * .13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -size * .055);
    ctx.lineTo(0, size * .045);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, size * .09, size * .018, 0, Math.PI * 2);
    ctx.fillStyle = '#fff1ed';
    ctx.fill();
    ctx.restore();
  }

  function drawAntiAirTierTexture(ctx, grid, layerByKey, time = Infinity, origin = null) {
    ctx.save();
    clipToGrid(ctx, grid);
    ctx.strokeStyle = '#ffb4aa';
    ctx.lineWidth = Math.max(1, grid.size * .025);
    for (const [key, layers] of layerByKey) {
      const tile = grid.tileMap.get(key);
      if (!tile) continue;
      const entry = previewEntry(tile, origin, time);
      ctx.save();
      ctx.globalAlpha = .38 * entry.alpha;
      hexPath(ctx, tile.x, tile.y, grid.size * .89);
      ctx.clip();
      for (let offset = -grid.size * 1.4; offset <= grid.size * 1.4; offset += grid.size * .27) {
        ctx.beginPath();
        ctx.moveTo(tile.x - grid.size * 1.1, tile.y + offset);
        ctx.lineTo(tile.x + grid.size * 1.1, tile.y + offset - grid.size * 1.28);
        ctx.stroke();
        if (layers >= 2) {
          ctx.beginPath();
          ctx.moveTo(tile.x - grid.size * 1.1, tile.y - offset);
          ctx.lineTo(tile.x + grid.size * 1.1, tile.y - offset + grid.size * 1.28);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawParatrooperTileTarget(ctx, tile, size, color, time, active, origin = null) {
    const entry = previewEntry(tile, origin, time);
    size *= entry.scale;
    const wave = (Math.sin(time * 2.15 + tile.q * .38 - tile.r * .27) + 1) / 2;
    const half = size * ((active ? .56 : .44) + wave * (active ? .035 : .018));
    const arm = size * (active ? .18 : .135);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = size * (active ? .05 : .034);
    ctx.globalAlpha = entry.alpha * (active ? .98 : .64 + wave * .14);
    ctx.shadowColor = color;
    ctx.shadowBlur = active ? size * (.16 + wave * .08) : size * .035;
    ctx.lineCap = 'square';
    for (const [sx, sy] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      ctx.beginPath();
      ctx.moveTo(tile.x + sx * (half - arm), tile.y + sy * half);
      ctx.lineTo(tile.x + sx * half, tile.y + sy * half);
      ctx.lineTo(tile.x + sx * half, tile.y + sy * (half - arm));
      ctx.stroke();
    }
    ctx.restore();
    drawHologramMotif(ctx, { x: tile.x, y: tile.y }, size * .72, color, 'paratrooper', active, wave, entry.alpha);
  }

  function drawAirliftLink(ctx, startTile, endTile, size, color, time) {
    if (!startTile || !endTile) return;
    const route = buildRangedPreviewTrajectory(unitVisualCenter(startTile, size), { x: endTile.x, y: endTile.y }, size);
    if (route.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    traceOperationRoute(ctx, route);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * .07;
    ctx.setLineDash([size * .14, size * .18]);
    ctx.lineDashOffset = -time * size * .55;
    ctx.globalAlpha = .9;
    ctx.shadowColor = color;
    ctx.shadowBlur = size * .09;
    ctx.stroke();
    ctx.restore();
  }

  function drawAirOriginHologram(ctx, tile, size, color, time) {
    if (!tile) return;
    const entry = previewEntry(tile, tile, time);
    const wave = (Math.sin(time * 2.4) + 1) / 2;
    drawHologramMotif(ctx, unitVisualCenter(tile, size), size * .78 * entry.scale, color, 'plane', true, wave, entry.alpha);
  }

  function renderAirTargetingPreview(time = state.interactionElapsed) {
    const { ctx, width, height } = prepareCanvas(airTargetingCanvas);
    ctx.clearRect(0, 0, width, height);
    const staticScene = getAirStaticScene(width, height);
    ctx.drawImage(staticScene.backing, 0, 0, width, height);
    const {
      grid, unitSpecs, antiAirSpecs, flakSpecs, antiAirLayerByKey
    } = staticScene;
    const friendlyPalette = PALETTES[state.palette];
    const unitByKey = new Map(unitSpecs.map(spec => [spec.key, spec]));
    const colonel = unitSpecs.find(spec => spec.colonel)?.tile;
    const pickupSource = unitSpecs.find(spec => spec.pickup)?.tile;
    const profile = AIR_TARGETING_PROFILES[state.airTargeting] || AIR_TARGETING_PROFILES.airstrike;
    const isColonelMode = ['diveStrafe', 'carpetBomb', 'airliftPickup', 'airliftDestination'].includes(state.airTargeting);
    const airEntryOrigin = isColonelMode ? colonel : null;

    const coverageEntry = previewEntry(
      airEntryOrigin || grid.tiles[0],
      airEntryOrigin || grid.tiles[0],
      time
    );
    ctx.save();
    ctx.globalAlpha = coverageEntry.alpha;
    ctx.drawImage(getAirCoverageLayer(staticScene, isColonelMode, colonel), 0, 0, width, height);
    ctx.restore();

    let legalKeys = [];
    const visibleEnemies = unitSpecs.filter(spec => spec.side === 'enemy' && spec.tile.visible);
    if (state.airTargeting === 'airstrike') {
      legalKeys = visibleEnemies.map(spec => spec.key);
    } else if (state.airTargeting === 'diveStrafe' || state.airTargeting === 'carpetBomb') {
      legalKeys = visibleEnemies.filter(spec => colonel && airDistance(colonel, spec.tile) <= 6).map(spec => spec.key);
    } else if (state.airTargeting === 'airliftPickup') {
      legalKeys = unitSpecs
        .filter(spec => spec.side === 'friendly' && spec.tile.visible && !spec.colonel && !spec.imprisoned && colonel && airDistance(colonel, spec.tile) <= 6)
        .map(spec => spec.key);
    } else {
      legalKeys = grid.tiles
        .filter(tile => tile.visible && !unitByKey.has(tileKey(tile.q, tile.r))
          && (state.airTargeting === 'airdrop' || (colonel && airDistance(colonel, tile) <= 6)))
        .map(tile => tileKey(tile.q, tile.r));
    }
    const legalSet = new Set(legalKeys);
    const hoverKey = legalSet.has(state.airTargetingHoverKey) ? state.airTargetingHoverKey : null;
    const hoverTile = grid.tileMap.get(hoverKey);

    if ((state.airTargeting === 'airstrike' || state.airTargeting === 'carpetBomb') && hoverTile) {
      const affected = new Set(grid.tiles.filter(tile => airDistance(hoverTile, tile) <= 1).map(tile => tileKey(tile.q, tile.r)));
      drawAirRegion(ctx, grid, affected, '#ee453c', '#ffd1cc', .17, grid.size * .072, time, airEntryOrigin);
    }
    if (state.airTargeting === 'airliftDestination' && hoverTile) {
      drawAirliftLink(ctx, pickupSource, hoverTile, grid.size, profile.color, time);
    }

    // Only colonel cards have a real board origin in the current rules. Global
    // airstrike/airdrop previews deliberately do not invent one.
    const airOrigin = isColonelMode ? colonel : null;
    if (airOrigin) drawSourceSelection(ctx, airOrigin, grid.size, 'fire', profile.color, time);

    for (const spec of unitSpecs) {
      const palette = spec.side === 'friendly' ? friendlyPalette : PALETTES.blue;
      drawUnit(ctx, spec.tile, grid.size, palette, {
        healthStyle: 'dial', health: spec.health,
        relation: spec.side === 'friendly' ? 'self' : 'enemy', shield: 0
      });
    }
    drawAirOriginHologram(ctx, airOrigin, grid.size, profile.color, time);
    for (const spec of antiAirSpecs) drawAntiAirSource(ctx, spec.tile, grid.size, time, airEntryOrigin);
    for (const spec of flakSpecs) drawAntiAirSource(ctx, spec.tile, grid.size, time, airEntryOrigin);

    if (state.airTargeting === 'airstrike' || state.airTargeting === 'carpetBomb') {
      for (const key of legalKeys) {
        const spec = unitByKey.get(key);
        if (spec) drawAreaCenterTarget(ctx, spec.tile, grid.size, profile.color, time, key === hoverKey, airEntryOrigin);
      }
    } else if (state.airTargeting === 'diveStrafe') {
      for (const key of legalKeys) {
        const spec = unitByKey.get(key);
        if (spec) drawTargetingFrame(ctx, spec.tile, grid.size, profile.color, time, key === hoverKey, 'attack', airEntryOrigin);
      }
    } else if (state.airTargeting === 'airliftPickup') {
      for (const key of legalKeys) {
        const spec = unitByKey.get(key);
        if (spec) drawTargetingFrame(ctx, spec.tile, grid.size, profile.color, time, key === hoverKey, 'paratrooper', airEntryOrigin);
      }
    } else {
      for (const key of legalKeys) {
        const tile = grid.tileMap.get(key);
        if (tile) drawParatrooperTileTarget(ctx, tile, grid.size, profile.color, time, key === hoverKey, airEntryOrigin);
      }
      if (state.airTargeting === 'airliftDestination' && pickupSource) {
        drawTargetingFrame(ctx, pickupSource, grid.size, profile.color, time, true, 'paratrooper', airEntryOrigin);
      }
    }

    for (const tile of grid.tiles) {
      if (tile.visible) continue;
      ctx.save();
      hexPath(ctx, tile.x, tile.y, grid.size * .99);
      ctx.fillStyle = 'rgba(5,8,8,.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(95,116,116,.2)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    drawTargetingModePlate(ctx, width, height, profile);
    airTargetingHitRegions = legalKeys.map(key => {
      const tile = grid.tileMap.get(key);
      return tile ? { key, x: tile.x, y: tile.y, radius: grid.size * .58 } : null;
    }).filter(Boolean);
  }

  function renderInteractionPreview(time = state.interactionElapsed) {
    const { ctx, width, height } = prepareCanvas(interactionCanvas, 1.48);
    ctx.clearRect(0, 0, width, height);
    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#171914');
    background.addColorStop(1, '#0d0f0d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    const grid = buildSystemGrid(width, height);
    const palette = PALETTES[state.palette];
    for (const tile of grid.tiles) drawTileBase(ctx, tile, grid.size, palette);
    for (const tile of grid.tiles) drawGrass(ctx, tile, grid.size);
    for (const tile of grid.tiles) drawHexOutline(ctx, tile, grid.size);

    const source = grid.tileMap.get('-2,0');
    const moveDestination = grid.tileMap.get('1,-1');
    const enemyA = grid.tileMap.get('2,-1');
    const enemyB = grid.tileMap.get('1,1');
    const moveKeys = ['-3,0','-3,1','-2,-1','-2,0','-2,1','-1,-2','-1,-1','-1,0','-1,1','0,-2','0,-1','0,0','0,1','1,-1','1,0'];

    if (state.interaction === 'march') {
      drawConnectedRegion(ctx, grid, moveKeys, '#58c9b3', state.interactionMotion ? time : Infinity, source);
      drawOperationArrow(ctx, [source, grid.tileMap.get('-1,0'), grid.tileMap.get('0,-1'), moveDestination], grid.size, 'march', '#58c9b3', time);
      drawSourceSelection(ctx, source, grid.size, 'march', '#58c9b3', time);
      drawUnit(ctx, source, grid.size, palette, { healthStyle: 'dial', health: .84, relation: 'self', shield: 0 });
    } else if (state.interaction === 'assault') {
      drawOperationArrow(ctx, [source, enemyA], grid.size, 'assault', '#e95b50', time);
      drawSourceSelection(ctx, source, grid.size, 'assault', '#e95b50', time);
      drawUnit(ctx, source, grid.size, palette, { healthStyle: 'dial', health: .84, relation: 'self', shield: 0 });
      drawUnit(ctx, enemyA, grid.size, PALETTES.blue, { healthStyle: 'dial', health: .72, relation: 'enemy', shield: 0 });
      drawUnit(ctx, enemyB, grid.size, PALETTES.blue, { healthStyle: 'dial', health: .46, relation: 'enemy', shield: 0 });
      drawTargetReticle(ctx, enemyA, grid.size, '#e95b50', time, true);
      drawTargetReticle(ctx, enemyB, grid.size, '#e95b50', time, false);
    } else if (state.interaction === 'fire') {
      drawOperationArrow(ctx, [source, enemyA], grid.size, 'fire', '#e95b50', time);
      drawSourceSelection(ctx, source, grid.size, 'fire', '#e95b50', time);
      drawUnit(ctx, source, grid.size, palette, { healthStyle: 'dial', health: .84, relation: 'self', shield: 0 });
      drawUnit(ctx, enemyA, grid.size, PALETTES.blue, { healthStyle: 'dial', health: .72, relation: 'enemy', shield: 0 });
      drawUnit(ctx, enemyB, grid.size, PALETTES.blue, { healthStyle: 'dial', health: .46, relation: 'enemy', shield: 0 });
      drawTargetReticle(ctx, enemyA, grid.size, '#e95b50', time, true);
      drawTargetReticle(ctx, enemyB, grid.size, '#e95b50', time, false);
      drawFireTargetPulse(ctx, unitVisualCenter(enemyA, grid.size), grid.size, '#e95b50', time);
    }
  }

  function drawWaterSurface(ctx, tile, size, deep) {
    ctx.save();
    hexPath(ctx, tile.x, tile.y, size * 1.015);
    ctx.clip();
    const gradient = ctx.createLinearGradient(tile.x - size, tile.y - size, tile.x + size, tile.y + size);
    gradient.addColorStop(0, deep ? '#314f5a' : '#557477');
    gradient.addColorStop(.55, deep ? '#243e49' : '#45686c');
    gradient.addColorStop(1, deep ? '#182f3a' : '#355a61');
    ctx.fillStyle = gradient;
    ctx.fillRect(tile.x - size, tile.y - size, size * 2, size * 2);
    ctx.strokeStyle = deep ? 'rgba(158,204,211,.18)' : 'rgba(196,224,215,.25)';
    ctx.lineWidth = Math.max(.8, size * .018);
    for (let row = -2; row <= 2; row++) {
      const y = tile.y + row * size * .28 + seeded(tile, 90 + row) * size * .08;
      ctx.beginPath();
      ctx.moveTo(tile.x - size * .8, y);
      ctx.quadraticCurveTo(tile.x - size * .3, y - size * .08, tile.x + size * .12, y);
      ctx.quadraticCurveTo(tile.x + size * .47, y + size * .06, tile.x + size * .78, y - size * .025);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCoastEdge(ctx, tile, size, index) {
    const a = hexPoint(tile.x, tile.y, size, index);
    const b = hexPoint(tile.x, tile.y, size, (index + 1) % 6);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(35,29,21,.92)';
    ctx.lineWidth = size * .12;
    ctx.stroke();
    ctx.strokeStyle = '#d5c89f';
    ctx.lineWidth = size * .035;
    ctx.stroke();
    ctx.setLineDash([size * .11, size * .075]);
    ctx.lineDashOffset = size * .05;
    ctx.strokeStyle = 'rgba(209,235,224,.78)';
    ctx.lineWidth = size * .027;
    ctx.stroke();
    ctx.restore();
  }

  function drawRiver(ctx, points, size) {
    if (points.length < 2) return;
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    trace();
    ctx.strokeStyle = 'rgba(38,39,32,.72)';
    ctx.lineWidth = size * .18;
    ctx.stroke();
    trace();
    ctx.strokeStyle = '#496d73';
    ctx.lineWidth = size * .12;
    ctx.stroke();
    trace();
    ctx.strokeStyle = 'rgba(185,219,214,.48)';
    ctx.lineWidth = size * .026;
    ctx.stroke();

    const bridgeIndex = Math.min(3, points.length - 2);
    const a = points[bridgeIndex];
    const b = points[bridgeIndex + 1];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    ctx.strokeStyle = '#3d3021';
    ctx.lineWidth = size * .22;
    ctx.beginPath();
    ctx.moveTo(midX - nx * size * .28, midY - ny * size * .28);
    ctx.lineTo(midX + nx * size * .28, midY + ny * size * .28);
    ctx.stroke();
    ctx.strokeStyle = '#b28c55';
    ctx.lineWidth = size * .14;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(54,41,27,.72)';
    ctx.lineWidth = size * .018;
    for (let step = -2; step <= 2; step++) {
      const offset = step * size * .105;
      ctx.beginPath();
      ctx.moveTo(midX + Math.cos(angle) * offset - nx * size * .18, midY + Math.sin(angle) * offset - ny * size * .18);
      ctx.lineTo(midX + Math.cos(angle) * offset + nx * size * .18, midY + Math.sin(angle) * offset + ny * size * .18);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawNavalUnit(ctx, tile, size) {
    const radius = size * .48;
    ctx.save();
    ctx.translate(tile.x, tile.y + size * .04);
    ctx.fillStyle = 'rgba(6,13,16,.42)';
    ctx.beginPath();
    ctx.ellipse(size * .05, radius * .72, radius * 1.2, radius * .35, 0, 0, Math.PI * 2);
    ctx.fill();
    const gradient = ctx.createRadialGradient(-radius * .32, -radius * .42, radius * .08, 0, 0, radius * 1.2);
    gradient.addColorStop(0, '#81969a');
    gradient.addColorStop(.58, '#40555a');
    gradient.addColorStop(1, '#152d36');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#132329';
    ctx.lineWidth = size * .055;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(13,14,12,.9)';
    ctx.lineWidth = size * .15;
    ctx.beginPath();
    ctx.arc(0, 0, size * .55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#e04c45';
    ctx.lineWidth = size * .083;
    ctx.beginPath();
    ctx.arc(0, 0, size * .55, -Math.PI / 2, -Math.PI / 2 + Math.PI * 1.55);
    ctx.stroke();
    ctx.font = `bold ${size * .52}px "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8d8ae';
    ctx.fillText('⚓', 0, size * .025);
    ctx.restore();
  }

  function renderWaterPreview() {
    const { ctx, width, height } = prepareCanvas(waterCanvas, 1.48);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0f1110';
    ctx.fillRect(0, 0, width, height);
    const grid = buildSystemGrid(width, height);
    const palette = PALETTES.green;
    for (const tile of grid.tiles) {
      tile.surface = tile.q >= 1 || (tile.q === 0 && tile.r >= 1)
        ? (tile.q >= 2 ? 'deepWater' : 'shallowWater')
        : 'land';
      if (tile.surface === 'land') {
        drawTileBase(ctx, tile, grid.size, palette);
        drawGrass(ctx, tile, grid.size);
      } else {
        drawWaterSurface(ctx, tile, grid.size, tile.surface === 'deepWater');
      }
      drawHexOutline(ctx, tile, grid.size);
    }

    for (const tile of grid.tiles) {
      if (tile.surface !== 'land') continue;
      HEX_DIRECTIONS.forEach((direction, index) => {
        const neighbor = grid.tileMap.get(tileKey(tile.q + direction.q, tile.r + direction.r));
        if (neighbor?.surface === 'shallowWater' || neighbor?.surface === 'deepWater') drawCoastEdge(ctx, tile, grid.size, index);
      });
    }

    const riverTiles = [grid.tileMap.get('-3,-1'), grid.tileMap.get('-2,-1'), grid.tileMap.get('-1,-1'), grid.tileMap.get('0,-1')].filter(Boolean);
    const riverPoints = [];
    riverTiles.forEach((tile, index) => {
      if (index === 0) riverPoints.push(hexPoint(tile.x, tile.y, grid.size, 5));
      riverPoints.push(hexPoint(tile.x, tile.y, grid.size, 0));
      riverPoints.push(hexPoint(tile.x, tile.y, grid.size, 1));
    });
    drawRiver(ctx, riverPoints, grid.size);
    const shipTile = grid.tileMap.get('2,0');
    if (shipTile) drawNavalUnit(ctx, shipTile, grid.size);
  }

  function renderAll() {
    if (battlefieldCanvas) renderBattlefield();
    hudCards.forEach(renderHudCard);
    specimenCanvases.forEach(renderSpecimen);
    if (interactionCanvas) renderInteractionPreview();
    if (targetingCanvas) renderTargetingPreview();
    if (airTargetingCanvas) renderAirTargetingPreview();
    if (waterCanvas) renderWaterPreview();
  }

  const hasAnimatedPreview = Boolean(interactionCanvas || targetingCanvas || airTargetingCanvas);
  let animationFrame = 0;

  function renderAnimatedPreviews() {
    if (interactionCanvas) renderInteractionPreview();
    if (targetingCanvas) renderTargetingPreview();
    if (airTargetingCanvas) renderAirTargetingPreview();
  }

  function animateInteractionPreview(now) {
    animationFrame = 0;
    if (!state.interactionMotion || document.hidden) return;
    const delta = Math.min(.05, Math.max(0, (now - state.interactionLastFrame) / 1000));
    state.interactionLastFrame = now;
    state.interactionElapsed += delta;
    renderAnimatedPreviews();
    animationFrame = requestAnimationFrame(animateInteractionPreview);
  }

  function ensureAnimation() {
    if (!hasAnimatedPreview || !state.interactionMotion || document.hidden || animationFrame) return;
    state.interactionLastFrame = performance.now();
    animationFrame = requestAnimationFrame(animateInteractionPreview);
  }

  function bindSegmentGroup(rootId, dataKey, onSelect) {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.addEventListener('click', event => {
      const dataAttribute = dataKey.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
      const button = event.target.closest(`[data-${dataAttribute}]`);
      if (!button) return;
      const value = button.dataset[dataKey];
      [...button.parentElement.children].forEach(item => item.classList.toggle('active', item === button));
      onSelect(value);
      renderAll();
    });
  }

  bindSegmentGroup('styleControls', 'style', value => { state.style = value; });
  bindSegmentGroup('paletteControls', 'palette', value => { state.palette = value; });
  bindSegmentGroup('relationControls', 'relation', value => { state.relation = value; });
  bindSegmentGroup('interactionControls', 'interaction', value => {
    state.interaction = value;
    state.interactionElapsed = 0;
  });
  bindSegmentGroup('targetingControls', 'targeting', value => {
    state.targeting = value;
    state.targetingHoverKey = null;
    state.interactionElapsed = 0;
  });
  bindSegmentGroup('airTargetingControls', 'airTargeting', value => {
    state.airTargeting = value;
    state.airTargetingHoverKey = null;
    state.interactionElapsed = 0;
  });

  targetingCanvas?.addEventListener('pointermove', event => {
    const rect = targetingCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let hit = null;
    let bestDistance = Infinity;
    for (const region of targetingHitRegions) {
      const distance = Math.hypot(x - region.x, y - region.y);
      if (distance <= region.radius && distance < bestDistance) {
        hit = region;
        bestDistance = distance;
      }
    }
    const nextKey = hit?.key || null;
    targetingCanvas.style.cursor = hit ? 'crosshair' : 'default';
    if (nextKey !== state.targetingHoverKey) {
      state.targetingHoverKey = nextKey;
      renderTargetingPreview();
    }
  });

  targetingCanvas?.addEventListener('pointerleave', () => {
    state.targetingHoverKey = null;
    targetingCanvas.style.cursor = 'crosshair';
    renderTargetingPreview();
  });

  airTargetingCanvas?.addEventListener('pointermove', event => {
    const rect = airTargetingCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let hit = null;
    let bestDistance = Infinity;
    for (const region of airTargetingHitRegions) {
      const distance = Math.hypot(x - region.x, y - region.y);
      if (distance <= region.radius && distance < bestDistance) {
        hit = region;
        bestDistance = distance;
      }
    }
    const nextKey = hit?.key || null;
    airTargetingCanvas.style.cursor = hit ? 'crosshair' : 'default';
    if (nextKey !== state.airTargetingHoverKey) {
      state.airTargetingHoverKey = nextKey;
      renderAirTargetingPreview();
    }
  });

  airTargetingCanvas?.addEventListener('pointerleave', () => {
    state.airTargetingHoverKey = null;
    airTargetingCanvas.style.cursor = 'crosshair';
    renderAirTargetingPreview();
  });

  if (interactionMotionInput) {
    interactionMotionInput.checked = state.interactionMotion;
    interactionMotionInput.addEventListener('change', () => {
      state.interactionMotion = interactionMotionInput.checked;
      if (!state.interactionMotion && animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
      renderAnimatedPreviews();
      ensureAnimation();
    });
  }

  const textureRange = document.getElementById('textureRange');
  textureRange?.addEventListener('input', () => {
    state.texture = Number(textureRange.value) / 100;
    document.getElementById('textureValue').value = `${textureRange.value}%`;
    renderAll();
  });

  const healthRange = document.getElementById('healthRange');
  healthRange?.addEventListener('input', () => {
    state.health = Number(healthRange.value) / 100;
    document.getElementById('healthValue').value = `${healthRange.value}%`;
    renderAll();
  });

  document.getElementById('hudGrid')?.addEventListener('click', event => {
    const card = event.target.closest('[data-health-style]');
    if (!card) return;
    state.healthStyle = card.dataset.healthStyle;
    hudCards.forEach(item => item.button.classList.toggle('active', item.button === card));
    renderAll();
  });

  const shieldRange = document.getElementById('shieldRange');
  shieldRange?.addEventListener('input', () => {
    state.shield = Number(shieldRange.value) / 100;
    document.getElementById('shieldValue').value = `${shieldRange.value}%`;
    renderAll();
  });

  document.getElementById('unitToggle')?.addEventListener('click', event => {
    state.units = !state.units;
    event.currentTarget.classList.toggle('active', state.units);
    renderAll();
  });

  document.getElementById('gridToggle')?.addEventListener('click', event => {
    state.grid = !state.grid;
    event.currentTarget.classList.toggle('active', state.grid);
    renderAll();
  });

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(renderAll);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      return;
    }
    ensureAnimation();
  });

  renderAll();
  ensureAnimation();
})();
