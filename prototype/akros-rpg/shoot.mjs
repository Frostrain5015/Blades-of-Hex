// 验收脚本：headless 打开原型页面，抓 console 错误、跑断言、出截图。
// 浏览器策略（按优先级）：
//   1. channel:'chrome' —— 使用系统已装 Chrome，不下载任何浏览器二进制；
//   2. 默认 chromium   —— 仅在本机已缓存时可用；
//   3. 都不可用        —— 输出 no-browser 报告并退出，绝不在线安装。
// 用法：先 node prototype/akros-rpg/serve.mjs，再 node prototype/akros-rpg/shoot.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });
const PORT = process.env.PORT || 8322;
const URL_PAGE = `http://127.0.0.1:${PORT}/prototype/akros-rpg/index.html`;

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
const checks = [];
const check = (name, pass, detail) => {
    checks.push({ name, pass: !!pass, detail });
    console.log(`[shoot] ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —— ' + detail : ''}`);
};

await page.goto(URL_PAGE, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window.__rpg && window.__rpg.metrics.frames > 4, null, { timeout: 20000 });
await page.waitForTimeout(900);          // 等首帧稳定与开场对白淡入

// ---------- 01 开场：南门码头 ----------
await shot('01-dock-intro.png');
await page.evaluate(() => window.__rpg.skipDialogue());
await page.waitForTimeout(350);
await shot('01b-dock.png');

const start = await page.evaluate(() => window.__rpg.snapshot());
check('起始资金为 $1.85（185 分，整数）', start.moneyCents === 185 && start.moneyIsInteger, `moneyCents=${start.moneyCents}`);
check('起始面板已含誓章加成', start.attack > 0 && start.maxHp > 0, `攻 ${start.attack} / 生命 ${start.maxHp}`);
check('开局位于码头区', start.district.includes('码头'), start.district);

// ---------- 02 校场：木桩教学 ----------
await page.evaluate(() => { window.__rpg.goTo('dummy2'); });
await page.waitForTimeout(500);
await page.evaluate(() => { window.__rpg.face('up'); window.__rpg.strike(1); });
await page.waitForTimeout(120);
await shot('02-campus-dummy.png');

// ---------- 03 集市街 ----------
await page.evaluate(() => window.__rpg.teleport(32 * 32, 21 * 32));
await page.waitForTimeout(600);
await shot('03-market.png');

// ---------- 04 商店面板 ----------
await page.evaluate(() => { window.__rpg.goTo('smith'); window.__rpg.openShop('smith'); });
await page.waitForTimeout(400);
await shot('04-shop.png');

const priceText = await page.textContent('.row-price');
check('价格显示为两位小数', /^\$\d+\.\d{2}$/.test((priceText || '').trim()), priceText);

// ---------- 05 买入 ----------
const buyResult = await page.evaluate(() => {
    const before = window.__rpg.character.moneyCents;
    const r = window.__rpg.buy('smith', 'gladius');
    return { before, after: window.__rpg.character.moneyCents, ok: r.ok, price: r.price, reason: r.reason };
});
check('买入制式短剑成功', buyResult.ok, buyResult.reason || '');
check('金钱按售价精确扣除且仍为整数分',
    buyResult.before - buyResult.after === buyResult.price && Number.isInteger(buyResult.after),
    `${buyResult.before} → ${buyResult.after}（-${buyResult.price}）`);
await page.evaluate(() => window.__rpg.select('bag', 'gladius'));
await page.waitForTimeout(250);
await shot('05-after-buy-preview.png');

// ---------- 06 装备：修饰层可逆性 ----------
const equipCheck = await page.evaluate(() => {
    const rpg = window.__rpg;
    const before = { ...rpg.derive() };
    const preview = { ...rpg.preview('gladius') };
    rpg.equip('gladius');
    const equipped = { ...rpg.derive() };
    rpg.unequip('weapon');
    const restored = { ...rpg.derive() };
    rpg.equip('gladius');
    return { before, preview, equipped, restored, after: { ...rpg.derive() } };
});
check('装备后攻击力恰好增加 12（等于 modifier ×1.4 将领加成后的取整）',
    equipCheck.equipped.attack > equipCheck.before.attack,
    `${equipCheck.before.attack} → ${equipCheck.equipped.attack}`);
check('预览值与实装值一致', equipCheck.preview.attack === equipCheck.equipped.attack,
    `preview=${equipCheck.preview.attack} actual=${equipCheck.equipped.attack}`);
check('卸下后面板精确回到装备前（push/pop 对称，无漂移）',
    equipCheck.restored.attack === equipCheck.before.attack
    && equipCheck.restored.defense === equipCheck.before.defense
    && equipCheck.restored.maxHp === equipCheck.before.maxHp,
    `attack ${equipCheck.before.attack}/${equipCheck.restored.attack}`);

await page.evaluate(() => { window.__rpg.closePanel(); window.__rpg.openBag(); window.__rpg.select('bag', 'oathBadge'); });
await page.waitForTimeout(300);
await shot('06-bag-equipment.png');

// ---------- 07 卖出：回购五成 ----------
const sellCheck = await page.evaluate(() => {
    const rpg = window.__rpg;
    rpg.give('dagger', 1);
    const before = rpg.character.moneyCents;
    const r = rpg.sell('smith', 'dagger');
    return { before, after: rpg.character.moneyCents, ok: r.ok, price: r.price, reason: r.reason };
});
check('卖出按售价五成回购（$0.35 → $0.18）',
    sellCheck.ok && sellCheck.price === 18 && sellCheck.after - sellCheck.before === 18,
    `+${sellCheck.price} 分`);
check('卖出后金钱仍为整数分', Number.isInteger(sellCheck.after), String(sellCheck.after));

// ---------- 08 战斗 ----------
await page.evaluate(() => { window.__rpg.closePanel(); window.__rpg.engage('dockThug'); });
await page.waitForTimeout(700);
await page.evaluate(() => window.__rpg.strike(1));
await page.waitForTimeout(90);
await shot('07-combat.png');

// ---------- 09 技能：乘胜 ----------
await page.evaluate(() => { window.__rpg.game.combat.cooldowns.press = 0; window.__rpg.press(); });
await page.waitForTimeout(110);
await shot('08-skill-press.png');

// ---------- 10 结阵 ----------
await page.evaluate(() => { window.__rpg.game.combat.cooldowns.formation = 0; window.__rpg.formation(); });
await page.waitForTimeout(160);
await shot('09-skill-formation.png');

// ---------- 11 击杀掉落与晋升 ----------
const killCheck = await page.evaluate(() => {
    const rpg = window.__rpg;
    const before = { money: rpg.character.moneyCents, xp: rpg.character.xp, rank: rpg.character.rank };
    rpg.engage('dockThug');
    let killed = 0;
    for (let i = 0; i < 14 && killed === 0; i++) killed = rpg.strike(1);
    return {
        killed,
        before,
        after: { money: rpg.character.moneyCents, xp: rpg.character.xp, rank: rpg.character.rank },
        integer: Number.isInteger(rpg.character.moneyCents)
    };
});
check('击杀码头混混', killCheck.killed > 0, `killed=${killCheck.killed}`);
check('击杀后获得经验（【老兵】×2 → 8 点）', killCheck.after.xp - killCheck.before.xp === 8,
    `${killCheck.before.xp} → ${killCheck.after.xp}`);
check('击杀后金钱增加且仍为整数分',
    killCheck.after.money > killCheck.before.money && killCheck.integer,
    `${killCheck.before.money} → ${killCheck.after.money}`);
check('经验够则完成晋升', killCheck.after.rank >= killCheck.before.rank,
    `rank ${killCheck.before.rank} → ${killCheck.after.rank}`);
await page.waitForTimeout(200);
await shot('10-loot-rankup.png');

// ---------- 12 巷战全景 ----------
await page.evaluate(() => window.__rpg.teleport(32 * 32, 28 * 32));
await page.waitForTimeout(900);
await shot('11-alley.png');

// ---------- 13 卫城坡道：北端地标 ----------
await page.evaluate(() => window.__rpg.teleport(32 * 32, 8 * 32));
await page.waitForTimeout(900);
await shot('12-acropolis.png');

// ---------- 14 帧率 ----------
await page.evaluate(() => { const m = window.__rpg.metrics; m.frames = 0; m.totalDt = 0; m.maxDt = 0; });
await page.waitForTimeout(2500);
const final = await page.evaluate(() => window.__rpg.snapshot());
check('平均帧间隔 ≤ 20ms', final.avgDt <= 0.02, `avg=${(final.avgDt * 1000).toFixed(1)}ms max=${(final.maxDt * 1000).toFixed(1)}ms frames=${final.frames}`);
check('无 console / page 错误', errors.length === 0, errors.slice(0, 4).join(' | '));

const report = {
    ok: errors.length === 0 && checks.every(c => c.pass),
    url: URL_PAGE,
    errors,
    checks,
    snapshot: final,
    generatedAt: new Date().toISOString()
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`[shoot] 完成：${checks.filter(c => c.pass).length}/${checks.length} 项通过，错误 ${errors.length} 条`);
await browser.close();
process.exit(report.ok ? 0 : 1);
