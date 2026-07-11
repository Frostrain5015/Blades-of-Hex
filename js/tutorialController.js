// 教程控制器 v2 — 严格步骤状态机 + 全局输入拦截 + 固定布局锚点。
//
// 核心设计：
//   1. 每一步精确声明允许的操作（不允许的操作被全局拦截）。
//   2. 对话框始终固定在底部锚点区域，不因 HUD/按钮变化而位移。
//   3. 目标高亮环独立于棋盘渲染循环，稳定锚定在像素坐标。
//   4. 对策卡使用纳入必经流程。
//
// 步骤阶段（phase）：
//   'dialog'        — 只能点教程按钮，阻止所有游戏内交互
//   'canvasTarget'  — 只能点棋盘上的指定单位/地块
//   'actionButton'  — 只能点棋盘动作栏上的指定按钮
//   'cardCanvas'    — 只能点对策卡画布上的指定卡牌
//   'auto'          — 无操作，等待事件自动推进

import { canvas } from './config.js';
import { gameState } from './state.js';
import { emit, on } from './eventBus.js';

// ===== 步骤定义 ====================================================
// 各字段：
//   phase     — 步骤阶段（见上）
//   title     — 对话框标题
//   text      — 对话框说明文字
//   button    — 按钮文字（null 表示无按钮，等待操作/事件）
//   next      — 按钮点击后进入的步骤 id（仅 phase='dialog' 时有效）
//   focus     — 高亮 CSS 选择器（逗号分隔）
//   target    — 操作目标标识（不同 phase 含义不同）
//   nextEvent — 监听此 eventBus 事件后自动推进（配合 nextStep）
//   nextStep  — 事件触发后进入的步骤
//   condition — (event) => boolean 事件过滤条件
const STEPS = {
    // ===== Phase 1: 欢迎与总览 ====================
    welcome: {
        phase: 'dialog',
        title: '欢迎',
        text: '欢迎来到《Blades of Hex》，接下来您将通过一个简短的教程学习游戏的基本操作与战术要领。',
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
    // ===== Phase 2: 选中狂战士 ====================
    unit_select: {
        phase: 'canvasTarget',
        title: '选中狂战士',
        text: '点击地图上高亮的【狂战士】。\n选中后可在左上方信息栏查看基础属性，左下角查看当前单位的被动技能，右下角显示的则是主动技能。',
        target: 'unit:tutorial_berserker',
        focus: '#canvasStage'
    },
    // ===== Phase 3: 被动技能与兵种特性 ====================
    unit_passive: {
        phase: 'dialog',
        title: '兵种被动 & 血怒',
        text: '狂战士因已损失生命触发了【血怒】：损失的生命按比例转为攻击与防御（底部效果徽章显示具体数值）。\n\n🐎 骑兵被动【冲锋】：移动越远，造成的伤害越高。雨天每步消耗 +1。\n\n🎯 炮兵被动【高地】：位于山地时射程 +1。风天同样生效。',
        button: '查看对策卡',
        next: 'card_intro',
        focus: '#selectionHud, #canvasPassiveButtons'
    },
    // ===== Phase 4: 对策卡介绍 ====================
    card_intro: {
        phase: 'dialog',
        title: '对策卡',
        text: '右侧面板下方为【对策卡】手牌。每回合可使用一次，扭转战局。\n\n你已获得一张【疗愈】：对任一单位使用，立即恢复 40% 最大生命值。\n\n先对受伤的狂战士使用疗愈，然后再推进。',
        button: '使用疗愈',
        next: 'card_use',
        focus: '#cardCanvas'
    },
    // ===== Phase 5: 点击对策卡 ====================
    card_use: {
        phase: 'cardCanvas',
        title: '点击疗愈卡',
        text: '点击右侧手牌中的【疗愈】卡牌，进入选目标模式。',
        target: 'card:heal',
        next: 'card_target',
        focus: '#cardCanvas'
    },
    // ===== Phase 6: 选择卡牌目标 ====================
    card_target: {
        phase: 'canvasTarget',
        title: '选择目标',
        text: '点击地图上的【狂战士】，为其恢复生命。',
        target: 'unit:tutorial_berserker',
        focus: '#canvasStage'
    },
    // ===== Phase 7: 移动与地形 ====================
    move: {
        phase: 'canvasTarget',
        title: '移动·地形·天气',
        text: '先点击【狂战士】选中它，此时可看到蓝色高亮可移动范围，然后点击高亮的【森林】地块进行移动。\n\n🌳 地形会影响单位的移动和战斗能力。',
        target: 'tile:move',
        focus: '#canvasStage'
    },
    // ===== Phase 8: 主动技能：泣血 ====================
    active_skill: {
        phase: 'actionButton',
        title: '主动技能：泣血',
        text: '双击右下角动作栏的【泣血】按钮发动狂战士的主动技能。\n这将消耗当前生命大幅强化下一次攻击，并对目标周围的敌人造成溅射伤害。\n\n💡 每位将领都拥有各异的丰富技能等你来探索！',
        target: 'skill:commander',
        focus: '#canvasActionButtons'
    },
    // ===== Phase 9: 攻击百夫长 ====================
    attack: {
        phase: 'canvasTarget',
        title: '攻击与占领',
        text: '点击高亮的【百夫长】（城市中的蓝军步兵）发动制胜一击！\n击败守军后，近战单位会进入城市，行政区此时将变更归属。',
        target: 'unit:tutorial_centurion',
        focus: '#canvasStage'
    },
    // ===== Phase 10: 占领城市后的对策卡复讲 ====================
    post_attack_card_intro: {
        phase: 'dialog',
        title: '城市易手',
        text: '中央行政区已经被占领！\n若残局尚未结束，你还可以：\n• 继续使用对策卡扭转战局/在己方城市补充兵员/部署新单位扩大优势\n对策卡是逆转关键——每回合仔细考虑是否使用。',
        button: '继续',
        next: 'complete'
    },
    // ===== Phase 11: 完成 ====================
    complete: {
        phase: 'dialog',
        title: '教程完成',
        text: '你已掌握基本战术要领，现在开始你的征服之路吧！',
        button: '返回大厅',
        next: '__exit__'
    }
};

// 获取当前步骤的原始目标 id 字符串（不含前缀）
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
    const blockingShield = document.getElementById('tutorialBlockingShield');

    let active = false;
    let stepId = '';
    let _interceptorInstalled = false;

    // ---- 工具函数 ----

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

    // ---- 目标高亮环（固定锚点，不随 HUD 跳变）----
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

        // 画布目标无有效 tile 时不显示环
        if (step.phase === 'actionButton' && step.target === 'skill:commander') {
            // 动作按钮由聚焦高亮 handle，不用环
            ring?.classList.remove('visible');
            return;
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

        // 设置对话框文案
        title.textContent = step.title;
        text.textContent = step.text;
        const hasButton = !!step.button;
        button.hidden = !hasButton;
        if (hasButton) {
            button.textContent = step.button;
            button.dataset.next = step.next || '';
        }
        card.dataset.step = nextStep;

        // 进度标签
        const stepKeys = Object.keys(STEPS);
        const idx = stepKeys.indexOf(nextStep);
        const total = stepKeys.length;
        const pct = idx >= 0 ? Math.round((idx / (total - 1)) * 100) : 0;
        progress.textContent = `教程 ${pct}%`;

        // 显示遮罩
        overlay.classList.add('show');

        // 更新拦截盾状态（对话框阶段全拦截；其他阶段让出可操作区域）
        updateBlockingShield(step);

        // 同步目标环（延迟一帧以保证布局稳定）
        requestAnimationFrame(() => requestAnimationFrame(syncTargetRing));
    }

    // ---- 拦截盾状态管理 ----
    function updateBlockingShield(step) {
        if (!blockingShield) return;
        if (!step) { blockingShield.classList.remove('active'); return; }

        if (step.phase === 'dialog') {
            // 对话框阶段：全屏拦截，只露出教练卡区域
            blockingShield.classList.add('active');
            blockingShield.style.pointerEvents = 'auto';
        } else {
            // 操作阶段：遮罩仍然覆盖全屏，但通过 CSS pointer-events 让部分区域可穿透
            blockingShield.classList.add('active');
            blockingShield.style.pointerEvents = 'auto';
        }
    }

    // ---- 显示操作提示（非法操作时） ----
    function showHint(msg) {
        if (!hint) return;
        hint.textContent = msg;
        hint.classList.add('visible');
        clearTimeout(hint._timer);
        hint._timer = setTimeout(() => hint.classList.remove('visible'), 1800);
    }

    // ---- 全局输入拦截器（capture phase） ----
    function isAllowedClick(e) {
        const step = STEPS[stepId];
        if (!step || !active) return true; // 不拦截非活跃状态

        const target = e.target;

        // 教程对话框按钮始终可点
        if (target === button || target.closest('#tutorialCoach')) {
            // 仅 dialog/auto 阶段允许
            if (step.phase === 'dialog') return true;
            // 其他阶段也可点（防止玩家卡死），但只会提示
            return true;
        }

        // 允许设置按钮（玩家可随时调整设置）
        if (target.closest('#settingsBtn') || target.closest('#settingsOverlay')) {
            return true;
        }
        // 允许聊天
        if (target.closest('#chatToggleBtn') || target.closest('#chatOverlay')) {
            return true;
        }
        // 允许静音按钮
        if (target.closest('#lobbyMuteBtn')) {
            return true;
        }

        switch (step.phase) {
            case 'dialog':
                // 对话框阶段：只允许点教程按钮
                return false;

            case 'canvasTarget': {
                // 棋盘选择目标阶段：只允许点击 canvas 上的特定目标
                if (!target.closest('#gameCanvas') && !target.closest('#canvasStage')) {
                    showHint('请按照指引点击棋盘上的目标');
                    return false;
                }
                // 让 canvas 点击通过事件系统验证（在 input.js 拦截器中做精确判断）
                return true;
            }

            case 'actionButton': {
                // 动作按钮阶段：只允许点指定的 canvas 动作按钮
                if (target.closest('#canvasActionButtons') || target.closest('#canvasPassiveButtons')) {
                    return true;
                }
                showHint('请点击右下角的技能按钮');
                return false;
            }

            case 'cardCanvas': {
                // 卡牌选择阶段：只允许点 cardCanvas
                if (target.closest('#cardCanvas')) {
                    return true;
                }
                showHint('请点击右侧手牌中的对策卡');
                return false;
            }

            case 'auto':
                return false;

            default:
                return false;
        }
    }

    // ---- 公开的 canvas 点击验证（由 input.js 调用） ----
    function validateCanvasClick(clickedTile) {
        const step = STEPS[stepId];
        if (!step || !active) return true; // 非教程模式不拦截

        if (step.phase !== 'canvasTarget' && step.phase !== 'cardCanvas') {
            showHint('请先完成当前指引');
            return false;
        }

        if (step.phase === 'canvasTarget') {
            const kind = targetKind(step.target);
            const id = targetId(step.target);
            const targets = gameState.tutorialTargets;

            if (kind === 'unit') {
                if (!clickedTile?.unit) {
                    showHint('请点击指定的目标单位');
                    return false;
                }
                // 攻击步骤允许先点自己的单位重新选中
                if (stepId === 'attack' && clickedTile.unit.id === targets.berserkerUnitId) {
                    return true;
                }
                if (clickedTile.unit.id !== id) {
                    showHint('请点击指定的目标单位');
                    return false;
                }
                return true; // 合法目标，交给事件系统推进
            }

            if (kind === 'tile') {
                if (id === 'move' && targets.move) {
                    // 允许先点狂战士选中它（可能因卡牌操作取消选中）
                    if (clickedTile?.unit?.id === targets.berserkerUnitId) {
                        return true;
                    }
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

            // card_target 阶段的特殊处理：点击任何有效卡牌目标
            // 由 eventBus 事件驱动，canvas 层放行所有点击（卡牌系统自己会验证合法性）
            if (stepId === 'card_target') {
                if (!clickedTile) {
                    showHint('请点击【狂战士】以使用疗愈');
                    return false;
                }
                // 限定只能点狂战士，确保疗愈用对单位
                if (clickedTile.unit?.id !== gameState.tutorialTargets?.berserkerUnitId) {
                    showHint('请选择【狂战士】作为疗愈目标');
                    return false;
                }
                return true;
            }
        }

        return false;
    }

    // ---- 卡牌 canvas 点击验证（由 input.js 调用） ----
    function validateCardCanvasClick(cardId) {
        const step = STEPS[stepId];
        if (!step || !active) return false;

        if (step.phase === 'cardCanvas') {
            const expectedTarget = targetId(step.target); // e.g. 'heal'
            if (expectedTarget && cardId === expectedTarget) {
                // 选卡成功：延迟推进到下一步（让 _handleCardCanvasClick 先设置 cardTargeting）
                const nextStep = step.next;
                if (nextStep) {
                    const currentStepId = stepId;
                    setTimeout(() => {
                        if (active && stepId === currentStepId) show(nextStep);
                    }, 120);
                }
                return true;
            }
            showHint('请点击【疗愈】卡牌');
            return false;
        }

        // 非 cardCanvas 阶段点卡牌 → 拦截
        showHint('请先完成当前指引');
        return false;
    }

    // ---- 动作按钮点击验证（由 input.js 调用） ----
    function validateActionButton(actionKey) {
        const step = STEPS[stepId];
        if (!step || !active) return true;

        if (step.phase === 'actionButton') {
            // 验证是否为指挥官技能按钮
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
        if (!step || !active) return true; // 非教程不拦截

        // 允许 ESC（取消选中/卡牌选择）
        if (key === 'Escape') return true;

        // 教程模式下阻止所有游戏快捷键
        showHint('教程期间请使用鼠标操作');
        return false;
    }

    // ---- 启动 ----
    function start() {
        if (active) return;
        active = true;
        stepId = '';
        overlay.classList.add('show');
        installInterceptor();
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
        if (blockingShield) blockingShield.classList.remove('active');
        overlay.classList.remove('show');
    }

    // ---- 全局事件拦截安装 ----
    function installInterceptor() {
        if (_interceptorInstalled) return;
        _interceptorInstalled = true;

        document.addEventListener('click', (e) => {
            if (!active || !stepId) return;
            if (!isAllowedClick(e)) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        }, { capture: true });

        // 拦截键盘事件
        document.addEventListener('keydown', (e) => {
            if (!active || !stepId) return;
            // 不拦截输入框
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (!validateKeyboard(e.key)) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        }, { capture: true });

        // 拦截右键（防止右键菜单干扰）
        document.addEventListener('contextmenu', (e) => {
            if (active && stepId) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, { capture: true });
    }

    // ---- 事件监听（推进步骤） ----
    // 按钮点击推进
    button?.addEventListener('click', () => {
        const step = STEPS[stepId];
        if (!active || !step) return;
        if (step.next === '__exit__') {
            stop();
            // 返回大厅
            window.location.reload();
            return;
        }
        if (step.next) show(step.next);
    });

    // 窗口 resize → 重定位目标环
    window.addEventListener('resize', () => {
        if (active) requestAnimationFrame(syncTargetRing);
    });

    // ---- eventBus 事件驱动的步骤推进 ----
    // 选中单位 → unit_select 推进
    on('input:tileSelected', ({ unit }) => {
        if (!active || stepId !== 'unit_select') return;
        if (unit?.id === gameState.tutorialTargets?.berserkerUnitId) {
            show('unit_passive');
        }
    });

    // 卡牌使用完成 → card_target 或 card_use 推进
    on('input:cardUsed', ({ cardId, targetUnitId }) => {
        if (!active) return;
        if (stepId === 'card_target' && cardId === 'heal') {
            // 疗愈使用成功 → 进入移动阶段
            show('move');
        }
    });

    // 移动完成 → move 推进
    on('match:unitMoved', ({ unit, targetTile }) => {
        if (!active || stepId !== 'move') return;
        const moveTarget = gameState.tutorialTargets?.move;
        if (unit?.id === gameState.tutorialTargets?.berserkerUnitId
            && targetTile?.q === moveTarget?.q && targetTile?.r === moveTarget?.r) {
            show('active_skill');
        }
    });

    // 主动技能使用 → active_skill 推进
    on('input:commanderSkillUsed', ({ unit }) => {
        if (!active || stepId !== 'active_skill') return;
        if (unit?.id === gameState.tutorialTargets?.berserkerUnitId) {
            show('attack');
        }
    });

    // 城市占领 → attack 推进
    on('match:cityCaptured', ({ cityTile, campKey }) => {
        if (!active || stepId !== 'attack') return;
        const attackTarget = gameState.tutorialTargets?.attack;
        if (campKey === 'player1'
            && cityTile?.q === attackTarget?.q && cityTile?.r === attackTarget?.r) {
            show('post_attack_card_intro');
        }
    });

    return {
        start,
        stop,
        syncTargetRing,
        validateCanvasClick,
        validateCardCanvasClick,
        validateActionButton,
        validateKeyboard
    };
}

// ===== 模块级共享实例（供 input.js 等外部模块轻量引用） =====
let _sharedCtrl = null;
export function setTutorialControllerRef(ctrl) { _sharedCtrl = ctrl; }
export function getTutorialControllerRef() { return _sharedCtrl; }

/**
 * 便捷验证器：由 input.js 在 canvas 点击后调用。
 * 返回 true 表示可放行，false 表示拦截。
 * 比完整实例更轻量，仅依赖 gameState 上的教程状态。
 */
export function tutorialValidateCanvasClick(clickedTile) {
    if (!gameState.tutorialMode || !gameState.tutorialStep) return true;
    const ctrl = getTutorialControllerRef();
    if (!ctrl) return true;
    return ctrl.validateCanvasClick(clickedTile);
}

export function tutorialValidateCardCanvasClick(cardId) {
    if (!gameState.tutorialMode || !gameState.tutorialStep) return true;
    const ctrl = getTutorialControllerRef();
    if (!ctrl) return true;
    return ctrl.validateCardCanvasClick(cardId);
}

export function tutorialValidateActionButton(actionKey) {
    if (!gameState.tutorialMode || !gameState.tutorialStep) return true;
    const ctrl = getTutorialControllerRef();
    if (!ctrl) return true;
    return ctrl.validateActionButton(actionKey);
}

export function tutorialValidateKeyboard(key) {
    if (!gameState.tutorialMode || !gameState.tutorialStep) return true;
    const ctrl = getTutorialControllerRef();
    if (!ctrl) return true;
    return ctrl.validateKeyboard(key);
}
