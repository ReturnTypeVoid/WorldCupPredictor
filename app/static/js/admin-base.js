// ── Token management ─────────────────────────────────────────────────────────
// Access token lives in sessionStorage (JS-readable, tab-scoped).
// Refresh token lives in an HttpOnly cookie (JS-blind, admin-path-scoped).

var _accessToken = sessionStorage.getItem('admin_access_token') || '';
var _refreshTimer = null;

function storeAccessToken(token) {
  _accessToken = token;
  sessionStorage.setItem('admin_access_token', token);
}

function clearTokens() {
  _accessToken = '';
  sessionStorage.removeItem('admin_access_token');
  clearTimeout(_refreshTimer);
}

function scheduleRefresh(expiresIn) {
  // Refresh 60 s before expiry
  var delay = Math.max((expiresIn - 60) * 1000, 5000);
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(silentRefresh, delay);
}

function silentRefresh() {
  fetch('/admin/api/refresh', { method: 'POST', credentials: 'include' })
    .then(function (r) {
      if (!r.ok) { redirectToLogin(); return null; }
      return r.json();
    })
    .then(function (data) {
      if (!data) return;
      storeAccessToken(data.access_token);
      scheduleRefresh(data.expires_in);
    })
    .catch(redirectToLogin);
}

function redirectToLogin() {
  clearTokens();
  window.location.href = '/admin/login';
}

// Auto-refresh on page load if we already have a token
(function () {
  var cfg = document.getElementById('app-config');
  if (!cfg) return;
  var config = JSON.parse(cfg.textContent);
  if (_accessToken) {
    scheduleRefresh(config.accessTokenExpires);
  }
})();

// Attach Bearer token to every fetch call within /admin
var _origFetch = window.fetch;
window.fetch = function (url, opts) {
  opts = opts || {};
  if (typeof url === 'string' && url.startsWith('/admin') && _accessToken) {
    var headers = Object.assign({}, opts.headers || {});
    headers['Authorization'] = 'Bearer ' + _accessToken;
    opts.headers = headers;
    opts.credentials = 'include';
  }
  return _origFetch(url, opts);
};

// ── Logout ───────────────────────────────────────────────────────────────────
function doLogout() {
  fetch('/admin/api/logout', { method: 'POST' })
    .catch(function () {})
    .finally(function () {
      clearTokens();
      window.location.href = '/admin/login';
    });
}

document.addEventListener('DOMContentLoaded', function () {
  var logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', doLogout);
  }
});
