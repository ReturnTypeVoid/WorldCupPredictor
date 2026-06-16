function doChangePassword() {
  var current = document.getElementById('current_password').value;
  var newPw   = document.getElementById('new_password').value;
  var confirm = document.getElementById('confirm_password').value;
  var msg     = document.getElementById('status-msg');

  msg.className = '';
  msg.style.display = 'none';

  if (!current || !newPw || !confirm) {
    msg.textContent = 'All fields are required.';
    msg.className = 'err';
    return;
  }
  if (newPw.length < 12) {
    msg.textContent = 'New password must be at least 12 characters.';
    msg.className = 'err';
    return;
  }
  if (newPw !== confirm) {
    msg.textContent = 'New passwords do not match.';
    msg.className = 'err';
    return;
  }

  fetch('/admin/api/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: current, new_password: newPw }),
  })
    .then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, data: data }; });
    })
    .then(function (result) {
      if (result.ok) {
        msg.textContent = result.data.message + ' Redirecting…';
        msg.className = 'ok';
        clearTokens();
        setTimeout(function () { window.location.href = '/admin/login'; }, 1500);
      } else {
        msg.textContent = result.data.error || 'Error changing password.';
        msg.className = 'err';
      }
    });
}

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('change-pw-btn').addEventListener('click', doChangePassword);
});
