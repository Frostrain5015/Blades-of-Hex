import { getFlagColors } from '../rules/camps.js';
import { buildMatchStatsDocument } from './matchStats.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FALLBACK_COLORS = ['#db574f', '#5688e8', '#55b875', '#c5994b', '#a56bd4', '#58b8b1'];
const CONTROL_METRICS = Object.freeze({
    controlShare: { label: '综合控制', countKey: null },
    unitShare: { label: '单位占比', countKey: 'units' },
    cityShare: { label: '城市占比', countKey: 'cities' }
});
const UNIT_METRICS = Object.freeze({
    kills: '击杀',
    damageDealt: '造成伤害',
    damageTaken: '承受伤害',
    healingReceived: '恢复量',
    actions: '参与行动'
});

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function formatNumber(value, digits = 0) {
    return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

function formatDuration(durationMs) {
    const totalSeconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function svgElement(tag, attributes = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
}

function colorForCamp(camp, index) {
    if (camp.campKey === 'neutral') return '#8b8f96';
    if (camp.colorId) {
        const color = getFlagColors(camp.colorId)?.main;
        if (color) return color;
    }
    return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function mixHexColor(color, target, ratio) {
    const normalize = value => {
        const match = String(value || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (!match) return null;
        const digits = match[1].length === 3
            ? [...match[1]].map(char => char + char).join('') : match[1];
        return [0, 2, 4].map(index => Number.parseInt(digits.slice(index, index + 2), 16));
    };
    const source = normalize(color);
    const destination = normalize(target);
    if (!source || !destination) return color;
    const mixed = source.map((channel, index) =>
        Math.round(channel + (destination[index] - channel) * ratio));
    return `#${mixed.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

function renderSummary(stats, container) {
    const roundCount = Math.max(
        stats.rounds.at(-1)?.round || 0,
        stats.controlTimeline.at(-1)?.round || 0
    );
    const cards = [
        ['对局时长', formatDuration(stats.durationMs), `${roundCount} 回合`],
        ['总交战', formatNumber(stats.camps.reduce((sum, camp) => sum + camp.attacks, 0)), `${formatNumber(stats.totalActions)} 次行动`],
        ['实际伤害', formatNumber(stats.totalDamage), '按生命变化统计'],
        ['单位阵亡', formatNumber(stats.totalLosses), `${formatNumber(stats.keyEvents.filter(event => event.type === 'cityCaptured').length)} 次占城`]
    ];
    container.innerHTML = cards.map(([label, value, note]) => `
        <article class="match-stat-summary-card">
            <span>${label}</span>
            <strong>${value}</strong>
            <small>${note}</small>
        </article>
    `).join('');
}

function renderControlChart(stats, metric, svg, legend, tooltip) {
    svg.replaceChildren();
    legend.replaceChildren();
    const data = stats.controlTimeline;
    if (!data.length || !stats.camps.length) return;

    const width = 960;
    const height = 340;
    const plot = { left: 54, right: 22, top: 28, bottom: 42 };
    const plotWidth = width - plot.left - plot.right;
    const plotHeight = height - plot.top - plot.bottom;
    const xAt = index => plot.left + (data.length === 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);
    const yAt = share => plot.top + (1 - share) * plotHeight;
    const colors = Object.fromEntries(stats.camps.map((camp, index) => [camp.campKey, colorForCamp(camp, index)]));

    for (const value of [0, 0.25, 0.5, 0.75, 1]) {
        const y = yAt(value);
        svg.appendChild(svgElement('line', {
            x1: plot.left, y1: y, x2: width - plot.right, y2: y,
            class: 'match-control-grid'
        }));
        const label = svgElement('text', { x: plot.left - 10, y: y + 4, class: 'match-control-axis-label', 'text-anchor': 'end' });
        label.textContent = `${Math.round(value * 100)}%`;
        svg.appendChild(label);
    }

    const eventByRound = new Map(stats.battleEvents.map(event => [event.round, event]));
    const skillsByRound = new Map();
    for (const event of stats.factionSkillEvents || []) {
        if (!skillsByRound.has(event.round)) skillsByRound.set(event.round, []);
        skillsByRound.get(event.round).push(event);
    }
    const bandWidth = data.length > 1 ? Math.max(12, plotWidth / (data.length - 1) * 0.62) : 36;
    data.forEach((point, index) => {
        const event = eventByRound.get(point.round);
        if (!event) return;
        const x = xAt(index);
        const band = svgElement('rect', {
            x: x - bandWidth / 2,
            y: plot.top,
            width: bandWidth,
            height: plotHeight,
            class: 'match-control-battle-band'
        });
        const title = svgElement('title');
        title.textContent = `第 ${point.round} 回合：${event.label}，${event.engagements} 次交战`;
        band.appendChild(title);
        svg.appendChild(band);
        const marker = svgElement('path', {
            d: `M ${x - 6} ${plot.top - 14} L ${x + 6} ${plot.top - 14} L ${x} ${plot.top - 3} Z`,
            class: 'match-control-battle-marker'
        });
        svg.appendChild(marker);
    });

    const lowerByCamp = Object.fromEntries(stats.camps.map(camp => [camp.campKey, []]));
    const upperByCamp = Object.fromEntries(stats.camps.map(camp => [camp.campKey, []]));
    const domainBounds = Object.fromEntries(stats.camps.map(camp => [camp.campKey, {
        landLower: [], landUpper: [], navalLower: [], navalUpper: []
    }]));
    data.forEach((point, index) => {
        let cumulative = 0;
        const rawTotal = stats.camps.reduce((sum, camp) => sum + Number(point.byCamp[camp.campKey]?.[metric] || 0), 0);
        stats.camps.forEach(camp => {
            const rawShare = Number(point.byCamp[camp.campKey]?.[metric] || 0);
            // 综合指标和原始占比理论上都和为 1；仍做归一化以兼容缺失阵营的旧日志。
            const share = rawTotal > 0 ? rawShare / rawTotal : 0;
            lowerByCamp[camp.campKey].push([xAt(index), yAt(cumulative)]);
            if (metric === 'unitShare') {
                const campPoint = point.byCamp[camp.campKey] || {};
                const landRaw = campPoint.landUnitShare == null
                    ? rawShare : Number(campPoint.landUnitShare || 0);
                const navalRaw = campPoint.navalUnitShare == null
                    ? 0 : Number(campPoint.navalUnitShare || 0);
                const landShare = rawTotal > 0 ? landRaw / rawTotal : 0;
                const navalShare = rawTotal > 0 ? navalRaw / rawTotal : 0;
                const bounds = domainBounds[camp.campKey];
                bounds.landLower.push([xAt(index), yAt(cumulative)]);
                cumulative += landShare;
                bounds.landUpper.push([xAt(index), yAt(cumulative)]);
                bounds.navalLower.push([xAt(index), yAt(cumulative)]);
                cumulative += navalShare;
                bounds.navalUpper.push([xAt(index), yAt(cumulative)]);
                // 兼容极小舍入差与旧日志中的异常拆分。
                cumulative += Math.max(0, share - landShare - navalShare);
            } else {
                cumulative += share;
            }
            upperByCamp[camp.campKey].push([xAt(index), yAt(cumulative)]);
        });
    });

    const appendArea = (camp, upper, lower, fill, domain = null) => {
        const points = [...upper, ...lower].map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
        const area = svgElement('polygon', {
            points,
            fill,
            class: 'match-control-area',
            'data-camp-key': camp.campKey,
            ...(domain ? { 'data-unit-domain': domain } : {})
        });
        const title = svgElement('title');
        title.textContent = `${camp.name}${domain === 'land' ? ' · 陆军' : domain === 'naval' ? ' · 海军' : ''}`;
        area.appendChild(title);
        svg.appendChild(area);
    };
    stats.camps.forEach(camp => {
        if (metric === 'unitShare') {
            const bounds = domainBounds[camp.campKey];
            appendArea(camp, bounds.landUpper, [...bounds.landLower].reverse(),
                mixHexColor(colors[camp.campKey], '#ffffff', 0.27), 'land');
            appendArea(camp, bounds.navalUpper, [...bounds.navalLower].reverse(),
                mixHexColor(colors[camp.campKey], '#000000', 0.30), 'naval');
        } else {
            appendArea(camp, upperByCamp[camp.campKey], [...lowerByCamp[camp.campKey]].reverse(),
                colors[camp.campKey]);
        }
    });

    const skillStackByBand = new Map();
    for (const event of stats.factionSkillEvents || []) {
        const pointIndex = data.findIndex(point => point.round === event.round);
        const camp = stats.camps.find(candidate => candidate.campKey === event.campKey);
        if (pointIndex < 0 || !camp) continue;
        const lower = lowerByCamp[event.campKey]?.[pointIndex];
        const upper = upperByCamp[event.campKey]?.[pointIndex];
        if (!lower || !upper || Math.abs(lower[1] - upper[1]) < 8) continue;
        const stackKey = `${event.round}:${event.campKey}`;
        const stackIndex = skillStackByBand.get(stackKey) || 0;
        skillStackByBand.set(stackKey, stackIndex + 1);
        const marker = svgElement('text', {
            x: xAt(pointIndex) + stackIndex * 18,
            y: (lower[1] + upper[1]) / 2 + 6,
            class: 'match-control-skill-marker',
            'text-anchor': 'middle',
            'data-camp-key': event.campKey
        });
        marker.textContent = event.logoEmoji || camp.flagEmoji || '⚑';
        const title = svgElement('title');
        title.textContent = `第 ${event.round} 回合：${camp.name}发动【${event.skillName}】`;
        marker.appendChild(title);
        svg.appendChild(marker);
    }

    const deathStackByBand = new Map();
    for (const event of stats.commanderDeathEvents || []) {
        const pointIndex = data.findIndex(point => point.round === event.round);
        const camp = stats.camps.find(candidate => candidate.campKey === event.campKey);
        if (pointIndex < 0 || !camp) continue;
        const lower = lowerByCamp[event.campKey]?.[pointIndex];
        const upper = upperByCamp[event.campKey]?.[pointIndex];
        const stackKey = `${event.round}:${event.campKey}`;
        const stackIndex = deathStackByBand.get(stackKey) || 0;
        deathStackByBand.set(stackKey, stackIndex + 1);
        const y = lower && upper && Math.abs(lower[1] - upper[1]) >= 12
            ? (lower[1] + upper[1]) / 2 - stackIndex * 22
            : plot.top + 15 + stackIndex * 22;
        const group = svgElement('g', { class: 'match-control-commander-death-marker' });
        group.appendChild(svgElement('circle', { cx: xAt(pointIndex), cy: y, r: 11 }));
        const glyph = svgElement('text', {
            x: xAt(pointIndex), y: y + 5, 'text-anchor': 'middle'
        });
        glyph.textContent = '☠';
        group.appendChild(glyph);
        const title = svgElement('title');
        title.textContent = `第 ${event.round} 回合：${camp.name}【${event.commanderName}】阵亡（${event.displayName}）`;
        group.appendChild(title);
        svg.appendChild(group);
    }

    const maxLabels = 9;
    const labelStep = Math.max(1, Math.ceil(data.length / maxLabels));
    data.forEach((point, index) => {
        if (index !== 0 && index !== data.length - 1 && index % labelStep !== 0) return;
        const label = svgElement('text', {
            x: xAt(index),
            y: height - 14,
            class: 'match-control-axis-label',
            'text-anchor': 'middle'
        });
        label.textContent = point.round === 0 ? '开局' : `R${point.round}`;
        svg.appendChild(label);
    });

    data.forEach((point, index) => {
        const previousX = index === 0 ? plot.left : (xAt(index - 1) + xAt(index)) / 2;
        const nextX = index === data.length - 1 ? width - plot.right : (xAt(index) + xAt(index + 1)) / 2;
        const hotspot = svgElement('rect', {
            x: previousX,
            y: plot.top,
            width: nextX - previousX,
            height: plotHeight,
            fill: 'transparent',
            class: 'match-control-hotspot',
            tabindex: 0
        });
        const showTooltip = event => {
            const countKey = CONTROL_METRICS[metric].countKey;
            const values = stats.camps.map(camp => {
                const campPoint = point.byCamp[camp.campKey] || {};
                const percent = Number(campPoint[metric] || 0) * 100;
                const domainCount = metric === 'unitShare'
                    ? ` · 陆${formatNumber(campPoint.landUnits)} / 海${formatNumber(campPoint.navalUnits)}`
                    : '';
                const count = countKey ? `${domainCount || ` · ${formatNumber(campPoint[countKey])}`}` : '';
                return `<span><i style="--camp-color:${colors[camp.campKey]}"></i>${escapeHtml(camp.name)} <b>${percent.toFixed(1)}%</b>${count}</span>`;
            }).join('');
            const battle = eventByRound.get(point.round);
            const skills = skillsByRound.get(point.round) || [];
            const commanderDeaths = (stats.commanderDeathEvents || [])
                .filter(death => death.round === point.round);
            tooltip.innerHTML = `
                <strong>${point.round === 0 ? '开局' : `第 ${point.round} 回合`}</strong>
                ${values}
                ${battle ? `<em>⚔ ${battle.label} · ${battle.engagements} 次交战</em>` : ''}
                ${skills.map(skill => `<em>${escapeHtml(skill.logoEmoji || '⚑')} ${escapeHtml(skill.skillName)} · ${escapeHtml(stats.camps.find(camp => camp.campKey === skill.campKey)?.name || skill.campKey)}</em>`).join('')}
                ${commanderDeaths.map(death => `<em>☠ ${escapeHtml(death.commanderName)}阵亡 · ${escapeHtml(stats.camps.find(camp => camp.campKey === death.campKey)?.name || death.campKey)}</em>`).join('')}
            `;
            tooltip.hidden = false;
            if (event?.clientX != null) {
                const bounds = svg.getBoundingClientRect();
                tooltip.style.left = `${Math.min(bounds.width - 190, Math.max(8, event.clientX - bounds.left + 12))}px`;
                tooltip.style.top = `${Math.max(8, event.clientY - bounds.top - 16)}px`;
            } else {
                tooltip.style.left = `${Math.min(76, (xAt(index) / width) * 100)}%`;
                tooltip.style.top = '20px';
            }
        };
        hotspot.addEventListener('pointermove', showTooltip);
        hotspot.addEventListener('focus', showTooltip);
        hotspot.addEventListener('pointerleave', () => { tooltip.hidden = true; });
        hotspot.addEventListener('blur', () => { tooltip.hidden = true; });
        svg.appendChild(hotspot);
    });

    stats.camps.forEach((camp, index) => {
        const item = document.createElement('span');
        item.innerHTML = metric === 'unitShare'
            ? `<i style="--camp-color:${mixHexColor(colors[camp.campKey], '#ffffff', 0.27)}"></i><i style="--camp-color:${mixHexColor(colors[camp.campKey], '#000000', 0.30)}"></i>${escapeHtml(camp.name)}（陆/海）`
            : `<i style="--camp-color:${colors[camp.campKey]}"></i>${escapeHtml(camp.name)}`;
        legend.appendChild(item);
    });
    if (stats.battleEvents.length) {
        const marker = document.createElement('span');
        marker.className = 'battle-legend';
        marker.innerHTML = '<i></i>战役事件';
        legend.appendChild(marker);
    }
    if ((stats.factionSkillEvents || []).length) {
        const marker = document.createElement('span');
        marker.className = 'skill-legend';
        marker.innerHTML = '<b>⚑</b>阵营技能';
        legend.appendChild(marker);
    }
    if ((stats.commanderDeathEvents || []).length) {
        const marker = document.createElement('span');
        marker.className = 'commander-death-legend';
        marker.innerHTML = '<b>☠</b>将领阵亡';
        legend.appendChild(marker);
    }
}

function renderCampCards(stats, container) {
    container.innerHTML = stats.camps.map((camp, index) => {
        const color = colorForCamp(camp, index);
        const winner = stats.result?.winnerCampKey === camp.campKey;
        return `
            <article class="match-camp-card" style="--camp-color:${color}">
                <header>
                    <span class="match-camp-swatch"></span>
                    <strong>${escapeHtml(camp.name)}</strong>
                    ${winner ? '<em>胜方</em>' : ''}
                </header>
                <div class="match-camp-metrics">
                    <span><b>${formatNumber(camp.kills)}</b>击杀</span>
                    <span><b>${formatNumber(camp.losses)}</b>阵亡</span>
                    <span><b>${formatNumber(camp.damageDealt)}</b>输出</span>
                    <span><b>${formatNumber(camp.damageTaken)}</b>承伤</span>
                    <span><b>${formatNumber(camp.healingReceived)}</b>恢复</span>
                    <span><b>${formatNumber(camp.captures)}</b>占城</span>
                </div>
                <footer>
                    <span>兵力 ${camp.initialForce.units} → ${camp.finalForce.units}</span>
                    <span>城市 ${camp.initialCities} → ${camp.finalCities}</span>
                    <span>每次攻击 ${formatNumber(camp.damagePerAttack, 1)} 伤害</span>
                </footer>
            </article>
        `;
    }).join('');
}

function renderLeaders(stats, container) {
    const entries = [
        ['击杀最多', stats.leaders.kills, 'kills'],
        ['输出最高', stats.leaders.damageDealt, 'damageDealt'],
        ['承伤最多', stats.leaders.damageTaken, 'damageTaken'],
        ['恢复最多', stats.leaders.healingReceived, 'healingReceived']
    ];
    container.innerHTML = entries.map(([label, unit, metric]) => `
        <article class="match-unit-leader">
            <span>${label}</span>
            <strong>${unit ? escapeHtml(unit.displayName) : '—'}</strong>
            <b>${unit ? formatNumber(unit[metric]) : '0'}</b>
            <small>${unit ? escapeHtml(stats.camps.find(camp => camp.campKey === unit.campKey)?.name || unit.campKey || '未知阵营') : '暂无数据'}</small>
        </article>
    `).join('');
}

function renderUnitTable(stats, container, metric, campFilter) {
    const filtered = stats.units
        .filter(unit => campFilter === 'all' || unit.campKey === campFilter)
        .filter(unit => Number(unit[metric] || 0) > 0)
        .sort((left, right) => Number(right[metric] || 0) - Number(left[metric] || 0) || String(left.id).localeCompare(String(right.id)))
        .slice(0, 12);
    const max = Math.max(1, ...filtered.map(unit => Number(unit[metric] || 0)));
    container.innerHTML = filtered.length ? filtered.map((unit, index) => {
        const camp = stats.camps.find(entry => entry.campKey === unit.campKey);
        const color = colorForCamp(camp || { campKey: unit.campKey }, Math.max(0, stats.camps.indexOf(camp)));
        const width = Math.max(3, (Number(unit[metric] || 0) / max) * 100);
        return `
            <div class="match-unit-row" style="--camp-color:${color}">
                <span class="match-unit-rank">${index + 1}</span>
                <span class="match-unit-name"><b>${escapeHtml(unit.displayName)}</b><small>${escapeHtml(camp?.name || unit.campKey || '未知阵营')} · ${escapeHtml(unit.id)}</small></span>
                <span class="match-unit-bar"><i style="width:${width}%"></i></span>
                <strong>${formatNumber(unit[metric])}</strong>
                <em>${unit.survived ? '存活' : '阵亡'}</em>
            </div>
        `;
    }).join('') : '<p class="match-stats-empty">这个筛选条件下没有可统计数据。</p>';
}

function renderBattleEvents(stats, container) {
    if (!stats.battleEvents.length) {
        container.innerHTML = '<p class="match-stats-empty">本局各回合交战强度较均匀，没有达到相对高强度阈值的战役事件。</p>';
        return;
    }
    container.innerHTML = stats.battleEvents.map(event => {
        const leader = stats.camps.find(camp => camp.campKey === event.leadingCampKey);
        return `
            <article class="match-battle-event">
                <span>R${event.round}</span>
                <div>
                    <strong>${event.label}</strong>
                    <p>${event.engagements} 次交战 · ${formatNumber(event.totalDamage)} 伤害 · ${event.totalLosses} 个单位阵亡${event.captures ? ` · ${event.captures} 次占城` : ''}${event.commanderLosses ? ` · ${event.commanderLosses} 名将领陨落` : ''}</p>
                </div>
                <em>${leader ? `${escapeHtml(leader.name)}输出领先` : '多方混战'}</em>
            </article>
        `;
    }).join('');
}

export function initMatchStatsPanel({ getLog, onMissing } = {}) {
    const overlay = document.getElementById('matchStatsOverlay');
    const closeButton = document.getElementById('matchStatsCloseBtn');
    if (!overlay) return { open() {}, close() {} };

    const summary = document.getElementById('matchStatsSummary');
    const svg = document.getElementById('matchControlChart');
    const legend = document.getElementById('matchControlLegend');
    const tooltip = document.getElementById('matchControlTooltip');
    const campCards = document.getElementById('matchCampCards');
    const leaders = document.getElementById('matchUnitLeaders');
    const unitTable = document.getElementById('matchUnitTable');
    const unitMetric = document.getElementById('matchUnitMetric');
    const unitCamp = document.getElementById('matchUnitCamp');
    const battleEvents = document.getElementById('matchBattleEvents');
    const subtitle = document.getElementById('matchStatsSubtitle');
    let activeStats = null;
    let controlMetric = 'controlShare';
    let previousFocus = null;

    const renderUnits = () => {
        if (activeStats) renderUnitTable(activeStats, unitTable, unitMetric.value, unitCamp.value);
    };
    unitMetric?.addEventListener('change', renderUnits);
    unitCamp?.addEventListener('change', renderUnits);

    for (const button of overlay.querySelectorAll('[data-control-metric]')) {
        button.addEventListener('click', () => {
            controlMetric = button.dataset.controlMetric;
            for (const peer of overlay.querySelectorAll('[data-control-metric]')) {
                peer.classList.toggle('active', peer === button);
                peer.setAttribute('aria-pressed', String(peer === button));
            }
            renderControlChart(activeStats, controlMetric, svg, legend, tooltip);
            const methodKey = controlMetric === 'controlShare' ? 'control' : controlMetric;
            document.getElementById('matchControlMethod').textContent = activeStats.methodology[methodKey];
        });
    }

    function open(documentOverride = null, { sourceLabel = '' } = {}) {
        const sourceDocument = documentOverride || (typeof getLog === 'function' ? getLog() : null);
        activeStats = buildMatchStatsDocument(sourceDocument);
        if (!activeStats) {
            onMissing?.();
            return false;
        }
        previousFocus = document.activeElement;
        const winner = activeStats.camps.find(camp => camp.campKey === activeStats.result?.winnerCampKey);
        const roundCount = Math.max(
            activeStats.rounds.at(-1)?.round || 0,
            activeStats.controlTimeline.at(-1)?.round || 0
        );
        subtitle.textContent = `${sourceLabel ? `${sourceLabel} · ` : ''}${winner ? `${winner.name}获胜 · ` : ''}${roundCount} 回合 · ${activeStats.mode?.type || '对局'}`;
        renderSummary(activeStats, summary);
        renderControlChart(activeStats, controlMetric, svg, legend, tooltip);
        renderCampCards(activeStats, campCards);
        renderLeaders(activeStats, leaders);
        unitCamp.innerHTML = '<option value="all">全部阵营</option>' + activeStats.camps
            .map(camp => `<option value="${escapeHtml(camp.campKey)}">${escapeHtml(camp.name)}</option>`)
            .join('');
        unitMetric.value = 'damageDealt';
        renderUnits();
        renderBattleEvents(activeStats, battleEvents);
        document.getElementById('matchControlMethod').textContent = activeStats.methodology.control;
        document.getElementById('matchBattleMethod').textContent = activeStats.methodology.battleEvents;
        overlay.classList.add('show');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('match-stats-open');
        closeButton?.focus();
        return true;
    }

    function close() {
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('match-stats-open');
        tooltip.hidden = true;
        previousFocus?.focus?.();
    }

    closeButton?.addEventListener('click', close);
    overlay.addEventListener('click', event => {
        if (event.target === overlay) close();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && overlay.classList.contains('show')) close();
    });
    return { open, close };
}
