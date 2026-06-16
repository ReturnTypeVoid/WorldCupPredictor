/* team.js — Team profile page */

var FINISHED = ['FT','AET','PEN','AWD','WO'];
var LIVE     = ['1H','2H','HT','ET','BT','P','SUSP','INT','LIVE'];

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

function fmt(d) {
  if (!d) return '';
  var dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString([], {weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
}

function isFinished(s) { return FINISHED.indexOf(s) >= 0; }
function isLive(s)     { return LIVE.indexOf(s) >= 0; }

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
  html += '<div class="tp-title">' + flag(TEAM_NAME) + ' ' + TEAM_NAME + '</div>';
  if (group) html += '<div class="tp-group">Group ' + group + '</div>';
  html += '</div>';

  // Group standing mini-table
  if (standing.length) {
    html += '<section class="tp-section"><h3 class="tp-section-title">Group ' + group + ' Standings</h3>';
    html += '<table class="tp-standings"><thead><tr><th></th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>';
    standing.forEach(function(s) {
      var cls = s.is_this_team ? ' tp-this-team' : '';
      html += '<tr class="' + cls + '">';
      html += '<td class="tp-pos">' + s.pos + '</td>';
      html += '<td><span class="tp-flag">' + flag(s.name) + '</span>' + s.name + '</td>';
      html += '<td>' + s.p + '</td><td>' + s.w + '</td><td>' + s.d + '</td><td>' + s.l + '</td>';
      html += '<td>' + s.gd + '</td><td class="tp-pts">' + s.pts + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></section>';
  }

  // Live matches
  if (live.length) {
    html += '<section class="tp-section"><h3 class="tp-section-title"><span class="live-pulse-dot"></span> Live</h3>';
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

  // Wire fixture card clicks
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

  var score = fin ? (hs + ' – ' + as_) :
              liv  ? (hs + ' – ' + as_) :
              (f.kickoff ? new Date(f.kickoff).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : 'TBD');

  var badge = liv  ? '<span class="fp-badge fp-live">LIVE</span>' :
              fin  ? '<span class="fp-badge fp-ft">FT</span>' : '';

  return '<div class="tp-fixture-card' + (isThis ? ' tp-ours' : '') + '" data-id="' + f.external_id + '">' +
    '<div class="tp-fx-teams">' +
      '<span class="tp-fx-team' + (homeWin ? ' tp-winner' : '') + '">' + flag(home) + ' ' + home + '</span>' +
      '<span class="tp-fx-score' + (liv ? ' tp-score-live' : '') + '">' + score + '</span>' +
      '<span class="tp-fx-team tp-fx-away' + (awayWin ? ' tp-winner' : '') + '">' + flag(away) + ' ' + away + '</span>' +
    '</div>' +
    '<div class="tp-fx-meta">' + badge + (f.round || f.group_name || '') + ' · ' + fmt(f.kickoff) + '</div>' +
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
  modalContent.innerHTML = '<div class="groups-loading"><div class="spinner"></div><p>Loading…</p></div>';
  fetch('/api/fixture/' + id)
    .then(function(r) { return r.json(); })
    .then(renderFixtureDetail)
    .catch(function() {
      modalContent.innerHTML = '<p style="color:var(--text-3);padding:2rem">Failed to load match details.</p>';
    });
}

function closeModal() {
  modal.classList.remove('open');
}

function renderFixtureDetail(data) {
  var f     = data.fixture || {};
  var evs   = data.events  || [];
  var lups  = data.lineups || [];
  var stats = data.statistics || [];

  var fin  = isFinished(f.status);
  var liv  = isLive(f.status);
  var home = f.home_team, away = f.away_team;

  var html = '<div class="fd-header">';
  html += '<div class="fd-teams">';
  html += '<div class="fd-team fd-home">' + flag(home) + '<span>' + home + '</span></div>';
  html += '<div class="fd-score' + (liv ? ' fd-score-live' : '') + '">';
  if (fin || liv) html += f.home_score + ' – ' + f.away_score;
  else html += new Date(f.kickoff).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  html += '</div>';
  html += '<div class="fd-team fd-away">' + flag(away) + '<span>' + away + '</span></div>';
  html += '</div>';
  html += '<div class="fd-meta">' + (f.round || '') + ' · ' + fmt(f.kickoff) + (f.status ? ' · ' + f.status : '') + '</div>';
  html += '</div>';

  // Timeline of events
  if (evs.length) {
    html += '<div class="fd-timeline">';
    evs.forEach(function(ev) {
      var type   = (ev.type || '').toLowerCase();
      var detail = (ev.detail || '').toLowerCase();
      var min    = ev.time ? (ev.time.elapsed + (ev.time.extra ? '+' + ev.time.extra : '') + "'") : '';
      var player = (ev.player && ev.player.name) ? ev.player.name : '';
      var assist = (ev.assist && ev.assist.name) ? ev.assist.name : '';
      var evTeam = ev.team ? ev.team.name : '';
      var isHome = evTeam === home;

      var icon = '•';
      var cls  = 'fd-ev';
      if (type === 'goal') {
        icon = detail.includes('own') ? '⚽️ OG' : detail.includes('pen') ? '⚽️ P' : '⚽️';
        cls += ' fd-ev-goal';
      } else if (type === 'card') {
        if (detail.includes('yellow red') || detail.includes('second yellow')) { icon = '🟨🟥'; cls += ' fd-ev-card'; }
        else if (detail.includes('red'))    { icon = '🟥'; cls += ' fd-ev-card'; }
        else                                { icon = '🟨'; cls += ' fd-ev-card'; }
      } else if (type === 'subst') {
        icon = '🔄'; cls += ' fd-ev-sub';
      } else if (type === 'var') {
        icon = '📺'; cls += ' fd-ev-var';
      }

      html += '<div class="' + cls + (isHome ? ' fd-ev-home' : ' fd-ev-away') + '">';
      html += '<span class="fd-ev-min">' + min + '</span>';
      html += '<span class="fd-ev-icon">' + icon + '</span>';
      html += '<span class="fd-ev-player">' + player;
      if (assist && type === 'goal') html += ' <span class="fd-ev-assist">(assist: ' + assist + ')</span>';
      html += '</span>';
      html += '<span class="fd-ev-team">' + evTeam + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  // Lineups
  if (lups.length === 2) {
    html += '<div class="fd-lineups">';
    lups.forEach(function(side) {
      var tname = side.team ? side.team.name : '';
      var form  = side.formation || '';
      html += '<div class="fd-lineup-col">';
      html += '<div class="fd-lineup-title">' + flag(tname) + ' ' + tname + (form ? ' · ' + form : '') + '</div>';
      html += '<div class="fd-lineup-list">';
      (side.startXI || []).forEach(function(p) {
        var pl = p.player || {};
        html += '<div class="fd-player fd-starter">' +
          '<span class="fd-shirt">' + (pl.number || '') + '</span>' +
          '<span class="fd-pname">' + (pl.name || '') + '</span>' +
          '<span class="fd-ppos">' + (pl.pos || '') + '</span>' +
          '</div>';
      });
      if ((side.substitutes || []).length) {
        html += '<div class="fd-lineup-sub-title">Substitutes</div>';
        (side.substitutes || []).forEach(function(p) {
          var pl = p.player || {};
          html += '<div class="fd-player fd-sub">' +
            '<span class="fd-shirt">' + (pl.number || '') + '</span>' +
            '<span class="fd-pname">' + (pl.name || '') + '</span>' +
            '</div>';
        });
      }
      html += '</div></div>';
    });
    html += '</div>';
  }

  // Match statistics (shots, possession, etc.)
  if (stats.length === 2) {
    var homeStats = stats[0], awayStats = stats[1];
    var homeStatMap = {}, awayStatMap = {};
    (homeStats.statistics || []).forEach(function(s) { homeStatMap[s.type] = s.value; });
    (awayStats.statistics || []).forEach(function(s) { awayStatMap[s.type] = s.value; });

    var keys = ['Ball Possession','Total Shots','Shots on Goal','Corner Kicks',
                'Fouls','Yellow Cards','Red Cards','Offsides'];
    html += '<div class="fd-stats">';
    html += '<div class="fd-stats-title">Match Statistics</div>';
    keys.forEach(function(k) {
      var hv = homeStatMap[k] !== undefined ? homeStatMap[k] : '—';
      var av = awayStatMap[k] !== undefined ? awayStatMap[k] : '—';
      if (hv === null) hv = 0;
      if (av === null) av = 0;
      // Build a visual bar for percentage stats
      var bar = '';
      if (typeof hv === 'string' && hv.endsWith('%') && typeof av === 'string' && av.endsWith('%')) {
        var hp = parseInt(hv);
        bar = '<div class="fd-stat-bar"><div class="fd-stat-bar-home" style="width:' + hp + '%"></div></div>';
      }
      html += '<div class="fd-stat-row">';
      html += '<span class="fd-stat-val fd-stat-home">' + hv + '</span>';
      html += '<span class="fd-stat-key">' + k + (bar ? bar : '') + '</span>';
      html += '<span class="fd-stat-val fd-stat-away">' + av + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  if (!evs.length && !lups.length && !stats.length) {
    html += '<p class="fd-no-data">Detailed match data not yet available.</p>';
  }

  modalContent.innerHTML = html;
}
