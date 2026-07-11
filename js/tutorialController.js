// 教程控制器 v2 — 严格步骤状态机 + 四块遮罩开洞 + 固定布局锚点。
//
// 核心设计：
//   1. 四块暗色遮罩（上/下/左/右）在目标区域开洞，自然拦截非目标点击。
//   2. 对话框始终固定在底部锚点区域，不因 HUD/按钮变化而位移。
//   3. 目标高亮环独立于棋盘渲染循环，稳定锚定在像素坐标。
//   4. 对策卡使用纳入必经流程。
//
// 步骤阶段（phase）：
//   'dialog'        — 全屏遮罩无洞，只能点教练卡按钮
//   'canvasTarget'  — 遮罩在目标地块位置开洞，只能点棋子/地块
//   'actionButton'  — 遮罩在动作栏位置开洞，只能点技能按钮
//   'cardCanvas'    — 遮罩在手牌画布位置开洞，只能点对策卡
//   'auto'          — 无操作，等待事件自动推进

import { canvas } from './config.js';
import { gameState } from './state.js';
import { emit, on } from './eventBus.js';

// ===== 步骤定义 ====================================================
const STEPS = {
    welcome: {
        phase: 'dialog',
        title: '战术演练',
        text: '本局模拟真实残局：你指挥红军（狂战士 + 炮兵），蓝军防守中央城市。\n\n每一步需按指引完成。系统已锁定非目标操作，请跟随指示熟悉各兵种特性与克制关系。',
        button: '开始教程',
        next: 'topbar_intro'
    },
    topbar_intro: {
        phase: 'dialog',
        title: '战场总览',
        text: '顶部的信息卡显示当前游戏的行动方、天气情况，以及双方当前剩余资金。\n天气会不分阵营地对单位施加效果。现在是【🌧️雨天】，地图上所有的【骑兵】将移动得更慢。\n选中己方控制的城市后可在右侧面板招募部队，招募部队需要消耗对应的资金。查看统计与对策卡手牌。',
        button: '查看棋盘',
        next: 'units_intro',
        focus: '#topBar, #rightPanel'
    },
    units_intro: {
        phase: 'dialog',
        title: '兵力部署',
        text: '基础兵种有三种：步兵、骑兵、炮兵，分别充当前线抗压、快速突击、远程轰炸功能，它们之间存在相互克制关系。\n\n💡 克制简记：骑兵克远程，步兵守城克骑兵，远程高地压步兵。',
        button: '选中你的主将',
        next: 'unit_select',
        focus: '#canvasStage'
    },
    unit_select: {
        phase: 'canvasTarget',
        title: '选中狂战士',
        text: '点击地图上高亮的【狂战士】。\n选中后可在左上方信息栏查看基础属性，左下角查看当前单位的被动技能，右下角显示的则是主动技能。',
        target: 'unit:tutorial_berserker',
        focus: '#canvasStage'
    },
    unit_passive: {
        phase: 'dialog',
        title: '兵种被动 & 血怒',
        text: '狂战士因已损失生命触发了【血怒】：损失的生命按比例转为攻击与防御（底部效果徽章显示具体数值）。\n\n🐎 骑兵被动【冲锋】：移动越远，造成的伤害越高。雨天每步消耗 +1。\n\n🎯 炮兵被动【高地】：位于山地时射程 +1。风天同样生效。',
        button: '查看对策卡',
        next: 'card_intro',
        focus: '#selectionHud, #canvasPassiveButtons'
    },
    card_intro: {
        phase: 'dialog',
        title: '对策卡',
        text: '右侧面板下方为【对策卡】手牌。每回合可使用一次，扭转战局。\n\n你已获得一张【疗愈】：对任一单位使用，立即恢复 40% 最大生命值。\n\n先对受伤的狂战士使用疗愈，然后再推进。',
        button: '使用疗愈',
        next: 'card_use',
        focus: '#cardCanvas'
    },
    card_use: {
        phase: 'cardCanvas',
        title: '点击疗愈卡',
        text: '点击右侧手牌中的【疗愈】卡牌，进入选目标模式。',
        target: 'card:heal',
        next: 'card_target',
        focus: '#cardCanvas'
    },
    card_target: {
        phase: 'canvasTarget',
        title: '选择目标',
        text: '点击地图上的【狂战士】，为其恢复生命。',
        target: 'unit:tutorial_berserker',
        focus: '#canvasStage'
    },
    move: {
        phase: 'canvasTarget',
        title: '移动·地形·天气',
        text: '先点击【狂战士】选中它，此时可看到蓝色高亮可移动范围，然后点击高亮的【森林】地块进行移动。\n\n🌳 地形会影响单位的移动和战斗能力。',
        target: 'tile:move',
        focus: '#canvasStage'
    },
    active_skill: {
        phase: 'actionButton',
        title: '主动技能：泣血',
        text: '双击右下角动作栏的【泣血】按钮发动狂战士的主动技能。\n这将消耗当前生命大幅强化下一次攻击，并对目标周围的敌人造成溅射伤害。\n\n💡 每位将领都拥有各异的丰富技能等你来探索！',
        target: 'skill:commander',
        focus: '#canvasActionButtons'
    },
    attack: {
        phase: 'canvasTarget',
        title: '攻击与占领',
        text: '点击高亮的【百夫长】（城市中的蓝军步兵）发动制胜一击！\n击败守军后，近战单位会进入城市，行政区此时将变更归属。',
        target: 'unit:tutorial_centurion',
        focus: '#canvasStage'
    },
    post_attack_card_intro: {
        phase: 'dialog',
        title: '城市易手',
        text: '中央行政区已经被占领！\n若残局尚未结束，你还可以：\n• 继续使用对策卡扭转战局/在己方城市补充兵员/部署新单位扩大优势\n对策卡是逆转关键——每回合仔细考虑是否使用。',
        button: '继续',
        next: 'complete'
    },
    complete: {
        phase: 'dialog',
        title: '教程完成',
        text: '你已掌握基本战术要领，现在开始你的征服之路吧！',
        button: '返回大厅',
        next: '__exit__'
    }
};

function targetId(target) {
    if (!target || typeof target !== 'string') return null;
    const colonIdx = target.indexOf(':');
    return colonIdx >= 0 ? target.slice(colonIdx + 1) : target;
}

function targetKind(target) {
    if (!target || typeof target !== 'string') return null;
    const colonIdx = target.indexOf(':');
    return colonIdx >= 0 ? target.slice(0, colonIdx) : 'unknown';
}

export function createTutorialController() {
    const overlay = document.getElementById('tutorialOverlay');
    const card = document.getElementById('tutorialCoach');
    const title = document.getElementById('tutorialTitle');
    const text = document.getElementById('tutorialText');
    const button = document.getElementById('tutorialNextBtn');
    const progress = document.getElementById('tutorialProgress');
    const ring = document.getElementById('tutorialTargetRing');
    const hint = document.getElementById('tutorialHint');
    const paneTop = document.getElementById('tutorialPaneTop');
    const paneBottom = document.getElementById('tutorialPaneBottom');
    const paneLeft = document.getElementById('tutorialPaneLeft');
    const paneRight = document.getElementById('tutorialPaneRight');

    let active = false;
    let stepId = '';

    function clearFocus() {
        document.querySelectorAll('.tutorial-focus').forEach(el => el.classList.remove('tutorial-focus'));
    }

    function getTargetTile(stepTarget) {
        if (!stepTarget || !gameState.tutorialTargets) return null;
        const targets = gameState.tutorialTargets;
        const kind = targetKind(stepTarget);
        const id = targetId(stepTarget);

        if (kind === 'unit') {
            if (!gameState.tiles) return null;
            return gameState.tiles.find(tile => tile.unit?.id === id) || null;
        }
        if (kind === 'tile') {
            if (id === 'move' && targets.move) {
                return gameState.tileMap.get(`${targets.move.q},${targets.move.r}`) || null;
            }
            if (id === 'attack' && targets.attack) {
                return gameState.tileMap.get(`${targets.attack.q},${targets.attack.r}`) || null;
            }
        }
        return null;
    }

    // ---- 计算 hole 在视口中的位置 ----
    function getHoleRect(step) {
        if (!step || step.phase === 'dialog') return null; // 全遮无洞

        const pad = 12; // 洞比目标稍大，留操作余量

        if (step.phase === 'canvasTarget') {
            // 棋子/地块：从 tile 坐标映射到视口坐标
            const tile = getTargetTile(step.target);
            if (!tile) return null;
            const rect = canvas.getBoundingClientRect();
            const scaleX = rect.width / canvas.width;
            const scaleY = rect.height / canvas.height;
            const size = Math.max(72, Math.min(rect.width, rect.height) * 0.1);
            const cx = rect.left + tile.x * scaleX;
            const cy = rect.top + tile.y * scaleY;
            return {
                left: cx - size / 2 - pad,
                top: cy - size / 2 - pad,
                right: cx + size / 2 + pad,
                bottom: cy + size / 2 + pad
            };
        }

        if (step.phase === 'actionButton') {
            const el = document.querySelector('#canvasActionButtons');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad };
        }

        if (step.phase === 'cardCanvas') {
            const el = document.querySelector('#cardCanvas');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad };
        }

        return null;
    }

    // ---- 四块遮罩定位 ----
    function updatePanes(step) {
        if (![paneTop, paneBottom, paneLeft, paneRight].every(p => p)) return;

        const hole = getHoleRect(step);

        if (!hole) {
            // 全屏遮罩（dialog 等）
            paneTop.style.cssText = 'display:block;top:0;left:0;width:100vw;height:100vh';
            paneBottom.style.display = 'none';
            paneLeft.style.display = 'none';
            paneRight.style.display = 'none';
            return;
        }

        const w = window.innerWidth;
        const h = window.innerHeight;

        paneTop.style.cssText = `display:block;top:0;left:0;width:100vw;height:${hole.top}px`;
        paneBottom.style.cssText = `display:block;top:${hole.bottom}px;left:0;width:100vw;height:${h - hole.bottom}px`;
        paneLeft.style.cssText = `display:block;top:${hole.top}px;left:0;width:${hole.left}px;height:${hole.bottom - hole.top}px`;
        paneRight.style.cssText = `display:block;top:${hole.top}px;left:${hole.right}px;width:${w - hole.right}px;height:${hole.bottom - hole.top}px`;
    }

    // ---- 目标高亮环 ----
    function syncTargetRing() {
        const step = STEPS[stepId];
        if (!step || !active) { ring?.classList.remove('visible'); return; }

        if (step.phase === 'canvasTarget') {
            const tile = getTargetTile(step.target);
            if (tile) {
                const rect = canvas.getBoundingClientRect();
                const scaleX = rect.width / canvas.width;
                const scaleY = rect.height / canvas.height;
                const size = Math.max(56, Math.min(rect.width, rect.height) * 0.09);
                ring.style.width = `${size}px`;
                ring.style.height = `${size}px`;
                ring.style.left = `${rect.left + tile.x * scaleX - size / 2}px`;
                ring.style.top = `${rect.top + tile.y * scaleY - size / 2}px`;
                ring.classList.add('visible');
                return;
            }
        }

        ring?.classList.remove('visible');
    }

    // ---- 显示步骤 ----
    function show(nextStep) {
        const step = STEPS[nextStep];
        if (!step || !active) return;
        stepId = nextStep;
        gameState.tutorialStep = nextStep;
        clearFocus();

        // 高亮目标元素
        if (step.focus) {
            step.focus.split(',').forEach(selector => {
                const el = document.querySelector(selector.trim());
                if (el) el.classList.add('tutorial-focus');
            });
        }

        title.textContent = step.title;
        text.textContent = step.text;
        const hasButton = !!step.button;
        button.hidden = !hasButton;
        if (hasButton) {
            button.textContent = step.button;
            button.dataset.next = step.next || '';
        }
        card.dataset.step = nextStep;

        const stepKeys = Object.keys(STEPS);
        const idx = stepKeys.indexOf(nextStep);
        const total = stepKeys.length;
        const pct = idx >= 0 ? Math.round((idx / (total - 1)) * 100) : 0;
        progress.textContent = `教程 ${pct}%`;

        // 更新四块遮罩位置
        updatePanes(step);

        // 显示遮罩
        overlay.classList.add('show');

        // 同步目标环
        requestAnimationFrame(() => requestAnimationFrame(syncTargetRing));
    }

    // ---- 显示操作提示 ----
    function showHint(msg) {
        if (!hint) return;
        hint.textContent = msg;
        hint.classList.add('visible');
        clearTimeout(hint._timer);
        hint._timer = setTimeout(() => hint.classList.remove('visible'), 1800);
    }

    // ---- canvas 点击验证（由 input.js 调用） ----
    function validateCanvasClick(clickedTile) {
        const step = STEPS[stepId];
        if (!step || !active) return true;

        if (step.phase === 'canvasTarget') {
            const kind = targetKind(step.target);
            const id = targetId(step.target);
            const targets = gameState.tutorialTargets;

            if (kind === 'unit') {
                if (!clickedTile?.unit) {
                    showHint('请点击指定的目标单位');
                    return false;
                }
                if (stepId === 'attack' && clickedTile.unit.id === targets.berserkerUnitId) {
                    return true;
                }
                if (clickedTile.unit.id !== id) {
                    showHint('请点击指定的目标单位');
                    return false;
                }
                return true;
            }

            if (kind === 'tile') {
                if (id === 'move' && targets.move) {
                    if (clickedTile?.unit?.id === targets.berserkerUnitId) return true;
                    if (!clickedTile || clickedTile.q !== targets.move.q || clickedTile.r !== targets.move.r) {
                        showHint('请点击高亮的森林地块');
                        return false;
                    }
                    return true;
                }
                if (id === 'attack' && targets.attack) {
                    if (!clickedTile || clickedTile.q !== targets.attack.q || clickedTile.r !== targets.attack.r) {
                        showHint('请点击高亮的城市目标');
                        return false;
                    }
                    return true;
                }
            }

            // card_target 阶段：限狂战士
            if (stepId === 'card_target') {
                if (!clickedTile) { showHint('请点击【狂战士】以使用疗愈'); return false; }
                if (clickedTile.unit?.id !== targets.berserkerUnitId) {
                    showHint('请选择【狂战士】作为疗愈目标');
                    return false;
                }
                return true;
            }
        }

        return true;
    }

    // ---- 卡牌 canvas 点击验证 ----
    function validateCardCanvasClick(cardId) {
        const step = STEPS[stepId];
        if (!step || !active) return false;

        if (step.phase === 'cardCanvas') {
            const expected = targetId(step.target);
            if (expected && cardId === expected) {
                const n = step.next;
                if (n) {
                    const cur = stepId;
                    setTimeout(() => { if (active && stepId === cur) show(n); }, 120);
                }
                return true;
            }
            showHint('请点击【疗愈】卡牌');
            return false;
        }

        showHint('请先完成当前指引');
        return false;
    }

    // ---- 动作按钮点击验证 ----
    function validateActionButton(actionKey) {
        const step = STEPS[stepId];
        if (!step || !active) return true;

        if (step.phase === 'actionButton') {
            if (!actionKey || !actionKey.startsWith('commander:')) {
                showHint('请点击右下角的【泣血】技能按钮');
                return false;
            }
            return true;
        }

        showHint('请先完成当前指引');
        return false;
    }

    // ---- 键盘操作验证 ----
    function validateKeyboard(key) {
        const step = STEPS[stepId];
        if (!step || !active) return true;

        // 允许浏览器功能键和 ESC
        if (key === 'F12' || key === 'F5' || key === 'Escape') return true;

        showHint('教程期间请使用鼠标操作');
        return false;
    }

    // ---- 启动 ----
    function start() {
        if (active) return;
        active = true;
        stepId = '';

        // 安装键盘拦截（仅拦截游戏快捷键）
        document.addEventListener('keydown', keydownHandler, { capture: true });
        // 拦截右键（防止右键菜单干扰操作）
        document.addEventListener('contextmenu', ctxHandler, { capture: true });

        overlay.classList.add('show');
        show('welcome');
    }

    // ---- 停止 ----
    function stop() {
        active = false;
        stepId = '';
        gameState.tutorialStep = '';
        clearFocus();
        ring?.classList.remove('visible');
        if (hint) hint.classList.remove('visible');

        // 恢复全遮 -> 隐藏所有遮罩
        updatePanes(null);
        overlay.classList.remove('show');

        document.removeEventListener('keydown', keydownHandler, { capture: true });
        document.removeEventListener('contextmenu', ctxHandler, { capture: true });
    }

    // ---- 键盘拦截 handler ----
    function keydownHandler(e) {
        if (!active || !stepId) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (!validateKeyboard(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        }
    }

    function ctxHandler(e) {
        if (active && stepId) { e.preventDefault(); e.stopPropagation(); }
    }

    // ---- 事件监听 ----
    button?.addEventListener('click', () => {
        const step = STEPS[stepId];
        if (!active || !step) return;
        if (step.next === '__exit__') { stop(); window.location.reload(); return; }
        if (step.next) show(step.next);
    });

    window.addEventListener('resize', () => {
        if (active) {
            const step = STEPS[stepId];
            if (step) updatePanes(step);
            requestAnimationFrame(syncTargetRing);
        }
    });

    // ---- eventBus 事件驱动的步骤推进 ----
    on('input:tileSelected', ({ unit }) => {
        if (!active || stepId !== 'unit_select') return;
        if (unit?.id === gameState.tutorialTargets?.berserkerUnitId) show('unit_passive');
    });

    on('input:cardUsed', ({ cardId, targetUnitId }) => {
        if (!active) return;
        if (stepId === 'card_target' && cardId === 'heal') show('move');
    });

    on('match:unitMoved', ({ unit, targetTile }) => {
        if (!active || stepId !== 'move') return;
        const mt = gameState.tutorialTargets?.move;
        if (unit?.id === gameState.tutorialTargets?.berserkerUnitId
            && targetTile?.q === mt?.q && targetTile?.r === mt?.r) show('active_skill');
    });

    on('input:commanderSkillUsed', ({ unit }) => {
        if (!active || stepId !== 'active_skill') return;
        if (unit?.id === gameState.tutorialTargets?.berserkerUnitId) show('attack');
    });

    on('match:cityCaptured', ({ cityTile, campKey }) => {
        if (!active || stepId !== 'attack') return;
        const at = gameState.tutorialTargets?.attack;
        if (campKey === 'player1' && cityTile?.q === at?.q && cityTile?.r === at?.r) {
            show('post_attack_card_intro');
        }
    });

    return {
        start, stop, syncTargetRing,
        validateCanvasClick, validateCardCanvasClick, validateActionButton, validateKeyboard
    };
}

// ===== 模块级共享实例（供 input.js 等外部模块轻量引用） =====
let _sharedCtrl = null;
export function setTutorialControllerRef(ctrl) { _sharedCtrl = ctrl; }
export function getTutorialControllerRef() { return _sharedCtrl; }

export function tutorialValidateCanvasClick(clickedTile) {
    if (!gameState.tutorialMode || !gameState.tutorialStep) return true;
    const ctrl = getTutorialControllerRef();
    return ctrl ? ctrl.validateCanvasClick(clickedTile) : true;
}

export function tutorialValidateCardCanvasClick(cardId) {
    if (!gameState.tutorialMode || !gameState.tutorialStep) return true;
    const ctrl = getTutorialControllerRef();
    return ctrl ? ctrl.validateCardCanvasClick(cardId) : true;
}

export function tutorialValidateActionButton(actionKey) {
    if (!gameState.tutorialMode || !gameState.tutorialStep) return true;
    const ctrl = getTutorialControllerRef();
    return ctrl ? ctrl.validateActionButton(actionKey) : true;
}
