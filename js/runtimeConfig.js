const viteEnv = import.meta.env || {};
const deployTarget = viteEnv.VITE_DEPLOY_TARGET || 'cloud';
const serverOrigin = String(viteEnv.VITE_SERVER_ORIGIN || '').replace(/\/+$/, '');
const authSetting = viteEnv.VITE_AUTH_ENABLED;

export const runtimeConfig = Object.freeze({
    deployTarget,
    serverOrigin,
    isItch: deployTarget === 'itch',
    authEnabled: authSetting === undefined ? deployTarget !== 'itch' : authSetting === 'true'
});

export function serverHttpUrl(path = '') {
    if (!runtimeConfig.serverOrigin) return path || location.origin;
    return new URL(path || '/', `${runtimeConfig.serverOrigin}/`).toString();
}

export function serverWebSocketUrl() {
    if (runtimeConfig.serverOrigin) {
        const url = new URL(runtimeConfig.serverOrigin);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = '/';
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}`;
}
