"""app/blueprints/admin.py — Admin area."""

import logging
import secrets

from flask import (
    Blueprint, request, jsonify, render_template,
    make_response, current_app, g, redirect, url_for, flash,
)
from werkzeug.security import generate_password_hash, check_password_hash

from app.db import db_connection
from app.jwt_auth import (
    create_token_pair, rotate_refresh_token, revoke_token,
    revoke_all_tokens_for_user, require_admin, require_admin_html, JWTError,
)
from app.rate_limit import check_api_rate_limit, record_login_attempt, is_brute_forced

log = logging.getLogger(__name__)
admin_bp = Blueprint("admin", __name__, url_prefix="/admin")

_REFRESH_COOKIE = "refresh_token"
_WEAK_PASSWORDS = {"password", "12345678", "password123", "admin123456"}


def _set_refresh_cookie(response, token, max_age):
    response.set_cookie(
        _REFRESH_COOKIE, token, max_age=max_age,
        httponly=True, samesite="Strict",
        secure=current_app.config.get("FORCE_HTTPS", False),
        path="/admin",
    )

def _clear_refresh_cookie(response):
    response.delete_cookie(_REFRESH_COOKIE, path="/admin")

def _ip():
    return request.headers.get("X-Real-IP") or request.remote_addr or "unknown"


@admin_bp.post("/api/login")
def api_login():
    ip = _ip()
    if not check_api_rate_limit(ip, "login", max_requests=20, window_seconds=60):
        return jsonify(error="Too many requests"), 429

    data     = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))

    if not username or not password:
        return jsonify(error="username and password are required"), 400

    if is_brute_forced(f"{username}:{ip}"):
        return jsonify(error="Too many failed attempts — try again in 15 minutes"), 429

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM admin_users WHERE LOWER(username) = LOWER(%s)",
                (username,),
            )
            user = cur.fetchone()

    dummy = generate_password_hash("dummy-to-prevent-timing-oracle")
    stored_hash = user["password_hash"] if user else dummy
    valid = check_password_hash(stored_hash, password)

    record_login_attempt(f"{username}:{ip}", succeeded=valid and bool(user))

    if not user or not valid:
        log.warning("Failed admin login: username=%r ip=%s", username, ip)
        return jsonify(error="Invalid credentials"), 401

    pair = create_token_pair(user["username"])
    resp = make_response(jsonify(
        access_token=pair["access_token"],
        expires_in=current_app.config["JWT_ACCESS_TOKEN_EXPIRES"],
        must_change_password=bool(user["must_change_password"]),
    ))
    _set_refresh_cookie(resp, pair["refresh_token"],
                        current_app.config["JWT_REFRESH_TOKEN_EXPIRES"])
    log.info("Admin login: username=%r ip=%s", user["username"], ip)
    return resp, 200


@admin_bp.post("/api/refresh")
def api_refresh():
    token = request.cookies.get(_REFRESH_COOKIE)
    if not token:
        return jsonify(error="No refresh token"), 401
    try:
        pair = rotate_refresh_token(token)
    except JWTError as exc:
        resp = make_response(jsonify(error=str(exc)), exc.status)
        _clear_refresh_cookie(resp)
        return resp
    resp = make_response(jsonify(
        access_token=pair["access_token"],
        expires_in=current_app.config["JWT_ACCESS_TOKEN_EXPIRES"],
    ))
    _set_refresh_cookie(resp, pair["refresh_token"],
                        current_app.config["JWT_REFRESH_TOKEN_EXPIRES"])
    return resp, 200


@admin_bp.post("/api/logout")
@require_admin
def api_logout():
    access_token = request.headers.get("Authorization", "")[7:].strip()
    revoke_token(access_token, "access")
    refresh_token = request.cookies.get(_REFRESH_COOKIE, "")
    if refresh_token:
        revoke_token(refresh_token, "refresh")
    resp = make_response(jsonify(message="Logged out"))
    _clear_refresh_cookie(resp)
    return resp, 200


@admin_bp.post("/api/change-password")
@require_admin
def api_change_password():
    data       = request.get_json(silent=True) or {}
    current_pw = str(data.get("current_password", ""))
    new_pw     = str(data.get("new_password", ""))

    if len(new_pw) < 12:
        return jsonify(error="New password must be at least 12 characters"), 400
    if new_pw.lower() in _WEAK_PASSWORDS:
        return jsonify(error="Password is too common"), 400

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM admin_users WHERE LOWER(username) = LOWER(%s)",
                (g.admin_username,),
            )
            user = cur.fetchone()

    if not check_password_hash(user["password_hash"], current_pw):
        return jsonify(error="Current password is incorrect"), 400
    if check_password_hash(user["password_hash"], new_pw):
        return jsonify(error="New password must differ from current"), 400

    new_hash = generate_password_hash(new_pw, method="pbkdf2:sha256:600000")
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE admin_users SET password_hash = %s, must_change_password = 0 "
                "WHERE LOWER(username) = LOWER(%s)",
                (new_hash, g.admin_username),
            )
        conn.commit()

    revoke_all_tokens_for_user(g.admin_username)
    access_token  = request.headers.get("Authorization", "")[7:].strip()
    refresh_token = request.cookies.get(_REFRESH_COOKIE, "")
    revoke_token(access_token, "access")
    if refresh_token:
        revoke_token(refresh_token, "refresh")

    resp = make_response(jsonify(message="Password changed. Please log in again."))
    _clear_refresh_cookie(resp)
    return resp, 200


@admin_bp.delete("/api/sessions/<slug>")
@require_admin
def api_delete_session(slug):
    data    = request.get_json(silent=True) or {}
    confirm = str(data.get("confirm_slug", ""))
    if not secrets.compare_digest(confirm, slug):
        return jsonify(error="confirm_slug does not match"), 400

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM prediction_sessions WHERE slug = %s", (slug,))
            row = cur.fetchone()
        if not row:
            return jsonify(error="Session not found"), 404
        with conn.cursor() as cur:
            cur.execute("DELETE FROM prediction_sessions WHERE id = %s", (row["id"],))
        conn.commit()

    return jsonify(message=f"Session {slug!r} deleted"), 200


@admin_bp.get("/login")
def login_page():
    return render_template("admin/login.html")


@admin_bp.get("/")
@require_admin_html
def dashboard():
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT slug, display_name, created_at "
                "FROM prediction_sessions ORDER BY created_at DESC"
            )
            sessions = cur.fetchall()
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM live_sync_meta WHERE id = 1")
            meta = cur.fetchone()
    return render_template("admin/dashboard.html",
                           sessions=sessions, meta=meta,
                           username=g.admin_username)


@admin_bp.get("/sessions/<slug>")
@require_admin_html
def session_detail(slug):
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM prediction_sessions WHERE slug = %s", (slug,))
            session = cur.fetchone()
        if not session:
            flash("Session not found", "danger")
            return redirect(url_for("admin.dashboard"))
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM group_picks WHERE session_id = %s "
                "ORDER BY group_letter, position",
                (session["id"],),
            )
            group_picks = cur.fetchall()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM match_picks WHERE session_id = %s ORDER BY match_num",
                (session["id"],),
            )
            match_picks = cur.fetchall()

    return render_template("admin/session_detail.html",
                           session=session, group_picks=group_picks,
                           match_picks=match_picks, username=g.admin_username)


@admin_bp.get("/change-password")
@require_admin_html
def change_password_page():
    return render_template("admin/change_password.html",
                           username=g.admin_username,
                           must_change=g.must_change_password)
