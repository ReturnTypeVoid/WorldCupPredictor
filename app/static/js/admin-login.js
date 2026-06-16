function doLogin() {
  var username = document.getElementById('username').value.trim();
  var password = document.getElementById('password').value;
  var msg = document.getElementById('status-msg');

  msg.className = '';
  msg.style.display = 'none';

  if (!username || !password) {
    msg.textContent = 'Please enter username and password.';
    msg.className = 'err';
    return;
  }

  fetch('/admin/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username, password: password }),
    credentials: 'include',
  })
    .then(function (r) {
      return r.json().then(function (data) {
        return { ok: r.ok, data: data };
      });
    })
    .then(function (result) {
      if (!result.ok) {
        msg.textContent = result.data.error || 'Login failed.';
        msg.className = 'err';
        return;
      }
      storeAccessToken(result.data.access_token);
      scheduleRefresh(result.data.expires_in);
      window.location.href = result.data.must_change_password
        ? '/admin/change-password'
        : '/admin/';
    })
    .catch(function () {
      msg.textContent = 'Network error — please try again.';
      msg.className = 'err';
    });
}

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doLogin();
  });
});
