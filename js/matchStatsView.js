import { getFlagColors } from '../rules/camps.js';
import { COMMANDER_CONFIG } from '../rules/commanders.js';
import { NPC_DIALOGUE_PORTRAITS } from '../campaign/portraits.js';
import { createFlagSvgUrl, createStandardFlagUrl, isStandardFlagEmoji } from '../rules/diplomacy.js';
import { buildMatchStatsDocument, selectMvpUnits } from './matchStats.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FALLBACK_COLORS = ['#db574f', '#5688e8', '#55b875', '#c5994b', '#a56bd4', '#58b8b1'];
const MEDAL_RANKS = Object.freeze(['🥇', '🥈', '🥉']);
const SAFE_FLAG_URL_PATTERN = /^(?:img\/(?:flags|ui)\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:svg|png|webp)|data:image\/svg\+xml;charset=utf-8,)/i;
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
    recruits: '招募',
    actions: '参与行动'
});

function sanitizeUiText(value) {
    return String(value ?? '')
        .replace(/\s*·\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function escapePlainHtml(value) {
    return escapeHtml(sanitizeUiText(value));
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
    if (camp?.campKey === 'neutral' && !camp?.neutralThemeId && !camp?.color) return '#8b8f96';
    if (camp?.colorId) {
        const color = getFlagColors(camp.colorId)?.main;
        if (color) return color;
    }
    if (typeof camp?.color === 'string' && /^#[0-9a-f]{3,6}$/i.test(camp.color.trim())) {
        return camp.color.trim();
    }
    return FALLBACK_COLORS[Math.max(0, index) % FALLBACK_COLORS.length];
}

function resolveCampFlagVisual(camp, index = 0) {
    const color = colorForCamp(camp, index);
    const palette = camp?.campKey === 'neutral' && !camp?.neutralThemeId
        ? getFlagColors('gray')
        : (getFlagColors(camp?.colorId) || getFlagColors(color) || { main: color, light: color, dark: color });
    const rawUrl = camp?.flagUrl || camp?.flagPreset || null;
    let url = typeof rawUrl === 'string' && SAFE_FLAG_URL_PATTERN.test(rawUrl) ? rawUrl : null;
    if (!url && camp?.flagConfig && typeof camp.flagConfig === 'object') {
        url = createFlagSvgUrl(camp.flagConfig, camp.colorId || color);
    }
    if (!url && camp?.flagEmoji && isStandardFlagEmoji(camp.flagEmoji)) {
        url = createStandardFlagUrl(camp.colorId || color, camp.flagEmoji);
    }
    if (!url && camp?.campKey === 'neutral' && !camp?.flagConfig && !camp?.flagEmoji) {
        url = 'img/flags/training-targets.svg';
    }
    return {
        url,
        color,
        palette,
        emoji: camp?.flagEmoji || '',
        name: camp?.name || (camp?.campKey === 'neutral' ? '中立' : camp?.campKey) || '未知阵营',
        hasDistinctFlag: Boolean(url || camp?.flagEmoji)
    };
}

function flagBadgeHtml(camp, index = 0, { size = 'sm', extraClass = '' } = {}) {
    const visual = resolveCampFlagVisual(camp, index);
    const title = escapeHtml(visual.name);
    const cls = ['match-hud-flag', `match-hud-flag--${size}`, extraClass].filter(Boolean).join(' ');
    if (visual.url) {
        return `<img class="${cls}" src="${escapeHtml(visual.url)}" alt="${title}旗帜" title="${title}">`;
    }
    const bg = `linear-gradient(135deg, ${visual.palette.light}, ${visual.palette.main} 55%, ${visual.palette.dark})`;
    return `<span class="${cls} match-hud-flag--color" style="background:${bg}" aria-label="${title}旗帜" title="${title}">${visual.emoji ? escapeHtml(visual.emoji) : ''}</span>`;
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
    const camps = stats.camps || [];
    const roundCount = Math.max(
        stats.rounds.at(-1)?.round || 0,
        stats.controlTimeline.at(-1)?.round || 0
    );
    const totalAttacks = camps.reduce((sum, camp) => sum + Number(camp.attacks || 0), 0);
    const totalMoves = camps.reduce((sum, camp) => sum + Number(camp.moves || 0), 0);
    const totalHealing = Number(
        stats.totalHealing ?? camps.reduce((sum, camp) => sum + Number(camp.healingReceived || 0), 0)
    );
    const totalReinforcements = camps.reduce((sum, camp) => sum + Number(camp.reinforcements || 0), 0);
    const totalRecruits = camps.reduce((sum, camp) => sum + Number(camp.recruits || 0), 0);
    const totalConstructions = camps.reduce((sum, camp) => sum + Number(camp.constructions || 0), 0);
    const totalCards = camps.reduce((sum, camp) => sum + Number(camp.cards || 0), 0);
    const totalAirCommands = camps.reduce((sum, camp) => sum + Number(camp.airCommands || 0), 0);
    const totalCaptures = stats.keyEvents.filter(event => event.type === 'cityCaptured').length
        || camps.reduce((sum, camp) => sum + Number(camp.captures || 0), 0);
    const commanderDeaths = (stats.commanderDeathEvents || []).length;
    const unattributedDamage = camps.reduce((sum, camp) => sum + Number(camp.unattributedDamage || 0), 0);
    const initialUnits = camps.reduce((sum, camp) => sum + Number(camp.initialForce?.units || 0), 0);
    const finalUnits = camps.reduce((sum, camp) => sum + Number(camp.finalForce?.units || 0), 0);
    const initialHp = camps.reduce((sum, camp) => sum + Number(camp.initialForce?.totalHp || 0), 0);
    const finalHp = camps.reduce((sum, camp) => sum + Number(camp.finalForce?.totalHp || 0), 0);
    const avgDamagePerAttack = totalAttacks > 0 ? stats.totalDamage / totalAttacks : 0;
    const healRatio = stats.totalDamage > 0 ? Math.round((totalHealing / stats.totalDamage) * 100) : 0;
    const skillCount = (stats.factionSkillEvents || []).length;
    const peakRound = [...(stats.rounds || [])].map(round => {
        const dmg = Object.values(round.byCamp || {}).reduce((s, c) => s + Number(c.damageTaken || 0), 0);
        const losses = Object.values(round.byCamp || {}).reduce((s, c) => s + Number(c.losses || 0), 0);
        return { round: round.round, dmg, losses, engagements: Number(round.engagements || 0) };
    }).sort((a, b) => b.dmg - a.dmg || b.losses - a.losses || b.engagements - a.engagements)[0] || null;

    const cards = [
        ['对局时长', formatDuration(stats.durationMs), `${roundCount} 回合 ${camps.length} 方参战`],
        ['总交战', formatNumber(totalAttacks), `${formatNumber(stats.totalActions)} 次行动 机动 ${formatNumber(totalMoves)}`],
        ['实际伤害', formatNumber(stats.totalDamage), `场均 ${formatNumber(avgDamagePerAttack, 1)} / 击 无源 ${formatNumber(unattributedDamage)}`],
        ['累计恢复', formatNumber(totalHealing), `补修 ${formatNumber(totalReinforcements)} 次 伤愈比 ${healRatio}%`],
        ['单位阵亡', formatNumber(stats.totalLosses), `占城 ${formatNumber(totalCaptures)} 次 将领陨落 ${formatNumber(commanderDeaths)} 名`],
        ['兵力演变', `${formatNumber(initialUnits)} → ${formatNumber(finalUnits)}`, `总生命 ${formatNumber(initialHp)} → ${formatNumber(finalHp)}`],
        ['征召与基建', formatNumber(totalRecruits + totalConstructions), `招募 ${formatNumber(totalRecruits)} 单位 工事/机场 ${formatNumber(totalConstructions)}`],
        ['战术与峰值', formatNumber(totalCards + totalAirCommands + skillCount),
            `战术卡 ${formatNumber(totalCards)} 空袭 ${formatNumber(totalAirCommands)}${peakRound && peakRound.dmg > 0 ? ` 峰值 R${peakRound.round}(${formatNumber(peakRound.dmg)})` : ''}`]
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
        title.textContent = `${sanitizeUiText(camp.name)}${domain === 'land' ? ' 陆军' : domain === 'naval' ? ' 海军' : ''}`;
        area.appendChild(title);
        svg.appendChild(area);
    };
    stats.camps.forEach(camp => {
        if (metric === 'unitShare') {
            const bounds = domainBounds[camp.campKey];
            // 深色（原色）表示占比更大的陆军主体，浅色表示海军
            appendArea(camp, bounds.landUpper, [...bounds.landLower].reverse(),
                colors[camp.campKey], 'land');
            appendArea(camp, bounds.navalUpper, [...bounds.navalLower].reverse(),
                mixHexColor(colors[camp.campKey], '#ffffff', 0.42), 'naval');
        } else {
            appendArea(camp, upperByCamp[camp.campKey], [...lowerByCamp[camp.campKey]].reverse(),
                colors[camp.campKey]);
        }
    });

    // 在开局初始占比处（第 1 段色带左缘）直接嵌入方形阵营旗帜，取代图表下方冗长的阵营文字图例
    stats.camps.forEach((camp, campIndex) => {
        const lowerArr = lowerByCamp[camp.campKey] || [];
        const upperArr = upperByCamp[camp.campKey] || [];
        if (!lowerArr.length || !upperArr.length) return;
        let anchorIndex = lowerArr.findIndex((pt, idx) => Math.abs(pt[1] - upperArr[idx][1]) >= 10);
        if (anchorIndex < 0) return;
        const xCenter = anchorIndex === 0 && data.length > 1
            ? Math.min(plot.left + 21, xAt(0) + Math.max(12, (xAt(1) - xAt(0)) * 0.45))
            : xAt(anchorIndex);
        const nextIndex = Math.min(data.length - 1, anchorIndex + 1);
        const spanX = Math.max(1, xAt(nextIndex) - xAt(anchorIndex));
        const alpha = anchorIndex === 0 && nextIndex > anchorIndex
            ? Math.max(0, Math.min(1, (xCenter - xAt(anchorIndex)) / spanX))
            : 0;
        const yTop = upperArr[anchorIndex][1] + (upperArr[nextIndex][1] - upperArr[anchorIndex][1]) * alpha;
        const yBottom = lowerArr[anchorIndex][1] + (lowerArr[nextIndex][1] - lowerArr[anchorIndex][1]) * alpha;
        const bandH = yBottom - yTop;
        if (bandH < 11) return;

        const flagH = Math.max(11, Math.min(18, bandH * 0.56));
        const flagW = flagH * 1.5;
        const fx = Math.max(plot.left + 5, xCenter - flagW / 2);
        const fy = (yTop + yBottom) / 2 - flagH / 2;
        const visual = resolveCampFlagVisual(camp, campIndex);

        const flagGroup = svgElement('g', {
            class: 'match-control-band-flag',
            'data-camp-key': camp.campKey
        });
        flagGroup.appendChild(svgElement('rect', {
            x: fx - 1, y: fy - 1, width: flagW + 2, height: flagH + 2,
            rx: 1.5, fill: 'rgba(6, 8, 12, 0.72)'
        }));
        if (visual.url) {
            flagGroup.appendChild(svgElement('rect', {
                x: fx, y: fy, width: flagW, height: flagH, fill: colors[camp.campKey]
            }));
            flagGroup.appendChild(svgElement('image', {
                href: visual.url, x: fx, y: fy, width: flagW, height: flagH,
                preserveAspectRatio: 'xMidYMid meet'
            }));
        } else {
            flagGroup.appendChild(svgElement('rect', {
                x: fx, y: fy, width: flagW, height: flagH, fill: visual.palette.main
            }));
            const tag = svgElement('text', {
                x: fx + flagW / 2, y: fy + flagH / 2,
                'text-anchor': 'middle', class: 'match-control-band-flag-glyph'
            });
            tag.textContent = visual.emoji || '';
            if (tag.textContent) flagGroup.appendChild(tag);
        }
        flagGroup.appendChild(svgElement('rect', {
            x: fx, y: fy, width: flagW, height: flagH,
            fill: 'none', stroke: 'rgba(255,255,255,0.56)', 'stroke-width': 1
        }));
        const title = svgElement('title');
        title.textContent = sanitizeUiText(camp.name);
        flagGroup.appendChild(title);
        svg.appendChild(flagGroup);
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
        title.textContent = sanitizeUiText(`第 ${event.round} 回合：${camp.name}发动【${event.skillName}】`);
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
        title.textContent = sanitizeUiText(`第 ${event.round} 回合：${camp.name}【${event.commanderName}】阵亡（${event.displayName}）`);
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
            const values = stats.camps.map((camp, campIndex) => {
                const campPoint = point.byCamp[camp.campKey] || {};
                const percent = Number(campPoint[metric] || 0) * 100;
                const domainCount = metric === 'unitShare'
                    ? `陆${formatNumber(campPoint.landUnits)} / 海${formatNumber(campPoint.navalUnits)}`
                    : '';
                const count = countKey ? (domainCount || formatNumber(campPoint[countKey])) : '';
                const visual = resolveCampFlagVisual(camp, campIndex);
                const fallbackName = visual.hasDistinctFlag ? '' : `<small class="match-tooltip-camp-label">${escapeHtml(camp.name)}</small>`;
                return `<span>${flagBadgeHtml(camp, campIndex, { size: 'xs' })}${fallbackName}<b>${percent.toFixed(1)}%</b>${count ? `<small>${count}</small>` : ''}</span>`;
            }).join('');
            const battle = eventByRound.get(point.round);
            const skills = skillsByRound.get(point.round) || [];
            const commanderDeaths = (stats.commanderDeathEvents || [])
                .filter(death => death.round === point.round);
            const campFlagRef = campKey => {
                const campIndex = stats.camps.findIndex(camp => camp.campKey === campKey);
                const camp = campIndex >= 0 ? stats.camps[campIndex] : { campKey };
                return flagBadgeHtml(camp, Math.max(0, campIndex), { size: 'xs' });
            };
            tooltip.innerHTML = `
                <strong>${point.round === 0 ? '开局' : `第 ${point.round} 回合`}</strong>
                ${values}
                ${battle ? `<em>⚔ ${escapePlainHtml(battle.label)} ${battle.engagements} 次交战</em>` : ''}
                ${skills.map(skill => `<em>${campFlagRef(skill.campKey)} ${escapeHtml(skill.skillName)}</em>`).join('')}
                ${commanderDeaths.map(death => `<em>${campFlagRef(death.campKey)} ☠ ${escapePlainHtml(death.commanderName)}阵亡</em>`).join('')}
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

    if (metric === 'unitShare') {
        const sampleColor = colors[stats.camps[0]?.campKey] || '#6b8ab8';
        const domainLegend = document.createElement('span');
        domainLegend.className = 'domain-legend';
        domainLegend.innerHTML = `<i style="--camp-color:${sampleColor}"></i>深色（原色）陆军 <i style="--camp-color:${mixHexColor(sampleColor, '#ffffff', 0.42)}"></i>浅色 海军`;
        legend.appendChild(domainLegend);
    }
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

function gradeTierClass(grade) {
    switch (grade) {
        case 'A+': return 'ap';
        case 'A': return 'a';
        case 'A-': return 'am';
        case 'B+': return 'bp';
        case 'B': return 'b';
        case 'B-': return 'bm';
        default: return 'c';
    }
}

function renderCampCards(stats, container) {
    container.innerHTML = stats.camps.map((camp, index) => {
        const color = colorForCamp(camp, index);
        const visual = resolveCampFlagVisual(camp, index);
        const winner = stats.result?.winnerCampKey === camp.campKey;
        const rating = camp.rating;
        const grade = rating?.grade || 'B';
        const b = rating?.breakdown;
        const ratingTitle = b
            ? `阵营综合评分 ${rating.score} 分（${grade}） 战果 ${b.outcome}/25 交战 ${b.combat}/28 火力 ${b.firepower}/21 存续后勤 ${b.sustain}/14 主动性 ${b.initiative}/12`
            : `阵营表现评级：${grade}`;
        return `
            <article class="match-camp-card" style="--camp-color:${color}">
                <header>
                    ${flagBadgeHtml(camp, index, { size: 'md' })}
                    ${visual.hasDistinctFlag ? '' : `<strong>${escapeHtml(camp.name)}</strong>`}
                    <span class="match-camp-badges">
                        ${winner ? '<em>胜方</em>' : ''}
                        <span class="match-camp-grade is-tier-${gradeTierClass(grade)}" title="${escapeHtml(ratingTitle)}" aria-label="${escapeHtml(ratingTitle)}">${escapeHtml(grade)}</span>
                    </span>
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

function resolveCommanderPennantPortrait(commanderId) {
    if (!commanderId) return null;
    const npc = NPC_DIALOGUE_PORTRAITS[commanderId];
    if (npc?.transparentSource) {
        return { src: npc.transparentSource, name: npc.label || commanderId, isIronGuard: false };
    }
    const commanderName = COMMANDER_CONFIG[commanderId]?.definition?.name;
    if (!commanderName) return null;
    return {
        src: `img/commander_tr/${commanderName}.webp`,
        name: commanderName,
        isIronGuard: commanderId === 'ironGuard'
    };
}

function unitMvpEmblemLabel(unit) {
    const specKey = typeof unit === 'string' ? null : unit?.specializationKey;
    switch (specKey) {
        case 'assaultInfantry': return '突击';
        case 'garrisonInfantry': return '卫戍';
        case 'lightCavalry': return '轻骑';
        case 'heavyCavalry': return '重骑';
        case 'fieldGun': return '野战';
        case 'antiAirArtillery': return '防空';
        case 'antiAirDestroyer': return '护空';
        case 'antiSubDestroyer': return '反潜';
        case 'fleetCruiser': return '制海';
        case 'supportCruiser': return '支援';
    }
    const type = typeof unit === 'string' ? unit : unit?.type;
    switch (type) {
        case 'carrier': return '航母';
        case 'gb_battleship': return '战列';
        case 'warship': return '巡洋';
        case 'destroyer': return '驱逐';
        case 'submarine': return '潜艇';
        case 'fr_heavy_cannon': return '巨炮';
        case 'ru_katyusha': return '火箭';
        case 'archer': return '炮兵';
        case 'infantry': return '步兵';
        case 'us_marine': return '陆战';
        case 'cavalry': return '骑兵';
        case 'kmt_training_brigade':
        case 'cn_training_brigade': return '教导';
        case 'cpc_guerrilla': return '游击';
        case 'jp_samurai': return '武士';
        case 'de_stuka': return '斯图卡';
        case 'mgNest': return '碉堡';
        case 'shoreBattery': return '要塞';
        case 'drone': return '天眼';
        case 'airfield': return '空军';
        default: return '精锐';
    }
}

function backdropFlagHtml(camp, index) {
    const visual = resolveCampFlagVisual(camp, index);
    if (visual.url) {
        return `<img class="match-mvp-backdrop-flag" src="${escapeHtml(visual.url)}" alt="${escapeHtml(visual.name)}阵营旗帜">`;
    }
    const bg = `linear-gradient(135deg, ${visual.palette.light}, ${visual.palette.main} 55%, ${visual.palette.dark})`;
    return `<div class="match-mvp-backdrop-flag match-mvp-backdrop-flag--color" style="background:${bg}" aria-label="${escapeHtml(visual.name)}阵营旗帜">${visual.emoji ? `<span>${escapeHtml(visual.emoji)}</span>` : ''}</div>`;
}

function renderUnitMvp(stats, container) {
    const mvps = Array.isArray(stats.mvpUnits) && stats.mvpUnits.length
        ? stats.mvpUnits
        : selectMvpUnits(stats.units, 3);
    if (!mvps.length) {
        container.innerHTML = '';
        return;
    }
    const cardsHtml = mvps.map((unit, index) => {
        const campIndex = stats.camps.findIndex(entry => entry.campKey === unit.campKey);
        const camp = campIndex >= 0 ? stats.camps[campIndex] : { campKey: unit.campKey };
        const color = colorForCamp(camp, Math.max(0, campIndex));
        const portrait = resolveCommanderPennantPortrait(unit.commanderId);
        const rankMedal = MEDAL_RANKS[index] || String(index + 1);
        const captures = Number(unit.captures || 0);
        const recruits = Number(unit.recruits || 0);
        const isAirfield = unit.type === 'airfield';
        const statusText = unit.survived === true ? '存活' : unit.survived === false ? '阵亡' : '参战';
        const statusClass = unit.survived === true ? 'is-alive' : 'is-dead';
        const foregroundHtml = portrait
            ? `<img class="match-mvp-commander-portrait${portrait.isIronGuard ? ' is-iron-guard' : ''}" src="${escapeHtml(portrait.src)}" alt="${escapeHtml(portrait.name)}立绘">`
            : `<span class="match-mvp-unit-watermark">${escapeHtml(unitMvpEmblemLabel(unit))}</span>`;
        const metricsHtml = isAirfield
            ? `
                        <span><b>${formatNumber(unit.kills)}</b>击杀</span>
                        <span><b>${formatNumber(unit.damageDealt)}</b>输出</span>
                        <span><b>${formatNumber(recruits)}</b>空降</span>
                        <span><b>${formatNumber(unit.airCommands || unit.actions)}</b>出动</span>`
            : `
                        <span><b>${formatNumber(unit.kills)}</b>击杀</span>
                        <span><b>${formatNumber(unit.damageDealt)}</b>输出</span>
                        <span><b>${formatNumber(unit.damageTaken)}</b>承伤</span>
                        <span><b>${formatNumber(unit.healingReceived)}</b>恢复</span>`;
        return `
            <article class="match-mvp-card is-rank-${index + 1}" style="--camp-color:${color}">
                <div class="match-mvp-stage${portrait ? ' has-commander' : ''}">
                    ${backdropFlagHtml(camp, Math.max(0, campIndex))}
                    ${foregroundHtml}
                    <header class="match-mvp-card-head">
                        <span class="match-mvp-rank" aria-label="第${index + 1}名">${rankMedal}</span>
                        <span class="match-mvp-tags">
                            ${captures > 0 ? `<em class="match-mvp-capture-tag">占城 ${formatNumber(captures)}</em>` : ''}
                            ${!isAirfield && recruits > 0 ? `<em class="match-mvp-capture-tag">空降 ${formatNumber(recruits)}</em>` : ''}
                            <em class="match-mvp-life ${statusClass}">${statusText}</em>
                        </span>
                    </header>
                </div>
                <div class="match-mvp-body">
                    <div class="match-mvp-identity">
                        <strong title="${escapePlainHtml(unit.displayName)}">${escapePlainHtml(unit.displayName)}</strong>
                        <small>#${escapePlainHtml(unit.id)}</small>
                    </div>
                    <div class="match-mvp-metrics">
                        ${metricsHtml}
                    </div>
                </div>
            </article>
        `;
    }).join('');
    container.innerHTML = `
        <div class="match-mvp-header">
            <span>${mvps.length === 1 ? '全场 MVP' : `MVP TOP ${mvps.length}`}</span>
            <small>综合多维战场贡献隐式评选</small>
        </div>
        <div class="match-mvp-grid" data-count="${mvps.length}">${cardsHtml}</div>
    `;
}

function renderLeaders(stats, container) {
    const entries = [
        ['击杀最多', stats.leaders.kills, 'kills'],
        ['输出最高', stats.leaders.damageDealt, 'damageDealt'],
        ['承伤最多', stats.leaders.damageTaken, 'damageTaken'],
        ['恢复最多', stats.leaders.healingReceived, 'healingReceived']
    ];
    container.innerHTML = entries.map(([label, unit, metric]) => {
        const campIndex = unit ? stats.camps.findIndex(camp => camp.campKey === unit.campKey) : -1;
        const camp = campIndex >= 0 ? stats.camps[campIndex] : (unit ? { campKey: unit.campKey } : null);
        const flagHtml = camp ? flagBadgeHtml(camp, Math.max(0, campIndex), { size: 'sm' }) : '';
        return `
            <article class="match-unit-leader">
                <span>${label}</span>
                <strong class="match-unit-leader-name">${flagHtml}<span>${unit ? escapePlainHtml(unit.displayName) : '—'}</span></strong>
                <b>${unit ? formatNumber(unit[metric]) : '0'}</b>
                <small>${unit ? `#${escapePlainHtml(unit.id)} ${unit.survived === true ? '存活' : unit.survived === false ? '阵亡' : '参战'}` : '暂无数据'}</small>
            </article>
        `;
    }).join('');
}

function renderUnitTable(stats, container, metric, campFilter) {
    const filtered = stats.units
        .filter(unit => campFilter === 'all' || unit.campKey === campFilter)
        .filter(unit => Number(unit[metric] || 0) > 0)
        .sort((left, right) => Number(right[metric] || 0) - Number(left[metric] || 0) || String(left.id).localeCompare(String(right.id)))
        .slice(0, 5);
    const max = Math.max(1, ...filtered.map(unit => Number(unit[metric] || 0)));
    container.innerHTML = filtered.length ? filtered.map((unit, index) => {
        const campIndex = stats.camps.findIndex(entry => entry.campKey === unit.campKey);
        const camp = campIndex >= 0 ? stats.camps[campIndex] : null;
        const color = colorForCamp(camp || { campKey: unit.campKey }, Math.max(0, campIndex));
        const width = Math.max(3, (Number(unit[metric] || 0) / max) * 100);
        const isMedal = index < MEDAL_RANKS.length;
        const rankDisplay = isMedal ? MEDAL_RANKS[index] : index + 1;
        return `
            <div class="match-unit-row" style="--camp-color:${color}">
                <span class="match-unit-rank${isMedal ? ' is-medal' : ''}">${rankDisplay}</span>
                <span class="match-unit-name">
                    ${flagBadgeHtml(camp || { campKey: unit.campKey }, Math.max(0, campIndex), { size: 'sm' })}
                    <b title="${escapePlainHtml(unit.displayName)}">${escapePlainHtml(unit.displayName)}</b>
                    <small class="match-unit-id">#${escapePlainHtml(unit.id)}</small>
                </span>
                <span class="match-unit-bar"><i style="width:${width}%"></i></span>
                <strong>${formatNumber(unit[metric])}</strong>
                <em>${unit.survived === true ? '存活' : unit.survived === false ? '阵亡' : '参战'}</em>
            </div>
        `;
    }).join('') : '<p class="match-stats-empty">这个筛选条件下没有可统计数据。</p>';
}

function findCampEntry(stats, campKey) {
    if (!campKey) return { camp: null, index: 0 };
    const index = stats.camps.findIndex(camp => camp.campKey === campKey);
    return { camp: index >= 0 ? stats.camps[index] : { campKey }, index: Math.max(0, index) };
}

function campInlineHtml(stats, campKey) {
    if (!campKey) return '<span>未知势力</span>';
    const { camp, index } = findCampEntry(stats, campKey);
    const visual = resolveCampFlagVisual(camp, index);
    const flag = flagBadgeHtml(camp, index, { size: 'xs' });
    return visual.hasDistinctFlag
        ? `<span class="match-battle-camp">${flag}</span>`
        : `<span class="match-battle-camp">${flag}<em>${escapePlainHtml(visual.name)}</em></span>`;
}

function eventTypeBadgeClass(eventType) {
    switch (eventType) {
        case 'factionEliminated': return 'is-elimination';
        case 'commanderFall': return 'is-commander-fall';
        case 'breakthrough': return 'is-breakthrough';
        case 'turningPoint': return 'is-turning-point';
        default: return 'is-pitched';
    }
}

function formatDistrictLabel(districtId) {
    return districtId != null ? `行政区${escapePlainHtml(districtId)}` : '城市据点';
}

function renderCaptureGroupsHtml(stats, capturesList) {
    if (!capturesList?.length) return '';
    // 若同一城市在同回合内被多方易手，合并为“反复争夺”避免重复堆砌
    const districtOwners = new Map();
    for (const cap of capturesList) {
        if (cap.districtId == null) continue;
        if (!districtOwners.has(cap.districtId)) districtOwners.set(cap.districtId, new Set());
        if (cap.campKey) districtOwners.get(cap.districtId).add(cap.campKey);
    }
    const contested = [...districtOwners.entries()].filter(([, camps]) => camps.size >= 2);
    if (contested.length && contested.length === districtOwners.size) {
        const camps = [...new Set(capturesList.map(cap => cap.campKey).filter(Boolean))];
        const districts = contested.map(([id]) => `行政区${id}`).join(' ');
        return `${camps.map(key => campInlineHtml(stats, key)).join(' ')} 反复争夺 ${escapePlainHtml(districts)}`;
    }

    const byPair = new Map();
    for (const cap of capturesList) {
        const prev = cap.previousCampKey && cap.previousCampKey !== cap.campKey
            ? cap.previousCampKey
            : '';
        const groupKey = `${cap.campKey || ''}->${prev}`;
        if (!byPair.has(groupKey)) byPair.set(groupKey, { campKey: cap.campKey, prevCampKey: prev || null, districts: [] });
        byPair.get(groupKey).districts.push(formatDistrictLabel(cap.districtId));
    }
    return [...byPair.values()].map(group => {
        const uniqueDistricts = [...new Set(group.districts)].join(' ');
        if (group.prevCampKey) {
            return `${campInlineHtml(stats, group.campKey)} 从 ${campInlineHtml(stats, group.prevCampKey)} 夺取 ${uniqueDistricts}`;
        }
        return `${campInlineHtml(stats, group.campKey)} 攻占 ${uniqueDistricts}`;
    }).join(' ');
}

function renderDeathLineHtml(stats, death) {
    if (!death) return '';
    const victimHtml = campInlineHtml(stats, death.campKey);
    const unitHtml = `<b>${escapePlainHtml(death.displayName || death.commanderName || '将领')}</b>`;
    if (death.killerCampKey) {
        return `${campInlineHtml(stats, death.killerCampKey)} 击杀 ${victimHtml} ${unitHtml}`;
    }
    return `${victimHtml} ${unitHtml} 阵亡`;
}

function renderTurningLineHtml(stats, tp, compact = false) {
    if (!tp) return '';
    const deltaPct = Math.round((tp.delta || 0) * 100);
    const prevPct = Math.round((tp.prevShare || 0) * 100);
    const curPct = Math.round((tp.curShare || 0) * 100);
    if (compact) {
        return `${campInlineHtml(stats, tp.campKey)} 控制力 +${deltaPct}%${tp.leaderChanged ? ' 反超领跑' : ''}`;
    }
    return `${campInlineHtml(stats, tp.campKey)} 控制力大涨 +${deltaPct}%（${prevPct}% → ${curPct}%）${tp.leaderChanged ? ' 反超领跑' : ''}`;
}

function renderBelligerentsLineHtml(stats, belligerents) {
    if (!belligerents?.length) return '多方主力大规模交火';
    const vsHtml = belligerents
        .map(entry => campInlineHtml(stats, entry.campKey))
        .join('<b class="match-battle-vs">VS</b>');
    return belligerents.length >= 2
        ? `${vsHtml} 主力会战`
        : `${vsHtml} 主导战局`;
}

function renderEventSideBadge(stats, event) {
    const type = event.eventType || 'pitchedBattle';
    const flagOnly = campKey => {
        if (!campKey) return '';
        const { camp, index } = findCampEntry(stats, campKey);
        return flagBadgeHtml(camp, index, { size: 'xs' });
    };

    if (type === 'factionEliminated' && event.eliminations?.length) {
        const elims = event.eliminations.slice(0, 3);
        const finishers = [...new Set(elims.map(e => e.finisherCampKey).filter(Boolean))];
        const tag = event.eliminations.length > 1 ? `覆灭 ${event.eliminations.length} 家` : '势力覆灭';
        if (elims.length > 1 && finishers.length === 1) {
            return `<div class="match-battle-matchup">${flagOnly(finishers[0])}<b class="match-battle-op">⚔</b>${elims.map(e => flagOnly(e.victimCampKey)).join('')}</div><small>${tag}</small>`;
        }
        const rows = elims.map(elim => elim.finisherCampKey
            ? `<div class="match-battle-matchup">${flagOnly(elim.finisherCampKey)}<b class="match-battle-op">⚔</b>${flagOnly(elim.victimCampKey)}</div>`
            : `<div class="match-battle-matchup">${flagOnly(elim.victimCampKey)}</div>`
        );
        return rows.length > 1
            ? `<div class="match-battle-matchup-stack">${rows.join('')}</div><small>${tag}</small>`
            : `${rows[0]}<small>${elims[0].finisherCampKey ? tag : '全军覆没'}</small>`;
    }

    if (type === 'commanderFall' && event.commanderDeaths?.length) {
        const deaths = event.commanderDeaths.slice(0, 3);
        const tag = event.commanderDeaths.length > 1 ? `斩将 ${event.commanderDeaths.length} 名` : '斩将';
        const rows = deaths.map(death => death.killerCampKey
            ? `<div class="match-battle-matchup">${flagOnly(death.killerCampKey)}<b class="match-battle-op">⚔</b>${flagOnly(death.campKey)}</div>`
            : `<div class="match-battle-matchup">☠${flagOnly(death.campKey)}</div>`
        );
        return rows.length > 1
            ? `<div class="match-battle-matchup-stack">${rows.join('')}</div><small>${tag}</small>`
            : `${rows[0]}<small>${tag}</small>`;
    }

    if (type === 'breakthrough') {
        const capturers = [...new Set((event.capturesList || []).map(cap => cap.campKey).filter(Boolean))];
        const prevEnemies = [...new Set((event.capturesList || [])
            .map(cap => cap.previousCampKey)
            .filter(key => key && !capturers.includes(key)))];
        if (capturers.length === 1 && prevEnemies.length >= 1) {
            return `<div class="match-battle-matchup">${flagOnly(capturers[0])}<b class="match-battle-op">➔</b>${prevEnemies.slice(0, 2).map(flagOnly).join('')}</div><small>攻占 ${formatNumber(event.captures)} 城</small>`;
        }
        if (capturers.length) {
            return `<div class="match-battle-matchup">${capturers.slice(0, 2).map(flagOnly).join('')}</div><small>攻占 ${formatNumber(event.captures)} 城</small>`;
        }
    }

    if (type === 'turningPoint' && event.turningPoint) {
        const tp = event.turningPoint;
        if (tp.leaderChanged && tp.previousLeaderCampKey) {
            return `<div class="match-battle-matchup">${flagOnly(tp.campKey)}<b class="match-battle-op">↗</b>${flagOnly(tp.previousLeaderCampKey)}</div><small>反超领跑</small>`;
        }
        return `<div class="match-battle-matchup">${flagOnly(tp.campKey)}</div><small>控制 +${Math.round((tp.delta || 0) * 100)}%</small>`;
    }

    const bellig = Array.isArray(event.belligerents) ? event.belligerents : [];
    if (bellig.length >= 2) {
        const shareSummary = bellig
            .map(entry => `${sanitizeUiText(findCampEntry(stats, entry.campKey).camp?.name || entry.campKey)} ${Math.round((entry.share || 0) * 100)}%`)
            .join(' ');
        const vsFlags = bellig.map(entry => flagOnly(entry.campKey)).join('<b class="match-battle-vs">VS</b>');
        return `<div class="match-battle-matchup" title="${escapeHtml(shareSummary)}">${vsFlags}</div><small>主力会战</small>`;
    }

    if (event.leadingCampKey) {
        return `<div class="match-battle-matchup">${flagOnly(event.leadingCampKey)}</div><small>输出领先</small>`;
    }
    return '<small>多方混战</small>';
}

function renderBattleEvents(stats, container) {
    if (!stats.battleEvents.length) {
        container.innerHTML = '<p class="match-stats-empty">本局各回合交战强度较均匀，没有达到相对高强度阈值的战役事件。</p>';
        return;
    }
    container.innerHTML = stats.battleEvents.map(event => {
        const type = event.eventType || 'pitchedBattle';
        const badgeCls = eventTypeBadgeClass(type);
        const deaths = Array.isArray(event.commanderDeaths) ? event.commanderDeaths : [];
        const captures = Array.isArray(event.capturesList) ? event.capturesList : [];
        const elims = Array.isArray(event.eliminations) ? event.eliminations : [];
        const bellig = Array.isArray(event.belligerents) ? event.belligerents : [];

        let headlineHtml = escapePlainHtml(event.label);
        const subNotes = [];

        if (type === 'factionEliminated' && elims.length) {
            const finishers = [...new Set(elims.map(elim => elim.finisherCampKey).filter(Boolean))];
            if (elims.length > 1 && finishers.length === 1) {
                headlineHtml = `${campInlineHtml(stats, finishers[0])} 消灭 ${elims.map(elim => campInlineHtml(stats, elim.victimCampKey)).join(' ')}（兵力与据点归零）`;
            } else {
                headlineHtml = elims.map(elim => elim.finisherCampKey
                    ? `${campInlineHtml(stats, elim.finisherCampKey)} 消灭 ${campInlineHtml(stats, elim.victimCampKey)}`
                    : `${campInlineHtml(stats, elim.victimCampKey)} 退出战局`
                ).join(' ') + '（兵力与据点归零）';
            }
            if (deaths.length) subNotes.push(...deaths.map(death => renderDeathLineHtml(stats, death)));
            if (captures.length) subNotes.push(renderCaptureGroupsHtml(stats, captures));
            if (event.turningPoint) subNotes.push(renderTurningLineHtml(stats, event.turningPoint, true));
        } else if (type === 'commanderFall' && deaths.length) {
            headlineHtml = deaths.length === 1
                ? renderDeathLineHtml(stats, deaths[0])
                : `${renderDeathLineHtml(stats, deaths[0])} 等 ${deaths.length} 名将领陨落`;
            if (deaths.length > 1) subNotes.push(...deaths.slice(1).map(death => renderDeathLineHtml(stats, death)));
            if (captures.length) subNotes.push(renderCaptureGroupsHtml(stats, captures));
            if (event.turningPoint) subNotes.push(renderTurningLineHtml(stats, event.turningPoint, true));
        } else if (type === 'breakthrough') {
            headlineHtml = captures.length
                ? renderCaptureGroupsHtml(stats, captures)
                : `${campInlineHtml(stats, event.leadingCampKey)} 突破敌军防线`;
            if (event.turningPoint) subNotes.push(renderTurningLineHtml(stats, event.turningPoint, true));
        } else if (type === 'turningPoint' && event.turningPoint) {
            headlineHtml = renderTurningLineHtml(stats, event.turningPoint, false);
            if (captures.length) subNotes.push(renderCaptureGroupsHtml(stats, captures));
        } else {
            headlineHtml = renderBelligerentsLineHtml(stats, bellig);
            if (captures.length) subNotes.push(renderCaptureGroupsHtml(stats, captures));
        }

        const metricChips = [
            `<span>${formatNumber(event.engagements)} 次交战</span>`,
            `<span>${formatNumber(event.totalDamage)} 伤害</span>`,
            `<span>${formatNumber(event.totalLosses)} 单位阵亡</span>`
        ];
        if (event.captures) metricChips.push(`<span>${formatNumber(event.captures)} 次占城</span>`);
        if (event.commanderLosses) metricChips.push(`<span>${formatNumber(event.commanderLosses)} 名将领陨落</span>`);

        return `
            <article class="match-battle-event ${badgeCls}">
                <div class="match-battle-round">
                    <span>R${event.round}</span>
                    <em class="match-battle-pill ${badgeCls}">${escapePlainHtml(event.label)}</em>
                </div>
                <div class="match-battle-main">
                    <div class="match-battle-headline">${headlineHtml}</div>
                    ${subNotes.length ? `<div class="match-battle-sub">${subNotes.map(note => `<span>${note}</span>`).join('')}</div>` : ''}
                    <div class="match-battle-metrics">${metricChips.join('')}</div>
                </div>
                <div class="match-battle-side">
                    ${renderEventSideBadge(stats, event)}
                </div>
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
    const unitMvp = document.getElementById('matchUnitMvp');
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
            document.getElementById('matchControlMethod').textContent = sanitizeUiText(activeStats.methodology[methodKey]);
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
        subtitle.textContent = [sourceLabel, winner ? `${winner.name}获胜` : '', `${roundCount} 回合`, activeStats.mode?.type || '对局'].filter(Boolean).map(sanitizeUiText).join(' ');
        renderSummary(activeStats, summary);
        renderControlChart(activeStats, controlMetric, svg, legend, tooltip);
        renderCampCards(activeStats, campCards);
        renderLeaders(activeStats, leaders);
        if (unitMvp) renderUnitMvp(activeStats, unitMvp);
        unitCamp.innerHTML = '<option value="all">全部阵营</option>' + activeStats.camps
            .map(camp => `<option value="${escapeHtml(camp.campKey)}">${escapeHtml(camp.name)}</option>`)
            .join('');
        unitMetric.value = 'damageDealt';
        renderUnits();
        renderBattleEvents(activeStats, battleEvents);
        document.getElementById('matchControlMethod').textContent = sanitizeUiText(activeStats.methodology.control);
        document.getElementById('matchBattleMethod').textContent = sanitizeUiText(activeStats.methodology.battleEvents);
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
