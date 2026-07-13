// Network chat UI controller. Keeps DOM state out of the application bootstrap.
import { getMyRole, isNetworkGame, sendChatMessage, roleToCamp } from './network.js';

const _chatHistory = { room: [], player1: [], player2: [], player3: [] };
let _chatChannel = 'room';
let _chatTargetRole = null;
let _chatLastSendTime = 0;
const CHAT_COOLDOWN = 500;
const _chatUnread = { room: 0, player1: 0, player2: 0, player3: 0 };
let _chatDragStartX = 0, _chatDragStartY = 0, _chatDragOrigX = 0, _chatDragOrigY = 0, _chatDragging = false;


export function isChatViewing(channel, targetRole = null) {
    const overlay = document.getElementById('chatOverlay');
    return !!overlay && overlay.classList.contains('show') && _chatChannel === channel
        && (channel === 'room' || _chatTargetRole === targetRole);
}

function _getChatHistoryKey(channel, targetRole) {
    return channel === 'room' ? 'room' : targetRole;
}

export function openChat(channel, targetRole = null) {
    if (!isNetworkGame()) return;
    const overlay = document.getElementById('chatOverlay');
    const headerLabel = document.getElementById('chatChannelLabel');
    const chatInput = document.getElementById('chatInput');

    _chatChannel = channel;
    _chatTargetRole = targetRole;

    if (channel === 'room') {
        headerLabel.textContent = '公共频道';
    } else if (targetRole) {
        const targetInfo = _roleToCampInfo(targetRole);
        headerLabel.textContent = `与${targetInfo.name}的私聊`;
    }

    // 清除该频道未读
    const key = _getChatHistoryKey(channel, targetRole);
    _chatUnread[key] = 0;
    _updateChatUnreadIndicator();

    _renderChatMessages();
    overlay.classList.add('show');
    chatInput.focus();
}

function closeChat() {
    document.getElementById('chatOverlay').classList.remove('show');
    _chatChannel = 'room';
    _chatTargetRole = null;
}

function togglePublicChat() {
    if (document.getElementById('chatOverlay').classList.contains('show') && _chatChannel === 'room') {
        closeChat();
    } else {
        openChat('room');
    }
}

function _renderChatMessages() {
    const messagesDiv = document.getElementById('chatMessages');
    messagesDiv.innerHTML = '';

    const key = _getChatHistoryKey(_chatChannel, _chatTargetRole);
    const history = _chatHistory[key] || [];
    const myRole = getMyRole();

    for (const msg of history) {
        messagesDiv.appendChild(_createMessageElement(msg, myRole));
    }
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function _createMessageElement(msg, myRole) {
    const isSelf = msg.senderRole === myRole;
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (isSelf ? 'self' : 'other');

    if (!isSelf) {
        const senderLabel = document.createElement('div');
        senderLabel.className = 'chat-msg-sender';
        senderLabel.style.color = msg.color;
        senderLabel.textContent = msg.senderName;
        div.appendChild(senderLabel);
    }

    const textEl = document.createElement('div');
    textEl.className = 'chat-msg-text';
    textEl.textContent = msg.text;
    div.appendChild(textEl);

    return div;
}

export function addChatMessage(senderRole, text, channel, targetRole) {
    const senderInfo = _roleToCampInfo(senderRole);
    const msg = {
        senderRole,
        senderName: senderInfo.name,
        color: senderInfo.color,
        text,
        timestamp: Date.now()
    };

    const key = _getChatHistoryKey(channel, targetRole);
    if (!_chatHistory[key]) _chatHistory[key] = [];
    _chatHistory[key].push(msg);
    if (_chatHistory[key].length > 200) {
        _chatHistory[key] = _chatHistory[key].slice(-200);
    }

    // 判断当前是否正在查看对应频道
    const isCurrentlyViewing =
        (_chatChannel === channel) &&
        (channel === 'room' || _chatTargetRole === targetRole);

    const overlay = document.getElementById('chatOverlay');
    if (isCurrentlyViewing && overlay.classList.contains('show')) {
        const messagesDiv = document.getElementById('chatMessages');
        const atBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight < 60;
        messagesDiv.appendChild(_createMessageElement(msg, getMyRole()));
        if (atBottom) messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } else {
        _chatUnread[key] = (_chatUnread[key] || 0) + 1;
        _updateChatUnreadIndicator();
    }
}

function _sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    const now = Date.now();
    if (now - _chatLastSendTime < CHAT_COOLDOWN) return;
    _chatLastSendTime = now;

    const myRole = getMyRole();
    if (!myRole) return;

    addChatMessage(myRole, text, _chatChannel, _chatTargetRole);
    sendChatMessage(_chatChannel, text, _chatTargetRole);

    input.value = '';
    input.focus();
}

function _initChatPanelDrag() {
    const panel = document.getElementById('chatPanel');
    const header = document.getElementById('chatHeader');

    header.addEventListener('mousedown', (e) => {
        if (e.target === document.getElementById('chatCloseBtn')) return;
        e.preventDefault();
        _chatDragging = true;
        _chatDragStartX = e.clientX;
        _chatDragStartY = e.clientY;
        const rect = panel.getBoundingClientRect();
        _chatDragOrigX = rect.left;
        _chatDragOrigY = rect.top;
        // 切换为 left/top 定位
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = _chatDragOrigX + 'px';
        panel.style.top = _chatDragOrigY + 'px';
    });

    document.addEventListener('mousemove', (e) => {
        if (!_chatDragging) return;
        const dx = e.clientX - _chatDragStartX;
        const dy = e.clientY - _chatDragStartY;
        let nx = _chatDragOrigX + dx;
        let ny = _chatDragOrigY + dy;
        // 边界限制
        const pw = panel.offsetWidth;
        const ph = panel.offsetHeight;
        nx = Math.max(0, Math.min(window.innerWidth - pw, nx));
        ny = Math.max(0, Math.min(window.innerHeight - ph, ny));
        panel.style.left = nx + 'px';
        panel.style.top = ny + 'px';
    });

    document.addEventListener('mouseup', () => { _chatDragging = false; });
}

export function initChat() {
    document.getElementById('chatCloseBtn').addEventListener('click', closeChat);
    document.getElementById('chatSendBtn').addEventListener('click', _sendChatMessage);

    document.getElementById('chatInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            _sendChatMessage();
        }
    });

    document.addEventListener('mousedown', (e) => {
        const overlay = document.getElementById('chatOverlay');
        if (!overlay.classList.contains('show')) return;
        const panel = document.getElementById('chatPanel');
        if (!panel.contains(e.target)) closeChat();
    });

    document.getElementById('chatToggleBtn').addEventListener('click', togglePublicChat);

    _initChatPanelDrag();

    // Ctrl+Enter 全局快捷键
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter' && isNetworkGame()) {
            e.preventDefault();
            togglePublicChat();
        }
    });
}

export function initEmblemChatClicks() {
    const myRole = getMyRole();
    if (!myRole) return;
    const myCamp = roleToCamp(myRole);
    if (!myCamp) return;

    const cardMappings = ['player1', 'player2', 'player3'].map((role, index) => ({
        cardId: `campCard${index + 1}`,
        camp: roleToCamp(role),
        role
    }));

    for (const { cardId, camp, role } of cardMappings) {
        const card = document.getElementById(cardId);
        if (!card) continue;
        const emblem = card.querySelector('.camp-emblem');
        if (!emblem) continue;

        // 移除旧监听器
        emblem.classList.remove('chat-enabled');
        const newEmblem = emblem.cloneNode(true);
        emblem.parentNode.replaceChild(newEmblem, emblem);

        if (card.style.display === 'none') continue;

        const freshEmblem = card.querySelector('.camp-emblem');
        freshEmblem.classList.add('chat-enabled');

        freshEmblem.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (!isNetworkGame()) return;
            if (camp?.id === myCamp.id) {
                openChat('room');
            } else {
                openChat('private', role);
            }
        });
    }
}

export function updateChatAvailability() {
    const toggleBtn = document.getElementById('chatToggleBtn');
    if (!toggleBtn) return;
    if (isNetworkGame()) {
        toggleBtn.style.display = '';
    } else {
        toggleBtn.style.display = 'none';
        closeChat();
    }
}

function _updateChatUnreadIndicator() {
    const toggleBtn = document.getElementById('chatToggleBtn');
    if (!toggleBtn) return;
    let total = 0;
    for (const v of Object.values(_chatUnread)) total += v || 0;
    if (total > 0) {
        toggleBtn.classList.add('has-unread');
        toggleBtn.title = `聊天 (${total} 条未读)`;
    } else {
        toggleBtn.classList.remove('has-unread');
        toggleBtn.title = '聊天 (Ctrl+Enter)';
    }
}

