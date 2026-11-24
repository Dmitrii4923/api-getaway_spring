document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(location.search);

    if (params.get('code')) {
        const session = await API.handleCallback();
        if (session && session.role) {
            location.replace(API.dashboardFor(session.role));
            return;
        }
    }

    const existing = API.auth();
    if (existing) {
        location.replace(API.dashboardFor(existing.role));
        return;
    }

    const form = document.getElementById('loginForm');
    const username = document.getElementById('loginUsername');
    const password = document.getElementById('loginPassword');
    const submit = document.getElementById('loginSubmit');
    const errorBox = document.getElementById('loginError');
    const registerLink = document.getElementById('registerLink');

    if (registerLink) {
        const redirectUri = encodeURIComponent(`${window.location.origin}/index.html`);
        const registrationUrl = `https://keycloak-production-cd3297f4.up.railway.app/realms/hostel/protocol/openid-connect/registrations?client_id=spring-app&response_type=code&scope=openid&redirect_uri=${redirectUri}`;
        const logoutUrl = `https://keycloak-production-cd3297f4.up.railway.app/realms/hostel/protocol/openid-connect/logout?post_logout_redirect_uri=${encodeURIComponent(registrationUrl)}&client_id=spring-app`;
        registerLink.href = logoutUrl;
    }

    if (params.get('expired')) {
        showError('Сессия истекла. Войдите снова.');
    }

    if (form) form.addEventListener('submit', handleLogin);

    const manualForm = document.getElementById('manualTokenForm');
    if (manualForm) manualForm.addEventListener('submit', handleManualToken);

    document.querySelectorAll('[data-toggle-password]').forEach((button) => {
        button.addEventListener('click', () => {
            const hidden = password && password.type === 'password';
            if (password) password.type = hidden ? 'text' : 'password';
            button.innerHTML = `<i class="fa-regular ${hidden ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
        });
    });

    async function handleLogin(event) {
        event.preventDefault();
        hideError();
        if (!submit) return;
        submit.disabled = true;
        const original = submit.innerHTML;
        submit.innerHTML = '<i class="fa-solid fa-spinner spin"></i><span> Вход…</span>';
        try {
            const session = await API.login(username.value.trim(), password.value);
            if (!session || !session.role) {
                API.clearSession();
                throw new Error('В токене нет роли PATIENT, DOCTOR или ADMIN.');
            }
            location.replace(API.dashboardFor(session.role));
        } catch (error) {
            showError(error.message || 'Ошибка входа. Проверьте логин и пароль.');
        } finally {
            submit.disabled = false;
            submit.innerHTML = original;
        }
    }

    async function handleManualToken(event) {
        event.preventDefault();
        hideManualError();
        const input = document.getElementById('manualToken');
        const token = input ? input.value.trim() : '';
        if (!token) return showManualError('Вставьте токен.');
        try {
            if (typeof API.saveToken === 'function') {
                API.saveToken(token);
            } else {
                localStorage.setItem('access_token', token);
            }
            const session = API.auth ? API.auth() : null;
            if (session && session.role) {
                location.replace(API.dashboardFor(session.role));
            } else {
                showManualError('Токен сохранён, но роль не определена. Проверьте токен.');
            }
        } catch (e) {
            showManualError(e.message || 'Не удалось сохранить токен.');
        }
    }

    function showError(message) {
        if (!errorBox) return;
        errorBox.textContent = message;
        errorBox.classList.remove('hidden');
    }

    function hideError() {
        if (errorBox) errorBox.classList.add('hidden');
    }

    function showManualError(message) {
        const box = document.getElementById('manualTokenError');
        if (!box) return;
        box.textContent = message;
        box.classList.remove('hidden');
    }

    function hideManualError() {
        const box = document.getElementById('manualTokenError');
        if (box) box.classList.add('hidden');
    }
});
