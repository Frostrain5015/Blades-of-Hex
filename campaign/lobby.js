// 单人战役大厅 —— 由 catalog 数据驱动渲染传记卡/关卡卡，并支持 ◀/▶ 切换传记。
// 新增关卡/传记无需改 HTML：登记进 catalog 即自动出现。
import { CHRONICLES } from './catalog.js';
import { isScenarioUnlocked, readProgress } from './progress.js';

let _index = 0;
let _onStart = null;
let _onPortrait = null;
let _navBound = false;

function _currentChronicle() {
    return CHRONICLES[_index] || null;
}

function _levelCardHtml(level) {
    const ek = level.elementKey;
    return `
        <button id="${ek}LevelBtn" class="campaign-level-card" type="button"
                aria-label="进入关卡：${level.label} ${level.title}">
            <span class="campaign-level-number">${level.label}</span>
            <span class="campaign-level-copy"><strong>${level.title}</strong></span>
            <span class="campaign-level-rating" id="${ek}Rating" aria-label="尚未完成">☆☆☆</span>
        </button>`;
}

function _renderInto(container, chronicle) {
    container.innerHTML = `
        <section class="campaign-chronicle-card" aria-labelledby="campaignChronicleTitle">
            <div class="campaign-ember" aria-hidden="true"></div>
            <div class="campaign-chronicle-index">${chronicle.index}</div>
            <h3 id="campaignChronicleTitle">${chronicle.title}</h3>
            <p>${chronicle.description}</p>
        </section>
        <div class="campaign-level-label">选择关卡</div>
        ${chronicle.scenarios.map(_levelCardHtml).join('')}`;

    // 关卡卡本身就是唯一入口，避免“先选中、再进入”的重复操作。
    for (const level of chronicle.scenarios) {
        const ek = level.elementKey;
        const levelBtn = document.getElementById(`${ek}LevelBtn`);
        levelBtn?.addEventListener('click', () => _onStart?.(chronicle.id, level.id));
    }
}

function _updateNavButtons() {
    const single = CHRONICLES.length <= 1;
    for (const id of ['campaignChroniclePrevBtn', 'campaignChronicleNextBtn']) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        btn.disabled = single;
        btn.classList.toggle('disabled', single);
    }
}

function _switchChronicle(delta) {
    const n = CHRONICLES.length;
    if (n <= 1) return;
    _index = (_index + delta + n) % n;
    _rerender();
}

function _rerender() {
    const container = document.getElementById('campaignChronicleList');
    const chronicle = _currentChronicle();
    if (!container || !chronicle) return;
    _renderInto(container, chronicle);
    refreshCampaignLobbyProgress();

    // 切换右侧展示：有 posterUrl 的传记显示电影海报，否则显示将领立绘
    const poster = document.getElementById('campaignPoster');
    if (chronicle.posterUrl) {
        poster.src = chronicle.posterUrl;
        poster.classList.add('active');
        // 非战役传记页隐藏轮播立绘（保持 overlay 可见）
        for (const id of ['heroPortraitA', 'heroPortraitB']) {
            const el = document.getElementById(id);
            if (el) el.style.opacity = '0';
        }
        _onPortrait?.(null); // 不切换将领立绘
    } else {
        poster.classList.remove('active');
        for (const id of ['heroPortraitA', 'heroPortraitB']) {
            const el = document.getElementById(id);
            if (el) el.style.opacity = '';
        }
        _onPortrait?.(chronicle.portraitCommanderId);
    }
}

/**
 * 渲染/刷新单人战役大厅。
 * @param {{ onStartScenario:(chronicleId:string,scenarioId:string)=>void, onPortraitChange:(commanderId:string)=>void }} cbs
 */
export function renderCampaignLobby({ onStartScenario, onPortraitChange } = {}) {
    if (onStartScenario) _onStart = onStartScenario;
    if (onPortraitChange) _onPortrait = onPortraitChange;

    if (!_navBound) {
        document.getElementById('campaignChroniclePrevBtn')?.addEventListener('click', () => _switchChronicle(-1));
        document.getElementById('campaignChronicleNextBtn')?.addEventListener('click', () => _switchChronicle(1));
        _navBound = true;
    }
    _updateNavButtons();
    _rerender();
}

/** 回填当前传记的进度：关卡评星 + 顶部进度百分比。 */
export function refreshCampaignLobbyProgress() {
    const chronicle = _currentChronicle();
    if (!chronicle) return;
    const progress = readProgress(chronicle.storageKey);

    const mark = document.getElementById('campaignProgressMark');
    if (mark) {
        const done = chronicle.scenarios.filter(s => progress.completedScenarioIds.includes(s.id)).length;
        const total = chronicle.scenarios.length || 1;
        mark.textContent = `当前进度 ${Math.round((done / total) * 100)}%`;
    }

    for (const [index, level] of chronicle.scenarios.entries()) {
        const previousLevel = chronicle.scenarios[index - 1];
        const unlocked = isScenarioUnlocked(chronicle.scenarios, level.id, progress);
        const levelBtn = document.getElementById(`${level.elementKey}LevelBtn`);
        const rating = document.getElementById(`${level.elementKey}Rating`);
        if (!levelBtn || !rating) continue;

        levelBtn.disabled = !unlocked;
        levelBtn.classList.toggle('locked', !unlocked);
        levelBtn.setAttribute('aria-disabled', String(!unlocked));
        if (!unlocked) {
            const reason = `上一关“${previousLevel.title}”至少获得 1 星后解锁`;
            levelBtn.setAttribute('aria-label', `${level.label} ${level.title}，未解锁：${reason}`);
            levelBtn.title = reason;
            rating.textContent = '🔒';
            rating.setAttribute('aria-label', reason);
            continue;
        }

        levelBtn.setAttribute('aria-label', `进入关卡：${level.label} ${level.title}`);
        levelBtn.removeAttribute('title');
        const completed = progress.completedScenarioIds.includes(level.id);
        const stars = completed ? (progress.scenarioStars[level.id] || 0) : 0;
        rating.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
        rating.setAttribute('aria-label', completed ? `最佳评价 ${stars} 星` : '尚未完成');
    }
}
