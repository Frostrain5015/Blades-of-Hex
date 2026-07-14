import { chromium } from 'playwright';
import path from 'node:path';

const OUTPUT = 'C:/Users/NERO/.codex/visualizations/2026/07/14/019f5e2a-e794-77f0-ae99-e0211d616918';
const BASE = 'http://127.0.0.1:3199';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('#soloGameBtn');
await page.click('#campaignBtn');
await page.locator('#campaignLobbyContent.active').waitFor();
await page.click('#campaignChronicleNextBtn');
await page.locator('#visual-qa-all-effectsLevelBtn:not([disabled])').waitFor();
await page.click('#visual-qa-all-effectsLevelBtn');

await page.waitForFunction(async () => {
    const { gameState } = await import('/js/state.js');
    return gameState.campaignMode
        && gameState.scenarioId === 'visual-qa-all-effects'
        && gameState.tiles.length === 277
        && document.getElementById('turnTransitionOverlay')?.classList.contains('show');
}, null, { timeout: 15000 });

const metrics = await page.evaluate(async () => {
    const { gameState } = await import('/js/state.js');
    const intro = document.getElementById('turnTransitionOverlay');
    intro.onclick = null;
    intro.classList.remove('show');
    intro.style.cursor = '';

    gameState.skirmishFog = false;
    if (gameState.mechanics) gameState.mechanics.fogOfWar = false;
    gameState.tutorialMode = false;
    delete gameState._campaignInputLock;
    delete gameState._campaignStepOwnsInputLock;
    Object.assign(gameState, {
        selectedUnit: null,
        selectedTile: null,
        selectedCityTile: null,
        hoveredTile: null,
        movableTiles: [],
        attackableTiles: [],
        cardTargeting: null,
        deselecting: false
    });

    const style = document.createElement('style');
    style.id = 'qa-capture-clean-style';
    style.textContent = `
        #turnTransitionOverlay, #tutorialOverlay, #countdownOverlay,
        #campaignResultOverlay, #victoryOverlay, #objectiveToast,
        #campaignSpeakerCard, #tutorialTargetRing, #tutorialHint {
            display:none !important; visibility:hidden !important;
            opacity:0 !important; pointer-events:none !important;
        }
    `;
    document.head.append(style);

    window.__qaNow = 20000;
    Object.defineProperty(performance, 'now', {
        configurable: true,
        value: () => window.__qaNow
    });

    const { renderGame } = await import('/js/renderer.js');
    renderGame();
    await new Promise(requestAnimationFrame);
    renderGame();
    await new Promise(requestAnimationFrame);

    return {
        tiles: gameState.tiles.length,
        layout: gameState.boardLayout,
        units: gameState.tiles.filter(tile => tile.unit).length,
        water: gameState.surfaceMap.size,
        coastEdges: gameState.coastEdges.length,
        rivers: gameState.rivers.length,
        riverSegments: gameState.riverTopology.segments.length,
        crossings: gameState.riverCrossings.length,
        ports: gameState.ports.length,
        cities: gameState.tiles.filter(tile => tile.isCity).length,
        urban: gameState.tiles.filter(tile => tile.isUrban).length,
        forests: gameState.tiles.filter(tile => tile.terrain === 'forest').length,
        mountains: gameState.tiles.filter(tile => tile.terrain === 'mountain').length
    };
});

await page.evaluate(() => document.fonts?.ready);
await page.waitForTimeout(250);

const stage = page.locator('#canvasStage');
const shot = async name => stage.screenshot({ path: path.join(OUTPUT, name) });
await shot('07-visual-qa-overview.png');

async function clientPoint(q, r) {
    return page.evaluate(async ({ q, r }) => {
        const { gameState } = await import('/js/state.js');
        const tile = gameState.tileMap.get(`${q},${r}`);
        const rect = document.getElementById('gameCanvas').getBoundingClientRect();
        if (!tile) throw new Error(`missing tile ${q},${r}`);
        return {
            x: rect.left + tile.x / 1000 * rect.width,
            y: rect.top + tile.y / 750 * rect.height
        };
    }, { q, r });
}

async function selectAndHover(source, target, now = 22000) {
    await page.evaluate(value => { window.__qaNow = value; }, now);
    const sourcePoint = await clientPoint(source.q, source.r);
    await page.mouse.click(sourcePoint.x, sourcePoint.y);
    await page.evaluate(value => { window.__qaNow = value; }, now + 700);
    const targetPoint = await clientPoint(target.q, target.r);
    await page.mouse.move(targetPoint.x, targetPoint.y);
    await page.waitForTimeout(80);
    await page.evaluate(async () => {
        const { renderGame } = await import('/js/renderer.js');
        renderGame();
        await new Promise(requestAnimationFrame);
        renderGame();
    });
}

await selectAndHover({ q: -4, r: 0 }, { q: -1, r: 1 });
await shot('08-visual-qa-movement.png');

await selectAndHover({ q: -2, r: 0 }, { q: -1, r: 0 }, 25000);
await shot('09-visual-qa-melee.png');

await selectAndHover({ q: -2, r: 2 }, { q: 0, r: 2 }, 28000);
await page.evaluate(() => { window.__qaNow = 30550 + 780; });
await page.evaluate(async () => {
    const { renderGame } = await import('/js/renderer.js');
    renderGame();
    await new Promise(requestAnimationFrame);
    renderGame();
});
await shot('10-visual-qa-ranged-flight.png');

await page.evaluate(() => { window.__qaNow = 30550 + 1680; });
await page.evaluate(async () => {
    const { renderGame } = await import('/js/renderer.js');
    renderGame();
    await new Promise(requestAnimationFrame);
    renderGame();
});
await shot('11-visual-qa-ranged-impact.png');

async function targetCard(cardId, targeting, q, r, now, filename) {
    await page.evaluate(async ({ cardId, targeting, q, r, now }) => {
        const { gameState } = await import('/js/state.js');
        const { renderGame } = await import('/js/renderer.js');
        gameState.selectedUnit = null;
        gameState.selectedTile = null;
        gameState.movableTiles = [];
        gameState.attackableTiles = [];
        gameState.cardTargeting = {
            cardId,
            targeting,
            handIndex: gameState.playerHands.player1.indexOf(cardId),
            startedAt: now - 1200
        };
        gameState.hoveredTile = gameState.tileMap.get(`${q},${r}`);
        window.__qaNow = now;
        renderGame();
        await new Promise(requestAnimationFrame);
        renderGame();
    }, { cardId, targeting, q, r, now });
    await shot(filename);
}

await targetCard('airstrike', 'enemyGlobal', 0, -1, 34000, '12-visual-qa-airstrike-aa.png');
await targetCard('heal', 'anyUnit', -3, 1, 36000, '13-visual-qa-heal-targets.png');
await targetCard('forceMarch', 'friendlyAny', -3, 1, 38000, '14-visual-qa-buff-targets.png');
await targetCard('shield', 'shieldTarget', -3, 1, 40000, '15-visual-qa-shield-targets.png');

const interactionState = await page.evaluate(async () => {
    const { gameState } = await import('/js/state.js');
    return {
        currentCard: gameState.cardTargeting?.cardId,
        candidates: gameState.cardTargeting ? 'rendered' : 'missing',
        selectedUnit: gameState.selectedUnit?.id || null,
        pageErrors: window.__qaPageErrors || []
    };
});

console.log(JSON.stringify({ metrics, interactionState, pageErrors }, null, 2));
await browser.close();
