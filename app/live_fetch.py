"""
app/live_fetch.py — Background sync thread for API-Football live data.

Syncs FIFA World Cup 2026 fixtures from:
  https://v3.football.api-sports.io/

Auth header: x-apisports-key: <API_FOOTBALL_KEY>
League ID: 1 (FIFA World Cup)
Season:  2026

Sync strategy (per the API docs and rate limits):
  - Runs every LIVE_SYNC_INTERVAL_SECONDS (default 300s; 60s when key set)
  - Step 1: Bootstrap — fetch all season fixtures once (if table empty)
  - Step 2: Live poll — GET /fixtures%slive=all&league=1 for in-progress matches
  - Step 3: Recent poll — GET /fixtures%sleague=1&season=2026&last=20
    to catch matches that just finished and update their final scores
  - Step 4: Card backfill — for finished matches with no fairplay data,
    fetch individual fixture to parse card events

All API-Football fixture statuses:
  In play:  1H, 2H, HT, ET, BT, P, SUSP, INT, LIVE
  Finished: FT, AET, PEN
  Scheduled: NS, TBD, PST, CANC, ABD, AWD, WO
"""

import os
import json
import logging
import threading
import time
import datetime
import urllib.request
import urllib.error

log = logging.getLogger(__name__)

WC_LEAGUE_ID = 1       # FIFA World Cup
WC_SEASON    = 2026
API_BASE     = 'https://v3.football.api-sports.io'

IN_PLAY_STATUSES  = {'1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'}
FINISHED_STATUSES = {'FT', 'AET', 'PEN'}

import re

# Round name normalisation
# API returns "Group Stage - 1/2/3" (matchday numbers, not group letters).
# Group assignment comes from _TEAM_GROUP in api.py, not this field.
def _normalise_round(raw):
    if not raw:
        return ''
    import re as _re
    if _re.match(r'Group Stage', raw, _re.IGNORECASE):
        return 'Group Stage'
    return raw


# Team name normalisation: API name → app canonical name
TEAM_NAME_MAP = {
    'USA':                          'United States',
    'Türkiye':                      'Turkiye',
    'Turkey':                       'Turkiye',
    'Bosnia & Herzegovina':         'Bosnia and Herzegovina',
    'Czech Republic':               'Czechia',
    'Curaçao':                      'Curacao',
    'Cape Verde Islands':           'Cape Verde',
    'Congo DR':                     'DR Congo',
    'Democratic Republic of Congo': 'DR Congo',
    'Côte d\'Ivoire':                'Ivory Coast',
    "Cote d'Ivoire":                'Ivory Coast',
    'Korea Republic':               'South Korea',
    'IR Iran':                      'Iran',
    'Trinidad & Tobago':            'Trinidad and Tobago',
    'Republic of Ireland':          'Ireland',
}


def _norm(name):
    """Normalise an API team name to the app's canonical name."""
    return TEAM_NAME_MAP.get(name, name)


# ──────────────────────────────────────────────────────────────────────────────
# API helper
# ──────────────────────────────────────────────────────────────────────────────

def _api_get(path, api_key, params=None):
    """
    Make a GET request to API-Football.
    Returns the parsed JSON response dict, or None on error.
    """
    url = f'{API_BASE}/{path.lstrip("/")}'
    if params:
        qs = '&'.join(f'{k}={v}' for k, v in params.items())
        url = f'{url}?{qs}'

    log.debug('API-Football GET %s', url)
    req = urllib.request.Request(
        url,
        headers={
            'x-apisports-key': api_key,
            'User-Agent': 'WorldCup2026-App/1.0',
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            results = data.get('results', 0)
            log.debug('API-Football %s → %d results', path, results)
            return data
    except urllib.error.HTTPError as e:
        log.error('API-Football HTTP %d for %s', e.code, url)
    except Exception as e:
        log.error('API-Football error for %s: %s', url, e)
    return None


# ──────────────────────────────────────────────────────────────────────────────
# DB helpers
# ──────────────────────────────────────────────────────────────────────────────

def _parse_cards_from_events(events):
    """Count yellow and red cards per team side from fixture events list."""
    home_y = home_r = away_y = away_r = 0
    for ev in (events or []):
        detail = (ev.get('type') or '').lower()
        team_id = ev.get('team', {}).get('id')
        # We use player_team to determine side later; for now use home/away flag
        # API-Football events have a 'team' object — compare to fixture teams
        if 'yellow' in detail and 'red' not in detail:
            if ev.get('team', {}).get('home'):
                home_y += 1
            else:
                away_y += 1
        elif 'red' in detail or detail in ('red card', 'yellow red card'):
            if ev.get('team', {}).get('home'):
                home_r += 1
            else:
                away_r += 1
    return home_y, home_r, away_y, away_r


def _upsert_fixture(conn, fix, api_key=None):
    """
    Insert or update one fixture row from an API-Football fixture object.
    If api_key is provided and match is finished, also fetches card events.
    """
    try:
        fixture_info = fix.get('fixture', {})
        teams        = fix.get('teams', {})
        goals        = fix.get('goals', {})
        league_info  = fix.get('league', {})

        external_id = fixture_info.get('id')
        home_team   = _norm(teams.get('home', {}).get('name', '') or '')
        away_team   = _norm(teams.get('away', {}).get('name', '') or '')
        home_score  = goals.get('home')
        away_score  = goals.get('away')
        status      = fixture_info.get('status', {}).get('short', 'NS')
        kickoff     = fixture_info.get('date')
        raw_round   = league_info.get('round', '') or ''
        group_name  = _normalise_round(raw_round)
        round_name  = raw_round

        if not external_id or not home_team or not away_team:
            return

        # Parse fair-play cards from inline events if present
        home_fp = away_fp = 0
        events = fix.get('events', [])
        if events:
            home_y, home_r, away_y, away_r = _parse_cards_from_events(events)
            # FIFA fair-play: YC=1pt, RC=3pt, YC+RC=3pt
            home_fp = home_y + home_r * 3
            away_fp = away_y + away_r * 3

        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO live_results
                    (external_id, home_team, away_team, home_score, away_score,
                     status, kickoff, group_name, round, home_fairplay, away_fairplay)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT(external_id) DO UPDATE SET
                     home_score    = excluded.home_score,
                     away_score    = excluded.away_score,
                     status        = excluded.status,
                     kickoff       = excluded.kickoff,
                     group_name    = excluded.group_name,
                     round         = excluded.round,
                     home_fairplay = CASE WHEN excluded.home_fairplay > 0
                                     THEN excluded.home_fairplay
                                     ELSE live_results.home_fairplay END,
                     away_fairplay = CASE WHEN excluded.away_fairplay > 0
                                     THEN excluded.away_fairplay
                                     ELSE live_results.away_fairplay END""",
                (external_id, home_team, away_team,
                 home_score, away_score, status, kickoff,
                 group_name, round_name, home_fp, away_fp),
            )
    except Exception as e:
        log.warning('_upsert_fixture error: %s', e)


def _set_sync_meta(conn, status, error=None):
    now = datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    with conn.cursor() as _cur:

        _cur.execute(
        """INSERT INTO live_sync_meta(id, last_sync, status, error)
           VALUES (1, %s, %s, %s)
           ON CONFLICT(id) DO UPDATE SET
             last_sync = excluded.last_sync,
             status    = excluded.status,
             error     = excluded.error""",
        (now, status, error),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Sync logic
# ──────────────────────────────────────────────────────────────────────────────

def _sync_once(api_key):
    """Run one full sync cycle. Called by the background thread."""
    from app.db import db_connection

    try:
        # ── Step 1: Bootstrap — fetch all season fixtures if table is empty ──
        with db_connection() as conn:
            with conn.cursor() as _cur:

                _cur.execute('SELECT COUNT(*) AS n FROM live_results')

                count = _cur.fetchone()
            fixture_count = count['n'] if count else 0

        if fixture_count == 0:
            log.info('Live sync: bootstrapping all WC2026 fixtures…')
            data = _api_get('/fixtures', api_key, {
                'league': WC_LEAGUE_ID,
                'season': WC_SEASON,
            })
            if data and data.get('response'):
                with db_connection() as conn:
                    for fix in data['response']:
                        _upsert_fixture(conn, fix)
                    conn.commit()
                log.info('Live sync: bootstrapped %d fixtures', len(data['response']))

        # ── Step 2: Live poll — any matches in progress right now ─────────────
        live_data = _api_get('/fixtures', api_key, {
            'live': 'all',
            'league': WC_LEAGUE_ID,
        })
        live_count = 0
        if live_data and live_data.get('response'):
            with db_connection() as conn:
                for fix in live_data['response']:
                    _upsert_fixture(conn, fix)
                conn.commit()
            live_count = len(live_data['response'])
            log.info('Live sync: %d live fixtures updated', live_count)

        # ── Step 3: Recent results — last 20 completed fixtures ───────────────
        recent_data = _api_get('/fixtures', api_key, {
            'league': WC_LEAGUE_ID,
            'season': WC_SEASON,
            'last': 20,
        })
        if recent_data and recent_data.get('response'):
            with db_connection() as conn:
                for fix in recent_data['response']:
                    _upsert_fixture(conn, fix)
                conn.commit()
            log.debug('Live sync: %d recent fixtures refreshed', len(recent_data['response']))

        # ── Step 4: Next 5 upcoming (so kickoff times are accurate) ──────────
        next_data = _api_get('/fixtures', api_key, {
            'league': WC_LEAGUE_ID,
            'season': WC_SEASON,
            'next': 5,
        })
        if next_data and next_data.get('response'):
            with db_connection() as conn:
                for fix in next_data['response']:
                    _upsert_fixture(conn, fix)
                conn.commit()

        # ── Step 5: Card backfill — fetch events for finished group matches ──
        # that still have home_fairplay=0 and away_fairplay=0
        # Limit to 3 per cycle to stay within rate limits
        with db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT external_id FROM live_results
                    WHERE status IN ('FT','AET','PEN')
                      AND home_fairplay = 0
                      AND away_fairplay = 0
                      AND external_id IS NOT NULL
                    ORDER BY kickoff DESC
                    LIMIT 3
                """)
                backfill_ids = [r['external_id'] for r in cur.fetchall()]

        for ext_id in backfill_ids:
            ev_data = _api_get('/fixtures/events', api_key, {'fixture': ext_id})
            if ev_data and ev_data.get('response'):
                events = ev_data['response']
                # Determine home/away side from fixture teams
                fix_data = _api_get('/fixtures', api_key, {'id': ext_id})
                if fix_data and fix_data.get('response'):
                    fix = fix_data['response'][0]
                    home_team_id = fix.get('teams', {}).get('home', {}).get('id')
                    home_y = home_r = away_y = away_r = 0
                    for ev in events:
                        detail = (ev.get('type') or '').lower()
                        ev_team_id = ev.get('team', {}).get('id')
                        is_home = (ev_team_id == home_team_id)
                        if 'yellow card' in detail and 'red' not in detail:
                            if is_home: home_y += 1
                            else: away_y += 1
                        elif 'red' in detail:
                            if is_home: home_r += 1
                            else: away_r += 1
                    home_fp = home_y + home_r * 3
                    away_fp = away_y + away_r * 3
                    if home_fp > 0 or away_fp > 0:
                        with db_connection() as conn:
                            with conn.cursor() as cur:
                                cur.execute("""
                                    UPDATE live_results
                                    SET home_fairplay = %s, away_fairplay = %s
                                    WHERE external_id = %s
                                """, (home_fp, away_fp, ext_id))
                            conn.commit()
                        log.debug('Card backfill: fixture %d home_fp=%d away_fp=%d',
                                  ext_id, home_fp, away_fp)

        with db_connection() as conn:
            _set_sync_meta(conn, f'OK — {live_count} live')
            conn.commit()

    except Exception as e:
        log.error('Live sync error: %s', e, exc_info=True)
        try:
            from app.db import db_connection
            with db_connection() as conn:
                _set_sync_meta(conn, 'ERROR', str(e))
                conn.commit()
        except Exception:
            pass


# ──────────────────────────────────────────────────────────────────────────────
# Background thread
# ──────────────────────────────────────────────────────────────────────────────

def start_live_sync(app):
    """Start the background sync daemon thread. Called from create_app()."""
    api_key = os.environ.get('API_FOOTBALL_KEY', '').strip()
    if not api_key:
        log.info('API_FOOTBALL_KEY not set — live sync disabled.')
        return

    disable = os.environ.get('DISABLE_LIVE_SYNC', '0').strip()
    if disable == '1':
        log.info('DISABLE_LIVE_SYNC=1 — live sync disabled.')
        return

    interval = int(os.environ.get('LIVE_SYNC_INTERVAL_SECONDS', '60'))
    log.info('Live sync: starting background thread (interval=%ds)', interval)

    def _loop():
        # Wait a few seconds after startup so DB is ready
        time.sleep(5)
        while True:
            with app.app_context():
                _sync_once(api_key)
            time.sleep(interval)

    t = threading.Thread(target=_loop, name='live-sync', daemon=True)
    t.start()
    log.info('Live sync: thread started')
