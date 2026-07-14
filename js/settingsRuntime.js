// Browser-local preferences. These values never belong to MatchState or a network snapshot.
const SETTINGS_KEY = 'bladesOfHex_settings';

const DEFAULT_SETTINGS = {
    animationSpeed: 1,
    particleDensity: 1,
    screenShake: true,
    turnFlash: true,
    soundEnabled: true,
    soundVolume: 0.7,
    rendererBackend: 'pixi-webgl',
    performanceProfile: 'auto',
    reducedMotion: false,
    showGrid: true
};

export let settings = { ...DEFAULT_SETTINGS };

export function loadSettings() {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        settings = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : { ...DEFAULT_SETTINGS };
    } catch {
        settings = { ...DEFAULT_SETTINGS };
    }
}

export function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        // Local storage can be unavailable in privacy-restricted browser contexts.
    }
}
