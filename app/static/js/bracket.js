/* bracket.js — World Cup 2026 bracket engine */

// ── Session & auth ─────────────────────────────────────────────────────────

var SESSION = JSON.parse(document.getElementById('session-data').textContent);
var SLUG    = SESSION.slug;
var _urlCode = (new URLSearchParams(location.search)).get('code');
var EDIT_CODE = _urlCode || localStorage.getItem('edit_code_' + SLUG) || null;
if (_urlCode) {
  localStorage.setItem('edit_code_' + SLUG, _urlCode);
  history.replaceState(null, '', location.pathname);
}
var CAN_EDIT = !!EDIT_CODE;

// Step unlock state
var _groupsSaved = false;
var _thirdSaved  = false;

// Bracket layout constants — computed ONCE when knockout tab first loads,
// stored on the viewport element itself. Never recomputed on picks or re-renders.
// Access via getBracketDims().
var _bracketDimsCache = null;

function getBracketDims() {
  if (_bracketDimsCache) return _bracketDimsCache;
  // Read from .main-content — the flex child that actually contains the panels.
  // This is the most reliable source: the browser has already laid it out,
  // and we measure it before any bracket content is inserted.
  var mc = document.querySelector('.main-content');
  var sb = document.querySelector('.sidebar');
  _bracketDimsCache = {
    h: mc ? mc.clientHeight : (window.innerHeight - 48),
    w: mc ? mc.clientWidth  : (window.innerWidth  - 68),
  };
  return _bracketDimsCache;
}

function clearBracketDimsCache() {
  // Measure immediately while panel is empty (called on tab switch before render)
  _bracketDimsCache = null;
  // Pre-populate now — .main-content height is stable at navigation time
  getBracketDims();
}

// ── Group data ─────────────────────────────────────────────────────────────

var GROUPS = {
  A: { teams: ['Mexico','South Korea','South Africa','Czechia'],
       flags: {'Mexico':'🇲🇽','South Korea':'🇰🇷','South Africa':'🇿🇦','Czechia':'🇨🇿'} },
  B: { teams: ['Canada','Switzerland','Qatar','Bosnia and Herzegovina'],
       flags: {'Canada':'🇨🇦','Switzerland':'🇨🇭','Qatar':'🇶🇦','Bosnia and Herzegovina':'🇧🇦'} },
  C: { teams: ['Brazil','Morocco','Scotland','Haiti'],
       flags: {'Brazil':'🇧🇷','Morocco':'🇲🇦','Scotland':'🏴󠁧󠁢󠁳󠁣󠁴󠁿','Haiti':'🇭🇹'} },
  D: { teams: ['United States','Australia','Paraguay','Turkiye'],
       flags: {'United States':'🇺🇸','Australia':'🇦🇺','Paraguay':'🇵🇾','Turkiye':'🇹🇷'} },
  E: { teams: ['Germany','Ecuador','Ivory Coast','Curacao'],
       flags: {'Germany':'🇩🇪','Ecuador':'🇪🇨','Ivory Coast':'🇨🇮','Curacao':'🇨🇼'} },
  F: { teams: ['Netherlands','Japan','Tunisia','Sweden'],
       flags: {'Netherlands':'🇳🇱','Japan':'🇯🇵','Tunisia':'🇹🇳','Sweden':'🇸🇪'} },
  G: { teams: ['Belgium','Iran','Egypt','New Zealand'],
       flags: {'Belgium':'🇧🇪','Iran':'🇮🇷','Egypt':'🇪🇬','New Zealand':'🇳🇿'} },
  H: { teams: ['Spain','Uruguay','Saudi Arabia','Cape Verde'],
       flags: {'Spain':'🇪🇸','Uruguay':'🇺🇾','Saudi Arabia':'🇸🇦','Cape Verde':'🇨🇻'} },
  I: { teams: ['France','Senegal','Norway','Iraq'],
       flags: {'France':'🇫🇷','Senegal':'🇸🇳','Norway':'🇳🇴','Iraq':'🇮🇶'} },
  J: { teams: ['Argentina','Austria','Algeria','Jordan'],
       flags: {'Argentina':'🇦🇷','Austria':'🇦🇹','Algeria':'🇩🇿','Jordan':'🇯🇴'} },
  K: { teams: ['Portugal','Colombia','Uzbekistan','DR Congo'],
       flags: {'Portugal':'🇵🇹','Colombia':'🇨🇴','Uzbekistan':'🇺🇿','DR Congo':'🇨🇩'} },
  L: { teams: ['England','Croatia','Panama','Ghana'],
       flags: {'England':'🏴󠁧󠁢󠁥󠁮󠁧󠁿','Croatia':'🇭🇷','Panama':'🇵🇦','Ghana':'🇬🇭'} },
};

var groupOrder = {};
var matchPicks = {};
var thirdPicks = [];
Object.keys(GROUPS).forEach(function(g) { groupOrder[g] = GROUPS[g].teams.slice(); });

function flag(team) {
  for (var g in GROUPS) { if (GROUPS[g].flags[team]) return GROUPS[g].flags[team]; }
  return '🏳';
}

// ── Toast ──────────────────────────────────────────────────────────────────

var _toastTimer;
function showToast(msg, type) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background   = type === 'err' ? 'rgba(255,77,77,0.15)' : '';
  t.style.borderColor  = type === 'err' ? 'rgba(255,77,77,0.3)'  : '';
  t.style.color        = type === 'err' ? 'var(--red)' : '';
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { t.classList.remove('show'); }, 2500);
}

// ── API ────────────────────────────────────────────────────────────────────

function apiCall(method, path, body) {
  var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
  if (body) { if (EDIT_CODE) body.edit_code = EDIT_CODE; opts.body = JSON.stringify(body); }
  return fetch(path, opts).then(function(r) {
    if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Error'); });
    return r.json();
  });
}

// ── Topbar share ───────────────────────────────────────────────────────────

function initShareBar() {
  // Use HOST_URL from server config if set, otherwise fall back to window.location.origin
  var configuredHost = (function() {
    try {
      var el = document.getElementById('app-host-url');
      var val = el ? JSON.parse(el.textContent) : '';
      return (val && val.length > 0) ? val : '';
    } catch(e) { return ''; }
  })();
  var shareUrl = (configuredHost || location.origin) + '/s/' + SLUG;
  document.getElementById('topbar-share-url').value = shareUrl;
  document.getElementById('topbar-share-url').addEventListener('click', function() { this.select(); });
  document.getElementById('topbar-copy-btn').addEventListener('click', function() {
    navigator.clipboard.writeText(shareUrl).then(function() {
      document.getElementById('copy-icon').style.display  = 'none';
      document.getElementById('copy-check').style.display = 'block';
      showToast('Link copied');
      setTimeout(function() {
        document.getElementById('copy-icon').style.display  = 'block';
        document.getElementById('copy-check').style.display = 'none';
      }, 2000);
    });
  });
  if (CAN_EDIT && EDIT_CODE) {
    document.getElementById('code-pill').style.display = 'flex';
    document.getElementById('code-pill-value').textContent = EDIT_CODE;
  }
  if (!CAN_EDIT) {
    document.getElementById('edit-btn').style.display = 'flex';
    document.getElementById('edit-btn').addEventListener('click', openEditModal);
  }
}

function insertViewonlyBanner() {
  var layout = document.querySelector('.layout');
  var b = document.createElement('div');
  b.className = 'viewonly-banner';
  b.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><span>Read-only view — click <strong>Edit bracket</strong> to make changes.</span>';
  layout.parentNode.insertBefore(b, layout);
}

// ── Navigation ─────────────────────────────────────────────────────────────

function navigateTo(panel) {
  document.querySelectorAll('.sidenav-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
  var btn = document.getElementById('nav-' + panel);
  if (btn) btn.classList.add('active');
  document.getElementById('panel-' + panel).classList.add('active');
  if (panel === 'live') { loadLive(); }
  if (panel === 'knockout') { clearBracketDimsCache(); }
}

// Wire up sidebar — locked buttons block navigation and show tooltip via CSS
document.querySelectorAll('.sidenav-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    if (btn.disabled || btn.classList.contains('locked')) return;
    navigateTo(btn.getAttribute('data-panel'));
  });
});

/*
 * Nav button states — mutually exclusive glow classes:
 *   next-step   green  — first time this step is available
 *   stale-step  amber  — step is accessible but needs attention (picks may be stale)
 *   locked-step red    — step is locked; must complete prior step first
 *
 * setNavState(tabId, state) is the single source of truth.
 * state: 'green' | 'amber' | 'red' | 'none'
 */
function setNavState(tabId, state) {
  var btn = document.getElementById('nav-' + tabId);
  if (!btn) return;
  btn.classList.remove('next-step', 'stale-step', 'locked-step');
  if (state === 'green')  btn.classList.add('next-step');
  if (state === 'amber')  btn.classList.add('stale-step');
  if (state === 'red')    btn.classList.add('locked-step');
}

function unlockTab(tabId, glow) {
  // glow = 'green' (default, first time) or 'amber' (re-unlock after stale)
  var btn = document.getElementById('nav-' + tabId);
  if (!btn) return;
  btn.classList.remove('locked');
  btn.disabled = false;
  btn.querySelectorAll('.nav-lock-icon').forEach(function(el) { el.style.display = 'none'; });
  btn.querySelectorAll('.nav-icon').forEach(function(el) { el.style.display = 'block'; });
  var wrap = document.getElementById('wrap-' + tabId);
  if (wrap) {
    var tt = wrap.querySelector('.nav-tooltip');
    if (tt) { tt.style.display = 'none'; tt.textContent = ''; }
  }
  setNavState(tabId, glow || 'green');
}

function clearGlows() {
  document.querySelectorAll('.sidenav-btn').forEach(function(b) {
    b.classList.remove('next-step', 'stale-step', 'locked-step');
  });
}

// Convenience aliases kept for call-site readability
function setStaleGlow(tabId)  { setNavState(tabId, 'amber'); }
function setLockedGlow(tabId) { setNavState(tabId, 'red');   }

// Called after a group drag-drop save.
// Checks if the 3rd-place team for that group changed.
// If so: removes stale 3rd-place picks and flags the Best 3rd tab as amber.
// Also cascades to knockout if match picks are affected.
function onGroupSaved(group, oldOrder) {
  var oldThird = oldOrder[2];
  var newThird = groupOrder[group][2];
  if (oldThird === newThird) {
    // 3rd didn't change — but positions 1/2 might affect knockout seeds
    // Check if any knockout match pick references a team whose seed changed
    _cascadeKnockoutFromGroups();
    return;
  }

  // The 3rd-place team for this group changed
  var wasSelected = thirdPicks.indexOf(oldThird) >= 0;
  if (wasSelected) {
    // Remove the old team from thirdPicks
    thirdPicks.splice(thirdPicks.indexOf(oldThird), 1);
    showToast(oldThird + ' removed from Best 3rd — group order changed', 'err');
    // Re-render third grid to reflect removal
    renderThirdGrid();
    // Flag Best 3rd tab as stale if it was already saved
    if (_thirdSaved) setStaleGlow('best-third');
  }

  // Also cascade to knockout
  _cascadeKnockoutFromGroups();
}

// Check if any match picks reference teams that are no longer in the correct
// position due to group order changes, and clear affected picks.
function _cascadeKnockoutFromGroups() {
  var changed = false;
  [73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88].forEach(function(m) {
    if (!matchPicks[m]) return;
    var correctTeams = getTeams(m);
    if (correctTeams.indexOf(matchPicks[m]) < 0) {
      clearDownstream(m, matchPicks[m]);
      delete matchPicks[m];
      changed = true;
    }
  });
  // Always re-render KO so team labels update even if no picks were invalidated
  if (_thirdSaved || Object.keys(matchPicks).length > 0) {
    
    renderKnockout();
  }
  if (changed) {
    if (_thirdSaved) {
      setStaleGlow('knockout');
    }
    showToast('Some knockout picks were cleared due to group changes', 'err');
  }
}

// Check if any currently-selected thirdPicks are no longer the 3rd-place team
// in their group (due to group reorder), and remove stale ones
// Lock the knockout tab — requires re-save of Best 3rd before proceeding
function _lockKnockout() {
  _thirdSaved = false;
  var btn = document.getElementById('nav-knockout');
  if (!btn) return;
  btn.classList.add('locked');
  btn.disabled = true;
  btn.querySelectorAll('.nav-lock-icon').forEach(function(el) { el.style.display = 'block'; });
  btn.querySelectorAll('.nav-icon').forEach(function(el) { el.style.display = 'none'; });
  var wrap = document.getElementById('wrap-knockout');
  if (wrap) {
    var tt = wrap.querySelector('.nav-tooltip');
    if (tt) { tt.textContent = 'Re-save Best 3rd to unlock'; tt.style.display = ''; }
  }
  setLockedGlow('knockout');  // red — locked, action required
}

function _checkThirdStaleness() {
  var currentThirds = Object.keys(GROUPS).map(function(g) { return groupOrder[g][2]; });
  var stale = thirdPicks.filter(function(t) { return currentThirds.indexOf(t) < 0; });
  if (stale.length === 0) return;
  stale.forEach(function(t) {
    var i = thirdPicks.indexOf(t);
    if (i >= 0) thirdPicks.splice(i, 1);
    showToast(t + ' removed — no longer a 3rd-place team', 'err');
  });
  renderThirdGrid();
  // Lock knockout (red) and amber best-third
  // Note: save-groups also calls _lockKnockout unconditionally for all re-saves,
  // so this handles cases where _checkThirdStaleness is called standalone
  if (_thirdSaved) {
    _lockKnockout();
  }
}

// Called after saving Best 3rd — checks if any R32 picks using 3rd-place
// slots are now invalid and clears them.
function onThirdSaved() {
  // When 3rd-place selections change, always invalidate the knockout stage:
  // - clear any R32 picks in matches 85-88 that used old 3rd-place teams
  // - lock the knockout tab (force user to re-save)
  // - show amber glow on knockout tab
  var changed = false;
  [85,86,87,88].forEach(function(m) {
    if (!matchPicks[m]) return;
    var correctTeams = getTeams(m);
    if (correctTeams.indexOf(matchPicks[m]) < 0) {
      clearDownstream(m, matchPicks[m]);
      delete matchPicks[m];
      changed = true;
    }
  });
  if (changed) {
    renderKnockout();
    showToast('Some knockout picks were cleared — Best 3rd selections changed', 'err');
  }
  // Always lock and amber the knockout tab when 3rd-place changes
  if (_thirdSaved) {
    _lockKnockout();
    setStaleGlow('knockout');
  }
}

function applyUnlockFromSavedState(data) {
  var hasGroups   = data.group_picks  && data.group_picks.length  > 0;
  var hasThird    = data.third_picks  && data.third_picks.length  > 0;
  var hasKnockout = data.match_picks  && data.match_picks.length  > 0;

  if (hasGroups || hasThird || hasKnockout) {
    _groupsSaved = true;
    unlockTab('best-third', 'none');  // returning user — no glow, just unlock
  }
  if (hasThird || hasKnockout) {
    _thirdSaved = true;
    unlockTab('knockout', 'none');    // returning user — no glow, just unlock
  }
  clearGlows();  // clean slate for returning users
}

// ── Save buttons ───────────────────────────────────────────────────────────

document.getElementById('save-groups-btn').addEventListener('click', function() {
  if (!CAN_EDIT) return;
  var wasAlreadySaved = _groupsSaved;
  _groupsSaved = true;
  if (wasAlreadySaved) {
    // Re-save: check staleness and cascade
    _checkThirdStaleness();         // removes stale thirdPicks, may lock KO
    _cascadeKnockoutFromGroups();   // clears invalid match picks

    // Any group re-save can shift 1st/2nd/3rd seedings → KO seeds change.
    // If knockout was previously saved, it must be locked for re-confirmation.
    if (_thirdSaved) {
      _lockKnockout();              // red + locked
      setNavState('best-third', 'amber');  // amber: review your 3rd picks
    } else {
      // KO was already locked — just amber best-third so user knows to review
      var btn3 = document.getElementById('nav-best-third');
      var isLocked3 = btn3 && btn3.classList.contains('locked');
      if (!isLocked3) setNavState('best-third', 'amber');
    }
  } else {
    // First save — green to guide user forward
    unlockTab('best-third', 'green');
  }
  showToast('Groups saved');
});

document.getElementById('save-third-btn').addEventListener('click', function() {
  if (!CAN_EDIT || thirdPicks.length < 8) return;
  var wasThirdSaved = _thirdSaved;   // capture BEFORE onThirdSaved() may clear it
  onThirdSaved();                    // cascade-check, may clear _thirdSaved
  _thirdSaved = true;
  setNavState('best-third', 'none'); // best-third is done, clear its glow
  // Green on first-ever save, amber on re-save (edit)
  unlockTab('knockout', wasThirdSaved ? 'amber' : 'green');
  showToast('Best 3rd saved');
});

// ── Load session ───────────────────────────────────────────────────────────

function loadSession() {
  apiCall('GET', '/api/session/' + SLUG).then(function(data) {
    if (data.group_picks && data.group_picks.length) {
      var byGroup = {};
      data.group_picks.forEach(function(p) {
        if (!byGroup[p.group_letter]) byGroup[p.group_letter] = [];
        byGroup[p.group_letter][p.position - 1] = p.team_name;
      });
      Object.keys(byGroup).forEach(function(g) {
        if (byGroup[g].filter(Boolean).length === 4) groupOrder[g] = byGroup[g].filter(Boolean);
      });
    }
    if (data.match_picks) {
      data.match_picks.forEach(function(p) { matchPicks[p.match_num] = p.winner; });
    }
    // Restore third-place picks from server
    if (data.third_picks && data.third_picks.length) {
      thirdPicks = data.third_picks.slice();
    }
    renderGroups();
    renderThirdGrid();
    renderKnockout();
    if (CAN_EDIT) applyUnlockFromSavedState(data);
  }).catch(function() {
    renderGroups(); renderThirdGrid(); renderKnockout();
  });
}

// ── Groups ─────────────────────────────────────────────────────────────────

function renderGroups() {
  var grid = document.getElementById('groups-grid');
  grid.innerHTML = '';
  Object.keys(GROUPS).forEach(function(g, i) {
    var card = buildGroupCard(g);
    card.style.animationDelay = (i * 35) + 'ms';
    grid.appendChild(card);
  });
}

function buildGroupCard(g) {
  var card = document.createElement('div');
  card.className = 'group-card fade-up';
  var hdr = document.createElement('div');
  hdr.className = 'group-card-header';
  hdr.innerHTML = '<div class="group-letter">Group ' + g + '</div>' +
    '<div class="group-sub">' + (CAN_EDIT ? 'Drag to reorder' : 'Predicted order') + '</div>';
  card.appendChild(hdr);
  var list = document.createElement('div');
  list.className = 'group-teams';
  groupOrder[g].forEach(function(team, idx) { list.appendChild(buildTeamSlot(team, idx+1)); });
  card.appendChild(list);
  if (CAN_EDIT) setupDragDrop(list, g);
  return card;
}

function buildTeamSlot(team, pos) {
  var s = document.createElement('div');
  s.className = 'team-slot';
  s.setAttribute('draggable', CAN_EDIT ? 'true' : 'false');
  s.setAttribute('data-team', team);
  s.innerHTML =
    '<span class="team-pos' + (pos<=2?' pos-'+pos:'') + '">' + pos + '</span>' +
    '<span class="team-flag">' + flag(team) + '</span>' +
    '<span class="team-name">' + team + '</span>';
  if (CAN_EDIT) {
    var h = document.createElement('span');
    h.className = 'drag-handle';
    h.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1.5" fill="currentColor"/><circle cx="15" cy="5" r="1.5" fill="currentColor"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/><circle cx="9" cy="19" r="1.5" fill="currentColor"/><circle cx="15" cy="19" r="1.5" fill="currentColor"/></svg>';
    s.appendChild(h);
  }
  return s;
}

var _dragEl = null;
var _saveTimers = {};

function setupDragDrop(container, group) {
  container.addEventListener('dragstart', function(e) {
    _dragEl = e.target.closest('.team-slot');
    if (_dragEl) { _dragEl.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
  });
  container.addEventListener('dragend', function() {
    if (_dragEl) _dragEl.classList.remove('dragging');
    container.querySelectorAll('.team-slot').forEach(function(s) { s.classList.remove('drag-over'); });
    _dragEl = null;
  });
  container.addEventListener('dragover', function(e) {
    e.preventDefault();
    var target = e.target.closest('.team-slot');
    if (!target || target === _dragEl) return;
    container.querySelectorAll('.team-slot').forEach(function(s) { s.classList.remove('drag-over'); });
    target.classList.add('drag-over');
    var slots = Array.from(container.querySelectorAll('.team-slot'));
    var fi = slots.indexOf(_dragEl), ti = slots.indexOf(target);
    if (fi !== ti) container.insertBefore(_dragEl, fi<ti ? target.nextSibling : target);
  });
  container.addEventListener('drop', function(e) {
    e.preventDefault();
    container.querySelectorAll('.team-slot').forEach(function(s) { s.classList.remove('drag-over'); });
    var order = Array.from(container.querySelectorAll('.team-slot')).map(function(s) { return s.getAttribute('data-team'); });
    var oldOrder = groupOrder[group].slice();  // capture before overwrite
    groupOrder[group] = order;
    container.querySelectorAll('.team-slot').forEach(function(slot, idx) {
      var p = slot.querySelector('.team-pos');
      p.textContent = idx+1; p.className = 'team-pos' + (idx<2?' pos-'+(idx+1):'');
    });
    clearTimeout(_saveTimers[group]);
    _saveTimers[group] = setTimeout(function() {
      apiCall('POST', '/api/session/'+SLUG+'/group-order', {group:group, teams:order})
        .then(function() { showToast('Group '+group+' saved'); })
        .catch(function(e) { showToast(e.message,'err'); });
    }, 400);
  });
}

// ── Best Third ─────────────────────────────────────────────────────────────

function renderThirdGrid() {
  var grid = document.getElementById('third-grid');
  grid.innerHTML = '';
  Object.keys(GROUPS).forEach(function(g, i) {
    var team = groupOrder[g][2];
    var sel  = thirdPicks.indexOf(team) >= 0;
    var full = thirdPicks.length >= 8;
    var rej  = full && !sel;
    var card = document.createElement('div');
    card.className = 'third-card fade-up' + (sel?' selected':'') + (rej?' rejected':'');
    card.style.animationDelay = (i*28)+'ms';
    card.setAttribute('data-team', team);
    card.innerHTML =
      '<span class="third-card-flag">'+flag(team)+'</span>' +
      '<div class="third-card-team">'+team+'</div>' +
      '<div class="third-card-group">Group '+g+' · 3rd</div>' +
      '<div class="third-status"></div>';
    if (CAN_EDIT) card.addEventListener('click', function() { toggleThird(team, card); });
    grid.appendChild(card);
  });
  updateThirdBadge();
  updateThirdBtn();
}

function toggleThird(team, card) {
  var idx = thirdPicks.indexOf(team);
  if (idx >= 0) {
    thirdPicks.splice(idx,1);
  } else {
    if (thirdPicks.length >= 8) { showToast('Already 8 selected — deselect one first','err'); return; }
    thirdPicks.push(team);
  }
  var full = thirdPicks.length >= 8;
  document.querySelectorAll('.third-card').forEach(function(c) {
    var t = c.getAttribute('data-team');
    var s = thirdPicks.indexOf(t) >= 0;
    c.classList.toggle('selected', s);
    c.classList.toggle('rejected', full && !s);
  });
  updateThirdBadge();
  updateThirdBtn();
  saveThirdPicks();  // persist immediately on every selection change
}

var _thirdSaveTimer = null;
function saveThirdPicks() {
  clearTimeout(_thirdSaveTimer);
  _thirdSaveTimer = setTimeout(function() {
    apiCall('POST', '/api/session/' + SLUG + '/third-picks', { teams: thirdPicks.slice() })
      .catch(function(e) { showToast('Failed to save 3rd picks: ' + e.message, 'err'); });
  }, 400);
}

function updateThirdBadge() {
  var b = document.getElementById('third-count-badge');
  var n = thirdPicks.length;
  b.textContent = n+' / 8';
  if (n===8) { b.className='badge badge-green'; b.style.cssText=''; }
  else if (n>0) { b.className='badge badge-amber'; b.style.cssText=''; }
  else { b.className='badge'; b.style.cssText='background:var(--surface-2);color:var(--text-3);border:1px solid var(--border-mid)'; }
}

function updateThirdBtn() {
  var btn  = document.getElementById('save-third-btn');
  var hint = document.getElementById('third-proceed-hint');
  var n = thirdPicks.length;
  btn.disabled = n < 8;
  if (n===8) { hint.textContent='All 8 selected — ready to save'; hint.style.color='var(--green)'; }
  else { hint.textContent='Select '+(8-n)+' more team'+(8-n===1?'':'s')+' to save'; hint.style.color=''; }
}

// ════════════════════════════════════════════════════════════════════════════
// KNOCKOUT BRACKET — mirror tree
//
// Match numbering (correct FIFA 2026):
//   73-88  Round of 32  (16 matches)
//   89-96  Round of 16  (8 matches)
//   97-100 Quarter-finals (4 matches)
//   101-102 Semi-finals  (2 matches)
//   103     3rd-place play-off
//   104     Final
//
// Mirror layout:
//   LEFT HALF  feeds into SF match 101 (left semi)
//   RIGHT HALF feeds into SF match 102 (right semi)
//   101 winner + 102 winner → Final (104)
//   101 loser  + 102 loser  → 3rd-place play-off (103)
// ════════════════════════════════════════════════════════════════════════════

// Feeder relationships
var FEEDER = {
  // R16 ← R32
  89:[73,74],  90:[75,76],  91:[77,78],  92:[79,80],
  93:[81,82],  94:[83,84],  95:[85,86],  96:[87,88],
  // QF ← R16
  97:[89,90],  98:[91,92],  99:[93,94],  100:[95,96],
  // SF ← QF
  101:[97,98], 102:[99,100],
  // Final ← SF
  104:[101,102],
  // 3rd place ← SF losers (special case, handled separately)
};

// R32 match → [teamSlot1, teamSlot2]
var R32 = {
  73:['A1','B2'],  74:['C1','D2'],  75:['E1','F2'],  76:['G1','H2'],
  77:['I1','J2'],  78:['K1','L2'],  79:['B1','A2'],  80:['D1','C2'],
  81:['F1','E2'],  82:['H1','G2'],  83:['J1','I2'],  84:['L1','K2'],
  85:['A3','B3'],  86:['C3','D3'],  87:['E3','F3'],  88:['G3','H3'],
};

function resolveSlot(slot) {
  var g = slot[0], pos = parseInt(slot[1])-1;
  return groupOrder[g] ? (groupOrder[g][pos]||null) : null;
}

function getTeams(matchNum) {
  if (matchNum >= 73 && matchNum <= 88) {
    var pair = R32[matchNum];
    if (!pair) return [null,null];
    return [resolveSlot(pair[0]), resolveSlot(pair[1])];
  }
  if (matchNum === 103) {
    // 3rd place: losers of SF 101 & 102
    var sf1teams = getTeams(101), sf2teams = getTeams(102);
    var w1 = matchPicks[101]||null, w2 = matchPicks[102]||null;
    var l1 = w1 ? (sf1teams[0]===w1 ? sf1teams[1] : sf1teams[0]) : null;
    var l2 = w2 ? (sf2teams[0]===w2 ? sf2teams[1] : sf2teams[0]) : null;
    return [l1, l2];
  }
  var f = FEEDER[matchNum]||[null,null];
  return [f[0]?matchPicks[f[0]]||null:null, f[1]?matchPicks[f[1]]||null:null];
}

function pickWinner(matchNum, team) {
  if (!CAN_EDIT) return;
  if (matchPicks[matchNum] === team) {
    delete matchPicks[matchNum];
    clearDownstream(matchNum, team);
  } else {
    var prev = matchPicks[matchNum];
    matchPicks[matchNum] = team;
    if (prev) clearDownstream(matchNum, prev);
  }
  renderKnockout();
  setTimeout(function() {
    apiCall('POST', '/api/session/'+SLUG+'/match-pick', {
      match_num: matchNum, winner: matchPicks[matchNum]||''
    }).catch(function(e) { showToast(e.message,'err'); });
  }, 0);
}

function clearDownstream(matchNum, team) {
  [89,90,91,92,93,94,95,96,97,98,99,100,101,102,104].forEach(function(m) {
    var f = FEEDER[m];
    if (f && f.indexOf(matchNum)>=0 && matchPicks[m]===team) {
      delete matchPicks[m];
      clearDownstream(m, team);
    }
  });
  // also clear 3rd-place if a SF result changes
  if (matchNum===101||matchNum===102) { delete matchPicks[103]; }
}

// ── Mirror bracket renderer ────────────────────────────────────────────────

/* ═══════════════════════════════════════════════════════════════════════════
   KNOCKOUT BRACKET — absolute-positioned tree
   
   Geometry:
   - MATCH_H:  total height of one match box (team rows + meta)
   - GAP:      minimum vertical gap between sibling matches in the same round
   - The bracket has 16 R32 matches per half.
   - Each successive round has half as many matches, vertically centred
     between the pair of feeder matches that produced them.
   - Column widths are fixed px so we can compute exact positions.
   
   Layout (left half, 5 columns, right half mirrors):
     Col 0: L-R32a  matches 73-76  (4 matches, top half of left)
     Col 1: L-R32b  matches 77-80  (4 matches, bottom half of left)
     Col 2: L-R16   matches 89-92  (4 matches)
     Col 3: L-QF    matches 97-98  (2 matches)
     Col 4: L-SF    match   101    (1 match)
     Col 5: R-SF    match   102    (1 match)
     Col 6: R-QF    matches 99-100 (2 matches)
     Col 7: R-R16   matches 93-96  (4 matches)
     Col 8: R-R32a  matches 81-84  (4 matches)
     Col 9: R-R32b  matches 85-88  (4 matches)
═══════════════════════════════════════════════════════════════════════════ */

// Match metadata: venue + date for each knockout match
// (approximate draw — update when official schedule is released)
/* ═══════════════════════════════════════════════════════════════════════════
   KNOCKOUT BRACKET — proper tournament tree, absolutely positioned
   
   Structure (per half, 4 rounds):
     Round of 32  : 8 matches  → 1 column
     Round of 16  : 4 matches  → 1 column, each centred between 2 R32 feeders
     Quarter-finals: 2 matches → 1 column, each centred between 2 R16 feeders
     Semi-finals  : 1 match    → 1 column, centred between 2 QF feeders
   
   Left half feeds right (converges to centre).
   Right half is a mirror — feeds left (also converges to centre).
   
   Left  matches: R32=73-80, R16=89-92, QF=97-98,   SF=101
   Right matches: R32=81-88, R16=93-96, QF=99-100,  SF=102
═══════════════════════════════════════════════════════════════════════════ */

var MATCH_META = {
  73:{venue:'MetLife Stadium',   date:'27 Jun'}, 74:{venue:'SoFi Stadium',      date:'27 Jun'},
  75:{venue:'AT&T Stadium',      date:'28 Jun'}, 76:{venue:'Hard Rock Stadium', date:'28 Jun'},
  77:{venue:"Levi's Stadium",    date:'29 Jun'}, 78:{venue:'Rose Bowl',         date:'29 Jun'},
  79:{venue:'Arrowhead Stadium', date:'30 Jun'}, 80:{venue:'NRG Stadium',       date:'30 Jun'},
  81:{venue:'Q2 Stadium',        date:'1 Jul'},  82:{venue:'Lincoln Financial', date:'1 Jul'},
  83:{venue:'BC Place',          date:'2 Jul'},  84:{venue:'BMO Field',         date:'2 Jul'},
  85:{venue:'Estadio Azteca',    date:'3 Jul'},  86:{venue:'Estadio Akron',     date:'3 Jul'},
  87:{venue:'Estadio BBVA',      date:'4 Jul'},  88:{venue:'Estadio Cuauhtémoc',date:'4 Jul'},
  89:{venue:'MetLife Stadium',   date:'5 Jul'},  90:{venue:'AT&T Stadium',      date:'5 Jul'},
  91:{venue:'SoFi Stadium',      date:'6 Jul'},  92:{venue:'Hard Rock Stadium', date:'6 Jul'},
  93:{venue:'Rose Bowl',         date:'7 Jul'},  94:{venue:'NRG Stadium',       date:'7 Jul'},
  95:{venue:"Levi's Stadium",    date:'8 Jul'},  96:{venue:'Arrowhead Stadium', date:'8 Jul'},
  97:{venue:'MetLife Stadium',   date:'9 Jul'},  98:{venue:'AT&T Stadium',      date:'9 Jul'},
  99:{venue:'SoFi Stadium',      date:'10 Jul'}, 100:{venue:'Hard Rock Stadium',date:'10 Jul'},
  101:{venue:'MetLife Stadium',  date:'14 Jul'}, 102:{venue:'SoFi Stadium',     date:'14 Jul'},
  103:{venue:'Hard Rock Stadium',date:'18 Jul'}, 104:{venue:'MetLife Stadium',  date:'19 Jul'},
};

function buildMatchBox(matchNum) {
  var box = document.createElement('div');
  box.className = 'bm';
  box.setAttribute('data-match', matchNum);

  var meta = MATCH_META[matchNum];
  var hdr  = document.createElement('div');
  hdr.className = 'bm-meta';
  hdr.innerHTML =
    '<span class="bm-match-num">M' + matchNum + '</span>' +
    (meta ? '<span class="bm-venue">' + meta.venue + '</span>' +
            '<span class="bm-date">'  + meta.date  + '</span>' : '');
  box.appendChild(hdr);

  getTeams(matchNum).forEach(function(team) {
    var row = document.createElement('div');
    var tbd = !team;
    var win = !tbd && matchPicks[matchNum] === team;
    row.className = 'bt' + (win?' bt--win':'') + (tbd?' bt--tbd':'');
    if (tbd) {
      row.innerHTML = '<span class="bt-name bt--tbd-text">TBD</span>';
    } else {
      row.innerHTML =
        '<span class="bt-flag">' + flag(team) + '</span>' +
        '<span class="bt-name">'  + team       + '</span>';
      if (CAN_EDIT) row.addEventListener('click', (function(m,t){ return function(){ pickWinner(m,t); }; })(matchNum,team));
    }
    box.appendChild(row);
  });
  return box;
}

function renderKnockout() {
  var vp = document.getElementById('bracket-viewport');
  vp.innerHTML = '';

  /* ── Layout constants — read from permanent cache, never re-measured ──── */
  var dims   = getBracketDims();
  var panelH = dims.h;
  var panelW = dims.w;

  // ── Step 1: column widths from available width ─────────────────────────
  // 8 cols: L-R32 L-R16 L-QF L-SF  R-SF R-QF R-R16 R-R32
  // All equal width — simpler, cleaner, fills the space evenly
  // 7 gaps between columns
  var HDR_H   = 22;
  var PAD_X   = 10;
  var PAD_Y   = 6;
  var availW  = panelW - PAD_X*2;
  var N_COLS  = 8;

  // Column widths: fixed at 65% of what would fill the panel.
  // The remaining 35% becomes generous gaps between columns.
  var colW    = Math.floor(availW * 0.62 / N_COLS);
  colW        = Math.max(90, Math.min(150, colW));   // 90–150px per column

  // Inner rounds slightly narrower than R32
  var W_R32   = Math.round(colW * 1.0);
  var W_R16   = Math.round(colW * 0.92);
  var W_QF    = Math.round(colW * 0.86);
  var W_SF    = Math.round(colW * 0.80);

  // Gaps fill the remaining horizontal space evenly across 7 inter-column gaps
  var colsSum = 2*(W_R32 + W_R16 + W_QF + W_SF);
  var COL_GAP = Math.floor((availW - colsSum) / 7);
  var totalW  = colsSum + 7*COL_GAP;

  // ── Step 2: box height — squarish relative to R32 column width ─────────
  // Target: BOX_H ≈ W_R32 * 0.55  →  closer to square (wide col, shorter box)
  var META_H   = 18;
  var N_R32    = 8;
  var BOX_GAP  = 6;  // will be recalculated from remaining height below
  // Box height: squarish-rectangle ratio — height ≈ width × 0.36
  // That gives roughly a 3:1 wide rectangle, which reads as compact
  // contentH = usable vertical space for the bracket body (excluding header + padding)
  var contentH = panelH - HDR_H - PAD_Y - 16;  // 16px bottom breathing room

  // BOX_H: fit 8 boxes + 7 gaps into contentH, capped for aesthetics
  // Start from width-based ratio, then clamp to what actually fits
  var BOX_H = Math.round(W_R32 * 0.52);
  BOX_H = Math.max(48, Math.min(72, BOX_H));

  // Minimum gap is 6px; calculate actual gap from remaining space
  var minGap   = 6;
  var maxBoxH  = Math.floor((contentH - (N_R32-1)*minGap) / N_R32);
  BOX_H        = Math.min(BOX_H, maxBoxH);  // shrink if needed to fit
  BOX_H        = Math.max(48, BOX_H);

  var TEAM_ROW = Math.floor((BOX_H - META_H) / 2);
  BOX_GAP      = Math.max(minGap, Math.floor((contentH - N_R32*BOX_H) / (N_R32-1)));
  var TREE_H   = N_R32 * BOX_H + (N_R32-1)*BOX_GAP;
  /* ── Column x positions (left edges) ─────────────────────────────────── */
  var g  = COL_GAP;
  var xLL = 0;                              // L-R32
  var xLM = xLL + W_R32 + g;               // L-R16
  var xLQ = xLM + W_R16 + g;               // L-QF
  var xLS = xLQ + W_QF  + g;               // L-SF
  var xRS = xLS + W_SF  + COL_GAP;         // R-SF
  var xRQ = xRS + W_SF  + g;               // R-QF
  var xRM = xRQ + W_QF  + g;               // R-R16
  var xRL = xRM + W_R16 + g;               // R-R32

  /* ── Vertical positions ───────────────────────────────────────────────── */
  var slotH = (TREE_H + BOX_GAP) / N_R32;
  function slotMid(i) { return i * slotH + slotH/2; }
  function topFromMid(mid) { return Math.round(mid - BOX_H/2); }

  // Left R32 positions (matches 73-80, top to bottom)
  var lPos = {};
  [73,74,75,76,77,78,79,80].forEach(function(m,i){ lPos[m] = topFromMid(slotMid(i)); });

  // Each subsequent round: midpoint of its two feeders' centres
  function mid2(a,b,posMap){ return topFromMid((posMap[a]+posMap[b])/2 + BOX_H/2); }
  lPos[89] = mid2(73,74,lPos); lPos[90] = mid2(75,76,lPos);
  lPos[91] = mid2(77,78,lPos); lPos[92] = mid2(79,80,lPos);
  lPos[97] = mid2(89,90,lPos); lPos[98] = mid2(91,92,lPos);
  lPos[101]= mid2(97,98,lPos);

  // Right half (matches 81-88, same vertical slots as left)
  var rPos = {};
  [81,82,83,84,85,86,87,88].forEach(function(m,i){ rPos[m] = topFromMid(slotMid(i)); });
  rPos[93] = mid2(81,82,rPos); rPos[94] = mid2(83,84,rPos);
  rPos[95] = mid2(85,86,rPos); rPos[96] = mid2(87,88,rPos);
  rPos[99] = mid2(93,94,rPos); rPos[100]= mid2(95,96,rPos);
  rPos[102]= mid2(99,100,rPos);

  /* ── DOM construction ─────────────────────────────────────────────────── */

  // Header
  var hdr = document.createElement('div');
  hdr.className = 'bkt-hdr-row';
  hdr.style.cssText = 'position:relative;height:'+HDR_H+'px;flex-shrink:0;width:'+totalW+'px;';

  function hdrCell(label, x, w) {
    var el = document.createElement('div');
    el.className = 'bkt-hdr-cell';
    el.style.cssText = 'position:absolute;left:'+x+'px;width:'+w+'px;text-align:center;line-height:'+HDR_H+'px;';
    el.textContent = label;
    return el;
  }
  hdr.appendChild(hdrCell('Round of 32',    xLL, W_R32));
  hdr.appendChild(hdrCell('Round of 16',    xLM, W_R16));
  hdr.appendChild(hdrCell('Quarter-finals', xLQ, W_QF));
  hdr.appendChild(hdrCell('Semi-finals',    xLS, W_SF*2+g));
  hdr.appendChild(hdrCell('Quarter-finals', xRQ, W_QF));
  hdr.appendChild(hdrCell('Round of 16',    xRM, W_R16));
  hdr.appendChild(hdrCell('Round of 32',    xRL, W_R32));

  // Canvas
  var canvas = document.createElement('div');
  canvas.style.cssText = 'position:relative;width:'+totalW+'px;height:'+TREE_H+'px;flex-shrink:0;';

  function place(matchNum, x, w, yTop, posMap) {
    var box = buildMatchBox(matchNum);
    box.style.cssText =
      'position:absolute;left:'+x+'px;top:'+yTop+'px;' +
      'width:'+w+'px;height:'+BOX_H+'px;';
    box.querySelector('.bm-meta').style.height = META_H + 'px';
    box.querySelectorAll('.bt').forEach(function(r){ r.style.height = TEAM_ROW + 'px'; });
    canvas.appendChild(box);
  }

  // Left half — place all matches
  [73,74,75,76,77,78,79,80].forEach(function(m){ place(m, xLL, W_R32, lPos[m]); });
  [89,90,91,92]             .forEach(function(m){ place(m, xLM, W_R16, lPos[m]); });
  [97,98]                   .forEach(function(m){ place(m, xLQ, W_QF,  lPos[m]); });
  place(101, xLS, W_SF, lPos[101]);

  // Right half — place all matches
  [81,82,83,84,85,86,87,88].forEach(function(m){ place(m, xRL, W_R32, rPos[m]); });
  [93,94,95,96]             .forEach(function(m){ place(m, xRM, W_R16, rPos[m]); });
  [99,100]                  .forEach(function(m){ place(m, xRQ, W_QF,  rPos[m]); });
  place(102, xRS, W_SF, rPos[102]);

  /* ── SVG connector lines ──────────────────────────────────────────────── */
  var svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.style.cssText = 'position:absolute;inset:0;width:'+totalW+'px;height:'+TREE_H+'px;pointer-events:none;overflow:visible;';
  var stroke = getComputedStyle(document.documentElement).getPropertyValue('--border-mid').trim() || '#2E3D60';

  function ln(x1,y1,x2,y2){
    var el = document.createElementNS('http://www.w3.org/2000/svg','line');
    el.setAttribute('x1',Math.round(x1)); el.setAttribute('y1',Math.round(y1));
    el.setAttribute('x2',Math.round(x2)); el.setAttribute('y2',Math.round(y2));
    el.setAttribute('stroke',stroke); el.setAttribute('stroke-width','1.5');
    svg.appendChild(el);
  }

  // LEFT connectors: feeder right-edge → midX → target left-edge
  // fromX = left edge of feeder col, fromW = feeder col width
  // toX   = left edge of target col
  function connectL(mA, mB, mT, fromX, fromW, toX, pos) {
    var cA = pos[mA] + BOX_H/2;   // centre-y of feeder A
    var cB = pos[mB] + BOX_H/2;   // centre-y of feeder B
    var cT = pos[mT] + BOX_H/2;   // centre-y of target
    var rx = fromX + fromW;        // right edge of feeder column
    var mx = rx + (toX - rx)/2;   // halfway into the gap
    ln(rx, cA, mx, cA);
    ln(rx, cB, mx, cB);
    ln(mx, cA, mx, cB);
    ln(mx, cT, toX, cT);
  }

  // RIGHT connectors: feeder left-edge → midX → target right-edge
  // fromX = left edge of feeder col, toX = left edge of target col, toW = target col width
  function connectR(mA, mB, mT, fromX, toX, toW, pos) {
    var cA = pos[mA] + BOX_H/2;
    var cB = pos[mB] + BOX_H/2;
    var cT = pos[mT] + BOX_H/2;
    var lx = fromX;                // left edge of feeder column
    var mx = toX + toW + (lx - toX - toW)/2;  // midpoint in gap
    ln(lx, cA, mx, cA);
    ln(lx, cB, mx, cB);
    ln(mx, cA, mx, cB);
    ln(mx, cT, toX + toW, cT);
  }

  // Left half
  connectL(73,74, 89,  xLL,W_R32, xLM, lPos);
  connectL(75,76, 90,  xLL,W_R32, xLM, lPos);
  connectL(77,78, 91,  xLL,W_R32, xLM, lPos);
  connectL(79,80, 92,  xLL,W_R32, xLM, lPos);
  connectL(89,90, 97,  xLM,W_R16, xLQ, lPos);
  connectL(91,92, 98,  xLM,W_R16, xLQ, lPos);
  connectL(97,98, 101, xLQ,W_QF,  xLS, lPos);

  // Right half
  connectR(81,82, 93,  xRL, xRM, W_R16, rPos);
  connectR(83,84, 94,  xRL, xRM, W_R16, rPos);
  connectR(85,86, 95,  xRL, xRM, W_R16, rPos);
  connectR(87,88, 96,  xRL, xRM, W_R16, rPos);
  connectR(93,94, 99,  xRM, xRQ, W_QF,  rPos);
  connectR(95,96, 100, xRM, xRQ, W_QF,  rPos);
  connectR(99,100,102, xRQ, xRS, W_SF,  rPos);

  canvas.insertBefore(svg, canvas.firstChild);

  // Vertically centre the whole tree within the panel
  var treeUsedH = HDR_H + 4 + TREE_H;
  var vOffset   = Math.max(PAD_Y, Math.floor((panelH - treeUsedH) / 2));

  hdr.style.marginLeft    = PAD_X + 'px';
  canvas.style.marginLeft = PAD_X + 'px';
  canvas.style.marginTop  = '4px';

  // Use a centring wrapper div — never mutate vp's own padding/height
  // (mutating vp causes next clientHeight read to be wrong → resize loop)
  vp.style.cssText = 'width:100%;height:100%;overflow:hidden;position:relative;';
  var wrap = document.createElement('div');
  // height:100% + overflow:hidden = wrap can NEVER expand beyond vp, period
  wrap.style.cssText = 'width:100%;height:100%;overflow:hidden;display:flex;flex-direction:column;padding-top:' + vOffset + 'px;box-sizing:border-box;';
  wrap.appendChild(hdr);
  wrap.appendChild(canvas);
  vp.appendChild(wrap);
}


// ── Edit modal ─────────────────────────────────────────────────────────────

function openEditModal() {
  document.getElementById('modal-backdrop').classList.add('open');
  document.getElementById('edit-modal').classList.add('open');
  document.getElementById('modal-error').style.display = 'none';
  var inp = document.getElementById('code-input');
  inp.value = ''; inp.classList.remove('error');
  setTimeout(function() { inp.focus(); }, 260);
  document.body.style.overflow = 'hidden';
}
function closeEditModal() {
  document.getElementById('modal-backdrop').classList.remove('open');
  document.getElementById('edit-modal').classList.remove('open');
  document.body.style.overflow = '';
}
function showModalError(msg) {
  var el = document.getElementById('modal-error');
  el.textContent = msg; el.style.display = 'block';
  var inp = document.getElementById('code-input');
  inp.classList.add('error');
  setTimeout(function() { inp.classList.remove('error'); }, 400);
}

async function submitEditCode() {
  var inp  = document.getElementById('code-input');
  var code = inp.value.trim().toUpperCase();
  if (!code || code.length !== 10) { showModalError('Access codes are 10 characters.'); return; }

  var btn = document.getElementById('modal-submit');
  btn.textContent = 'Checking…'; btn.disabled = true;

  try {
    var resp = await fetch('/api/session/'+SLUG+'/name', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ edit_code: code, name: SESSION.display_name||'' }),
    });
    if (resp.status === 403) {
      showModalError('That code is incorrect. Check it and try again.');
      btn.textContent = 'Unlock editing'; btn.disabled = false;
      return;
    }
    if (!resp.ok) {
      showModalError('Something went wrong — please try again.');
      btn.textContent = 'Unlock editing'; btn.disabled = false;
      return;
    }

    EDIT_CODE = code; CAN_EDIT = true;
    localStorage.setItem('edit_code_'+SLUG, code);
    closeEditModal();

    document.getElementById('edit-btn').style.display  = 'none';
    document.getElementById('code-pill').style.display = 'flex';
    document.getElementById('code-pill-value').textContent = code;
    var banner = document.querySelector('.viewonly-banner');
    if (banner) banner.remove();

    renderGroups(); renderThirdGrid(); renderKnockout();
    showToast('Edit mode unlocked');
  } catch(e) {
    showModalError('Network error — please try again.');
    btn.textContent = 'Unlock editing'; btn.disabled = false;
  }
}

document.getElementById('modal-submit').addEventListener('click', submitEditCode);
document.getElementById('modal-cancel').addEventListener('click', closeEditModal);
document.getElementById('modal-close').addEventListener('click', closeEditModal);
document.getElementById('modal-backdrop').addEventListener('click', closeEditModal);
document.getElementById('code-input').addEventListener('keydown', function(e) {
  if (e.key==='Enter') submitEditCode();
  if (e.key==='Escape') closeEditModal();
});
document.getElementById('edit-modal').addEventListener('click', function(e) { e.stopPropagation(); });

// ── Live data ──────────────────────────────────────────────────────────────

var _liveLoaded  = false;
var _liveRefreshTimer = null;
var _allFixtures = [];

// ── Sub-tab switching inside the Live panel ──────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.live-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.live-tab').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.live-tab-panel').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      var target = btn.getAttribute('data-live-tab');
      document.getElementById(target).classList.add('active');
      // Re-render with latest data when switching sub-tabs
      if (target === 'past-tab') {
        if (_liveLoaded) renderPastFixtures(_allFixtures); else loadLive();
      }
      if (target === 'standings-tab') {
        if (_liveLoaded) renderLiveStandings(_allFixtures); else loadLive();
      }
    });
  });
  document.getElementById('past-group-filter').addEventListener('change', function() {
    renderPastFixtures(_allFixtures);
  });
});

function loadLive() {
  if (_liveLoaded) return;
  _liveLoaded = true;

  // Show loading indicator in today-list only (standings renders unconditionally)
  document.getElementById('today-list').innerHTML =
    '<div class="groups-loading"><div class="spinner"></div><p>Loading…</p></div>';

  fetch('/api/live').then(function(r) { return r.json(); }).then(function(data) {
    _allFixtures = data.fixtures || [];

    // Always render standings and past fixtures — even with no data they show
    // the group tables with zeros, which is the correct empty state.
    renderLiveStandings(_allFixtures);
    renderPastFixtures(_allFixtures);

    if (_allFixtures.length === 0) {
      // No fixture data yet — show message only in live/results section
      document.getElementById('today-list').innerHTML =
        '<div class="live-empty" style="padding:1.5rem;text-align:center">' +
        '<p style="margin-bottom:.4rem;color:var(--text-2)">No live data yet.</p>' +
        '<p style="font-size:.78rem;color:var(--text-3)">Set <code>API_FOOTBALL_KEY</code> in .env and restart.</p>' +
        '</div>';
      document.getElementById('recent-list').innerHTML = '';
      var lsec = document.getElementById('live-now-section');
      if (lsec) lsec.style.display = 'none';
      return;
    }

    // Render live/results section
    renderLiveAndResults(_allFixtures);
    // If user is on standings or past tab, re-render explicitly now data is ready
    var curPanel = document.querySelector('#panel-live .live-tab-panel.active');
    if (curPanel && curPanel.id === 'standings-tab') renderLiveStandings(_allFixtures);
    if (curPanel && curPanel.id === 'past-tab')      renderPastFixtures(_allFixtures);


    // Auto-refresh every 60s if any matches are live
    var hasLive = _allFixtures.some(function(f) {
      return ['LIVE','1H','2H','HT','ET','BT','P','SUSP','INT'].indexOf(f.status) >= 0;
    });
    if (hasLive) {
      setTimeout(function() { _liveLoaded = false; loadLive(); }, 60000);
    }
  }).catch(function(e) {
    document.getElementById('live-groups-grid').innerHTML =
      '<div class="live-empty">Live data unavailable — check server logs.</div>';
    _liveLoaded = false;
  });
}

// ── Status helpers ───────────────────────────────────────────────────────────

var LIVE_STATUSES     = ['LIVE','1H','2H','HT','ET','BT','SUSP','INT'];
var FINISHED_STATUSES = ['FT','AET','PEN','AWD','WO'];
var UPCOMING_STATUSES = ['NS','TBD','SCHEDULED'];

function isLive(f)     { return LIVE_STATUSES.indexOf(f.status) >= 0; }
function isFinished(f) { return FINISHED_STATUSES.indexOf(f.status) >= 0; }
function isUpcoming(f) { return !isLive(f) && !isFinished(f); }

function formatKickoff(kickoff) {
  if (!kickoff) return '';
  var d = new Date(kickoff);
  if (isNaN(d)) return kickoff;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(kickoff) {
  if (!kickoff) return '';
  var d = new Date(kickoff);
  if (isNaN(d)) return '';
  return d.toLocaleDateString([], { weekday:'short', day:'numeric', month:'short' });
}

function isToday(kickoff) {
  if (!kickoff) return false;
  var d = new Date(kickoff);
  var now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate();
}

function daysDiff(kickoff) {
  // Returns how many days ago the fixture was (negative = future)
  if (!kickoff) return 0;
  var d = new Date(kickoff);
  var now = new Date();
  now.setHours(0,0,0,0);
  d.setHours(0,0,0,0);
  return Math.floor((now - d) / 86400000);
}

// ── Build a fixture card DOM element ─────────────────────────────────────────

function buildFixtureCard(f) {
  var live     = isLive(f);
  var finished = isFinished(f);
  var upcoming = isUpcoming(f);

  var homeWin = finished && f.home_score > f.away_score;
  var awayWin = finished && f.away_score > f.home_score;

  var card = document.createElement('div');
  card.className = 'fixture-card' +
    (live ? ' is-live' : '') +
    (finished ? ' is-finished' : '');

  // Home team
  var homeEl = document.createElement('div');
  homeEl.className = 'fixture-team home' + (homeWin ? ' winner' : '');
  homeEl.innerHTML =
    '<span class="fixture-team-name">' + (f.home_team || 'TBD') + '</span>' +
    '<span class="fixture-team-flag">' + flag(f.home_team || '') + '</span>';

  // Score / time
  var scoreEl = document.createElement('div');
  if (live) {
    scoreEl.className = 'fixture-score';
    scoreEl.textContent = (f.home_score || 0) + ' – ' + (f.away_score || 0);
  } else if (finished) {
    scoreEl.className = 'fixture-score';
    scoreEl.textContent = f.home_score + ' – ' + f.away_score;
  } else {
    scoreEl.className = 'fixture-score upcoming';
    scoreEl.textContent = formatKickoff(f.kickoff) || 'TBD';
  }

  // Away team
  var awayEl = document.createElement('div');
  awayEl.className = 'fixture-team away' + (awayWin ? ' winner' : '');
  awayEl.innerHTML =
    '<span class="fixture-team-flag">' + flag(f.away_team || '') + '</span>' +
    '<span class="fixture-team-name">' + (f.away_team || 'TBD') + '</span>';

  // Status badge
  var statusEl = document.createElement('div');
  statusEl.className = 'fixture-status';
  var badgeClass = live ? 'live' : finished ? 'ft' : '';
  var badgeText  = live ? (f.status || 'LIVE') : finished ? 'FT' : '';
  var meta = f.group_name || f.round || '';

  statusEl.innerHTML =
    (badgeText ? '<span class="fixture-badge ' + badgeClass + '">' + badgeText + '</span>' : '') +
    (meta ? '<span class="fixture-meta">' + meta + '</span>' : '');

  card.appendChild(homeEl);
  card.appendChild(scoreEl);
  card.appendChild(awayEl);
  card.appendChild(statusEl);
  return card;
}

// ── Live & Results tab ───────────────────────────────────────────────────────

// Wire up filter change
document.addEventListener('DOMContentLoaded', function() {
  var sel = document.getElementById('live-results-filter');
  if (sel) sel.addEventListener('change', function() { renderLiveAndResults(_allFixtures); });
});

function renderLiveAndResults(fixtures) {
  var filter   = (document.getElementById('live-results-filter') || {}).value || 'all';
  var live     = fixtures.filter(isLive);
  var today    = fixtures.filter(function(f) { return isToday(f.kickoff); });
  var recent   = fixtures.filter(function(f) {
    var d = daysDiff(f.kickoff);
    return d > 0 && d <= 4 && isFinished(f) && !isToday(f.kickoff);
  });

  // matchesFilter: does this fixture match the selected filter?
  function matchesFilter(f) {
    if (filter === 'all')      return true;
    if (filter === 'live')     return isLive(f);
    if (filter === 'today')    return isToday(f.kickoff);
    if (filter === 'recent')   return isFinished(f) && daysDiff(f.kickoff) > 0;
    if (filter === 'upcoming') return isUpcoming(f) && !isToday(f.kickoff);
    if (filter === 'group')    return !!f.group_name;
    if (filter === 'knockout') return !f.group_name;
    return f.group_name === 'Group ' + filter;
  }

  // Live now section — only visible when filter includes live matches
  var showLiveSection = filter === 'all' || filter === 'live' || filter === 'today' ||
                        filter === 'group' || filter === 'knockout' ||
                        (filter.length === 1 && filter >= 'A' && filter <= 'L');
  var liveSection = document.getElementById('live-now-section');
  var liveList    = document.getElementById('live-matches-list');
  var liveFiltered = live.filter(matchesFilter);
  if (showLiveSection && liveFiltered.length) {
    liveSection.style.display = 'block';
    liveList.innerHTML = '';
    liveFiltered.forEach(function(f) { liveList.appendChild(buildFixtureCard(f)); });
    document.querySelectorAll('.live-tab-dot').forEach(function(d) { d.classList.add('visible'); });
    document.getElementById('live-indicator').style.display = 'block';
  } else {
    liveSection.style.display = 'none';
  }

  var todaySection  = document.getElementById('today-section');
  var recentSection = document.getElementById('recent-section');
  var todayLabel    = document.getElementById('today-label');
  var todayList     = document.getElementById('today-list');
  var recentList    = document.getElementById('recent-list');
  var useCustomList = filter !== 'all' && filter !== 'today' && filter !== 'recent';

  if (useCustomList) {
    var filtered = fixtures.filter(matchesFilter);
    filtered.sort(function(a,b) { return new Date(a.kickoff) - new Date(b.kickoff); });
    var labelMap = { live:'Live now', upcoming:'Upcoming', group:'Group stage', knockout:'Knockout stage' };
    if (todayLabel) todayLabel.textContent = labelMap[filter] || ('Group ' + filter);
    todayList.innerHTML = '';
    if (filtered.length) {
      var byDate = {};
      filtered.forEach(function(f) {
        var d = formatDate(f.kickoff) || 'TBD';
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(f);
      });
      Object.keys(byDate).forEach(function(date) {
        var dh = document.createElement('div');
        dh.className = 'fixture-date-header';
        dh.textContent = date;
        todayList.appendChild(dh);
        byDate[date].forEach(function(f) { todayList.appendChild(buildFixtureCard(f)); });
      });
    } else {
      todayList.innerHTML = '<div class="live-empty">No fixtures match this filter</div>';
    }
    recentSection.style.display = 'none';
    return;
  }

  recentSection.style.display = '';
  if (todayLabel) todayLabel.textContent = 'Today';

  var todayFiltered = today.filter(matchesFilter);
  todayList.innerHTML = '';
  if (todayFiltered.length) {
    todayFiltered.slice().sort(function(a,b) {
      return (isLive(a)?0:isUpcoming(a)?1:2) - (isLive(b)?0:isUpcoming(b)?1:2);
    }).forEach(function(f) { todayList.appendChild(buildFixtureCard(f)); });
  } else {
    todayList.innerHTML = '<div class="live-empty">No fixtures today</div>';
  }

  var recentFiltered = recent.filter(matchesFilter);
  recentList.innerHTML = '';
  if (recentFiltered.length) {
    var byDate2 = {};
    recentFiltered.forEach(function(f) {
      var d = formatDate(f.kickoff);
      if (!byDate2[d]) byDate2[d] = [];
      byDate2[d].push(f);
    });
    Object.keys(byDate2).sort().reverse().forEach(function(date) {
      var hdr = document.createElement('div');
      hdr.className = 'fixture-date-header';
      hdr.textContent = date;
      recentList.appendChild(hdr);
      byDate2[date].forEach(function(f) { recentList.appendChild(buildFixtureCard(f)); });
    });
  } else {
    recentList.innerHTML = '<div class="live-empty">No recent results</div>';
  }
}

// ── Standings tab ────────────────────────────────────────────────────────────

function renderLiveStandings(fixtures) {
  // Fetch standings from the server — computed from team names, not API group_name field
  fetch('/api/standings').then(function(r) { return r.json(); }).then(function(data) {
    var grid = document.getElementById('live-groups-grid');
    grid.innerHTML = '';
    Object.keys(GROUPS).forEach(function(g, i) {
      var card = buildStandingsCardFromServer(g, data[g]);
      card.style.animationDelay = (i * 30) + 'ms';
      grid.appendChild(card);
    });
  }).catch(function(e) {
    document.getElementById('live-groups-grid').innerHTML =
      '<div class="live-empty">Could not load standings.</div>';
  });
}

function buildStandingsCardFromServer(g, data) {
  var card = document.createElement('div');
  card.className = 'group-card fade-up';
  var hdr = document.createElement('div');
  hdr.className = 'group-card-header';
  hdr.innerHTML = '<div class="group-letter">Group ' + g + '</div>';
  card.appendChild(hdr);

  var tbl = document.createElement('table');
  tbl.className = 'standings-table';
  tbl.innerHTML = '<thead><tr><th style="padding-left:.8rem">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>';
  var tbody = document.createElement('tbody');

  var teams = (data && data.teams) ? data.teams : GROUPS[g].teams.map(function(t,i) {
    return {name:t,pos:i+1,p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0};
  });

  teams.forEach(function(s, idx) {
    var tr = document.createElement('tr');
    tr.className = ['pos-1','pos-2','pos-3','pos-4'][idx] || '';
    tr.innerHTML =
      '<td><div class="team-cell"><span class="pos-indicator"></span>' +
      '<a href="/team/' + encodeURIComponent(s.name) + '" class="tp-standings-link">' +
      '<span style="font-size:.9rem;margin-right:.3rem">' + flag(s.name) + '</span>' +
      '<span style="font-size:.78rem">' + s.name + '</span>' +
      '</a></div></td>' +
      '<td>' + s.p + '</td><td>' + s.w + '</td><td>' + s.d + '</td><td>' + s.l + '</td>' +
      '<td>' + s.gd + '</td><td class="pts">' + s.pts + '</td>';
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  card.appendChild(tbl);
  return card;
}

/*
 * FIFA 2026 Article 13 — tiebreaker order for teams level on points:
 *  1. H2H points among tied teams
 *  2. H2H goal difference among tied teams
 *  3. H2H goals scored among tied teams
 *  4. Overall goal difference
 *  5. Overall goals scored
 *  6. Fair-play (not available in API response — skipped)
 *  7. Drawing of lots (alphabetical as proxy)
 */

function computeGroupStats(teams, playedFixtures) {
  var stats = {};
  teams.forEach(function(t) { stats[t] = {p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0}; });
  playedFixtures.forEach(function(f) {
    var hs = f.home_score, as_ = f.away_score, ht = f.home_team, at = f.away_team;
    if (hs == null || as_ == null) return;
    if (stats[ht]) { stats[ht].p++; stats[ht].gf += hs;  stats[ht].ga += as_; }
    if (stats[at]) { stats[at].p++; stats[at].gf += as_; stats[at].ga += hs;  }
    if (hs > as_)      { if (stats[ht]) { stats[ht].w++; stats[ht].pts += 3; } if (stats[at]) stats[at].l++; }
    else if (hs < as_) { if (stats[at]) { stats[at].w++; stats[at].pts += 3; } if (stats[ht]) stats[ht].l++; }
    else               { if (stats[ht]) { stats[ht].d++; stats[ht].pts++; }   if (stats[at]) { stats[at].d++; stats[at].pts++; } }
  });
  return stats;
}

function headToHeadStats(group, allFixtures) {
  var s = {};
  group.forEach(function(t) { s[t] = true; });
  var h2hFixtures = allFixtures.filter(function(f) { return s[f.home_team] && s[f.away_team]; });
  return computeGroupStats(group, h2hFixtures);
}

function fifaSort(teams, overallStats, allFixtures) {
  if (teams.length <= 1) return teams;
  // Initial sort by overall points
  var sorted = teams.slice().sort(function(a,b) { return overallStats[b].pts - overallStats[a].pts; });
  // Process equal-points blocks
  var result = [], i = 0;
  while (i < sorted.length) {
    var j = i + 1;
    while (j < sorted.length && overallStats[sorted[j]].pts === overallStats[sorted[i]].pts) j++;
    var block = sorted.slice(i, j);
    if (block.length > 1) block = applyArticle13(block, overallStats, allFixtures);
    result = result.concat(block);
    i = j;
  }
  return result;
}

function applyArticle13(group, overallStats, allFixtures) {
  var h2h = headToHeadStats(group, allFixtures);
  return group.slice().sort(function(a, b) {
    var ha = h2h[a] || {pts:0,gf:0,ga:0}, hb = h2h[b] || {pts:0,gf:0,ga:0};
    var oa = overallStats[a], ob = overallStats[b];
    return (hb.pts        - ha.pts)                     // 1. H2H pts
        || ((hb.gf-hb.ga) - (ha.gf-ha.ga))             // 2. H2H GD
        || (hb.gf          - ha.gf)                     // 3. H2H GF
        || ((ob.gf-ob.ga)  - (oa.gf-oa.ga))            // 4. Overall GD
        || (ob.gf          - oa.gf)                     // 5. Overall GF
        || a.localeCompare(b);                           // 7. Alphabetical
  });
}

function buildStandingsCard(g, fixtures) {
  var card = document.createElement('div');
  card.className = 'group-card fade-up';
  var hdr = document.createElement('div');
  hdr.className = 'group-card-header';
  hdr.innerHTML = '<div class="group-letter">Group ' + g + '</div>';
  card.appendChild(hdr);

  var teams  = GROUPS[g].teams.slice();
  var played = fixtures.filter(isFinished);
  var stats  = computeGroupStats(teams, played);
  var sorted = fifaSort(teams, stats, played);

  var tbl = document.createElement('table');
  tbl.className = 'standings-table';
  tbl.innerHTML = '<thead><tr><th style="padding-left:.8rem">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>';
  var tbody = document.createElement('tbody');
  sorted.forEach(function(team, idx) {
    var s = stats[team];
    var tr = document.createElement('tr');
    tr.className = ['pos-1','pos-2','pos-3','pos-4'][idx] || '';
    tr.innerHTML =
      '<td><div class="team-cell"><span class="pos-indicator"></span>' +
      '<span style="font-size:.9rem;margin-right:.3rem">' + flag(team) + '</span>' +
      '<span style="font-size:.78rem">' + team + '</span></div></td>' +
      '<td>' + s.p + '</td><td>' + s.w + '</td><td>' + s.d + '</td><td>' + s.l + '</td>' +
      '<td>' + (s.gf-s.ga) + '</td><td class="pts">' + s.pts + '</td>';
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  card.appendChild(tbl);
  return card;
}

// ── Past fixtures tab ─────────────────────────────────────────────────────────

// Wire past filter on DOMContentLoaded (already done for live filter above,
// but adding here explicitly for past tab)
document.addEventListener('DOMContentLoaded', function() {
  var pf = document.getElementById('past-group-filter');
  if (pf) pf.addEventListener('change', function() { renderPastFixtures(_allFixtures); });
});

function renderPastFixtures(fixtures) {
  var list   = document.getElementById('past-list');
  var sel    = document.getElementById('past-group-filter');
  var filter = sel ? sel.value : '';

  var past = fixtures.filter(function(f) {
    if (!isFinished(f)) return false;
    if (!filter) return true;                              // "All groups" — show everything
    if (filter === 'knockout') return !f.group_name;       // knockout fixtures have no group_name
    return f.group_name === 'Group ' + filter;            // e.g. filter="A" → "Group A"
  });

  past.sort(function(a, b) {
    return new Date(b.kickoff) - new Date(a.kickoff);  // newest first
  });

  list.innerHTML = '';
  if (!past.length) {
    list.innerHTML = '<div class="live-empty">No completed fixtures' + (filter ? ' in this group' : '') + '</div>';
    return;
  }

  // Group by date
  var byDate = {};
  past.forEach(function(f) {
    var d = formatDate(f.kickoff);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(f);
  });

  Object.keys(byDate).forEach(function(date) {
    var hdr = document.createElement('div');
    hdr.className = 'fixture-date-header';
    hdr.textContent = date;
    list.appendChild(hdr);
    byDate[date].forEach(function(f) { list.appendChild(buildFixtureCard(f)); });
  });
}

// ── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  initShareBar();
  if (!CAN_EDIT) {
    insertViewonlyBanner();
    // View-only: all tabs browsable, no glow/lock flow
    document.getElementById('nav-best-third').classList.remove('locked');
    document.getElementById('nav-best-third').disabled = false;
    document.getElementById('nav-knockout').classList.remove('locked');
    document.getElementById('nav-knockout').disabled = false;
    document.querySelectorAll('.nav-lock-icon').forEach(function(el){el.style.display='none';});
    document.querySelectorAll('.nav-icon').forEach(function(el){el.style.display='block';});
    // Hide tooltips
    document.querySelectorAll('.nav-tooltip').forEach(function(el){el.style.display='none';});
    // Hide save bars
    var bars = document.querySelectorAll('.proceed-bar');
    bars.forEach(function(b){b.style.display='none';});
  }
  loadSession();
});
