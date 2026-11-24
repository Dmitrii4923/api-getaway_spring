const API = (() => {
    const BASE = window.API_BASE || '';
    const TOKEN_URL = 'https://keycloak-production-cd3297f4.up.railway.app/realms/hostel/protocol/openid-connect/token';
    const CLIENT_ID = 'spring-app';
    const TOKEN_KEY = 'access_token';
    const TOKEN_KEYS = ['access_token', 'accessToken', 'token', 'jwt', 'auth_token'];
    const REFRESH_KEY = 'refresh_token';

    class ApiError extends Error {
        constructor(message, status, data) {
            super(message);
            this.name = 'ApiError';
            this.status = status;
            this.data = data;
        }
    }

    const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const WEEKDAYS_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

    function getToken() {
        for (const key of TOKEN_KEYS) {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const value = raw.trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '');
            if (value.split('.').length === 3) return value;
        }
        return null;
    }

    function saveToken(token) { localStorage.setItem(TOKEN_KEY, token); }
    function saveRefreshToken(token) { if (token) localStorage.setItem(REFRESH_KEY, token); }

    function clearSession() {
        TOKEN_KEYS.forEach((key) => localStorage.removeItem(key));
        localStorage.removeItem(REFRESH_KEY);
    }

    function decode(token) {
        try {
            const payload = String(token).split('.')[1];
            if (!payload) return null;
            const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
            const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
            const binary = atob(padded);
            const json = decodeURIComponent(Array.from(binary).map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`).join(''));
            return JSON.parse(json);
        } catch (error) {
            return null;
        }
    }

    function roleOf(claims) {
        const roles = claims?.realm_access?.roles || [];
        if (roles.includes('ADMIN')) return 'ADMIN';
        if (roles.includes('DOCTOR')) return 'DOCTOR';
        if (roles.includes('PATIENT')) return 'PATIENT';
        return null;
    }

    function auth() {
        const token = getToken();
        if (!token) return null;
        const claims = decode(token);
        if (!claims) return null;
        if (claims.exp && claims.exp * 1000 <= Date.now() + 5000) return null;
        return { token, claims, role: roleOf(claims) };
    }

    function dashboardFor(role) {
        if (role === 'DOCTOR') return 'doctor.html';
        if (role === 'ADMIN') return 'admin.html';
        if (role === 'PATIENT') return 'patient.html';
        return 'index.html';
    }

    function requireAuth(roles) {
        const session = auth();
        if (!session) { location.replace('index.html?expired=1'); return null; }
        if (roles && !roles.includes(session.role)) { location.replace(dashboardFor(session.role)); return null; }
        return session;
    }

    async function login(username, password) {
        const body = new URLSearchParams({ grant_type: 'password', client_id: CLIENT_ID, username, password });
        let response;
        try {
            response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        } catch (error) {
            throw new ApiError('Не удалось связаться с Keycloak.', 0);
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.access_token) {
            throw new ApiError(data.error_description || data.error || 'Неверный логин или пароль', response.status, data);
        }
        saveToken(data.access_token);
        saveRefreshToken(data.refresh_token);
        const claims = decode(data.access_token);
        return { token: data.access_token, claims, role: roleOf(claims) };
    }

    async function handleCallback() {
        const params = new URLSearchParams(location.search);
        const code = params.get('code');
        if (!code) return null;
        window.history.replaceState({}, document.title, window.location.pathname);
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            code: code,
            redirect_uri: window.location.origin + '/index.html'
        });
        try {
            const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error_description || 'Ошибка обмена кода');
            saveToken(data.access_token);
            saveRefreshToken(data.refresh_token);
            const claims = decode(data.access_token);
            const role = roleOf(claims);
            if (role === 'PATIENT') {
                try {
                    await fetch(`${BASE}/api/customers/register`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${data.access_token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: claims.name || claims.preferred_username })
                    });
                } catch (registerError) {
                    console.warn('Не удалось создать профиль пациента:', registerError);
                }
            }
            return { token: data.access_token, claims, role };
        } catch (error) {
            console.error('Callback error:', error);
            return null;
        }
    }

    function logout() {
        localStorage.clear();
        location.href = 'index.html';
    }

    async function request(path, options = {}) {
        const token = getToken();
        const headers = { Accept: 'application/json', ...(options.headers || {}) };
        if (token) headers.Authorization = `Bearer ${token}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        let response;
        try {
            response = await fetch(`${BASE}${path}`, { ...options, headers, signal: controller.signal });
        } catch (error) {
            if (error.name === 'AbortError') throw new ApiError('Сервер не ответил за 15 секунд', 0);
            throw new ApiError('Не удалось связаться с сервером.', 0);
        } finally {
            clearTimeout(timer);
        }
        if (response.status === 401) {
            clearSession();
            location.replace('index.html?expired=1');
            throw new ApiError('Сессия истекла', 401);
        }
        const text = await response.text();
        let data = null;
        if (text) {
            try { data = JSON.parse(text); } catch (error) { data = text; }
        }
        if (!response.ok) {
            const message = data && typeof data === 'object' ? data.message || data.detail || data.error : null;
            throw new ApiError(message || statusMessage(response.status), response.status, data);
        }
        return data;
    }

    function statusMessage(status) {
        if (status === 400) return 'Проверьте заполнение формы';
        if (status === 403) return 'Недостаточно прав для этой операции';
        if (status === 404) return 'Данные не найдены';
        if (status === 409) return 'Это время уже занято или недоступно';
        if (status === 502 || status === 503 || status === 504) return 'Сервис временно недоступен';
        if (status >= 500) return 'Ошибка на сервере';
        return `Запрос завершился с кодом ${status}`;
    }

    function get(path) { return request(path); }
    function post(path, body) { return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    function put(path, body) { return request(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    function putText(path, body) { return request(path, { method: 'PUT', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body }); }
    function del(path) { return request(path, { method: 'DELETE' }); }

    function parseDateTime(value) {
        if (!value) return null;
        const date = new Date(String(value).replace(' ', 'T'));
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function formatDateTime(value) {
        const date = parseDateTime(value);
        if (!date) return '—';
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        return `${day}.${month}.${date.getFullYear()}, ${formatTime(value)}`;
    }

    function formatDate(value) {
        const date = parseDateTime(value);
        if (!date) return '—';
        return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    }

    function formatTime(value) {
        const text = String(value || '');
        const match = text.match(/(\d{2}):(\d{2})/);
        return match ? `${match[1]}:${match[2]}` : '—';
    }

    function formatShortDate(value) {
        const date = parseDateTime(value);
        if (!date) return '—';
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        return `${day}.${month}.${date.getFullYear()}`;
    }

    function weekdayShort(value) {
        const date = parseDateTime(value);
        if (!date) return '';
        return WEEKDAYS[(date.getDay() + 6) % 7];
    }

    function weekdayFull(value) {
        const date = parseDateTime(value);
        if (!date) return '';
        return WEEKDAYS_FULL[(date.getDay() + 6) % 7];
    }

    function toISODate(date) {
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 10);
    }

    function todayISO() { return toISODate(new Date()); }

    function addDays(date, days) {
        const next = new Date(date);
        next.setDate(next.getDate() + days);
        return next;
    }

    function statusLabel(status) {
        if (status === 'COMPLETED') return 'Завершён';
        if (status === 'CANCELLED') return 'Отменён';
        return 'Запланирован';
    }

    function statusClass(status) {
        if (status === 'COMPLETED') return 'status status-completed';
        if (status === 'CANCELLED') return 'status status-cancelled';
        return 'status status-booked';
    }

    function roleLabel(role) {
        if (role === 'DOCTOR') return 'Врач';
        if (role === 'PATIENT') return 'Пациент';
        if (role === 'ADMIN') return 'Администратор';
        return 'Пользователь';
    }

    function displayName(claims) {
        return (claims?.name || [claims?.given_name, claims?.family_name].filter(Boolean).join(' ') || claims?.preferred_username || 'Пользователь');
    }

    function shortName(fullName) {
        const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return 'Пользователь';
        if (parts.length >= 3) return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.${parts[2].charAt(0).toUpperCase()}.`;
        if (parts.length === 2) return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
        return parts[0];
    }

    function initials(fullName) {
        const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
        return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'П';
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    }

    function query(name) { return new URLSearchParams(location.search).get(name); }

    function toast(message, type = 'info') {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const icon = type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info';
        const node = document.createElement('div');
        node.className = `toast toast-${type}`;
        node.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHtml(message)}</span>`;
        container.appendChild(node);
        setTimeout(() => {
            node.classList.add('is-hiding');
            setTimeout(() => node.remove(), 220);
        }, 4200);
    }

    function openModal(id) {
        const modal = document.getElementById(id);
        if (!modal) return;
        modal.classList.add('open');
        document.body.classList.add('overflow-hidden');
    }

    function closeModal(id) {
        const modal = document.getElementById(id);
        if (!modal) return;
        modal.classList.remove('open');
        if (!document.querySelector('.modal.open')) {
            document.body.classList.remove('overflow-hidden');
        }
    }

    document.addEventListener('click', (event) => {
        const modal = event.target.closest('.modal');
        if (modal && event.target === modal) closeModal(modal.id);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        document.querySelectorAll('.modal.open').forEach((modal) => closeModal(modal.id));
    });

    return {
        BASE, TOKEN_URL, CLIENT_ID, ApiError, getToken, saveToken, saveRefreshToken, clearSession, decode, roleOf, auth, requireAuth, dashboardFor, login, handleCallback, logout, get, post, put, putText, del, request, parseDateTime, formatDateTime, formatDate, formatShortDate, formatTime, weekdayShort, weekdayFull, toISODate, todayISO, addDays, statusLabel, statusClass, roleLabel, displayName, shortName, initials, escapeHtml, query, toast, openModal, closeModal
    };
})();
