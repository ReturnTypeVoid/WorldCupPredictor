/* team.js — Team profile page */

var FINISHED = ['FT','AET','PEN','AWD','WO'];
var LIVE     = ['1H','2H','HT','ET','BT','P','SUSP','INT','LIVE'];

var TEAM_NAME = JSON.parse(document.getElementById('team-name-data').textContent);

var FLAGS = {
  'Mexico':'🇲🇽','South Korea':'🇰🇷','South Africa':'🇿🇦','Czechia':'🇨🇿',
  'Canada':'🇨🇦','Switzerland':'🇨🇭','Qatar':'🇶🇦','Bosnia and Herzegovina':'🇧🇦',
  'Brazil':'🇧🇷','Morocco':'🇲🇦','Scotland':'🏴󠁧󠁢󠁳󠁣󠁴󠁿','Haiti':'🇭🇹',
  'United States':'🇺🇸','Australia':'🇦🇺','Paraguay':'🇵🇾','Turkiye':'🇹🇷',
  'Germany':'🇩🇪','Ecuador':'🇪🇨','Ivory Coast':'🇨🇮','Curacao':'🇨🇼',
  'Netherlands':'🇳🇱','Japan':'🇯🇵','Tunisia':'🇹🇳','Sweden':'🇸🇪',
  'Belgium':'🇧🇪','Iran':'🇮🇷','Egypt':'🇪🇬','New Zealand':'🇳🇿',
  'Spain':'🇪🇸','Uruguay':'🇺🇾','Saudi Arabia':'🇸🇦','Cape Verde':'🇨🇻',
  'France':'🇫🇷','Senegal':'🇸🇳','Norway':'🇳🇴','Iraq':'🇮🇶',
  'Argentina':'🇦🇷','Austria':'🇦🇹','Algeria':'🇩🇿','Jordan':'🇯🇴',
  'Portugal':'🇵🇹','Colombia':'🇨🇴','Uzbekistan':'🇺🇿','DR Congo':'🇨🇩',
  'England':'🏴󠁧󠁢󠁥󠁮󠁧󠁿','Croatia':'🇭🇷','Panama':'🇵🇦','Ghana':'🇬🇭',
};

function flag(t) { return FLAGS[t] || '🏳️'; }

function fmtDate(d) {
  if (!d) return '';
  var dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString([], {weekday:'short', day:'numeric', month:'short'});
}
function fmtTime(d) {
  if (!d) return '';
  var dt = new Date(d);
  return isNaN(dt) ? '' : dt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}

function isFinished(s) { return FINISHED.indexOf(s) >= 0; }
function isLive(s)     { return LIVE.indexOf(s) >= 0; }

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Load team data ────────────────────────────────────────────────────────────

fetch('/api/team/' + encodeURIComponent(TEAM_NAME))
  .then(function(r) { return r.json(); })
  .then(renderTeam)
  .catch(function() {
    document.getElementById('team-content').innerHTML =
      '<p style="color:var(--text-3);padding:2rem">Failed to load team data.</p>';
  });

function renderTeam(data) {
  var fixtures = data.fixtures || [];
  var standing = data.group_standing || [];
  var group    = data.group || '';

  var past     = fixtures.filter(function(f) { return isFinished(f.status); });
  var live     = fixtures.filter(function(f) { return isLive(f.status); });
  var upcoming = fixtures.filter(function(f) { return !isFinished(f.status) && !isLive(f.status); });

  var html = '<div class="tp-header">';
  html += '<a class="tp-back" href="javascript:history.back()">← Back</a>';
  html += '<div class="tp-title"><span class="tp-flag-lg">' + flag(TEAM_NAME) + '</span>' + esc(TEAM_NAME) + '</div>';
  if (group) html += '<span class="tp-group-badge">Group ' + esc(group) + '</span>';
  html += '</div>';

  // Group standing table
  if (standing.length) {
    html += '<section class="tp-section">';
    html += '<h3 class="tp-section-title">Group ' + esc(group) + ' Standings</h3>';
    html += '<div class="tp-standings-wrap"><table class="tp-standings">';
    html += '<thead><tr><th></th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>';
    html += '<tbody>';
    standing.forEach(function(s, i) {
      var thisCls  = s.is_this_team ? ' tp-this-team' : '';
      var qualCls  = i < 2 ? ' tp-qualify' : (i === 2 ? ' tp-qualify-3' : '');
      html += '<tr class="' + thisCls + qualCls + '">';
      html += '<td class="tp-pos">' + s.pos + '</td>';
      html += '<td><div class="tp-team-cell"><span class="tp-flag">' + flag(s.name) + '</span>'
            + '<span class="tp-team-name">' + esc(s.name) + '</span></div></td>';
      html += '<td>' + s.p + '</td><td>' + s.w + '</td><td>' + s.d + '</td><td>' + s.l + '</td>';
      html += '<td>' + (s.gd > 0 ? '+' : '') + s.gd + '</td>';
      html += '<td class="tp-pts">' + s.pts + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    html += '</section>';
  }

  // Live matches
  if (live.length) {
    html += '<section class="tp-section"><h3 class="tp-section-title">🔴 Live Now</h3>';
    html += '<div class="tp-fixtures">' + live.map(fixtureCard).join('') + '</div></section>';
  }

  // Upcoming
  if (upcoming.length) {
    html += '<section class="tp-section"><h3 class="tp-section-title">Upcoming</h3>';
    html += '<div class="tp-fixtures">' + upcoming.map(fixtureCard).join('') + '</div></section>';
  }

  // Past results
  if (past.length) {
    html += '<section class="tp-section"><h3 class="tp-section-title">Results</h3>';
    html += '<div class="tp-fixtures">' + past.slice().reverse().map(fixtureCard).join('') + '</div></section>';
  }

  document.getElementById('team-content').innerHTML = html;

  document.querySelectorAll('.tp-fixture-card[data-id]').forEach(function(el) {
    el.addEventListener('click', function() {
      openFixture(this.getAttribute('data-id'));
    });
  });
}

function fixtureCard(f) {
  var home    = f.home_team, away = f.away_team;
  var hs      = f.home_score, as_ = f.away_score;
  var fin     = isFinished(f.status);
  var liv     = isLive(f.status);
  var homeWin = fin && hs > as_;
  var awayWin = fin && as_ > hs;
  var isThis  = (home === TEAM_NAME || away === TEAM_NAME);
  var clickable = !!f.external_id;

  var scoreStr = fin ? (hs + ' – ' + as_) :
                 liv  ? (hs + ' – ' + as_) :
                 (f.kickoff ? fmtTime(f.kickoff) : 'TBD');

  var badge = liv ? '<span class="fp-badge fp-live">Live</span>' :
              fin ? '<span class="fp-badge fp-ft">FT</span>'     : '';

  var clickHint = clickable && fin ? '<span class="tp-click-hint">View stats →</span>' : '';

  return '<div class="tp-fixture-card' +
    (isThis  ? ' tp-ours'  : '') +
    (liv     ? ' tp-live'  : '') +
    '" ' + (clickable ? 'data-id="' + f.external_id + '"' : '') + '>' +

    '<div class="tp-fx-teams">' +
      '<span class="tp-fx-team' + (homeWin ? ' tp-winner' : '') + '">' +
        flag(home) + ' <span>' + esc(home) + '</span></span>' +
      '<span class="tp-fx-score' + (liv ? ' tp-score-live' : '') + '">' + scoreStr + '</span>' +
      '<span class="tp-fx-team tp-fx-away' + (awayWin ? ' tp-winner' : '') + '">' +
        '<span>' + esc(away) + '</span> ' + flag(away) + '</span>' +
    '</div>' +

    '<div class="tp-fx-meta">' +
      badge +
      '<span>' + esc(f.round || f.group_name || '') + '</span>' +
      (f.kickoff ? '<span class="tp-fx-meta-sep">·</span><span>' + fmtDate(f.kickoff) + '</span>' : '') +
      clickHint +
    '</div>' +
    '</div>';
}

// ── Fixture detail modal ──────────────────────────────────────────────────────

var modal        = document.getElementById('fixture-modal');
var modalContent = document.getElementById('fixture-modal-content');

document.getElementById('modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });

function openFixture(id) {
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  modalContent.innerHTML = '<div class="groups-loading"><div class="spinner"></div><p>Loading match data…</p></div>';
  fetch('/api/fixture/' + id)
    .then(function(r) { return r.json(); })
    .then(renderFixtureDetail)
    .catch(function() {
      modalContent.innerHTML = '<p style="color:var(--text-3);padding:2rem;text-align:center">Failed to load match details.</p>';
    });
}

function closeModal() {
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

// ── Render fixture detail ─────────────────────────────────────────────────────

function renderFixtureDetail(data) {
  var f     = data.fixture    || {};
  var evs   = data.events     || [];
  var lups  = data.lineups    || [];
  var stats = data.statistics || [];

  var fin  = isFinished(f.status);
  var liv  = isLive(f.status);
  var home = f.home_team || '';
  var away = f.away_team || '';

  // ── Header ────────────────────────────────────────────────────────────────
  var statusBadge = liv
    ? '<span class="fd-status-badge fd-status-live">Live · ' + f.status + '</span>'
    : fin
      ? '<span class="fd-status-badge fd-status-ft">Full Time</span>'
      : '';

  var scoreHtml;
  if (fin || liv) {
    scoreHtml = '<div class="fd-score' + (liv ? ' fd-score-live' : '') + '">'
              + f.home_score + ' – ' + f.away_score + '</div>';
  } else {
    scoreHtml = '<div class="fd-score-time">' + fmtTime(f.kickoff) + '</div>';
  }

  var html = '<div class="fd-header">';
  html += '<div class="fd-teams">';
  html += '<div class="fd-team fd-home">'
        + '<span class="fd-team-flag">' + flag(home) + '</span>'
        + '<span class="fd-team-name">' + esc(home) + '</span>'
        + '</div>';
  html += '<div class="fd-score-block">' + scoreHtml + '</div>';
  html += '<div class="fd-team fd-away">'
        + '<span class="fd-team-flag">' + flag(away) + '</span>'
        + '<span class="fd-team-name">' + esc(away) + '</span>'
        + '</div>';
  html += '</div>';
  html += '<div class="fd-meta">'
        + statusBadge
        + '<span>' + esc(f.round || '') + '</span>'
        + (f.kickoff ? '<span>·</span><span>' + fmtDate(f.kickoff) + '</span>' : '')
        + '</div>';
  html += '</div>';

  html += '<div class="fd-body">';

  var hasData = evs.length || lups.length || stats.length;
  if (!hasData) {
    html += '<div class="fd-no-data">Detailed match data not yet available.</div>';
    html += '</div>';
    modalContent.innerHTML = html;
    return;
  }

  // ── Match Timeline ────────────────────────────────────────────────────────
  // Filter to goals and cards only (exclude subs for cleanliness, unless wanted)
  var keyEvs   = evs.filter(function(e) { return e.type === 'Goal' || e.type === 'Card'; });
  var allEvs   = evs; // full list with subs

  if (allEvs.length) {
    html += '<div class="fd-block">';
    html += '<div class="fd-block-title">Match Timeline</div>';
    html += '<div class="fd-timeline-wrap">';
    html += '<div class="fd-timeline-line"></div>';

    // Kickoff marker
    html += '<div class="fd-period-label"><span>Kick Off</span></div>';

    var inET = false;
    allEvs.forEach(function(ev) {
      var type   = (ev.type   || '').toLowerCase();
      var detail = (ev.detail || '').toLowerCase();
      var min    = ev.time ? ev.time.elapsed : 0;
      var extra  = ev.time ? ev.time.extra   : null;
      var minStr = min + (extra ? '+' + extra : '') + "'";
      var player = ev.player && ev.player.name ? esc(ev.player.name) : '';
      var assist = ev.assist && ev.assist.name ? esc(ev.assist.name) : '';
      var evTeam = ev.team ? ev.team.name : '';
      var isHome = evTeam === home;

      // Insert HT marker between 45 and 46
      if (!inET && min >= 46 && allEvs[allEvs.indexOf(ev) - 1] && allEvs[allEvs.indexOf(ev) - 1].time.elapsed <= 45) {
        html += '<div class="fd-period-label"><span>Half Time</span></div>';
        inET = true;
      }

      var icon, evCls, detailText;

      if (type === 'goal') {
        var isOG  = detail.includes('own');
        var isPen = detail.includes('pen');
        icon      = isOG ? '⚽ OG' : isPen ? '⚽ P' : '⚽';
        evCls     = 'fd-ev-goal';
        detailText = assist ? 'Assist: ' + assist : '';
      } else if (type === 'card') {
        if (detail.includes('yellow red') || detail.includes('second yellow')) {
          icon = '🟨🟥'; evCls = 'fd-ev-red'; detailText = 'Second Yellow';
        } else if (detail.includes('red')) {
          icon = '🟥'; evCls = 'fd-ev-red'; detailText = 'Red Card';
        } else {
          icon = '🟨'; evCls = 'fd-ev-yellow'; detailText = 'Yellow Card';
        }
      } else if (type === 'subst') {
        icon = '🔄'; evCls = 'fd-ev-sub';
        detailText = assist ? '↑ ' + assist : '';
      } else {
        icon = '•'; evCls = ''; detailText = '';
      }

      var contentHtml = '<div class="fd-ev-player">' + player + '</div>'
                      + (detailText ? '<div class="fd-ev-detail">' + detailText + '</div>' : '');

      html += '<div class="fd-ev ' + evCls + '">';
      if (isHome) {
        html += '<div class="fd-ev-left">' + contentHtml + '</div>';
      } else {
        html += '<div class="fd-ev-empty"></div>';
      }
      html += '<div class="fd-ev-min-wrap">'
            + '<div class="fd-ev-icon">' + icon + '</div>'
            + '<div class="fd-ev-min">' + minStr + '</div>'
            + '</div>';
      if (!isHome) {
        html += '<div class="fd-ev-right">' + contentHtml + '</div>';
      } else {
        html += '<div class="fd-ev-empty"></div>';
      }
      html += '</div>';
    });

    html += '<div class="fd-period-label"><span>Full Time</span></div>';
    html += '</div></div>'; // timeline-wrap, fd-block
  }

  // ── Lineups ───────────────────────────────────────────────────────────────
  if (lups.length >= 1) {
    html += '<div class="fd-block">';
    html += '<div class="fd-block-title">Line-ups</div>';
    html += '<div class="fd-lineups">';

    lups.forEach(function(side) {
      var tname = side.team ? side.team.name : '';
      var form  = side.formation || '';
      var coach = side.coach     ? side.coach.name : '';

      html += '<div class="fd-lineup-col">';
      html += '<div class="fd-lineup-header">';
      html += '<div class="fd-lineup-team">'
            + flag(tname) + ' <strong>' + esc(tname) + '</strong></div>';
      html += '<div class="fd-lineup-info">'
            + (form ? '<span class="fd-lineup-formation">' + esc(form) + '</span>' : '')
            + (coach ? (form ? ' · ' : '') + esc(coach) : '')
            + '</div>';
      html += '</div>';

      html += '<span class="fd-starter-label">Starting XI</span>';
      html += '<div class="fd-lineup-starters">';
      (side.startXI || []).forEach(function(p) {
        var pl  = p.player || {};
        var pos = pl.pos || '';
        html += '<div class="fd-player">'
              + '<span class="fd-shirt">' + (pl.number || '') + '</span>'
              + '<span class="fd-pname">' + esc(pl.name || '') + '</span>'
              + '<span class="fd-ppos fd-pos-' + pos + '">' + pos + '</span>'
              + '</div>';
      });
      html += '</div>';

      if ((side.substitutes || []).length) {
        html += '<span class="fd-sub-label">Substitutes</span>';
        (side.substitutes || []).forEach(function(p) {
          var pl  = p.player || {};
          var pos = pl.pos || '';
          html += '<div class="fd-player fd-sub">'
                + '<span class="fd-shirt">' + (pl.number || '') + '</span>'
                + '<span class="fd-pname">' + esc(pl.name || '') + '</span>'
                + '<span class="fd-ppos fd-pos-' + pos + '">' + pos + '</span>'
                + '</div>';
        });
      }

      html += '</div>'; // fd-lineup-col
    });

    html += '</div></div>'; // fd-lineups, fd-block
  }

  // ── Match Statistics ──────────────────────────────────────────────────────
  if (stats.length >= 2) {
    var homeName  = stats[0].team ? stats[0].team.name : home;
    var awayName  = stats[1].team ? stats[1].team.name : away;
    var homeMap   = {}, awayMap = {};
    (stats[0].statistics || []).forEach(function(s) { homeMap[s.type] = s.value; });
    (stats[1].statistics || []).forEach(function(s) { awayMap[s.type] = s.value; });

    var statKeys = [
      'Ball Possession', 'Total Shots', 'Shots on Goal', 'Shots off Goal',
      'Blocked Shots', 'Corner Kicks', 'Fouls', 'Yellow Cards', 'Red Cards',
      'Offsides', 'Total passes', 'Passes %'
    ];

    html += '<div class="fd-block">';
    html += '<div class="fd-block-title">Match Statistics</div>';
    html += '<div class="fd-stats-grid">';

    // Legend row
    html += '<div class="fd-stat-teams-legend">'
          + '<div class="fd-legend-home">' + flag(homeName) + ' ' + esc(homeName) + '</div>'
          + '<div class="fd-legend-away">' + flag(awayName) + ' ' + esc(awayName) + '</div>'
          + '</div>';

    statKeys.forEach(function(k) {
      var hv = homeMap[k];
      var av = awayMap[k];
      if (hv === undefined && av === undefined) return;
      if (hv === null) hv = 0;
      if (av === null) av = 0;

      var hvDisp = hv !== undefined ? hv : '—';
      var avDisp = av !== undefined ? av : '—';

      // Bar widths
      var hPct = 50, aPct = 50;
      if (typeof hv === 'string' && hv.endsWith('%')) {
        hPct = parseInt(hv) || 0;
        aPct = 100 - hPct;
      } else {
        var hNum = parseFloat(hv) || 0;
        var aNum = parseFloat(av) || 0;
        var tot  = hNum + aNum;
        if (tot > 0) { hPct = Math.round(hNum / tot * 100); aPct = 100 - hPct; }
      }

      html += '<div class="fd-stat-row">';
      html += '<span class="fd-stat-val fd-stat-home">' + hvDisp + '</span>';
      html += '<div class="fd-stat-mid">'
            + '<span class="fd-stat-key">' + esc(k) + '</span>'
            + '<div class="fd-stat-bar-wrap">'
            + '<div class="fd-stat-bar-home" style="width:' + hPct + '%"></div>'
            + '<div class="fd-stat-bar-away" style="width:' + aPct + '%"></div>'
            + '</div>'
            + '</div>';
      html += '<span class="fd-stat-val fd-stat-away">' + avDisp + '</span>';
      html += '</div>';
    });

    html += '</div></div>'; // fd-stats-grid, fd-block
  }

  html += '</div>'; // fd-body
  modalContent.innerHTML = html;
}
