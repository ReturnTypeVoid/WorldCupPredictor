"""
app/db.py — PostgreSQL database helpers.

Setup:
    createuser -P worldcup
    createdb -O worldcup worldcup
    export DATABASE_URL="postgresql://worldcup:PASSWORD@localhost:5432/worldcup"
"""

import os
import logging
from contextlib import contextmanager

log = logging.getLogger(__name__)

_PG_DSN = None


# ── Init ──────────────────────────────────────────────────────────────────────

def init_db(app):
    global _PG_DSN

    _PG_DSN = os.environ.get('DATABASE_URL', '').strip()
    if not _PG_DSN:
        raise RuntimeError(
            'DATABASE_URL is not set. '
            'Add it to .env: postgresql://worldcup:PASSWORD@127.0.0.1:5432/worldcup'
        )

    # Log DSN without password
    safe = _PG_DSN.split('@')[-1] if '@' in _PG_DSN else _PG_DSN
    log.info('Database: PostgreSQL (%s)', safe)

    _create_schema()
    _run_migrations()
    log.info('Database ready.')


# ── Connection ────────────────────────────────────────────────────────────────

@contextmanager
def db_connection():
    """Yield a psycopg2 connection. Rolls back on error, always closes."""
    import psycopg2
    import psycopg2.extras
    conn = psycopg2.connect(_PG_DSN, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ── Schema ────────────────────────────────────────────────────────────────────

def _create_schema():
    stmts = [
        """CREATE TABLE IF NOT EXISTS prediction_sessions (
            id           SERIAL PRIMARY KEY,
            slug         TEXT        NOT NULL UNIQUE,
            edit_code    TEXT        NOT NULL,
            display_name TEXT,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS group_picks (
            id           SERIAL PRIMARY KEY,
            session_id   INTEGER NOT NULL REFERENCES prediction_sessions(id) ON DELETE CASCADE,
            group_letter TEXT    NOT NULL,
            position     INTEGER NOT NULL CHECK(position BETWEEN 1 AND 4),
            team_name    TEXT    NOT NULL,
            UNIQUE(session_id, group_letter, position)
        )""",
        """CREATE TABLE IF NOT EXISTS match_picks (
            id         SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES prediction_sessions(id) ON DELETE CASCADE,
            match_num  INTEGER NOT NULL,
            winner     TEXT    NOT NULL,
            UNIQUE(session_id, match_num)
        )""",
        """CREATE TABLE IF NOT EXISTS third_picks (
            id         SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES prediction_sessions(id) ON DELETE CASCADE,
            team_name  TEXT    NOT NULL,
            UNIQUE(session_id, team_name)
        )""",
        """CREATE TABLE IF NOT EXISTS live_results (
            id            SERIAL PRIMARY KEY,
            external_id   INTEGER     UNIQUE,
            home_team     TEXT        NOT NULL,
            away_team     TEXT        NOT NULL,
            home_score    INTEGER,
            away_score    INTEGER,
            status        TEXT,
            kickoff       TIMESTAMPTZ,
            group_name    TEXT,
            round         TEXT,
            match_num     INTEGER,
            home_fairplay INTEGER     NOT NULL DEFAULT 0,
            away_fairplay INTEGER     NOT NULL DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS fixture_cache (
            external_id   INTEGER PRIMARY KEY,
            events_json   TEXT,
            lineups_json  TEXT,
            stats_json    TEXT,
            cached_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS live_sync_meta (
            id        INTEGER PRIMARY KEY CHECK(id = 1),
            last_sync TIMESTAMPTZ,
            status    TEXT,
            error     TEXT
        )""",
        """INSERT INTO live_sync_meta(id) VALUES(1) ON CONFLICT DO NOTHING""",
        """CREATE TABLE IF NOT EXISTS admin_users (
            id                   SERIAL PRIMARY KEY,
            username             TEXT        NOT NULL UNIQUE,
            password_hash        TEXT        NOT NULL,
            must_change_password INTEGER     NOT NULL DEFAULT 1,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS admin_login_attempts (
            id           SERIAL PRIMARY KEY,
            identifier   TEXT        NOT NULL,
            succeeded    INTEGER     NOT NULL DEFAULT 0,
            attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        """CREATE INDEX IF NOT EXISTS idx_attempts_ident_time
            ON admin_login_attempts(identifier, attempted_at)""",
        """CREATE TABLE IF NOT EXISTS jwt_denylist (
            jti        TEXT        NOT NULL PRIMARY KEY,
            token_type TEXT        NOT NULL,
            revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL
        )""",
        """CREATE INDEX IF NOT EXISTS idx_jwt_denylist_expires
            ON jwt_denylist(expires_at)""",
        """CREATE TABLE IF NOT EXISTS jwt_refresh_families (
            family_id     TEXT        NOT NULL PRIMARY KEY,
            admin_user_id INTEGER     NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
            current_jti   TEXT        NOT NULL,
            invalidated   INTEGER     NOT NULL DEFAULT 0,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
    ]
    with db_connection() as conn:
        with conn.cursor() as cur:
            for stmt in stmts:
                cur.execute(stmt)
        conn.commit()


def _run_migrations():
    """Safe to run on every startup — adds columns/tables missing from older DBs."""
    with db_connection() as conn:
        with conn.cursor() as cur:
            # Prune expired JWT rows
            cur.execute("DELETE FROM jwt_denylist WHERE expires_at < NOW() - INTERVAL '1 day'")
        conn.commit()
