import { getToken } from './auth.js';

const PROFILE_SCHEMA_VERSION = 2;
const LOCAL_PROFILE_KEY = 'blades-of-hex.player-profile.v2';
const RESET_MARKER_KEY = 'blades-of-hex.player-profile-reset.v2';
const LEGACY_KEYS = [
    'bladesOfHex.campaign.bloodIris',
    'blades-of-hex.standard-flag-customizations.v1'
];

let _profile = emptyProfile();
let _mode = 'guest';
let _readyPromise = null;
let _writeQueue = Promise.resolve();

function emptyProfile() {
    return {
        schemaVersion: PROFILE_SCHEMA_VERSION,
        campaigns: {},
        standardFlagPreferences: {}
    };
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeProfile(value) {
    if (!isRecord(value) || Number(value.schemaVersion) !== PROFILE_SCHEMA_VERSION) return emptyProfile();
    return {
        schemaVersion: PROFILE_SCHEMA_VERSION,
        campaigns: isRecord(value.campaigns) ? clone(value.campaigns) : {},
        standardFlagPreferences: isRecord(value.standardFlagPreferences)
            ? clone(value.standardFlagPreferences) : {}
    };
}

function clearLegacyDataOnce() {
    try {
        if (localStorage.getItem(RESET_MARKER_KEY)) return;
        for (const key of LEGACY_KEYS) localStorage.removeItem(key);
        localStorage.removeItem(LOCAL_PROFILE_KEY);
        localStorage.setItem(RESET_MARKER_KEY, new Date().toISOString());
    } catch (_) {
        // 隐私模式或禁用存储时仍可在内存中运行。
    }
}

function readGuestProfile() {
    try {
        return normalizeProfile(JSON.parse(localStorage.getItem(LOCAL_PROFILE_KEY) || 'null'));
    } catch (_) {
        return emptyProfile();
    }
}

function persistGuestProfile() {
    try {
        localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(_profile));
    } catch (error) {
        console.warn('[profile] 无法写入访客档案:', error);
    }
}

async function fetchServerProfile(token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch('/api/player-profile', {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return normalizeProfile(await response.json());
    } finally {
        clearTimeout(timer);
    }
}

export function ensurePlayerProfileReady() {
    if (_readyPromise) return _readyPromise;
    clearLegacyDataOnce();
    const token = getToken();
    if (!token) {
        _mode = 'guest';
        _profile = readGuestProfile();
        _readyPromise = Promise.resolve(_profile);
        return _readyPromise;
    }

    _mode = 'frost';
    _readyPromise = fetchServerProfile(token)
        .then(profile => {
            _profile = profile;
            return _profile;
        })
        .catch(error => {
            _profile = emptyProfile();
            console.error('[profile] Frost ID 档案读取失败，本次不会回退到本地进度:', error);
            return _profile;
        });
    return _readyPromise;
}

function queueServerWrite() {
    const token = getToken();
    if (!token) return;
    const snapshot = clone(_profile);
    _writeQueue = _writeQueue.catch(() => {}).then(async () => {
        const response = await fetch('/api/player-profile', {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(snapshot),
            keepalive: true
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }).catch(error => console.error('[profile] Frost ID 档案写入失败:', error));
}

function commit() {
    if (_mode === 'guest') persistGuestProfile();
    else queueServerWrite();
}

export function readCampaignProfile(storageKey) {
    const value = _profile.campaigns[storageKey];
    return isRecord(value) ? clone(value) : {};
}

export function writeCampaignProfile(storageKey, progress) {
    if (!storageKey) return;
    _profile.campaigns[storageKey] = isRecord(progress) ? clone(progress) : {};
    commit();
}

export function readStandardFlagPreferences() {
    return clone(_profile.standardFlagPreferences);
}

export function writeStandardFlagPreference(factionKey, preference) {
    if (!factionKey || !isRecord(preference)) return;
    _profile.standardFlagPreferences[factionKey] = clone(preference);
    commit();
}

export function getPlayerProfileMode() {
    return _mode;
}

clearLegacyDataOnce();
