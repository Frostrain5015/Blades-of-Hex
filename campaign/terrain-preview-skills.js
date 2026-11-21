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
  const CPC_PALETTE = { tile: '#fcd6b0', line: '#8c2a12', flag: '#d94826' };
  const ENEMY_PALETTE = { tile: '#aaaaff', line: '#1a2a80', flag: '#4060d0' };
  const RELATION_COLORS = {
    self: '#55c66a',
    enemy: '#e04c45'
  };

  const state = {
    style: 'relief',
    palette: 'red',
    texture: 0.72,
    grid: true,
    samuraiMode: 'parabola',
    samuraiOutcome: 'kill',
    samuraiTargetKey: '0,0',
    samuraiGuides: true,
    samuraiSlow: false,
    samuraiAutoLoop: true,
    samuraiPaused: false,
    samuraiFrozenElapsed: 0,
    samuraiCastNonce: 1,
    samuraiCastStart: performance.now(),
    sniperRay: 'hexAxis',
    sniperScaling: 'pierce',
    sniperSlow: false,
    sniperPaused: false,
    sniperFrozenElapsed: 0,
    sniperHoverX: null,
    sniperHoverY: null,
    sniperCast: null
  };

  const samuraiCanvas = document.getElementById('samuraiJumpPreview');
  const sniperCanvas = document.getElementById('guerrillaSniperPreview');

  function tileKey(q, r) { return `${q},${r}`; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function drawOutlinedText(ctx, text, x, y, fillStyle, strokeW = 4.2) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = 'rgba(10, 9, 8, 0.94)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fillStyle;
    ctx.fillText(text, x, y);
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

  function hexDistance(a, b) {
    const dq = b.q - a.q;
    const dr = b.r - a.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(-dq - dr)) / 2;
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

  function axialToPixel(q, r, size, originX, originY) {
    return {
      x: originX + SQRT3 * size * (q + r * 0.5),
      y: originY + 1.5 * size * r
    };
  }

  function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const pixelW = Math.round(width * dpr);
    const pixelH = Math.round(height * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    return { ctx, width, height };
  }

  function styleProfile() {
    if (state.style === 'chronicle') {
      return {
        wash: 0.52, shadow: 0.16, stroke: 0.9, detail: 0.85,
        ink: '#4a4033', light: '#ddcda7', foliage: '#5e6650'
      };
    }
    if (state.style === 'texture') {
      return {
        wash: 0.24, shadow: 0.08, stroke: 0.45, detail: 0.58,
        ink: '#534c40', light: '#d9cba9', foliage: '#66705a'
      };
    }
    return {
      wash: 0.68, shadow: 0.34, stroke: 1, detail: 1,
      ink: '#3e392f', light: '#e7d8b3', foliage: '#596649'
    };
  }

  function drawContourHatching(ctx, tile, size, alpha) {
    ctx.save();
    ctx.strokeStyle = `rgba(65,57,42,${0.075 * alpha})`;
    ctx.lineWidth = 0.75;
    for (let offset = -2; offset <= 2; offset++) {
      ctx.beginPath();
      const y = tile.y + offset * size * 0.23;
      ctx.moveTo(tile.x - size, y - size * 0.08);
      ctx.bezierCurveTo(tile.x - size * 0.35, y + size * 0.12, tile.x + size * 0.28, y - size * 0.13, tile.x + size, y + size * 0.05);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTileBase(ctx, tile, size, palette) {
    const profile = styleProfile();
    ctx.save();
    hexPath(ctx, tile.x + size * 0.035, tile.y + size * 0.07, size);
    ctx.fillStyle = `rgba(15,14,12,${0.12 + profile.shadow * 0.22})`;
    ctx.fill();
    hexPath(ctx, tile.x, tile.y, size);
    ctx.fillStyle = palette.tile;
    ctx.fill();
    ctx.clip();

    const vignette = ctx.createRadialGradient(tile.x - size * 0.22, tile.y - size * 0.35, size * 0.08, tile.x, tile.y, size * 1.2);
    vignette.addColorStop(0, `rgba(255,247,220,${0.17 * state.texture})`);
    vignette.addColorStop(1, `rgba(42,36,28,${0.11 * state.texture})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(tile.x - size, tile.y - size, size * 2, size * 2);

    const alpha = state.texture * profile.detail;
    ctx.lineCap = 'round';
    for (let index = 0; index < 14; index++) {
      const px = tile.x + (seeded(tile, 100 + index) - 0.5) * size * 1.7;
      const py = tile.y + (seeded(tile, 220 + index) - 0.5) * size * 1.8;
      const len = size * (0.06 + seeded(tile, 350 + index) * 0.15);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + len, py + len * 0.18);
      ctx.strokeStyle = `rgba(50,43,33,${alpha * (0.025 + seeded(tile, 480 + index) * 0.045)})`;
      ctx.lineWidth = 0.45 + seeded(tile, 620 + index) * 0.65;
      ctx.stroke();
    }

    if (tile.terrain === 'forest') {
      ctx.fillStyle = `rgba(57,76,48,${0.22 * state.texture * profile.wash})`;
      ctx.fillRect(tile.x - size, tile.y - size, size * 2, size * 2);
    } else if (tile.terrain === 'hill') {
      ctx.fillStyle = `rgba(82,72,56,${0.18 * state.texture * profile.wash})`;
      ctx.fillRect(tile.x - size, tile.y - size, size * 2, size * 2);
      drawContourHatching(ctx, tile, size, state.texture * profile.wash * 1.3);
    } else {
      drawContourHatching(ctx, tile, size, state.texture * profile.wash);
    }
    ctx.restore();
  }

  function drawTreeDecor(ctx, x, y, scale) {
    const profile = styleProfile();
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.5 + state.texture * profile.detail * 0.45;
    ctx.fillStyle = '#68513a';
    ctx.fillRect(-scale * 0.08, scale * 0.04, scale * 0.16, scale * 0.44);
    const grad = ctx.createRadialGradient(-scale * 0.18, -scale * 0.25, scale * 0.08, 0, 0, scale * 0.68);
    grad.addColorStop(0, profile.light);
    grad.addColorStop(0.28, '#697453');
    grad.addColorStop(1, profile.foliage);
    ctx.fillStyle = grad;
    ctx.strokeStyle = profile.ink;
    ctx.lineWidth = Math.max(0.5, scale * 0.035) * profile.stroke;
    [[-0.25, 0.02, 0.38], [0.23, 0.01, 0.42], [-0.02, -0.26, 0.48]].forEach(part => {
      ctx.beginPath();
      ctx.arc(part[0] * scale, part[1] * scale, part[2] * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawTerrainDecor(ctx, tile, size) {
    if (tile.terrain !== 'forest') return;
    drawTreeDecor(ctx, tile.x - size * 0.3, tile.y + size * 0.12, size * 0.32);
    drawTreeDecor(ctx, tile.x + size * 0.28, tile.y - size * 0.18, size * 0.29);
  }

  function drawHexOutline(ctx, tile, size, strong = false) {
    if (!state.grid) return;
    ctx.save();
    hexPath(ctx, tile.x, tile.y, size);
    ctx.strokeStyle = strong ? 'rgba(54,45,34,.48)' : 'rgba(55,47,36,.24)';
    ctx.lineWidth = strong ? 1.3 : 0.75;
    ctx.stroke();
    ctx.restore();
  }

  function unitVisualCenter(x, y, size) {
    return { x, y: y + size * 0.035 };
  }

  function drawUnitFlagAt(ctx, x, y, size, palette, alpha = 1) {
    const poleX = x - size * 0.5;
    const poleTop = y - size;
    const poleBottom = y + size * 0.067;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#aaa49a';
    ctx.lineWidth = Math.max(1, size * 0.05);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(poleX, poleTop);
    ctx.lineTo(poleX, poleBottom);
    ctx.stroke();
    const flagX = poleX + size * 0.035;
    const flagY = poleTop + size * 0.067;
    const flagW = size * 0.5;
    const flagH = size / 3;
    const flagGrad = ctx.createLinearGradient(flagX, flagY, flagX + flagW, flagY + flagH);
    flagGrad.addColorStop(0, palette.flag);
    flagGrad.addColorStop(1, palette.line);
    ctx.fillStyle = flagGrad;
    ctx.strokeStyle = 'rgba(41,31,22,.72)';
    ctx.lineWidth = Math.max(0.6, size * 0.018);
    ctx.beginPath();
    ctx.moveTo(flagX, flagY);
    ctx.quadraticCurveTo(flagX + flagW * 0.52, flagY - flagH * 0.08, flagX + flagW, flagY + flagH * 0.12);
    ctx.lineTo(flagX + flagW, flagY + flagH);
    ctx.quadraticCurveTo(flagX + flagW * 0.48, flagY + flagH * 0.84, flagX, flagY + flagH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d9bc6b';
    ctx.beginPath();
    ctx.arc(poleX, poleTop, size * 0.055, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawDialGauge(ctx, size, color, health) {
    const radius = size * 0.51;
    const startAngle = -Math.PI / 2;
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(13,14,12,.92)';
    ctx.lineWidth = size * 0.13;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `${color}52`;
    ctx.lineWidth = size * 0.078;
    ctx.stroke();
    if (health > 0.002) {
      ctx.beginPath();
      ctx.arc(0, 0, radius, startAngle, startAngle + Math.PI * 2 * clamp(health, 0, 1));
      ctx.strokeStyle = color;
      ctx.lineWidth = size * 0.082;
      ctx.shadowColor = color;
      ctx.shadowBlur = size * 0.08;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.strokeStyle = 'rgba(245,228,188,.34)';
    ctx.lineWidth = Math.max(0.6, size * 0.018);
    for (let index = 0; index < 4; index++) {
      const angle = -Math.PI / 2 + index * Math.PI / 2;
      ctx.beginPath();
      ctx.arc(0, 0, radius, angle - 0.014, angle + 0.014);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawUnitEmblem(ctx, radius, archetype) {
    ctx.fillStyle = '#e4d1a3';
    ctx.strokeStyle = '#e4d1a3';
    if (archetype === 'samurai') {
      // Kabuto crescent + katana blade silhouette
      ctx.beginPath();
      ctx.arc(0, -radius * 0.08, radius * 0.25, Math.PI, Math.PI * 2);
      ctx.lineTo(radius * 0.34, radius * 0.12);
      ctx.lineTo(-radius * 0.34, radius * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#f5d782';
      ctx.lineWidth = Math.max(1.2, radius * 0.1);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-radius * 0.34, -radius * 0.34);
      ctx.quadraticCurveTo(0, -radius * 0.18, radius * 0.34, -radius * 0.34);
      ctx.stroke();
      ctx.strokeStyle = '#fff2df';
      ctx.lineWidth = Math.max(1.4, radius * 0.11);
      ctx.beginPath();
      ctx.moveTo(-radius * 0.36, radius * 0.38);
      ctx.lineTo(radius * 0.36, -radius * 0.22);
      ctx.stroke();
      ctx.fillRect(-radius * 0.22, radius * 0.24, radius * 0.44, radius * 0.18);
      return;
    }
    if (archetype === 'sniper') {
      // Sniper rifle + precision scope glint
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#f0dec0';
      ctx.lineWidth = Math.max(1.5, radius * 0.13);
      ctx.beginPath();
      ctx.moveTo(-radius * 0.44, radius * 0.28);
      ctx.lineTo(radius * 0.46, -radius * 0.14);
      ctx.stroke();
      // Scope above barrel
      ctx.lineWidth = Math.max(1.2, radius * 0.1);
      ctx.strokeStyle = '#ffbf69';
      ctx.beginPath();
      ctx.moveTo(-radius * 0.12, -radius * 0.04);
      ctx.lineTo(radius * 0.18, -radius * 0.18);
      ctx.stroke();
      // Shoulder/hat silhouette
      ctx.beginPath();
      ctx.arc(-radius * 0.12, -radius * 0.22, radius * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-radius * 0.36, radius * 0.16, radius * 0.4, radius * 0.22);
      return;
    }
    if (archetype === 'cannon') {
      // Artillery barrel silhouette
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, radius * 0.2);
      ctx.beginPath();
      ctx.moveTo(-radius * 0.34, radius * 0.16);
      ctx.lineTo(radius * 0.34, -radius * 0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-radius * 0.14, radius * 0.2, radius * 0.2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (archetype === 'cavalry') {
      // Chevron + lance
      ctx.beginPath();
      ctx.moveTo(-radius * 0.34, radius * 0.28);
      ctx.lineTo(0, -radius * 0.32);
      ctx.lineTo(radius * 0.34, radius * 0.28);
      ctx.lineTo(0, radius * 0.08);
      ctx.closePath();
      ctx.fill();
      return;
    }
    // Infantry default
    ctx.beginPath();
    ctx.arc(0, -radius * 0.28, radius * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-radius * 0.38, radius * 0.39);
    ctx.quadraticCurveTo(-radius * 0.28, -radius * 0.03, 0, -radius * 0.02);
    ctx.quadraticCurveTo(radius * 0.28, -radius * 0.03, radius * 0.38, radius * 0.39);
    ctx.closePath();
    ctx.fill();
  }

  function drawUnitAt(ctx, x, y, size, palette, options = {}) {
    const radius = size * 0.5;
    const health = Number.isFinite(options.health) ? options.health : 0.85;
    const relationColor = RELATION_COLORS[options.relation || 'enemy'] || RELATION_COLORS.enemy;
    const alpha = options.alpha ?? 1;
    const scaleX = options.scaleX ?? 1;
    const scaleY = options.scaleY ?? 1;
    const rotation = options.rotation ?? 0;
    const shadowScale = options.shadowScale ?? 1;
    const shadowAlpha = options.shadowAlpha ?? 0.34;
    const shadowX = options.shadowX ?? x;
    const shadowY = options.shadowY ?? y;
    const hitFlash = options.hitFlash ?? 0;

    if (options.drawShadow !== false) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgba(18,14,10,${shadowAlpha})`;
      ctx.beginPath();
      ctx.ellipse(shadowX + 2, shadowY + size * 0.035 + radius * 0.7, radius * 1.18 * shadowScale, radius * 0.42 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (options.showFlag !== false) {
      drawUnitFlagAt(ctx, x, y, size, palette, alpha);
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y + size * 0.035);
    ctx.rotate(rotation);
    ctx.scale(scaleX, scaleY);

    const grad = ctx.createRadialGradient(-radius * 0.3, -radius * 0.42, radius * 0.08, 0, 0, radius * 1.15);
    grad.addColorStop(0, options.archetype === 'samurai' ? '#8c534a' : (options.archetype === 'sniper' ? '#80694c' : '#796d55'));
    grad.addColorStop(0.7, '#474239');
    grad.addColorStop(1, palette.line);
    ctx.fillStyle = grad;
    ctx.strokeStyle = options.archetype === 'samurai' ? '#b85042' : '#30291e';
    ctx.lineWidth = Math.max(1, size * (options.archetype === 'samurai' ? 0.052 : 0.04));
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    drawUnitEmblem(ctx, radius, options.archetype || 'infantry');

    if (hitFlash > 0.01) {
      ctx.fillStyle = `rgba(255,244,238,${clamp(hitFlash, 0, 1) * 0.72})`;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    drawDialGauge(ctx, size, relationColor, health);
    ctx.restore();
  }

  function drawTargetingBrackets(ctx, tile, size, color, time, active, badgeText = null) {
    const center = unitVisualCenter(tile.x, tile.y, size);
    const wave = (Math.sin(time * 2.8 + tile.q * 0.5 + tile.r * 0.35) + 1) / 2;
    const half = size * ((active ? 0.74 : 0.66) + wave * (active ? 0.036 : 0.016));
    const arm = size * (active ? 0.23 : 0.18);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = size * (active ? 0.062 : 0.044);
    ctx.lineCap = 'square';
    ctx.globalAlpha = active ? 0.98 : 0.72;
    ctx.shadowColor = color;
    ctx.shadowBlur = active ? size * 0.22 : size * 0.06;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(center.x + sx * (half - arm), center.y + sy * half);
      ctx.lineTo(center.x + sx * half, center.y + sy * half);
      ctx.lineTo(center.x + sx * half, center.y + sy * (half - arm));
      ctx.stroke();
    }
    if (badgeText) {
      ctx.shadowBlur = 0;
      const bx = tile.x + size * 0.52;
      const by = tile.y - size * 0.54;
      ctx.font = `800 ${Math.max(10, Math.round(size * 0.27))}px ui-monospace, "Cascadia Mono", monospace`;
      const tw = ctx.measureText(badgeText).width + 10;
      const th = Math.max(16, size * 0.38);
      ctx.fillStyle = 'rgba(18, 10, 10, 0.92)';
      ctx.strokeStyle = '#ff6b5b';
      ctx.lineWidth = 1.2;
      ctx.fillRect(bx - tw / 2, by - th / 2, tw, th);
      ctx.strokeRect(bx - tw / 2, by - th / 2, tw, th);
      ctx.fillStyle = '#ffd7c2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, bx, by + 0.5);
    }
    ctx.restore();
  }

  function drawModePlate(ctx, width, height, title, contract, note, accentColor) {
    const x = width * 0.022;
    const y = height * 0.036;
    const plateWidth = Math.min(width * 0.34, 380);
    const plateHeight = Math.min(72, height * 0.16);
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,9,.88)';
    ctx.fillRect(x, y, plateWidth, plateHeight);
    ctx.fillStyle = accentColor;
    ctx.fillRect(x, y, 4, plateHeight);
    ctx.fillStyle = '#eadfca';
    ctx.font = '800 12px "Palatino Linotype", serif';
    ctx.textBaseline = 'top';
    ctx.fillText(title, x + 14, y + 10);
    ctx.fillStyle = accentColor;
    ctx.font = '700 9px ui-monospace, "Cascadia Mono", monospace';
    ctx.fillText(contract, x + 14, y + 30);
    ctx.fillStyle = '#8d8370';
    ctx.font = '600 9px "Microsoft YaHei", sans-serif';
    ctx.fillText(note, x + 14, y + 48, plateWidth - 24);
    ctx.restore();
  }

  function buildRectHexGrid(width, height, cols, rows, originXRatio, originYRatio, sizeDivX, sizeDivY) {
    const size = Math.min(width / sizeDivX, height / sizeDivY);
    const originX = width * originXRatio;
    const originY = height * originYRatio;
    const halfRows = Math.floor(rows / 2);
    const halfCols = Math.floor(cols / 2);
    const tiles = [];
    for (let r = -halfRows; r <= halfRows; r++) {
      const qShift = Math.floor(r / 2);
      for (let col = -halfCols; col <= halfCols; col++) {
        const q = col - qShift;
        const point = axialToPixel(q, r, size, originX, originY);
        const roll = hashNumber(q + 31, r + 17, 77);
        const terrain = roll > 0.84 ? 'forest' : (roll < 0.12 ? 'hill' : 'plains');
        tiles.push({ q, r, x: point.x, y: point.y, terrain });
      }
    }
    return { size, tiles, tileMap: new Map(tiles.map(t => [tileKey(t.q, t.r), t])) };
  }

  // =========================================================
  // 06A · IMPERIAL SAMURAI THREE-PHASE CHARGED LEAP & HITSTOP
  // =========================================================

  const SAMURAI_TARGETS = [
    { key: '-2,1', archetype: 'infantry', label: '1格近身' },
    { key: '0,0', archetype: 'cavalry', label: '2格正东（默认）' },
    { key: '0,-2', archetype: 'cannon', label: '2格斜向' }
  ];
  const SAMURAI_ORIGIN_KEY = '-2,0';
  const SAMURAI_PHASE1_MS = 250;
  const SAMURAI_PHASE2_MS = 450;
  const SAMURAI_PHASE3_MS = 540;
  const SAMURAI_HITSTOP_MS = 80;
  const DEBRIS_COLORS = ['#8c7b65', '#5c5042', '#c2a878', '#3a3228'];

  let samuraiHitRegions = [];

  function evalSamuraiThreePhase(fromX, fromY, destX, destY, elapsedMs) {
    const dx = destX - fromX;
    const dy = destY - fromY;
    const dist = Math.hypot(dx, dy);
    const H = Math.max(66, 42 + 0.19 * dist);
    const t = clamp(elapsedMs, 0, SAMURAI_PHASE3_MS);
    let h = 0;
    let z = 0;
    let phase = 1;

    if (t <= SAMURAI_PHASE1_MS) {
      // Phase 1 (0 ~ 250ms): Ease-Out upward launch, vy -> 0 at apex
      phase = 1;
      const u1 = t / SAMURAI_PHASE1_MS;
      z = H * (1 - (1 - u1) * (1 - u1));
      h = 0.47 * u1 - 0.11 * u1 * u1; // 0 -> 0.36
    } else if (t <= SAMURAI_PHASE2_MS) {
      // Phase 2 (250 ~ 450ms): zero gravity, non-zero horizontal glide at apex
      phase = 2;
      const u2 = (t - SAMURAI_PHASE1_MS) / (SAMURAI_PHASE2_MS - SAMURAI_PHASE1_MS);
      z = H;
      h = 0.36 + 0.20 * u2; // 0.36 -> 0.56
    } else {
      // Phase 3 (450 ~ 540ms): L-style straight-line flash cut from apex to target, cubic ease-out (instant burst)
      phase = 3;
      const u3 = (t - SAMURAI_PHASE2_MS) / (SAMURAI_PHASE3_MS - SAMURAI_PHASE2_MS);
      const e = 1 - Math.pow(1 - u3, 3);
      z = H * (1 - e);
      h = 0.56 + 0.44 * e; // straight segment in screen space
    }

    const groundX = lerp(fromX, destX, h);
    const groundY = lerp(fromY, destY, h);
    return { x: groundX, y: groundY - z, groundX, groundY, lift: z, H, phase };
  }

  function evalLegacyLShape(fromX, fromY, destX, destY, elapsedMs, travelMs) {
    const leapMs = 110;
    const hangMs = 55;
    const dashMs = Math.max(80, travelMs - leapMs - hangMs);
    if (elapsedMs < leapMs) {
      const p = elapsedMs / leapMs;
      const easeOut = 1 - (1 - p) * (1 - p);
      return { x: fromX, y: fromY - 28 * easeOut, groundX: fromX, groundY: fromY, lift: 28 * easeOut, H: 28, phase: 1 };
    }
    if (elapsedMs < leapMs + hangMs) {
      return { x: fromX, y: fromY - 28, groundX: fromX, groundY: fromY, lift: 28, H: 28, phase: 2 };
    }
    const p = clamp((elapsedMs - leapMs - hangMs) / dashMs, 0, 1);
    const dashEase = 1 - Math.pow(1 - p, 3);
    const airArc = -28 * (1 - p * p);
    const gx = lerp(fromX, destX, dashEase);
    const gy = lerp(fromY, destY, dashEase);
    return { x: gx, y: gy + airArc, groundX: gx, groundY: gy, lift: Math.max(0, -airArc), H: 28, phase: 3 };
  }

  function sampleArcParticles(seedBase, originX, originY, dirX, dirY, progressMs, durationMs, count, color) {
    const t = clamp(progressMs / durationMs, 0, 1);
    if (t <= 0 || t >= 1) return [];
    const baseAngle = Math.atan2(dirY, dirX);
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = baseAngle + (hashNumber(seedBase, i, 11) - 0.5) * 1.15;
      const spd = 48 + hashNumber(seedBase, i, 23) * 86;
      const radius = spd * t * (1 - 0.35 * t);
      out.push({
        x: originX + Math.cos(a) * radius,
        y: originY + Math.sin(a) * radius,
        r: (1.8 + hashNumber(seedBase, i, 37) * 2.2) * (1 - t * 0.7),
        alpha: 1 - t,
        color
      });
    }
    return out;
  }

  function sampleDebrisShards(originX, originY, progressMs, durationMs = 660, count = 18) {
    if (progressMs < 0 || progressMs >= durationMs) return [];
    const t = progressMs / 1000;
    const lifeNorm = progressMs / durationMs;
    const g = 520;
    const shards = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (hashNumber(701, i, 3) - 0.5) * 0.38;
      const vx = Math.cos(angle) * (46 + hashNumber(701, i, 7) * 95);
      const vy = Math.sin(angle) * (24 + hashNumber(701, i, 13) * 48);
      const vz0 = 115 + hashNumber(701, i, 19) * 115;
      const bounceT = (2 * vz0) / g;
      let z = 0;
      if (t < bounceT) {
        z = Math.max(0, vz0 * t - 0.5 * g * t * t);
      } else {
        const dt2 = t - bounceT;
        const vz1 = vz0 * 0.38;
        z = Math.max(0, vz1 * dt2 - 0.5 * g * dt2 * dt2);
      }
      const size = 2.6 + hashNumber(701, i, 29) * 3.8;
      shards.push({
        x: originX + vx * t,
        y: originY + vy * t - z,
        groundY: originY + vy * t,
        z,
        size,
        rot: hashNumber(701, i, 41) * Math.PI * 2 + t * (hashNumber(701, i, 43) - 0.5) * 14,
        aspect: 0.58 + hashNumber(701, i, 53) * 0.45,
        color: DEBRIS_COLORS[i % DEBRIS_COLORS.length],
        alpha: lifeNorm < 0.65 ? 1 : clamp(1 - (lifeNorm - 0.65) / 0.35, 0, 1)
      });
    }
    return shards;
  }

  function renderSamuraiPreview(now) {
    if (!samuraiCanvas) return;
    const { ctx, width, height } = prepareCanvas(samuraiCanvas);
    const grid = buildRectHexGrid(width, height, 9, 5, 0.50, 0.55, 13.0, 7.6);
    const friendlyPalette = PALETTES[state.palette];

    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, '#171914');
    bg.addColorStop(1, '#0c0e0d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const fromTile = grid.tileMap.get(SAMURAI_ORIGIN_KEY);
    const targetTile = grid.tileMap.get(state.samuraiTargetKey) || grid.tileMap.get('0,0');
    const isKill = state.samuraiOutcome === 'kill';
    let destTile = targetTile;
    if (!isKill && fromTile && targetTile && hexDistance(fromTile, targetTile) === 2) {
      const midKey = tileKey(fromTile.q + Math.round((targetTile.q - fromTile.q) / 2), fromTile.r + Math.round((targetTile.r - fromTile.r) / 2));
      destTile = grid.tileMap.get(midKey) || grid.tileMap.get('-1,0') || fromTile;
    }

    const isLegacy = state.samuraiMode === 'legacy';
    const flightMs = isLegacy ? 280 : SAMURAI_PHASE3_MS;
    const hitstopMs = isLegacy ? 0 : SAMURAI_HITSTOP_MS;
    const settleMs = 120;
    const afterMs = 980;
    const pauseMs = 360;
    const totalCycleMs = flightMs + hitstopMs + settleMs + afterMs + pauseMs;
    const speedScale = state.samuraiSlow ? 0.35 : 1.0;

    let rawElapsed = state.samuraiPaused
      ? state.samuraiFrozenElapsed
      : (now - state.samuraiCastStart) * speedScale;
    if (state.samuraiAutoLoop) {
      rawElapsed = rawElapsed % totalCycleMs;
    } else {
      rawElapsed = Math.min(rawElapsed, flightMs + hitstopMs + settleMs + afterMs - 1);
    }
    if (!state.samuraiPaused) {
      state.samuraiFrozenElapsed = rawElapsed;
    }

    const impactAt = flightMs;
    const hitElapsed = rawElapsed - impactAt;
    const hasImpacted = hitElapsed >= 0;
    const inHitstop = hasImpacted && hitElapsed < hitstopMs;
    const releaseElapsed = Math.max(0, hitElapsed - hitstopMs);
    const released = hasImpacted && !inHitstop;

    // Strong exponentially-decayed screen shake upon Hitstop release (and micro tremor during Hitstop)
    let shakeX = 0;
    let shakeY = 0;
    if (inHitstop) {
      shakeX = Math.sin(hitElapsed * 1.45) * 2.2;
      shakeY = Math.cos(hitElapsed * 1.75) * 1.8;
    } else if (released && releaseElapsed < 320) {
      const amp = (isKill ? 11.5 : 8.2) * Math.exp(-releaseElapsed / 115);
      shakeX = Math.sin(releaseElapsed * 0.34) * amp;
      shakeY = Math.cos(releaseElapsed * 0.43) * amp * 0.78;
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);

    for (const tile of grid.tiles) {
      drawTileBase(ctx, tile, grid.size, friendlyPalette);
      drawTerrainDecor(ctx, tile, grid.size);
      drawHexOutline(ctx, tile, grid.size);
    }

    // Highlight legal targets + origin tile
    if (fromTile) {
      ctx.save();
      for (const spec of SAMURAI_TARGETS) {
        const t = grid.tileMap.get(spec.key);
        if (!t) continue;
        hexPath(ctx, t.x, t.y, grid.size * 0.96);
        ctx.fillStyle = spec.key === targetTile.key ? 'rgba(240, 100, 86, 0.14)' : 'rgba(240, 100, 86, 0.06)';
        ctx.fill();
      }
      hexPath(ctx, fromTile.x, fromTile.y, grid.size * 0.96);
      ctx.strokeStyle = '#69c7e8';
      ctx.lineWidth = grid.size * 0.05;
      ctx.stroke();
      ctx.restore();
    }

    // 3-stage trajectory guide lines (plus optional legacy L-shape comparison)
    if (state.samuraiGuides && fromTile && destTile) {
      ctx.save();
      if (state.samuraiMode === 'legacy' || state.samuraiMode === 'compare') {
        ctx.strokeStyle = 'rgba(130, 196, 224, 0.65)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(fromTile.x, fromTile.y);
        ctx.lineTo(fromTile.x, fromTile.y - 28);
        ctx.lineTo(destTile.x, destTile.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#82c4e0';
        ctx.beginPath();
        ctx.arc(fromTile.x, fromTile.y - 28, 3.8, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!isLegacy) {
        const drawSeg = (t0, t1, stroke, widthPx, dash) => {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = widthPx;
          ctx.setLineDash(dash);
          ctx.beginPath();
          for (let i = 0; i <= 20; i++) {
            const p = evalSamuraiThreePhase(fromTile.x, fromTile.y, destTile.x, destTile.y, lerp(t0, t1, i / 20));
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        };
        // Phase 1: Ease-Out Launch
        drawSeg(0, SAMURAI_PHASE1_MS, 'rgba(255, 209, 102, 0.78)', 2.2, [6, 5]);
        // Phase 2: 0g Glide Hold
        drawSeg(SAMURAI_PHASE1_MS, SAMURAI_PHASE2_MS, 'rgba(125, 226, 252, 0.92)', 2.8, []);
        // Phase 3: 3g Flash Dive
        drawSeg(SAMURAI_PHASE2_MS, SAMURAI_PHASE3_MS, 'rgba(255, 77, 64, 0.85)', 2.4, [7, 4]);
        ctx.setLineDash([]);

        const pStart2 = evalSamuraiThreePhase(fromTile.x, fromTile.y, destTile.x, destTile.y, SAMURAI_PHASE1_MS);
        const pEnd2 = evalSamuraiThreePhase(fromTile.x, fromTile.y, destTile.x, destTile.y, SAMURAI_PHASE2_MS);
        for (const anchor of [pStart2, pEnd2]) {
          ctx.fillStyle = '#9bf6ff';
          ctx.beginPath();
          ctx.arc(anchor.x, anchor.y, 4.0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.font = '700 10px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        drawOutlinedText(ctx, `零重力滞空 H=${Math.round(pStart2.H)}px`, (pStart2.x + pEnd2.x) * 0.5, pStart2.y - 20, '#b8f4ff', 3.4);
      }
      ctx.restore();
    }

    // Ground cracks & perspective double shockwave after hitstop release
    if (released && fromTile && destTile) {
      if (releaseElapsed < 680) {
        const crackAlpha = clamp(1 - releaseElapsed / 680, 0, 1) * 0.85;
        ctx.save();
        ctx.translate(destTile.x, destTile.y + grid.size * 0.06);
        ctx.scale(1, 0.58);
        ctx.globalAlpha = crackAlpha;
        ctx.strokeStyle = '#241a12';
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        for (let ci = 0; ci < 7; ci++) {
          const a = (ci / 7) * Math.PI * 2 + hashNumber(33, ci, 5) * 0.35;
          const r1 = grid.size * (0.28 + hashNumber(33, ci, 9) * 0.18);
          const r2 = grid.size * (0.68 + hashNumber(33, ci, 13) * 0.34) * clamp(releaseElapsed / 90, 0.25, 1);
          const midA = a + (hashNumber(33, ci, 17) - 0.5) * 0.25;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * grid.size * 0.12, Math.sin(a) * grid.size * 0.12);
          ctx.lineTo(Math.cos(midA) * r1, Math.sin(midA) * r1);
          ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (releaseElapsed < 420) {
        const rp = releaseElapsed / 420;
        const ease = 1 - Math.pow(1 - rp, 3);
        ctx.save();
        ctx.translate(destTile.x, destTile.y + grid.size * 0.08);
        ctx.scale(1, 0.54);
        ctx.globalAlpha = (1 - rp) * 0.92;
        ctx.strokeStyle = '#ff4d40';
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 16;
        ctx.lineWidth = 5.2 * (1 - rp * 0.6);
        ctx.beginPath();
        ctx.arc(0, 0, grid.size * (0.28 + ease * 1.45), 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#fff3d6';
        ctx.lineWidth = 2.4 * (1 - rp * 0.5);
        ctx.beginPath();
        ctx.arc(0, 0, grid.size * (0.20 + ease * 1.05), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Draw enemy targets (with hitstop bright flash & post-release kick)
    const timeSec = now * 0.001;
    samuraiHitRegions = [];
    for (const spec of SAMURAI_TARGETS) {
      const tile = grid.tileMap.get(spec.key);
      if (!tile) continue;
      samuraiHitRegions.push({ key: spec.key, x: tile.x, y: tile.y, radius: grid.size * 0.72 });
      const isSelected = spec.key === targetTile.key;
      let enemyAlpha = 1;
      let enemyHealth = isSelected ? 0.46 : 0.72;
      let enemyFlash = 0;
      let ex = tile.x;
      let ey = tile.y;
      if (isSelected && hasImpacted) {
        if (inHitstop) {
          ex += Math.sin(hitElapsed * 1.9) * 2.5;
          ey += Math.cos(hitElapsed * 2.3) * 1.8;
          enemyFlash = 1.0;
        } else if (isKill) {
          enemyAlpha = clamp(1 - releaseElapsed / 240, 0, 1);
          enemyFlash = clamp(1 - releaseElapsed / 160, 0, 1);
          enemyHealth = 0;
        } else {
          const pushT = releaseElapsed < 160 ? Math.sin((releaseElapsed / 160) * Math.PI) : 0;
          const ang = Math.atan2(tile.y - fromTile.y, tile.x - fromTile.x);
          ex += Math.cos(ang) * pushT * 7.5;
          ey += Math.sin(ang) * pushT * 7.5;
          enemyFlash = clamp(1 - releaseElapsed / 180, 0, 1);
          enemyHealth = lerp(0.46, 0.14, clamp(releaseElapsed / 180, 0, 1));
        }
      }
      if (enemyAlpha > 0.02) {
        drawUnitAt(ctx, ex, ey, grid.size, ENEMY_PALETTE, {
          archetype: spec.archetype,
          health: enemyHealth,
          relation: 'enemy',
          alpha: enemyAlpha,
          hitFlash: enemyFlash
        });
      }
      drawTargetingBrackets(ctx, tile, grid.size, isSelected ? '#ff5c4d' : '#d86559', timeSec, isSelected);
    }

    // Samurai kinematics & blade choreography
    let currentPhaseLabel = '阶段 4/4 · 落地爆发与收招';
    if (fromTile && destTile) {
      let sx = fromTile.x;
      let sy = fromTile.y;
      let gx = fromTile.x;
      let gy = fromTile.y;
      let lift = 0;
      let scaleX = 1;
      let scaleY = 1;
      let rotation = 0;
      const moveDirX = Math.sign(destTile.x - fromTile.x) || 1;
      let samuraiHp = 0.56;
      if (released && isKill) {
        samuraiHp = lerp(0.56, 0.91, clamp(releaseElapsed / 320, 0, 1));
      }

      const evalPos = (ms) => (isLegacy
        ? evalLegacyLShape(fromTile.x, fromTile.y, destTile.x, destTile.y, ms, flightMs)
        : evalSamuraiThreePhase(fromTile.x, fromTile.y, destTile.x, destTile.y, ms));

      if (rawElapsed < impactAt) {
        const pos = evalPos(rawElapsed);
        sx = pos.x;
        sy = pos.y;
        gx = pos.groundX;
        gy = pos.groundY;
        lift = pos.lift;

        if (!isLegacy) {
          if (rawElapsed <= SAMURAI_PHASE1_MS) {
            currentPhaseLabel = '阶段 1/4 · 起跳缓出跃升 (0~0.25s)';
            const u1 = rawElapsed / SAMURAI_PHASE1_MS;
            scaleX = 1 - 0.12 * (1 - u1);
            scaleY = 1 + 0.16 * (1 - u1);
            rotation = -0.18 * moveDirX * (1 - u1 * 0.5);
            // Takeoff ground burst wave
            if (rawElapsed < 170) {
              const dp = rawElapsed / 170;
              ctx.save();
              ctx.translate(fromTile.x, fromTile.y + grid.size * 0.08);
              ctx.scale(1, 0.54);
              ctx.globalAlpha = (1 - dp) * 0.78;
              ctx.strokeStyle = '#ffd199';
              ctx.lineWidth = 2.6;
              ctx.beginPath();
              ctx.arc(0, 0, grid.size * (0.28 + dp * 0.9), 0, Math.PI * 2);
              ctx.stroke();
              ctx.restore();
            }
          } else if (rawElapsed <= SAMURAI_PHASE2_MS) {
            currentPhaseLabel = '阶段 2/4 · 零重力最高点滑行滞空 (0.25~0.45s)';
            const u2 = (rawElapsed - SAMURAI_PHASE1_MS) / (SAMURAI_PHASE2_MS - SAMURAI_PHASE1_MS);
            scaleX = 1.02;
            scaleY = 0.98;
            rotation = moveDirX * (-0.08 + u2 * 0.20);
          } else {
            currentPhaseLabel = '阶段 3/4 · 3倍重力+冲量极速闪现斩击 (0.45s+)';
            rotation = moveDirX * 0.30;
            scaleX = 0.88;
            scaleY = 1.15;
          }
        }

        // Phase 2 -> 3 critical burst ring at t = 450ms
        if (!isLegacy && rawElapsed >= SAMURAI_PHASE2_MS) {
          const fp = clamp((rawElapsed - SAMURAI_PHASE2_MS) / 140, 0, 1);
          const burstPos = evalPos(SAMURAI_PHASE2_MS);
          ctx.save();
          ctx.globalAlpha = 1 - fp;
          ctx.strokeStyle = '#fff1d6';
          ctx.shadowColor = '#ff4d40';
          ctx.shadowBlur = 14;
          ctx.lineWidth = 3.2 * (1 - fp * 0.6);
          ctx.beginPath();
          ctx.arc(burstPos.x, burstPos.y, 12 + fp * 36, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Curved blade trail ribbon (extra bold & tapered in Phase 3 flash dive)
        const trailSpanMs = pos.phase === 3 ? 135 : 170;
        const tStart = Math.max(0, rawElapsed - trailSpanMs);
        const steps = 18;
        const pts = [];
        for (let k = 0; k <= steps; k++) {
          pts.push(evalPos(lerp(tStart, rawElapsed, k / steps)));
        }
        if (pts.length > 1) {
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (let k = 1; k < pts.length; k++) {
            const frac = k / (pts.length - 1);
            const p0 = pts[k - 1];
            const p1 = pts[k];
            ctx.strokeStyle = pos.phase === 3 ? `rgba(255, 52, 42, ${0.3 + 0.65 * frac})` : `rgba(232, 72, 56, ${0.2 + 0.55 * frac})`;
            ctx.shadowColor = '#ff3b30';
            ctx.shadowBlur = pos.phase === 3 ? 18 : 10;
            ctx.lineWidth = (pos.phase === 3 ? 13.5 : 8) * (0.2 + 0.8 * frac);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();

            ctx.shadowBlur = 0;
            ctx.strokeStyle = `rgba(255, 246, 224, ${0.25 + 0.72 * frac})`;
            ctx.lineWidth = (pos.phase === 3 ? 4.4 : 2.6) * (0.2 + 0.8 * frac);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
          }
          ctx.restore();
        }

        // Motion afterimages: 6 tight echoes during 3g flash dive, 3 subtle echoes earlier
        const ghostCount = pos.phase === 3 ? 6 : 3;
        const ghostStepMs = pos.phase === 3 ? 15 : 32;
        for (let g = ghostCount; g >= 1; g--) {
          const tg = rawElapsed - g * ghostStepMs;
          if (tg <= 0) continue;
          const pg = evalPos(tg);
          drawUnitAt(ctx, pg.x, pg.y, grid.size, friendlyPalette, {
            archetype: 'samurai',
            health: samuraiHp,
            relation: 'self',
            alpha: ((ghostCount + 1 - g) / (ghostCount + 1)) * (pos.phase === 3 ? 0.34 : 0.16),
            drawShadow: false,
            showFlag: false,
            rotation: rotation * 0.75
          });
        }
      } else {
        sx = destTile.x;
        sy = destTile.y;
        gx = destTile.x;
        gy = destTile.y;
        if (inHitstop) {
          currentPhaseLabel = '阶段 4/4 · 0.08s 命中顿帧 (Hitstop)';
          scaleX = 1.12;
          scaleY = 0.88;
          rotation = moveDirX * 0.24;
          sy += 2;
        } else if (releaseElapsed < settleMs) {
          currentPhaseLabel = '阶段 4/4 · 强震 + 地面冲击波 + 碎石飞溅';
          const sp = releaseElapsed / settleMs;
          const squash = Math.sin(sp * Math.PI);
          scaleX = 1 + 0.14 * squash;
          scaleY = 1 - 0.12 * squash;
          sy += 3 * squash;
        } else {
          currentPhaseLabel = '阶段 4/4 · 强震 + 地面冲击波 + 碎石飞溅';
        }
      }

      const heightNorm = clamp(lift / 96, 0, 1);
      drawUnitAt(ctx, sx, sy, grid.size, friendlyPalette, {
        archetype: 'samurai',
        health: samuraiHp,
        relation: 'self',
        scaleX,
        scaleY,
        rotation,
        shadowX: gx,
        shadowY: gy,
        shadowScale: 1 - 0.44 * heightNorm,
        shadowAlpha: 0.38 - 0.20 * heightNorm
      });

      // Phase 2 Apex Cold Blade Glint (visual anchor during zero-gravity hover)
      if (!isLegacy && rawElapsed >= SAMURAI_PHASE1_MS && rawElapsed <= SAMURAI_PHASE2_MS + 35) {
        const u2 = clamp((rawElapsed - SAMURAI_PHASE1_MS) / (SAMURAI_PHASE2_MS - SAMURAI_PHASE1_MS), 0, 1);
        const glintPulse = Math.sin(Math.min(1, u2) * Math.PI);
        const bx = sx + moveDirX * grid.size * 0.28;
        const by = sy - grid.size * 0.18;
        const rayLen = grid.size * (0.48 + 0.34 * glintPulse);
        ctx.save();
        ctx.globalAlpha = 0.4 + 0.6 * glintPulse;
        ctx.translate(bx, by);
        ctx.strokeStyle = '#fff8dc';
        ctx.shadowColor = '#ffd166';
        ctx.shadowBlur = 16;
        ctx.lineWidth = 2.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-rayLen, 0);
        ctx.lineTo(rayLen, 0);
        ctx.moveTo(0, -rayLen * 0.72);
        ctx.lineTo(0, rayLen * 0.72);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 118, 92, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, grid.size * (0.48 - 0.22 * u2), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // L-style straight katana streak: grows with the dash, overshoots through target on impact, holds during hitstop
      if (!isLegacy && rawElapsed >= SAMURAI_PHASE2_MS) {
        const a = evalPos(SAMURAI_PHASE2_MS);
        const ddx = destTile.x - a.x;
        const ddy = destTile.y - a.y;
        const len = Math.hypot(ddx, ddy) || 1;
        const ux = ddx / len;
        const uy = ddy / len;
        let headX;
        let headY;
        let streakAlpha = 1;
        if (rawElapsed < impactAt) {
          const p = evalPos(rawElapsed);
          headX = p.x;
          headY = p.y;
        } else {
          const fadeT = inHitstop ? 0 : clamp(releaseElapsed / 240, 0, 1);
          streakAlpha = 1 - fadeT;
          const overshoot = grid.size * (0.95 + 0.35 * fadeT);
          headX = destTile.x + ux * overshoot;
          headY = destTile.y + uy * overshoot;
        }
        if (streakAlpha > 0.01) {
          const tailX = a.x - ux * grid.size * 0.3;
          const tailY = a.y - uy * grid.size * 0.3;
          ctx.save();
          ctx.globalAlpha = streakAlpha;
          ctx.lineCap = 'butt';
          ctx.strokeStyle = 'rgba(255, 36, 36, 0.6)';
          ctx.shadowColor = '#ff2a2a';
          ctx.shadowBlur = 20;
          ctx.lineWidth = inHitstop ? 9 : 7;
          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(headX, headY);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#fffaf2';
          ctx.lineWidth = inHitstop ? 3 : 2.2;
          ctx.beginPath();
          ctx.moveTo(lerp(tailX, headX, 0.15), lerp(tailY, headY, 0.15));
          ctx.lineTo(headX, headY);
          ctx.stroke();
          // Sharp blade tip glint
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(headX + ux * 10, headY + uy * 10);
          ctx.lineTo(headX - uy * 3.2, headY + ux * 3.2);
          ctx.lineTo(headX + uy * 3.2, headY - ux * 3.2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      // Impact slash arc (held bright during 80ms hitstop!), flying rock shards, sparks & combat text
      if (hasImpacted) {
        const ang = Math.atan2(targetTile.y - fromTile.y, targetTile.x - fromTile.x);
        const slashProg = inHitstop ? 0 : releaseElapsed / 280;
        if (slashProg < 1) {
          const r = grid.size * (0.98 + slashProg * 0.48);
          ctx.save();
          ctx.globalAlpha = inHitstop ? 1.0 : 1 - slashProg;
          ctx.lineCap = 'round';
          ctx.shadowColor = '#ff2a2a';
          ctx.shadowBlur = inHitstop ? 26 : 18;
          ctx.strokeStyle = '#fff9f0';
          ctx.lineWidth = (inHitstop ? 9 : 7) * (1 - slashProg * 0.65);
          ctx.beginPath();
          ctx.arc(targetTile.x, targetTile.y, r, ang - 1.22, ang + 1.22);
          ctx.stroke();
          ctx.strokeStyle = '#ff6b5b';
          ctx.lineWidth = (inHitstop ? 3.8 : 2.8) * (1 - slashProg * 0.5);
          ctx.beginPath();
          ctx.arc(targetTile.x, targetTile.y, r * 0.8, ang - 0.96, ang + 0.96);
          ctx.stroke();
          ctx.restore();
        }

        if (released) {
          // Physical debris shards bouncing on ground
          for (const shard of sampleDebrisShards(destTile.x, destTile.y + grid.size * 0.08, releaseElapsed, 660, 18)) {
            ctx.save();
            ctx.globalAlpha = shard.alpha * 0.45;
            ctx.fillStyle = '#0e0c09';
            ctx.beginPath();
            ctx.ellipse(shard.x, shard.groundY, shard.size * 0.9, shard.size * 0.45, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = shard.alpha;
            ctx.translate(shard.x, shard.y);
            ctx.rotate(shard.rot);
            ctx.fillStyle = shard.color;
            ctx.strokeStyle = '#1e1912';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(-shard.size, -shard.size * shard.aspect * 0.6);
            ctx.lineTo(shard.size * 0.7, -shard.size * shard.aspect);
            ctx.lineTo(shard.size, shard.size * shard.aspect * 0.7);
            ctx.lineTo(-shard.size * 0.5, shard.size * shard.aspect);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }

          // Directional crimson sparks
          for (const pt of sampleArcParticles(19, targetTile.x, targetTile.y, Math.cos(ang), Math.sin(ang), releaseElapsed, 360, 18, '#fb7185')) {
            ctx.save();
            ctx.globalAlpha = pt.alpha;
            ctx.fillStyle = pt.color;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          // Outlined floating combat text (zero anti-heal indicator)
          if (releaseElapsed < 880) {
            const fp = releaseElapsed / 880;
            const rise = fp * grid.size * 0.78;
            const alpha = fp < 0.7 ? 1 : 1 - (fp - 0.7) / 0.3;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.textAlign = 'center';
            ctx.font = `800 ${Math.round(grid.size * 0.42)}px "Palatino Linotype", serif`;
            drawOutlinedText(ctx, isKill ? '-92 斩杀!' : '-68', targetTile.x, targetTile.y - grid.size * 0.68 - rise, isKill ? '#ffd166' : '#ff6b5b', 4.6);
            if (isKill) {
              ctx.font = `700 ${Math.round(grid.size * 0.30)}px "Microsoft YaHei", sans-serif`;
              drawOutlinedText(ctx, '+73 HP · ⚔️ 再动', destTile.x, destTile.y - grid.size * 1.18 - rise, '#6ef29b', 4.2);
            }
            ctx.restore();
          }
        }
      }
    }

    ctx.restore();

    const modeTitle = state.samuraiMode === 'parabola'
      ? '三段式蓄力跳斩（新）'
      : (state.samuraiMode === 'legacy' ? '单点 L 型轨迹（旧）' : '新旧轨迹叠加对比');
    drawModePlate(
      ctx, width, height,
      modeTitle,
      `0.25s↗ 0.45s(0g)→ 0.54s 直线闪斩⚡ +0.08s hitstop · ${state.samuraiSlow ? '0.35x' : '1.0x'}`,
      currentPhaseLabel,
      '#ff705c'
    );
  }

  // =========================================================
  // 06B · GUERRILLA SNIPER LONG-RANGE PIERCING SHOT
  // =========================================================

  const SNIPER_ORIGIN_KEY = '-4,0';
  const SNIPER_RANGE = 7;
  const SNIPER_BASE_DMG = 48;

  function createSniperInitialTargets() {
    return [
      { key: '-2,0', archetype: 'infantry', hp: 0.76, maxHpVal: 120, name: '敌步兵' },
      { key: '0,0', archetype: 'cavalry', hp: 0.84, maxHpVal: 145, name: '敌骑兵' },
      { key: '2,0', archetype: 'cannon', hp: 0.92, maxHpVal: 170, name: '重炮阵列' },
      { key: '-2,-2', archetype: 'infantry', hp: 0.72, maxHpVal: 120, name: '北翼步兵' },
      { key: '-2,-1', archetype: 'infantry', hp: 0.68, maxHpVal: 120, name: '侧翼哨兵' },
      { key: '0,-2', archetype: 'cavalry', hp: 0.86, maxHpVal: 145, name: '高地骑兵' },
      { key: '-4,2', archetype: 'infantry', hp: 0.80, maxHpVal: 120, name: '南翼守军' },
      { key: '3,-1', archetype: 'cavalry', hp: 0.74, maxHpVal: 145, name: '东翼轻骑' }
    ];
  }

  let sniperTargets = createSniperInitialTargets();

  function computeDmgBreakdown(targetTile, originTile, pierceIdx) {
    const dist = hexDistance(originTile, targetTile);
    if (state.sniperScaling === 'pierce') {
      const bonusPct = pierceIdx * 15;
      const dmg = Math.round(SNIPER_BASE_DMG * (1 + bonusPct / 100));
      return { dmg, tag: bonusPct > 0 ? `+${bonusPct}%穿透` : '首穿' };
    }
    if (state.sniperScaling === 'distance') {
      const bonusPct = Math.max(0, (dist - 1) * 8);
      const dmg = Math.round(SNIPER_BASE_DMG * (1 + bonusPct / 100));
      return { dmg, tag: `${dist}格 +${bonusPct}%` };
    }
    const bonusPct = pierceIdx * 12 + Math.max(0, (dist - 1) * 6);
    const dmg = Math.round(SNIPER_BASE_DMG * (1 + bonusPct / 100));
    return { dmg, tag: `+${bonusPct}%综合` };
  }

  function computeSniperRay(grid, originTile, aimX, aimY) {
    const targetByKey = new Map(sniperTargets.filter(t => t.hp > 0).map(t => [t.key, t]));
    const dx = aimX - originTile.x;
    const dy = aimY - originTile.y;
    const dirLen = Math.hypot(dx, dy);

    let rayTiles = [];
    let ux = 1;
    let uy = 0;

    if (state.sniperRay === 'hexAxis') {
      let bestDir = HEX_DIRECTIONS[1]; // East default
      let bestDot = -Infinity;
      if (dirLen > grid.size * 0.25) {
        const ndx = dx / dirLen;
        const ndy = dy / dirLen;
        for (const dir of HEX_DIRECTIONS) {
          const p = axialToPixel(dir.q, dir.r, 1, 0, 0);
          const plen = Math.hypot(p.x, p.y);
          const dot = (p.x / plen) * ndx + (p.y / plen) * ndy;
          if (dot > bestDot) {
            bestDot = dot;
            bestDir = dir;
          }
        }
      }
      const stepVec = axialToPixel(bestDir.q, bestDir.r, 1, 0, 0);
      const slen = Math.hypot(stepVec.x, stepVec.y);
      ux = stepVec.x / slen;
      uy = stepVec.y / slen;
      for (let k = 1; k <= SNIPER_RANGE; k++) {
        const t = grid.tileMap.get(tileKey(originTile.q + bestDir.q * k, originTile.r + bestDir.r * k));
        if (t) rayTiles.push(t);
      }
    } else {
      if (dirLen > grid.size * 0.25) {
        ux = dx / dirLen;
        uy = dy / dirLen;
      }
      const maxReach = (SNIPER_RANGE + 0.35) * SQRT3 * grid.size;
      const corridorHalfWidth = grid.size * 0.72;
      const candidates = [];
      for (const t of grid.tiles) {
        if (t.key === originTile.key) continue;
        const vx = t.x - originTile.x;
        const vy = t.y - originTile.y;
        const proj = vx * ux + vy * uy;
        if (proj <= grid.size * 0.45 || proj > maxReach) continue;
        const lat = Math.abs(vx * (-uy) + vy * ux);
        if (lat <= corridorHalfWidth) {
          candidates.push({ tile: t, proj });
        }
      }
      candidates.sort((a, b) => a.proj - b.proj);
      rayTiles = candidates.map(c => c.tile);
    }

    const hitList = [];
    let pierceIdx = 0;
    for (const tile of rayTiles) {
      const target = targetByKey.get(tileKey(tile.q, tile.r));
      if (!target) continue;
      const proj = (tile.x - originTile.x) * ux + (tile.y - originTile.y) * uy;
      const breakdown = computeDmgBreakdown(tile, originTile, pierceIdx);
      hitList.push({
        target,
        tile,
        order: pierceIdx + 1,
        proj,
        ...breakdown
      });
      pierceIdx++;
    }

    const lastTile = rayTiles.length ? rayTiles[rayTiles.length - 1] : originTile;
    const endProj = Math.max(
      grid.size * 2.2,
      (lastTile.x - originTile.x) * ux + (lastTile.y - originTile.y) * uy + grid.size * 0.45
    );
    const lockHit = hitList.length ? hitList[hitList.length - 1] : null;
    return {
      ux,
      uy,
      rayTiles,
      hitList,
      lockHit,
      lockPoint: lockHit ? { x: lockHit.tile.x, y: lockHit.tile.y } : { x: lastTile.x, y: lastTile.y },
      endPoint: { x: originTile.x + ux * endProj, y: originTile.y + uy * endProj },
      endProj
    };
  }

  function drawCorridorHighlight(ctx, grid, rayTiles, originTile, ux, uy, endPoint, timeSec, lockIntensity = 0) {
    if (!rayTiles.length) return;
    const keySet = new Set(rayTiles.map(t => tileKey(t.q, t.r)));
    ctx.save();

    // 1. Strip interior glowing highlight
    for (let idx = 0; idx < rayTiles.length; idx++) {
      const t = rayTiles[idx];
      const pulse = 0.5 + 0.5 * Math.sin(timeSec * 4.5 - idx * 0.65);
      hexPath(ctx, t.x, t.y, grid.size * 0.99);
      ctx.fillStyle = lockIntensity > 0
        ? `rgba(255, 76, 56, ${0.14 + lockIntensity * 0.14 + pulse * 0.04})`
        : `rgba(255, 118, 62, ${0.16 + pulse * 0.06})`;
      ctx.fill();
    }

    // 2. Outer connected corridor outline
    ctx.beginPath();
    for (const t of rayTiles) {
      HEX_DIRECTIONS.forEach((dir, idx) => {
        if (keySet.has(tileKey(t.q + dir.q, t.r + dir.r))) return;
        const a = hexPoint(t.x, t.y, grid.size * 0.99, idx);
        const b = hexPoint(t.x, t.y, grid.size * 0.99, (idx + 1) % 6);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      });
    }
    ctx.strokeStyle = lockIntensity > 0 ? '#ff4d3d' : '#ff9947';
    ctx.lineWidth = grid.size * (lockIntensity > 0 ? 0.075 : 0.055);
    ctx.shadowColor = lockIntensity > 0 ? '#ff3b30' : '#ff7b3b';
    ctx.shadowBlur = grid.size * 0.18;
    ctx.stroke();

    // 3. Center firing axis beam & scrolling chevrons
    ctx.shadowBlur = 6;
    ctx.strokeStyle = lockIntensity > 0 ? `rgba(255, 74, 74, ${0.55 + lockIntensity * 0.4})` : 'rgba(255, 200, 118, 0.72)';
    ctx.lineWidth = lockIntensity > 0 ? 1.8 : 2.1;
    ctx.setLineDash(lockIntensity > 0 ? [] : [8, 7]);
    ctx.lineDashOffset = -timeSec * 46;
    ctx.beginPath();
    ctx.moveTo(originTile.x + ux * grid.size * 0.45, originTile.y + uy * grid.size * 0.45);
    ctx.lineTo(endPoint.x, endPoint.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Forward direction arrow tip at endPoint
    const ang = Math.atan2(uy, ux);
    const tip = 9;
    ctx.fillStyle = lockIntensity > 0 ? '#ff4a4a' : '#ffbe76';
    ctx.beginPath();
    ctx.moveTo(endPoint.x, endPoint.y);
    ctx.lineTo(endPoint.x - Math.cos(ang - 0.45) * tip, endPoint.y - Math.sin(ang - 0.45) * tip);
    ctx.lineTo(endPoint.x - Math.cos(ang + 0.45) * tip, endPoint.y - Math.sin(ang + 0.45) * tip);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawRedSniperReticle(ctx, x, y, size, alpha, scale, rotation, lockedPulse = 0) {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(scale, scale);
    ctx.globalAlpha = clamp(alpha, 0, 1);

    const rOuter = size * 0.64;
    const rInner = size * 0.36;

    // Dark contrast halo so red reticle pops cleanly against any palette tile
    ctx.strokeStyle = 'rgba(18, 4, 4, 0.72)';
    ctx.lineWidth = 5.4;
    ctx.beginPath();
    ctx.arc(0, 0, rOuter, 0, Math.PI * 2);
    ctx.stroke();

    // Glowing crimson outer ring
    ctx.strokeStyle = '#ff2626';
    ctx.shadowColor = '#ff1e1e';
    ctx.shadowBlur = 16 + lockedPulse * 8;
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.arc(0, 0, rOuter, 0, Math.PI * 2);
    ctx.stroke();

    // Inner segmented reticle circle
    ctx.strokeStyle = '#ff7266';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      const a0 = i * Math.PI / 2 + 0.24;
      const a1 = (i + 1) * Math.PI / 2 - 0.24;
      ctx.beginPath();
      ctx.arc(0, 0, rInner, a0, a1);
      ctx.stroke();
    }

    // 4-way precision crosshair ticks
    ctx.strokeStyle = '#ff2e2e';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    const gap = size * 0.14;
    const ext = rOuter * 1.24;
    for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath();
      ctx.moveTo(sx * gap, sy * gap);
      ctx.lineTo(sx * ext, sy * ext);
      ctx.stroke();
    }

    // Center bright crimson & white lock-on core
    ctx.fillStyle = '#ff3838';
    ctx.beginPath();
    ctx.arc(0, 0, size * (0.095 + lockedPulse * 0.025), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff5f5';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.038, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function triggerSniperCast(grid, originTile, rayInfo) {
    if (!originTile || !rayInfo.rayTiles.length) return;
    // Restore downed targets on this corridor automatically if all targets on it are already dead
    if (rayInfo.hitList.length === 0) {
      const freshByKey = new Map(createSniperInitialTargets().map(t => [t.key, t]));
      for (const tile of rayInfo.rayTiles) {
        const k = tileKey(tile.q, tile.r);
        const existing = sniperTargets.find(t => t.key === k);
        const fresh = freshByKey.get(k);
        if (existing && fresh) existing.hp = fresh.hp;
      }
      rayInfo = computeSniperRay(grid, originTile, state.sniperHoverX ?? originTile.x + 200, state.sniperHoverY ?? originTile.y);
    }

    state.sniperCast = {
      startTime: performance.now(),
      ux: rayInfo.ux,
      uy: rayInfo.uy,
      rayKeys: rayInfo.rayTiles.map(t => tileKey(t.q, t.r)),
      endProj: rayInfo.endProj,
      endPoint: { ...rayInfo.endPoint },
      lockPoint: { ...rayInfo.lockPoint },
      hits: rayInfo.hitList.map(h => ({
        key: tileKey(h.tile.q, h.tile.r),
        x: h.tile.x,
        y: h.tile.y,
        proj: h.proj,
        order: h.order,
        dmg: h.dmg,
        tag: h.tag,
        hpBefore: h.target.hp,
        hpAfter: Math.max(0, h.target.hp - h.dmg / h.target.maxHpVal),
        applied: false
      }))
    };
  }

  function renderSniperPreview(now) {
    if (!sniperCanvas) return;
    const { ctx, width, height } = prepareCanvas(sniperCanvas);
    const grid = buildRectHexGrid(width, height, 11, 5, 0.50, 0.56, 15.8, 7.6);
    const originTile = grid.tileMap.get(SNIPER_ORIGIN_KEY);

    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, '#171914');
    bg.addColorStop(1, '#0c0e0d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const timeSec = now * 0.001;
    const fadeInMs = 360;
    const holdMs = 280;
    const fireAt = fadeInMs + holdMs; // 640ms
    const flightMs = 380;
    const settleEnd = fireAt + flightMs + 820;
    const slowScale = state.sniperSlow ? 0.4 : 1.0;

    let cast = state.sniperCast;
    let castElapsed = -1;
    if (cast) {
      castElapsed = state.sniperPaused
        ? state.sniperFrozenElapsed
        : (now - cast.startTime) * slowScale;
      if (!state.sniperPaused) {
        state.sniperFrozenElapsed = castElapsed;
      }
    }
    if (cast && castElapsed >= settleEnd) {
      state.sniperCast = null;
      state.sniperPaused = false;
      const pauseBtn = document.getElementById('sniperPauseBtn');
      if (pauseBtn) pauseBtn.classList.remove('active');
      cast = null;
      castElapsed = -1;
    }

    // Active ray geometry (locked during cast, live hover otherwise)
    let rayInfo;
    if (cast) {
      const rayTiles = cast.rayKeys.map(k => grid.tileMap.get(k)).filter(Boolean);
      const scaleLast = cast.hits.length ? cast.hits[cast.hits.length - 1] : null;
      rayInfo = {
        ux: cast.ux,
        uy: cast.uy,
        rayTiles,
        hitList: [],
        lockPoint: scaleLast ? { x: scaleLast.x, y: scaleLast.y } : (rayTiles.length ? { x: rayTiles[rayTiles.length - 1].x, y: rayTiles[rayTiles.length - 1].y } : { x: originTile.x, y: originTile.y }),
        endPoint: {
          x: originTile.x + cast.ux * cast.endProj,
          y: originTile.y + cast.uy * cast.endProj
        },
        endProj: cast.endProj
      };
    } else {
      const aimX = state.sniperHoverX ?? (originTile.x + 280);
      const aimY = state.sniperHoverY ?? originTile.y;
      rayInfo = computeSniperRay(grid, originTile, aimX, aimY);
    }

    // Compute bullet progress and hit impacts if fired
    let bulletProj = -1;
    let recoilOffset = 0;
    let shakeX = 0;
    let shakeY = 0;
    if (cast && castElapsed >= fireAt) {
      const flyT = clamp((castElapsed - fireAt) / flightMs, 0, 1);
      bulletProj = flyT * cast.endProj;
      const fireSince = castElapsed - fireAt;
      if (fireSince < 220) {
        recoilOffset = 7.5 * Math.exp(-fireSince / 65);
      }
      // Trigger HP damage & check final hit shake
      for (let hi = 0; hi < cast.hits.length; hi++) {
        const h = cast.hits[hi];
        const hitTimeOffset = (h.proj / cast.endProj) * flightMs;
        const sinceHit = fireSince - hitTimeOffset;
        if (sinceHit >= 0) {
          if (!h.applied) {
            h.applied = true;
            const liveTarget = sniperTargets.find(t => t.key === h.key);
            if (liveTarget) liveTarget.hp = h.hpAfter;
          }
          if (hi === cast.hits.length - 1 && sinceHit < 210) {
            const mag = 5.2 * (1 - sinceHit / 210);
            shakeX = Math.sin(sinceHit * 0.31) * mag;
            shakeY = Math.cos(sinceHit * 0.39) * mag * 0.7;
          }
        }
      }
    } else if (cast) {
      // Slight pull-back readiness during lock-on
      recoilOffset = 2.5 * clamp(castElapsed / fadeInMs, 0, 1);
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);

    for (const tile of grid.tiles) {
      drawTileBase(ctx, tile, grid.size, PALETTES[state.palette]);
      drawTerrainDecor(ctx, tile, grid.size);
      drawHexOutline(ctx, tile, grid.size);
    }

    // 1. Highlight strip tiles (条形高亮地块)
    const lockIntensity = cast ? clamp(castElapsed / fadeInMs, 0, 1) * (castElapsed > fireAt + flightMs ? clamp(1 - (castElapsed - fireAt - flightMs) / 300, 0, 1) : 1) : 0;
    drawCorridorHighlight(ctx, grid, rayInfo.rayTiles, originTile, rayInfo.ux, rayInfo.uy, rayInfo.endPoint, timeSec, lockIntensity);

    // Source ring on sniper tile
    if (originTile) {
      ctx.save();
      hexPath(ctx, originTile.x, originTile.y, grid.size * 0.96);
      ctx.strokeStyle = '#69c7e8';
      ctx.lineWidth = grid.size * 0.05;
      ctx.stroke();
      ctx.restore();
    }

    // Lookup hit event info by key for target animation
    const castHitByKey = new Map(cast ? cast.hits.map(h => [h.key, h]) : []);
    const hoverHitByKey = new Map(rayInfo.hitList.map(h => [tileKey(h.tile.q, h.tile.r), h]));

    // 2. Render targets
    for (const target of sniperTargets) {
      if (target.hp <= 0) {
        const dt = grid.tileMap.get(target.key);
        const hEv = castHitByKey.get(target.key);
        if (dt && hEv) {
          const hitSince = castElapsed - (fireAt + (hEv.proj / cast.endProj) * flightMs);
          if (hitSince < 240) {
            drawUnitAt(ctx, dt.x, dt.y, grid.size, ENEMY_PALETTE, {
              archetype: target.archetype,
              health: 0,
              relation: 'enemy',
              alpha: clamp(1 - hitSince / 240, 0, 1),
              hitFlash: clamp(1 - hitSince / 150, 0, 1)
            });
          }
        }
        continue;
      }
      const tile = grid.tileMap.get(target.key);
      if (!tile) continue;
      let tx = tile.x;
      let ty = tile.y;
      let hitFlash = 0;
      const hEv = castHitByKey.get(target.key);
      if (cast && hEv) {
        const hitSince = castElapsed - (fireAt + (hEv.proj / cast.endProj) * flightMs);
        if (hitSince >= 0 && hitSince < 200) {
          const kick = Math.exp(-hitSince / 60) * 6.5;
          tx += cast.ux * kick;
          ty += cast.uy * kick;
          hitFlash = clamp(1 - hitSince / 170, 0, 1);
        }
      }
      drawUnitAt(ctx, tx, ty, grid.size, ENEMY_PALETTE, {
        archetype: target.archetype,
        health: target.hp,
        relation: 'enemy',
        hitFlash
      });

      const hoverHit = hoverHitByKey.get(target.key);
      if (!cast && hoverHit) {
        const isFarthest = rayInfo.lockHit && rayInfo.lockHit === hoverHit;
        drawTargetingBrackets(ctx, tile, grid.size, isFarthest ? '#ff3b30' : '#ff7b54', timeSec, true, `#${hoverHit.order}`);
        // High-contrast compact dark capsule at bottom of tile, completely clear of top flag and #order badge
        ctx.save();
        ctx.font = `700 ${Math.max(10, Math.round(grid.size * 0.25))}px "Microsoft YaHei", sans-serif`;
        const txt = `-${hoverHit.dmg} · ${hoverHit.tag}`;
        const pw = ctx.measureText(txt).width + 12;
        const ph = Math.max(16, Math.round(grid.size * 0.36));
        const px = tile.x;
        const py = tile.y + grid.size * 0.72;
        ctx.fillStyle = 'rgba(13, 10, 9, 0.92)';
        ctx.strokeStyle = isFarthest ? '#ff443a' : '#ff8a4c';
        ctx.lineWidth = 1.1;
        ctx.fillRect(px - pw / 2, py - ph / 2, pw, ph);
        ctx.strokeRect(px - pw / 2, py - ph / 2, pw, ph);
        ctx.fillStyle = isFarthest ? '#ffada6' : '#ffe0b2';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, px, py + 0.5);
        ctx.restore();
      } else if (cast && hEv) {
        drawTargetingBrackets(ctx, tile, grid.size, '#ff4d40', timeSec, true, `#${hEv.order}`);
      }
    }

    // 3. Render Sniper Unit (with recoil)
    if (originTile) {
      drawUnitAt(
        ctx,
        originTile.x - rayInfo.ux * recoilOffset,
        originTile.y - rayInfo.uy * recoilOffset,
        grid.size,
        CPC_PALETTE,
        { archetype: 'sniper', health: 0.92, relation: 'self' }
      );
    }

    // 4. Farthest Target Red Crosshair Icon Fade-In & Lock-On
    if (cast && castElapsed >= 0) {
      const lp = rayInfo.lockPoint;
      if (castElapsed < fireAt) {
        const tIn = clamp(castElapsed / fadeInMs, 0, 1);
        const ease = 1 - Math.pow(1 - tIn, 3);
        const rot = (1 - ease) * (-0.36);
        const scale = lerp(1.62, 1.0, ease);
        const pulse = castElapsed >= fadeInMs ? (0.5 + 0.5 * Math.sin((castElapsed - fadeInMs) * 0.04)) : 0;
        drawRedSniperReticle(ctx, lp.x, lp.y + grid.size * 0.035, grid.size, ease, scale, rot, pulse);
      } else {
        // After fire, keep reticle briefly until bullet passes last hit, then shatter-expand
        const lastHitProj = cast.hits.length ? cast.hits[cast.hits.length - 1].proj : cast.endProj;
        const shatterAt = fireAt + (lastHitProj / cast.endProj) * flightMs;
        if (castElapsed < shatterAt) {
          drawRedSniperReticle(ctx, lp.x, lp.y + grid.size * 0.035, grid.size, 1, 1, 0, 1);
        } else {
          const sp = clamp((castElapsed - shatterAt) / 280, 0, 1);
          drawRedSniperReticle(ctx, lp.x, lp.y + grid.size * 0.035, grid.size, 1 - sp, 1 + sp * 0.55, sp * 0.15, 0);
        }
      }
    } else if (!cast && rayInfo.lockHit) {
      // Subtle dashed preview reticle on farthest target during hover
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.strokeStyle = '#ff443a';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(rayInfo.lockPoint.x, rayInfo.lockPoint.y + grid.size * 0.035, grid.size * 0.58, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 5. Muzzle Blast, Bullet Flight, Through-Shot Sparks & Floating Damage
    if (cast && castElapsed >= fireAt) {
      const fireSince = castElapsed - fireAt;
      const muzzleX = originTile.x + rayInfo.ux * grid.size * 0.44;
      const muzzleY = originTile.y + rayInfo.uy * grid.size * 0.44;
      const fireAng = Math.atan2(rayInfo.uy, rayInfo.ux);

      // Muzzle flash & sonic ring
      if (fireSince < 220) {
        const mp = fireSince / 220;
        ctx.save();
        ctx.translate(muzzleX, muzzleY);
        ctx.rotate(fireAng);
        ctx.globalAlpha = 1 - mp;
        ctx.fillStyle = '#fff3d1';
        ctx.shadowColor = '#ff7b29';
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(grid.size * (0.95 - mp * 0.3), -grid.size * 0.24 * (1 - mp * 0.5));
        ctx.lineTo(grid.size * (1.28 - mp * 0.2), 0);
        ctx.lineTo(grid.size * (0.95 - mp * 0.3), grid.size * 0.24 * (1 - mp * 0.5));
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = (1 - mp) * 0.72;
        ctx.strokeStyle = '#ffb36b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(muzzleX, muzzleY, 6 + mp * grid.size * 0.85, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Lingering vapor & bright wake behind bullet
      const headProj = Math.min(cast.endProj, bulletProj);
      const wakeFade = fireSince <= flightMs ? 1 : clamp(1 - (fireSince - flightMs) / 480, 0, 1);
      if (wakeFade > 0.01) {
        const hx = originTile.x + rayInfo.ux * headProj;
        const hy = originTile.y + rayInfo.uy * headProj;
        const tailProj = Math.max(grid.size * 0.44, headProj - grid.size * (fireSince <= flightMs ? 4.2 : 6.0));
        const tx = originTile.x + rayInfo.ux * tailProj;
        const ty = originTile.y + rayInfo.uy * tailProj;
        ctx.save();
        ctx.globalAlpha = wakeFade;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255, 86, 52, 0.52)';
        ctx.shadowColor = '#ff5733';
        ctx.shadowBlur = 14;
        ctx.lineWidth = 5.5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(hx, hy);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 245, 224, 0.94)';
        ctx.lineWidth = 2.1;
        ctx.beginPath();
        ctx.moveTo(lerp(tx, hx, 0.35), lerp(ty, hy, 0.35));
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.restore();
      }

      // High-speed supersonic sniper round
      if (fireSince <= flightMs) {
        const bx = originTile.x + rayInfo.ux * bulletProj;
        const by = originTile.y + rayInfo.uy * bulletProj;
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(fireAng);
        ctx.shadowColor = '#ff4d2e';
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#fffaf0';
        ctx.beginPath();
        ctx.ellipse(0, 0, 14, 3.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ff9a42';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-4, -9);
        ctx.lineTo(14, 0);
        ctx.lineTo(-4, 9);
        ctx.stroke();
        ctx.restore();
      }

      // Individual piercing hit FX & damage numbers at exact crossing instant
      for (let hi = 0; hi < cast.hits.length; hi++) {
        const h = cast.hits[hi];
        const hitAt = (h.proj / cast.endProj) * flightMs;
        const sinceHit = fireSince - hitAt;
        if (sinceHit < 0) continue;

        if (sinceHit < 300) {
          const rp = sinceHit / 300;
          ctx.save();
          ctx.globalAlpha = 1 - rp;
          ctx.strokeStyle = hi === cast.hits.length - 1 ? '#ff2a2a' : '#ff9f43';
          ctx.lineWidth = hi === cast.hits.length - 1 ? 3.4 : 2.4;
          ctx.beginPath();
          ctx.arc(h.x, h.y, 10 + rp * grid.size * (hi === cast.hits.length - 1 ? 1.15 : 0.82), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        // Through-shot exit sparks bursting out the back along ray direction
        for (const pt of sampleArcParticles(100 + hi * 7, h.x, h.y, cast.ux, cast.uy, sinceHit, 320, 12, '#ffae63')) {
          ctx.save();
          ctx.globalAlpha = pt.alpha;
          ctx.fillStyle = pt.color;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        if (sinceHit < 900) {
          const fp = sinceHit / 900;
          const rise = fp * grid.size * 0.88;
          const alpha = fp < 0.72 ? 1 : 1 - (fp - 0.72) / 0.28;
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.textAlign = 'center';
          ctx.font = `800 ${Math.round(grid.size * 0.42)}px "Palatino Linotype", serif`;
          drawOutlinedText(ctx, `-${h.dmg}`, h.x, h.y - grid.size * 0.68 - rise, hi === cast.hits.length - 1 ? '#ff5c4d' : '#ffd166', 4.6);
          ctx.font = `700 ${Math.round(grid.size * 0.27)}px "Microsoft YaHei", sans-serif`;
          drawOutlinedText(ctx, h.tag, h.x, h.y - grid.size * 1.08 - rise, '#ffe3bd', 3.8);
          ctx.restore();
        }
      }
    }

    ctx.restore();

    const phaseNote = !cast
      ? `瞄准中 · ${rayInfo.hitList.length} 名贯通目标（点击画布立即击发）`
      : (castElapsed < fadeInMs
        ? '阶段 1/3 · 最远目标红色准星淡入锁定...'
        : (castElapsed < fireAt
          ? '阶段 2/3 · 屏息锁定 · 即将击发'
          : '阶段 3/3 · 穿甲狙击弹沿线贯穿击伤！'));
    drawModePlate(
      ctx, width, height,
      '中共游击纵队 · 超远距离穿透狙击',
      `${state.sniperRay === 'hexAxis' ? 'hexAxis-7' : 'freeRay-7'} · ${state.sniperScaling} · ${state.sniperSlow ? '0.4x' : '1.0x'}`,
      phaseNote,
      '#ff5c4d'
    );
  }

  // =========================================================
  // CONTROLS & EVENT WIRING
  // =========================================================

  function bindSegments(rootId, dataKey, onChange) {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.addEventListener('click', event => {
      const attr = dataKey.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`);
      const button = event.target.closest(`[data-${attr}]`);
      if (!button) return;
      const value = button.dataset[dataKey];
      for (const sibling of root.querySelectorAll(`[data-${attr}]`)) {
        sibling.classList.toggle('active', sibling === button);
      }
      onChange(value);
    });
  }

  bindSegments('styleControls', 'style', value => { state.style = value; });
  bindSegments('paletteControls', 'palette', value => { state.palette = value; });
  bindSegments('samuraiControls', 'samuraiMode', value => {
    state.samuraiMode = value;
    state.samuraiCastStart = performance.now();
  });
  bindSegments('samuraiControls', 'samuraiOutcome', value => {
    state.samuraiOutcome = value;
    state.samuraiCastStart = performance.now();
  });
  bindSegments('sniperControls', 'sniperRay', value => {
    state.sniperRay = value;
    state.sniperCast = null;
  });
  bindSegments('sniperControls', 'sniperScaling', value => {
    state.sniperScaling = value;
  });

  document.getElementById('textureRange')?.addEventListener('input', event => {
    state.texture = Number(event.target.value) / 100;
    document.getElementById('textureValue').value = `${event.target.value}%`;
  });

  document.getElementById('gridToggle')?.addEventListener('click', event => {
    state.grid = !state.grid;
    event.currentTarget.classList.toggle('active', state.grid);
  });

  document.getElementById('samuraiGuideToggle')?.addEventListener('change', event => {
    state.samuraiGuides = event.target.checked;
  });
  const samuraiPauseBtn = document.getElementById('samuraiPauseBtn');
  const sniperPauseBtn = document.getElementById('sniperPauseBtn');

  function setSamuraiPaused(paused) {
    state.samuraiPaused = paused;
    if (!paused) {
      const sp = state.samuraiSlow ? 0.35 : 1.0;
      state.samuraiCastStart = performance.now() - state.samuraiFrozenElapsed / sp;
    }
    samuraiPauseBtn?.classList.toggle('active', paused);
    if (samuraiPauseBtn) samuraiPauseBtn.textContent = paused ? '继续' : '定格';
  }

  function setSniperPaused(paused) {
    state.sniperPaused = paused;
    if (!paused && state.sniperCast) {
      const sp = state.sniperSlow ? 0.4 : 1.0;
      state.sniperCast.startTime = performance.now() - state.sniperFrozenElapsed / sp;
    }
    sniperPauseBtn?.classList.toggle('active', paused);
    if (sniperPauseBtn) sniperPauseBtn.textContent = paused ? '继续' : '定格';
  }

  document.getElementById('samuraiSlowToggle')?.addEventListener('change', event => {
    state.samuraiSlow = event.target.checked;
    setSamuraiPaused(false);
    state.samuraiCastStart = performance.now();
  });
  document.getElementById('samuraiLoopToggle')?.addEventListener('change', event => {
    state.samuraiAutoLoop = event.target.checked;
    setSamuraiPaused(false);
    state.samuraiCastStart = performance.now();
  });
  document.getElementById('samuraiCastBtn')?.addEventListener('click', () => {
    setSamuraiPaused(false);
    state.samuraiCastStart = performance.now();
  });
  samuraiPauseBtn?.addEventListener('click', () => {
    setSamuraiPaused(!state.samuraiPaused);
  });

  samuraiCanvas?.addEventListener('click', event => {
    const rect = samuraiCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    for (const region of samuraiHitRegions) {
      if (Math.hypot(x - region.x, y - region.y) <= region.radius) {
        state.samuraiTargetKey = region.key;
        setSamuraiPaused(false);
        state.samuraiCastStart = performance.now();
        break;
      }
    }
  });

  document.getElementById('sniperSlowToggle')?.addEventListener('change', event => {
    state.sniperSlow = event.target.checked;
  });
  document.getElementById('sniperCastBtn')?.addEventListener('click', () => {
    if (!sniperCanvas) return;
    setSniperPaused(false);
    const { width, height } = prepareCanvas(sniperCanvas);
    const grid = buildRectHexGrid(width, height, 11, 5, 0.50, 0.56, 15.8, 7.6);
    const originTile = grid.tileMap.get(SNIPER_ORIGIN_KEY);
    const aimX = state.sniperHoverX ?? (originTile.x + 280);
    const aimY = state.sniperHoverY ?? originTile.y;
    const rayInfo = computeSniperRay(grid, originTile, aimX, aimY);
    triggerSniperCast(grid, originTile, rayInfo);
  });
  sniperPauseBtn?.addEventListener('click', () => {
    if (state.sniperCast) setSniperPaused(!state.sniperPaused);
  });
  document.getElementById('sniperResetBtn')?.addEventListener('click', () => {
    sniperTargets = createSniperInitialTargets();
    setSniperPaused(false);
    state.sniperCast = null;
  });

  sniperCanvas?.addEventListener('pointermove', event => {
    const rect = sniperCanvas.getBoundingClientRect();
    state.sniperHoverX = event.clientX - rect.left;
    state.sniperHoverY = event.clientY - rect.top;
  });
  sniperCanvas?.addEventListener('pointerleave', () => {
    state.sniperHoverX = null;
    state.sniperHoverY = null;
  });
  sniperCanvas?.addEventListener('click', event => {
    setSniperPaused(false);
    const rect = sniperCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    state.sniperHoverX = x;
    state.sniperHoverY = y;
    const { width, height } = prepareCanvas(sniperCanvas);
    const grid = buildRectHexGrid(width, height, 11, 5, 0.50, 0.56, 15.8, 7.6);
    const originTile = grid.tileMap.get(SNIPER_ORIGIN_KEY);
    const rayInfo = computeSniperRay(grid, originTile, x, y);
    triggerSniperCast(grid, originTile, rayInfo);
  });

  function tick() {
    const now = performance.now();
    renderSamuraiPreview(now);
    renderSniperPreview(now);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
