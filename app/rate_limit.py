"""app/rate_limit.py — Sliding-window rate limiting backed by PostgreSQL."""

import logging
from app.db import db_connection

log = logging.getLogger(__name__)


def check_api_rate_limit(
    identifier: str,
    key: str,
    max_requests: int = 60,
    window_seconds: int = 60,
) -> bool:
    """
    Returns True if the request is allowed, False if rate-limited.
    Records the attempt in admin_login_attempts.
    """
    try:
        with db_connection() as conn:
            # Record this attempt
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO admin_login_attempts(identifier, succeeded) VALUES(%s, %s)",
                    (f"{key}:{identifier}", 0),
                )

            # Count recent attempts
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT COUNT(*) AS cnt FROM admin_login_attempts
                       WHERE identifier = %s
                         AND attempted_at > NOW() - (%s * INTERVAL '1 second')""",
                    (f"{key}:{identifier}", window_seconds),
                )
                row = cur.fetchone()
                count = row["cnt"] if row else 0

            conn.commit()

        return count <= max_requests

    except Exception as e:
        log.error("rate_limit error: %s", e)
        return True  # fail open


def record_login_attempt(identifier: str, succeeded: bool) -> None:
    """Record an admin login attempt for brute-force protection."""
    try:
        with db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO admin_login_attempts(identifier, succeeded) VALUES(%s, %s)",
                    (identifier, int(succeeded)),
                )
            conn.commit()
    except Exception as e:
        log.error("record_login_attempt error: %s", e)


def is_brute_forced(identifier: str, max_failures: int = 8, window_seconds: int = 900) -> bool:
    """Return True if the identifier has too many failed login attempts recently."""
    try:
        with db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT COUNT(*) AS cnt FROM admin_login_attempts
                       WHERE identifier = %s
                         AND succeeded  = 0
                         AND attempted_at > NOW() - (%s * INTERVAL '1 second')""",
                    (identifier, window_seconds),
                )
                row = cur.fetchone()
                return (row["cnt"] if row else 0) >= max_failures
    except Exception as e:
        log.error("is_brute_forced error: %s", e)
        return False
