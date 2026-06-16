"""
app/blueprints/api.py — Public JSON API for bracket predictions.

All state-changing endpoints require the edit_code (10-char alphanumeric).
The code is accepted via:
  • JSON body field   "edit_code"
  • HTTP header       X-Edit-Code
  • Query param       ?code=

Compared using hmac.compare_digest() to prevent timing attacks.
"""

import hmac
import logging
import secrets
import re
import string

from flask import Blueprint, request, jsonify, g

from app.db import db_connection
from app.naming import generate_slug
from app.rate_limit import check_api_rate_limit


def _serialise(row):
    """Convert a psycopg2 RealDictRow to a plain dict, stringifying datetimes."""
    import datetime
    d = {}
    for k, v in dict(row).items():
        if isinstance(v, (datetime.datetime, datetime.date)):
            d[k] = v.isoformat()
        else:
            d[k] = v
    return d

log = logging.getLogger(__name__)

api_bp = Blueprint("api", __name__, url_prefix="/api")

# ── Valid team names ──────────────────────────────────────────────────────────

TEAMS = {
    "Mexico", "South Korea", "South Africa", "Czechia",
    "Canada", "Switzerland", "Qatar", "Bosnia and Herzegovina",
    "Brazil", "Morocco", "Scotland", "Haiti",
    "United States", "Australia", "Paraguay", "Turkiye",
    "Germany", "Ecuador", "Ivory Coast", "Curacao",
    "Netherlands", "Japan", "Tunisia", "Sweden",
    "Belgium", "Iran", "Egypt", "New Zealand",
    "Spain", "Uruguay", "Saudi Arabia", "Cape Verde",
    "France", "Senegal", "Norway", "Iraq",
    "Argentina", "Austria", "Algeria", "Jordan",
    "Portugal", "Colombia", "Uzbekistan", "DR Congo",
    "England", "Croatia", "Panama", "Ghana",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def _generate_edit_code():
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(10))


def _get_edit_code():
    data = request.get_json(silent=True) or {}
    return (
        data.get("edit_code")
        or request.headers.get("X-Edit-Code")
        or request.args.get("code")
        or ""
    )


def _verify_edit_code(session, code):
    if not code:
        return False
    return hmac.compare_digest(
        session["edit_code"].encode(), code.strip().upper().encode()
    )


def _get_session_or_404(slug):
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM prediction_sessions WHERE slug = %s", (slug,)
            )
            return cur.fetchone()


def _rate_limit_or_abort(key, max_req=60, window=60):
    ip = request.headers.get("X-Real-IP") or request.remote_addr or ""
    if not check_api_rate_limit(ip, key, max_req, window):
        return jsonify(error="Rate limit exceeded"), 429
    return None


# ── Session management ────────────────────────────────────────────────────────

@api_bp.post("/sessions")
def create_session():
    err = _rate_limit_or_abort("create", max_req=20, window=60)
    if err:
        return err

    slug      = generate_slug()
    edit_code = _generate_edit_code()

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO prediction_sessions(slug, edit_code) VALUES(%s, %s)",
                (slug, edit_code),
            )
        conn.commit()

    return jsonify(slug=slug, edit_code=edit_code), 201


@api_bp.get("/session/<slug>")
def get_session(slug):
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM prediction_sessions WHERE slug = %s", (slug,)
            )
            session = cur.fetchone()
        if not session:
            return jsonify(error="Not found"), 404

        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM group_picks WHERE session_id = %s ORDER BY group_letter, position",
                (session["id"],),
            )
            group_picks = cur.fetchall()

        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM match_picks WHERE session_id = %s ORDER BY match_num",
                (session["id"],),
            )
            match_picks = cur.fetchall()

        with conn.cursor() as cur:
            cur.execute(
                "SELECT team_name FROM third_picks WHERE session_id = %s",
                (session["id"],),
            )
            third_picks = cur.fetchall()

    return jsonify(
        slug=session["slug"],
        display_name=session["display_name"],
        group_picks=[_serialise(r) for r in group_picks],
        match_picks=[_serialise(r) for r in match_picks],
        third_picks=[r["team_name"] for r in third_picks],
    )


@api_bp.post("/session/<slug>/name")
def set_session_name(slug):
    err = _rate_limit_or_abort("name")
    if err:
        return err

    session = _get_session_or_404(slug)
    if not session:
        return jsonify(error="Not found"), 404

    code = _get_edit_code()
    if not _verify_edit_code(session, code):
        return jsonify(error="Invalid edit code"), 403

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()[:80] or None

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE prediction_sessions SET display_name = %s WHERE id = %s",
                (name, session["id"]),
            )
        conn.commit()

    return jsonify(ok=True, display_name=name)


# ── Group picks ───────────────────────────────────────────────────────────────

@api_bp.post("/session/<slug>/group-order")
def set_group_order(slug):
    err = _rate_limit_or_abort("picks")
    if err:
        return err

    session = _get_session_or_404(slug)
    if not session:
        return jsonify(error="Not found"), 404

    code = _get_edit_code()
    if not _verify_edit_code(session, code):
        return jsonify(error="Invalid edit code"), 403

    data         = request.get_json(silent=True) or {}
    group_letter = (data.get("group") or "").upper().strip()
    teams        = data.get("teams", [])

    if group_letter not in list("ABCDEFGHIJKL"):
        return jsonify(error="Invalid group"), 400
    if not isinstance(teams, list) or len(teams) != 4:
        return jsonify(error="Must supply exactly 4 teams"), 400
    for t in teams:
        if t not in TEAMS:
            return jsonify(error=f"Unknown team: {t!r}"), 400

    with db_connection() as conn:
        with conn.cursor() as cur:
            for pos, team in enumerate(teams, start=1):
                cur.execute(
                    """INSERT INTO group_picks(session_id, group_letter, position, team_name)
                       VALUES(%s, %s, %s, %s)
                       ON CONFLICT(session_id, group_letter, position)
                       DO UPDATE SET team_name = EXCLUDED.team_name""",
                    (session["id"], group_letter, pos, team),
                )
        conn.commit()

    return jsonify(ok=True)


# ── Match picks ───────────────────────────────────────────────────────────────

@api_bp.post("/session/<slug>/match-pick")
def set_match_pick(slug):
    err = _rate_limit_or_abort("picks")
    if err:
        return err

    session = _get_session_or_404(slug)
    if not session:
        return jsonify(error="Not found"), 404

    code = _get_edit_code()
    if not _verify_edit_code(session, code):
        return jsonify(error="Invalid edit code"), 403

    data      = request.get_json(silent=True) or {}
    match_num = data.get("match_num")
    winner    = (data.get("winner") or "").strip()

    if not isinstance(match_num, int) or match_num not in range(73, 105):
        return jsonify(error="Invalid match_num"), 400
    if winner and winner not in TEAMS:
        return jsonify(error=f"Unknown team: {winner!r}"), 400

    with db_connection() as conn:
        with conn.cursor() as cur:
            if winner:
                cur.execute(
                    """INSERT INTO match_picks(session_id, match_num, winner)
                       VALUES(%s, %s, %s)
                       ON CONFLICT(session_id, match_num)
                       DO UPDATE SET winner = EXCLUDED.winner""",
                    (session["id"], match_num, winner),
                )
            else:
                cur.execute(
                    "DELETE FROM match_picks WHERE session_id = %s AND match_num = %s",
                    (session["id"], match_num),
                )
        conn.commit()

    return jsonify(ok=True)


# ── Third picks ───────────────────────────────────────────────────────────────

@api_bp.post("/session/<slug>/third-picks")
def set_third_picks(slug):
    err = _rate_limit_or_abort("picks")
    if err:
        return err

    session = _get_session_or_404(slug)
    if not session:
        return jsonify(error="Not found"), 404

    code = _get_edit_code()
    if not _verify_edit_code(session, code):
        return jsonify(error="Invalid edit code"), 403

    data  = request.get_json(silent=True) or {}
    teams = data.get("teams", [])

    if not isinstance(teams, list) or len(teams) > 8:
        return jsonify(error="teams must be a list of up to 8"), 400
    for t in teams:
        if t not in TEAMS:
            return jsonify(error=f"Unknown team: {t!r}"), 400

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM third_picks WHERE session_id = %s", (session["id"],)
            )
            for team in teams:
                cur.execute(
                    """INSERT INTO third_picks(session_id, team_name)
                       VALUES(%s, %s)
                       ON CONFLICT DO NOTHING""",
                    (session["id"], team),
                )
        conn.commit()

    return jsonify(ok=True)


# ── Reset ─────────────────────────────────────────────────────────────────────

@api_bp.post("/session/<slug>/reset")
def reset_session(slug):
    err = _rate_limit_or_abort("reset", max_req=10, window=60)
    if err:
        return err

    session = _get_session_or_404(slug)
    if not session:
        return jsonify(error="Not found"), 404

    code = _get_edit_code()
    if not _verify_edit_code(session, code):
        return jsonify(error="Invalid edit code"), 403

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM group_picks  WHERE session_id = %s", (session["id"],))
            cur.execute("DELETE FROM match_picks  WHERE session_id = %s", (session["id"],))
            cur.execute("DELETE FROM third_picks  WHERE session_id = %s", (session["id"],))
        conn.commit()

    return jsonify(ok=True)


# ── Live data ─────────────────────────────────────────────────────────────────

@api_bp.get("/live")
def get_live():
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM live_results ORDER BY kickoff")
            rows = cur.fetchall()
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM live_sync_meta WHERE id = 1")
            meta = cur.fetchone()

    return jsonify(
        fixtures=[_serialise(r) for r in rows],
        last_sync=meta["last_sync"] if meta else None,
        status=meta["status"] if meta else None,
        count=len(rows),
    )


@api_bp.get("/live/debug")
def get_live_debug():
    """Debug: show distinct group_name and round values stored in DB."""
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT group_name, round, status, COUNT(*) AS n "
                "FROM live_results GROUP BY group_name, round, status ORDER BY group_name"
            )
            groups = cur.fetchall()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT home_team, away_team, home_score, away_score, "
                "status, group_name, round, kickoff "
                "FROM live_results ORDER BY kickoff DESC LIMIT 10"
            )
            sample = cur.fetchall()
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM live_results")
            total = cur.fetchone()

    return jsonify(
        total=total['n'] if total else 0,
        distinct_groups=[_serialise(r) for r in groups],
        recent_fixtures=[_serialise(r) for r in sample],
    )


@api_bp.post("/live/fix-team-names")
def fix_team_names():
    """One-time fix: rename API team names to canonical names in live_results."""
    RENAMES = {
        'USA':                          'United States',
        'T\u00fcrkiye':                    'Turkiye',
        'Turkey':                       'Turkiye',
        'Bosnia & Herzegovina':         'Bosnia and Herzegovina',
        'Czech Republic':               'Czechia',
        'Cura\u00e7ao':                    'Curacao',
        'Cape Verde Islands':           'Cape Verde',
        'Congo DR':                     'DR Congo',
        'Democratic Republic of Congo': 'DR Congo',
        "C\u00f4te d\'Ivoire":            'Ivory Coast',
        "Cote d\'Ivoire":              'Ivory Coast',
        'Korea Republic':               'South Korea',
        'IR Iran':                      'Iran',
    }
    updated = 0
    with db_connection() as conn:
        for api_name, canonical in RENAMES.items():
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE live_results SET home_team = %s WHERE home_team = %s",
                    (canonical, api_name)
                )
                updated += cur.rowcount
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE live_results SET away_team = %s WHERE away_team = %s",
                    (canonical, api_name)
                )
                updated += cur.rowcount
        conn.commit()
    return jsonify(ok=True, rows_updated=updated)


# ── Standings (server-computed, team-name-based) ──────────────────────────────

# Official team → group mapping. Independent of API round/group_name field.
_TEAM_GROUP = {
    # Group A
    'Mexico':'A','South Korea':'A','South Africa':'A','Czechia':'A',
    # Group B
    'Canada':'B','Switzerland':'B','Qatar':'B','Bosnia and Herzegovina':'B',
    # Group C
    'Brazil':'C','Morocco':'C','Scotland':'C','Haiti':'C',
    # Group D
    'United States':'D','Australia':'D','Paraguay':'D','Turkiye':'D',
    # Group E
    'Germany':'E','Ecuador':'E','Ivory Coast':'E','Curacao':'E',
    # Group F
    'Netherlands':'F','Japan':'F','Tunisia':'F','Sweden':'F',
    # Group G
    'Belgium':'G','Iran':'G','Egypt':'G','New Zealand':'G',
    # Group H
    'Spain':'H','Uruguay':'H','Saudi Arabia':'H','Cape Verde':'H',
    # Group I
    'France':'I','Senegal':'I','Norway':'I','Iraq':'I',
    # Group J
    'Argentina':'J','Austria':'J','Algeria':'J','Jordan':'J',
    # Group K
    'Portugal':'K','Colombia':'K','Uzbekistan':'K','DR Congo':'K',
    # Group L
    'England':'L','Croatia':'L','Panama':'L','Ghana':'L',
}

_GROUPS = {
    'A': ['Mexico','South Korea','South Africa','Czechia'],
    'B': ['Canada','Switzerland','Qatar','Bosnia and Herzegovina'],
    'C': ['Brazil','Morocco','Scotland','Haiti'],
    'D': ['United States','Australia','Paraguay','Turkiye'],
    'E': ['Germany','Ecuador','Ivory Coast','Curacao'],
    'F': ['Netherlands','Japan','Tunisia','Sweden'],
    'G': ['Belgium','Iran','Egypt','New Zealand'],
    'H': ['Spain','Uruguay','Saudi Arabia','Cape Verde'],
    'I': ['France','Senegal','Norway','Iraq'],
    'J': ['Argentina','Austria','Algeria','Jordan'],
    'K': ['Portugal','Colombia','Uzbekistan','DR Congo'],
    'L': ['England','Croatia','Panama','Ghana'],
}

_FINISHED = {'FT','AET','PEN','AWD','WO'}


def _team_stats(teams, fixtures):
    """Compute raw stats for each team from a list of finished fixtures."""
    stats = {t: {'p':0,'w':0,'d':0,'l':0,'gf':0,'ga':0,'pts':0,'fp':0} for t in teams}
    for f in fixtures:
        ht, at = f['home_team'], f['away_team']
        hs, as_ = f['home_score'], f['away_score']
        if hs is None or as_ is None:
            continue
        # Fair-play: use pre-computed home_fairplay/away_fairplay from DB
        if ht in stats:
            stats[ht]['p']  += 1
            stats[ht]['gf'] += hs
            stats[ht]['ga'] += as_
            stats[ht]['fp'] += f.get('home_fairplay', 0) or 0
        if at in stats:
            stats[at]['p']  += 1
            stats[at]['gf'] += as_
            stats[at]['ga'] += hs
            stats[at]['fp'] += f.get('away_fairplay', 0) or 0
        if hs > as_:
            if ht in stats: stats[ht]['w'] += 1; stats[ht]['pts'] += 3
            if at in stats: stats[at]['l'] += 1
        elif hs < as_:
            if at in stats: stats[at]['w'] += 1; stats[at]['pts'] += 3
            if ht in stats: stats[ht]['l'] += 1
        else:
            if ht in stats: stats[ht]['d'] += 1; stats[ht]['pts'] += 1
            if at in stats: stats[at]['d'] += 1; stats[at]['pts'] += 1
    return stats


def _fair_play(s):
    """FIFA fair-play: lower fp score = better discipline. Negate for sort key."""
    return -s['fp']


def _sort_group(teams, overall, fixtures):
    """
    Sort teams by FIFA Article 13 tiebreakers:
    1. Overall points
    2-4. H2H: points, GD, GF (among tied teams only)
    5. Overall GD
    6. Overall GF
    7. Fair-play (fewer cards)
    8. Alphabetical (proxy for drawing of lots)
    """
    def sort_key(t):
        o = overall[t]
        return (-o['pts'], 0, 0, 0, -(o['gf']-o['ga']), -o['gf'], _fair_play(o), t)

    # First pass: sort by overall points
    teams = sorted(teams, key=lambda t: -overall[t]['pts'])

    # Find equal-points blocks and apply H2H within each block
    result = []
    i = 0
    while i < len(teams):
        j = i + 1
        while j < len(teams) and overall[teams[j]]['pts'] == overall[teams[i]]['pts']:
            j += 1
        block = teams[i:j]
        if len(block) > 1:
            # H2H fixtures among just these teams
            h2h_fix = [f for f in fixtures
                       if f['home_team'] in block and f['away_team'] in block]
            h2h = _team_stats(block, h2h_fix)
            # Check if H2H pts differ
            h2h_pts = [h2h[t]['pts'] for t in block]
            if len(set(h2h_pts)) > 1 or True:  # always apply full chain
                block = sorted(block, key=lambda t: (
                    -h2h[t]['pts'],
                    -(h2h[t]['gf']-h2h[t]['ga']),
                    -h2h[t]['gf'],
                    -(overall[t]['gf']-overall[t]['ga']),
                    -overall[t]['gf'],
                    _fair_play(overall[t]),
                    t,
                ))
        result.extend(block)
        i = j
    return result


@api_bp.get("/standings")
def get_standings():
    """
    Compute group standings from live_results using team names.
    Ignores group_name field from API — derives group from hard-coded team map.
    """
    with db_connection() as conn:
        with conn.cursor() as cur:
            # Fetch all group-stage fixtures by matching team names
            # A fixture is a group match if BOTH teams are in our team→group map
            # and they belong to the same group.
            cur.execute("SELECT * FROM live_results ORDER BY kickoff")
            all_rows = cur.fetchall()

    # Partition fixtures into groups by team name
    group_fixtures = {g: [] for g in _GROUPS}
    for row in all_rows:
        f = dict(row)
        ht = f.get('home_team', '')
        at = f.get('away_team', '')
        hg = _TEAM_GROUP.get(ht)
        ag = _TEAM_GROUP.get(at)
        if hg and hg == ag:
            # Both teams in same group — this is a group stage fixture
            f['derived_group'] = hg
            group_fixtures[hg].append(f)

    # Compute standings for each group
    standings = {}
    for g, teams in _GROUPS.items():
        fixtures  = group_fixtures[g]
        finished  = [f for f in fixtures if f.get('status') in _FINISHED]
        overall   = _team_stats(teams, finished)
        sorted_teams = _sort_group(teams, overall, finished)

        standings[g] = {
            'teams': [
                {
                    'name': t,
                    'pos':  i + 1,
                    **overall[t],
                    'gd': overall[t]['gf'] - overall[t]['ga'],
                }
                for i, t in enumerate(sorted_teams)
            ],
            'fixtures': [
                {
                    'home': f['home_team'],
                    'away': f['away_team'],
                    'hs':   f['home_score'],
                    'as_':  f['away_score'],
                    'status': f['status'],
                    'kickoff': f['kickoff'].isoformat() if f['kickoff'] else None,
                }
                for f in sorted(fixtures, key=lambda x: x['kickoff'] or '')
            ],
        }

    return jsonify(standings)


# ── Fixture detail ────────────────────────────────────────────────────────────

@api_bp.get("/fixture/<int:external_id>")
def get_fixture_detail(external_id):
    """
    Return detailed data for one fixture from the API-Football cache.
    Fetches live events, lineups, statistics from the API on demand.
    """
    import os
    api_key = os.environ.get('API_FOOTBALL_KEY', '').strip()

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM live_results WHERE external_id = %s", (external_id,))
            row = cur.fetchone()

    if not row:
        return jsonify(error="Fixture not found"), 404

    result = dict(row)

    if not api_key:
        return jsonify(fixture=result, events=[], lineups=[], statistics=[])

    # Fetch events (goals, cards, substitutions)
    from app.live_fetch import _api_get
    events_data = _api_get('/fixtures/events', api_key, {'fixture': external_id})
    events = events_data.get('response', []) if events_data else []

    # Fetch lineups
    lineups_data = _api_get('/fixtures/lineups', api_key, {'fixture': external_id})
    lineups = lineups_data.get('response', []) if lineups_data else []

    # Fetch statistics
    stats_data = _api_get('/fixtures/statistics', api_key, {'fixture': external_id})
    statistics = stats_data.get('response', []) if stats_data else []

    return jsonify(
        fixture=_serialise(result),
        events=events,
        lineups=lineups,
        statistics=statistics,
    )


# ── Team profile ──────────────────────────────────────────────────────────────

@api_bp.get("/team/<path:team_name>")
def get_team_profile(team_name):
    """Return all fixtures for a team, plus their group and current standings position."""
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM live_results "
                "WHERE home_team = %s OR away_team = %s "
                "ORDER BY kickoff",
                (team_name, team_name),
            )
            fixtures = cur.fetchall()

    group = _TEAM_GROUP.get(team_name)
    group_teams = _GROUPS.get(group, []) if group else []

    # Get full group standings for context
    group_standing = []
    if group:
        all_group_fix = [f for f in fixtures]
        # Need all group fixtures, not just this team's
        with db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM live_results ORDER BY kickoff")
                all_rows = cur.fetchall()

        group_fixtures = [
            f for f in all_rows
            if _TEAM_GROUP.get(f['home_team']) == group
            and _TEAM_GROUP.get(f['away_team']) == group
        ]
        finished = [f for f in group_fixtures if f['status'] in _FINISHED]
        overall  = _team_stats(group_teams, finished)
        sorted_t = _sort_group(group_teams, overall, finished)
        group_standing = [
            {
                'name': t,
                'pos':  i + 1,
                **overall[t],
                'gd': overall[t]['gf'] - overall[t]['ga'],
                'is_this_team': t == team_name,
            }
            for i, t in enumerate(sorted_t)
        ]

    return jsonify(
        team=team_name,
        group=group,
        fixtures=[_serialise(f) for f in fixtures],
        group_standing=group_standing,
    )
