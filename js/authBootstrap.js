import { clearAuth, getUser, setAuth } from './auth.js';
import { runtimeConfig, serverHttpUrl } from './runtimeConfig.js';

const brandSnow = document.getElementById('brandSnow');
const authSlot = document.getElementById('authSlot');

if (!runtimeConfig.authEnabled) {
    authSlot?.replaceChildren();
    if (authSlot) authSlot.hidden = true;
    brandSnow?.classList.remove('logged-in');
} else {
    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    const username = params.get('username');
    if (token && username) {
        setAuth(token, username);
        const url = new URL(location.href);
        url.searchParams.delete('token');
        url.searchParams.delete('username');
        window.history.replaceState({}, '', url);
    }

    function renderLogin() {
        if (!authSlot) return;
        authSlot.hidden = false;
        authSlot.replaceChildren();
        const loginLink = document.createElement('a');
        loginLink.className = 'auth-inline-login';
        loginLink.href = serverHttpUrl('/auth/login');
        const frost = document.createElement('span');
        frost.className = 'auth-frost';
        frost.setAttribute('aria-hidden', 'true');
        frost.textContent = '❄';
        loginLink.append(frost, document.createTextNode('登录 Frost ID'));
        authSlot.appendChild(loginLink);
        brandSnow?.classList.remove('logged-in');
    }

    function renderAuth() {
        if (!authSlot) return;
        const user = getUser();
        if (!user?.token) {
            renderLogin();
            return;
        }

        authSlot.hidden = false;
        authSlot.replaceChildren();
        const userLabel = document.createElement('span');
        userLabel.className = 'auth-inline-user';
        userLabel.textContent = typeof user.username === 'string' ? user.username : '';
        const logoutButton = document.createElement('button');
        logoutButton.className = 'auth-inline-logout';
        logoutButton.id = 'authInlineLogout';
        logoutButton.type = 'button';
        logoutButton.textContent = 'Exit';
        logoutButton.addEventListener('click', () => {
            clearAuth();
            location.reload();
        });
        authSlot.append(userLabel, logoutButton);
        brandSnow?.classList.add('logged-in');
    }

    brandSnow?.addEventListener('click', () => {
        location.href = getUser()?.token
            ? 'https://frostrain.tech/dashboard'
            : serverHttpUrl('/auth/login');
    });

    renderAuth();
}
