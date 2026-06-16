"""app/__init__.py — Application factory."""

import logging
import os
import secrets
import stat

from flask import Flask

log = logging.getLogger(__name__)

_PLACEHOLDER_NAMES = {"admin", "user", "test", "administrator", "root", "change_me"}
_WEAK_PASSWORDS    = {"password", "password123", "changeme", "admin123", "letmein", "qwerty123"}


def create_app():
    app = Flask(__name__, instance_relative_config=False)

    # ── Core config ───────────────────────────────────────────────────────────
    app.config["SECRET_KEY"]                 = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
    app.config["FORCE_HTTPS"]                = os.environ.get("FORCE_HTTPS", "0") == "1"
    app.config["JWT_PRIVATE_KEY_FILE"]       = os.environ.get("JWT_PRIVATE_KEY_FILE", "jwt_private.pem")
    app.config["JWT_PUBLIC_KEY_FILE"]        = os.environ.get("JWT_PUBLIC_KEY_FILE",  "jwt_public.pem")
    app.config["JWT_ACCESS_TOKEN_EXPIRES"]   = int(os.environ.get("JWT_ACCESS_TOKEN_EXPIRES",  900))
    app.config["JWT_REFRESH_TOKEN_EXPIRES"]  = int(os.environ.get("JWT_REFRESH_TOKEN_EXPIRES", 28800))

    # ── Logging ───────────────────────────────────────────────────────────────
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] %(levelname)s in %(module)s: %(message)s",
    )

    # ── Security headers ──────────────────────────────────────────────────────
    @app.after_request
    def add_security_headers(resp):
        if app.config.get("FORCE_HTTPS"):
            resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        resp.headers["X-Content-Type-Options"]  = "nosniff"
        resp.headers["X-Frame-Options"]         = "SAMEORIGIN"
        resp.headers["Referrer-Policy"]         = "strict-origin-when-cross-origin"
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "font-src 'self'; "
            "connect-src 'self';"
        )
        return resp

    # ── HTTPS redirect ────────────────────────────────────────────────────────
    if app.config["FORCE_HTTPS"]:
        from flask import request, redirect
        @app.before_request
        def redirect_http():
            if not request.is_secure:
                url = request.url.replace("http://", "https://", 1)
                return redirect(url, code=301)

    # ── Database ──────────────────────────────────────────────────────────────
    from app.db import init_db
    init_db(app)

    # ── JWT ───────────────────────────────────────────────────────────────────
    from app.jwt_auth import init_jwt
    init_jwt(app)

    # ── Blueprints ────────────────────────────────────────────────────────────
    from app.blueprints.public import public_bp
    from app.blueprints.api    import api_bp
    from app.blueprints.admin  import admin_bp

    app.register_blueprint(public_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(admin_bp)

    # ── Admin bootstrap ───────────────────────────────────────────────────────
    with app.app_context():
        _bootstrap_admin(app)

    # ── Live data sync ────────────────────────────────────────────────────────
    from app.live_fetch import start_live_sync
    start_live_sync(app)

    return app


def _bootstrap_admin(app):
    username = os.environ.get("INITIAL_ADMIN_USERNAME", "").strip()
    password = os.environ.get("INITIAL_ADMIN_PASSWORD", "").strip()

    if not username or not password:
        return
    if username.lower() in _PLACEHOLDER_NAMES:
        log.warning("INITIAL_ADMIN_USERNAME looks like a placeholder (%r) — skipping.", username)
        return
    if len(password) < 12:
        log.warning("INITIAL_ADMIN_PASSWORD too short (< 12 chars) — skipping bootstrap.")
        return
    if password.lower() in _WEAK_PASSWORDS:
        log.warning("INITIAL_ADMIN_PASSWORD is a common weak password — skipping bootstrap.")
        return

    from app.db import db_connection
    from werkzeug.security import generate_password_hash

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM admin_users WHERE LOWER(username) = LOWER(%s)",
                (username,),
            )
            existing = cur.fetchone()

        if existing:
            return  # already created

        pw_hash = generate_password_hash(password, method="pbkdf2:sha256:600000")
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO admin_users(username, password_hash, must_change_password) "
                "VALUES(%s, %s, 1)",
                (username, pw_hash),
            )
        conn.commit()
        log.info("Bootstrap: created admin account %r", username)
