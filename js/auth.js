/**
 * Blades of Hex — Frost ID Auth frontend module.
 *
 * Manages JWT token in localStorage, exposes user state,
 * and provides the token for WebSocket connections.
 */

const AUTH_URL = location.origin;
const TOKEN_KEY = 'blades_token';
const USER_KEY  = 'blades_user';

let _currentUser = null;
let _listeners = [];

function notify() {
  _listeners.forEach(fn => fn(_currentUser));
}

export function onAuthChange(fn) {
  _listeners.push(fn);
  if (_currentUser) fn(_currentUser);
  return () => { _listeners = _listeners.filter(f => f !== fn); };
}

export function loadAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  const user  = localStorage.getItem(USER_KEY);
  if (token && user) {
    _currentUser = { token, ...JSON.parse(user) };
    notify();
  }
  return _currentUser;
}

export function setAuth(token, username, email) {
  const user = { username, email };
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  _currentUser = { token, ...user };
  notify();
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  _currentUser = null;
  notify();
}

export function getToken() {
  return _currentUser?.token || localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  return _currentUser;
}

export function getWsUrl(baseUrl) {
  const token = getToken();
  if (!token) return baseUrl;
  const u = new URL(baseUrl);
  u.searchParams.set('token', token);
  return u.toString();
}

// Bootstrap from stored token
loadAuth();
