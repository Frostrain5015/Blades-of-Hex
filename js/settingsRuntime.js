// Browser-local preferences. These values never belong to MatchState or a network snapshot.
const SETTINGS_KEY = 'bladesOfHex_settings';

const DEFAULT_SETTINGS = {
    animationSpeed: 1,
    particleDensity: 1,
    screenShake: true,
    turnFlash: true,
    soundEnabled: true,
    musicVolume: 0.49,
    effectsVolume: 0.49,
    performanceProfile: 'auto',
    reducedMotion: false,
    showGrid: true
};

export let settings = { ...DEFAULT_SETTINGS };

function readVolume(value, fallback) {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

export function loadSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
        // The old slider applied its gain twice. Preserve its effective level.
        const legacyVolume = readVolume(saved?.soundVolume, 0.7);
        const migratedVolume = Math.round(legacyVolume ** 2 * 100) / 100;
        settings = {
            ...DEFAULT_SETTINGS,
            ...saved,
            musicVolume: readVolume(saved?.musicVolume, migratedVolume),
            effectsVolume: readVolume(saved?.effectsVolume, migratedVolume)
        };
        delete settings.soundVolume;
        // Retire the former full-Canvas/Pixi selector without allowing a stale
        // browser preference to leak back into the backend composition root.
        delete settings.rendererBackend;
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
