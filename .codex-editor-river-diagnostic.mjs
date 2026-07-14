import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));

await page.goto('http://127.0.0.1:3199', { waitUntil: 'networkidle' });
await page.click('#editorBtn');
await page.locator('#editorOverlay').waitFor({ state: 'visible' });
await page.locator('.ed-brush').filter({ hasText: '河流' }).click();

const refs = [
    { q: 0, r: 0, vertex: 5 },
    { q: 0, r: 0, vertex: 0 },
    { q: 0, r: 0, vertex: 1 }
];
const points = await page.evaluate(async refs => {
    const { riverVertexToPixel } = await import('/campaign/editor/boardModel.js');
    return refs.map(ref => riverVertexToPixel(ref));
}, refs);
const canvas = page.locator('#editorCanvas');
const box = await canvas.boundingBox();
const canvasSize = await canvas.evaluate(element => ({ width: element.width, height: element.height }));
const clientPoint = point => ({
    x: box.x + point.x * box.width / canvasSize.width,
    y: box.y + point.y * box.height / canvasSize.height
});
for (const point of points) {
    const client = clientPoint(point);
    await page.mouse.click(client.x, client.y);
}

const beforeCommitStatus = await page.locator('#editorStatusBar').textContent();
const finish = page.getByRole('button', { name: '完成河流' });
const finishEnabled = await finish.isEnabled();

await page.click('#editorPlaytestBtn');
await page.locator('#gameWrapper').waitFor({ state: 'visible' });
await page.waitForFunction(async () => {
    const { gameState } = await import('/js/state.js');
    return gameState.tiles.length > 0;
});
const intro = page.locator('#turnTransitionOverlay.show');
if (await intro.isVisible()) await intro.click();
await page.waitForTimeout(800);

const state = await page.evaluate(async () => {
    const { gameState } = await import('/js/state.js');
    return {
        tiles: gameState.tiles.length,
        rivers: gameState.rivers?.length ?? null,
        topologyRivers: gameState.riverTopology?.rivers?.size ?? null,
        crossings: gameState.riverCrossings?.length ?? null,
        canvas: {
            width: document.querySelector('#gameCanvas')?.width,
            height: document.querySelector('#gameCanvas')?.height
        }
    };
});

console.log(JSON.stringify({ beforeCommitStatus, finishEnabled, state, pageErrors }, null, 2));
await browser.close();
