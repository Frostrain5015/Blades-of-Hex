// 验证脚本：headless 打开原型页面，抓取 console 错误 + 场景状态 + 截图。
// 浏览器策略（按优先级）：
//   1. channel:'chrome' —— 使用系统已装 Chrome，不下载任何浏览器二进制；
//   2. 默认 chromium   —— 仅在本机已缓存时可用；
//   3. 都不可用        —— 输出 no-browser 报告并退出，绝不在线安装。
// 用法：node prototype/3d-battlefield/shoot.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });
const URL_PAGE = 'http://127.0.0.1:8321/prototype/3d-battlefield/index.html';

async function launch() {
  try {
    console.log('[shoot] 尝试系统 Chrome (channel=chrome)…');
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch (e) {
    console.log('[shoot] 系统 Chrome 不可用：' + e.message.split('\n')[0]);
  }
  try {
    console.log('[shoot] 尝试默认 chromium（仅已缓存时）…');
    return await chromium.launch({ headless: true });
  } catch (e) {
    console.log('[shoot] 默认 chromium 不可用：' + e.message.split('\n')[0]);
  }
  return null;
}

const browser = await launch();
if (!browser) {
  const report = { ok: false, reason: 'no-browser', hint: '未安装系统 Chrome 且无缓存的 chromium；已按约束跳过截图验证' };
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  process.exit(2);
}

const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const shot = (name) => page.screenshot({ path: join(OUT, name) });

await page.goto(URL_PAGE, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(6000);                     // 等待首帧 + 自动演示暖场
await shot('01-initial.png');

// 场景健康检查：draw call / 三角形数 / 单位数
const state = await page.evaluate(() => {
  const p = window.__proto;
  if (!p) return null;
  return {
    drawCalls: p.renderer.info.render.calls,
    triangles: p.renderer.info.render.triangles,
    sceneChildren: p.scene.children.length,
    units: p.units.length,
    unitsAlive: p.units.filter((u) => u.alive).length,
    autoDemo: p.demo.state.auto,
  };
});
console.log('[shoot] 场景状态: ' + JSON.stringify(state));

// 停自动旋转与自动演示，后续手动驱动
await page.evaluate(() => {
  const p = window.__proto;
  p.controls.autoRotate = false;
  p.demo.setAuto(false);
});

// —— 02 炮兵对射 ——
await page.evaluate(() => window.__proto.demo.debugAttack(2, 6));  // 红炮兵 → 蓝步兵
await page.waitForTimeout(1100);
await shot('02-artillery.png');
await page.waitForTimeout(1500);

// —— 03 战舰齐射 ——
await page.evaluate(() => window.__proto.demo.debugAttack(4, 3));  // 蓝战舰 → 红碉堡
await page.waitForTimeout(1250);
await shot('03-warship.png');
await page.waitForTimeout(1600);

// —— 05 选中骑兵：选择环 + 移动范围高亮 ——
await page.evaluate(() => window.__proto.demo.select(window.__proto.units[1]));
await page.waitForTimeout(400);
await shot('05-selection.png');
console.log('[shoot] debugMove 结果: ' + await page.evaluate(() => window.__proto.demo.debugMove(1, -1, 0)));
await page.waitForTimeout(1000);

// —— 06 骑兵冲锋命中帧（火花/尘环/撞飞）——
// debugMeleeStrike 会把骑兵瞬移到目标邻格再演出完整编舞，命中帧约在 0.85s
await page.evaluate(() => {
  const p = window.__proto;
  p.demo.select(null);
  p.demo.debugMeleeStrike(1, 6);   // 红骑兵 → 蓝步兵
});
await page.waitForTimeout(930);
await shot('06-melee-cavalry.png');
await page.waitForTimeout(1600);

// —— 06b 步兵连击第二击（重劈命中帧约 1.0s）——
await page.evaluate(() => window.__proto.demo.debugMeleeStrike(0, 6));  // 红步兵 → 蓝步兵
await page.waitForTimeout(1060);
await shot('06b-melee-infantry.png');
await page.waitForTimeout(1600);

// —— 07 行进路径预览（金白流动 chevron + 平滑折线）——
const pathKey = await page.evaluate(() => {
  const p = window.__proto;
  p.demo.select(p.units[1]);       // 骑兵（此时在 (1,2) 附近）
  return p.demo.debugHoverTile(-1, 3);
});
console.log('[shoot] 路径预览 key: ' + pathKey);
await page.waitForTimeout(450);
await shot('07-path-preview.png');

// —— 08 火炮抛物线预览弧 + 幽灵炮弹 + 落点圈 ——
const arcKey = await page.evaluate(() => {
  const p = window.__proto;
  p.demo.select(p.units[2]);       // 红炮兵
  return p.demo.debugHoverUnit(7); // 悬停蓝炮兵
});
console.log('[shoot] 攻击预览 key: ' + arcKey);
await page.waitForTimeout(500);
await shot('08-arc-preview.png');

// —— 09 旗帜风向：两个朝向相反的单位同框，旗面应统一顺东南风 ——
await page.evaluate(() => {
  const p = window.__proto;
  p.demo.select(null);
  // 红碉堡（朝东）与蓝步兵（朝西）同框
  p.camera.position.set(1.7, 3.4, 7.6);
  p.controls.target.set(1.7, 0.5, 0.9);
  p.controls.update();
});
await page.waitForTimeout(700);
await shot('09-flags.png');

// —— 10 底座弧光血条：残血碉堡（27%）+ 背景满血单位近景 ——
await page.evaluate(() => {
  const p = window.__proto;
  p.demo.debugSetHp(3, 40);        // 红碉堡 → 40/150（红色残血弧，不致死）
  const pos = p.units[3].group.position;
  // 从东北向西南看：碉堡在前、中场单位作背景，避免步兵遮挡底座弧
  p.camera.position.set(pos.x + 1.8, 2.4, pos.z - 3.6);
  p.controls.target.set(pos.x - 0.2, 0.25, pos.z + 0.3);
  p.controls.update();
});
await page.waitForTimeout(450);    // 掉血碎裂散落中
await shot('10-hp-style.png');
await page.waitForTimeout(600);

// —— 11 空袭指令：编队俯冲 + 弹着链炸开 ——
await page.evaluate(() => {
  const p = window.__proto;
  p.camera.position.set(8.2, 10.2, 11.8);
  p.controls.target.set(0.5, 0.2, 0.1);
  p.controls.update();
  p.demo.debugAirstrike('red', 0, -2);   // 目标：蓝炮兵格
});
await page.waitForTimeout(1980);         // 弹着链进行中
await shot('11-airstrike.png');
await page.waitForTimeout(350);
await shot('11b-airstrike-late.png');
await page.waitForTimeout(1500);

// —— 12 阅兵展示区：陆地变体一排 ——
await page.evaluate(() => {
  const p = window.__proto;
  p.camera.position.set(0, 3.6, 16);
  p.controls.target.set(-0.3, 0.5, 8.3);
  p.controls.update();
});
await page.waitForTimeout(600);
await shot('12-variants.png');

// —— 12b 阅兵展示区：湖面舰船变体 ——
await page.evaluate(() => {
  const p = window.__proto;
  p.camera.position.set(4.8, 6.5, 7.2);
  p.controls.target.set(4.8, 0.1, -1.6);
  p.controls.update();
});
await page.waitForTimeout(600);
await shot('12b-variants-navy.png');

// —— 13 军旗布料特写：不同朝向单位同框，两帧对比波纹传播 ——
await page.evaluate(() => {
  const p = window.__proto;
  // 红步兵（朝东）与蓝卫戍步兵（朝西）：贴近机位聚焦旗面
  p.camera.position.set(3.6, 1.4, 4.0);
  p.controls.target.set(2.1, 1.0, 2.2);
  p.controls.update();
});
await page.waitForTimeout(600);
await shot('13-flag-cloth.png');
await page.waitForTimeout(400);
await shot('13b-flag-cloth-motion.png');


// —— 14 防空火力特写：弹流 + flak 炸点 + 炮管跟踪 ——
await page.evaluate(() => {
  const p = window.__proto;
  // 用默认沙盘机位但略压低，能同时看到飞机、防空炮和弹着链
  p.camera.position.set(6.5, 7.5, 9.5);
  p.controls.target.set(0.8, 0.6, -2.0);
  p.controls.update();
  p.demo.debugAirstrike('red', 0, -2);
});
await page.waitForTimeout(1600);         // 弹着链进行中、防空火力正盛
await shot('14-aa-flak.png');

// —— 14b 引擎着火离场：带伤飞机爬升 + 黑烟 + 火舌 ——
await page.evaluate(() => {
  const p = window.__proto;
  // 从侧前方追拍离场飞机
  p.camera.position.set(8.0, 6.0, 4.0);
  p.controls.target.set(2.5, 2.0, -2.5);
  p.controls.update();
});
await page.waitForTimeout(700);
await shot('14b-engine-fire.png');
await page.waitForTimeout(1200);

// —— 04 夜晚 + 鱼雷 ——
await page.evaluate(() => {
  const p = window.__proto;
  p.camera.position.set(8.2, 10.2, 11.8);
  p.controls.target.set(0.5, 0.2, 0.1);
  p.controls.update();
  p.setNight(true);
});
await page.waitForTimeout(2200);
await page.evaluate(() => window.__proto.demo.debugAttack(5, 3));  // 蓝潜艇 → 红碉堡
await page.waitForTimeout(900);
await shot('04-night-torpedo.png');

const report = { ok: errors.length === 0 && !!state, errors, state };
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log('[shoot] 结果: ' + JSON.stringify(report, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
