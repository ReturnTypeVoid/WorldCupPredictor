async function createBracket() {
  var btn = document.getElementById('create-btn');
  var msg = document.getElementById('msg');

  btn.classList.add('loading');
  btn.textContent = 'Creating…';
  msg.textContent = '';
  msg.className = '';

  try {
    var r = await fetch('/api/sessions', { method: 'POST' });
    if (!r.ok) throw new Error();
    var data = await r.json();
    localStorage.setItem('edit_code_' + data.slug, data.edit_code);
    window.location.href = '/s/' + data.slug + '?code=' + data.edit_code;
  } catch {
    btn.classList.remove('loading');
    btn.textContent = 'Build my bracket';
    msg.textContent = 'Something went wrong — please try again.';
    msg.classList.add('err');
  }
}

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('create-btn').addEventListener('click', createBracket);
});
