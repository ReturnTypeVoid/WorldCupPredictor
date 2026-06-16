function deleteSession(slug) {
  var confirmSlug = prompt('Type the slug to confirm deletion:\n\n' + slug);
  if (!confirmSlug) return;

  fetch('/admin/api/sessions/' + slug, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm_slug: confirmSlug }),
  })
    .then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, data: data }; });
    })
    .then(function (result) {
      if (result.ok) {
        location.reload();
      } else {
        alert(result.data.error || 'Delete failed');
      }
    });
}

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-delete-slug]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      deleteSession(btn.getAttribute('data-delete-slug'));
    });
  });
});
