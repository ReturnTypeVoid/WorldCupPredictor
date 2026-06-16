"""app/jwt_auth.py — RS256 JWT auth for the admin area."""

import hmac
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from functools import wraps
from pathlib import Path

import jwt
from flask import current_app, request, jsonify, g

from app.db import db_connection

log = logging.getLogger(__name__)

ALGORITHM      = "RS256"
ISSUER         = "worldcup2026"
AUDIENCE       = "worldcup-admin"
TOKEN_TYPE_KEY = "typ"
FAMILY_KEY     = "fam"


# ── Key management ────────────────────────────────────────────────────────────

def _load_or_generate_keys(app):
    priv_path = Path(app.instance_path) / app.config.get("JWT_PRIVATE_KEY_FILE", "jwt_private.pem")
    pub_path  = Path(app.instance_path) / app.config.get("JWT_PUBLIC_KEY_FILE",  "jwt_public.pem")

    if priv_path.exists() and pub_path.exists():
        log.info("JWT: loaded RS256 key pair from %s / %s", priv_path, pub_path)
        return priv_path.read_bytes(), pub_path.read_bytes()

    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization

    log.warning("JWT key files not found — generating fresh RS2048 key pair. Back these up: %s  %s", priv_path, pub_path)
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv = private_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption())
    pub  = private_key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    os.makedirs(app.instance_path, exist_ok=True)
    priv_path.write_bytes(priv); pub_path.write_bytes(pub)
    os.chmod(priv_path, 0o600)
    return priv, pub


def init_jwt(app):
    priv, pub = _load_or_generate_keys(app)
    app.config["JWT_PRIVATE_KEY"] = priv
    app.config["JWT_PUBLIC_KEY"]  = pub
    app.config.setdefault("JWT_ACCESS_TOKEN_EXPIRES",  900)
    app.config.setdefault("JWT_REFRESH_TOKEN_EXPIRES", 28800)


# ── Token creation ────────────────────────────────────────────────────────────

def _make_token(username, token_type, lifetime, family_id=None):
    now = datetime.now(tz=timezone.utc)
    jti = str(uuid.uuid4())
    exp = now + timedelta(seconds=lifetime)
    payload = {
        "iss": ISSUER, "sub": username, "aud": AUDIENCE,
        "iat": now, "nbf": now, "exp": exp,
        "jti": jti, TOKEN_TYPE_KEY: token_type,
    }
    if family_id:
        payload[FAMILY_KEY] = family_id
    token = jwt.encode(payload, current_app.config["JWT_PRIVATE_KEY"], algorithm=ALGORITHM)
    return token, jti, exp


def create_token_pair(username):
    access_lifetime  = current_app.config["JWT_ACCESS_TOKEN_EXPIRES"]
    refresh_lifetime = current_app.config["JWT_REFRESH_TOKEN_EXPIRES"]
    family_id = str(uuid.uuid4())

    access_token,  access_jti,  access_exp  = _make_token(username, "access",  access_lifetime)
    refresh_token, refresh_jti, refresh_exp = _make_token(username, "refresh", refresh_lifetime, family_id=family_id)

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM admin_users WHERE LOWER(username) = LOWER(%s)", (username,))
            user = cur.fetchone()
        if not user:
            raise ValueError(f"Unknown admin user: {username}")
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO jwt_refresh_families(family_id, admin_user_id, current_jti) VALUES(%s, %s, %s)",
                (family_id, user["id"], refresh_jti),
            )
        conn.commit()

    return {
        "access_token": access_token, "access_jti": access_jti, "access_exp": access_exp,
        "refresh_token": refresh_token, "refresh_jti": refresh_jti, "refresh_exp": refresh_exp,
        "family_id": family_id,
    }


# ── Token validation ──────────────────────────────────────────────────────────

class JWTError(Exception):
    def __init__(self, message, status=401):
        super().__init__(message)
        self.status = status


def _decode_token(token, expected_type):
    try:
        payload = jwt.decode(
            token, current_app.config["JWT_PUBLIC_KEY"],
            algorithms=[ALGORITHM], issuer=ISSUER, audience=AUDIENCE,
            options={"require": ["iss","sub","aud","iat","nbf","exp","jti"],
                     "verify_exp": True, "verify_nbf": True, "leeway": 0},
        )
    except jwt.ExpiredSignatureError:
        raise JWTError("Token has expired")
    except jwt.ImmatureSignatureError:
        raise JWTError("Token not yet valid")
    except jwt.PyJWTError as exc:
        raise JWTError(f"JWT error: {exc}")

    if payload.get(TOKEN_TYPE_KEY) != expected_type:
        raise JWTError(f"Wrong token type (expected {expected_type!r})")

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM jwt_denylist WHERE jti = %s", (payload["jti"],))
            row = cur.fetchone()
    if row:
        raise JWTError("Token has been revoked")

    return payload


# ── Refresh rotation ──────────────────────────────────────────────────────────

def rotate_refresh_token(refresh_token):
    payload   = _decode_token(refresh_token, "refresh")
    jti       = payload["jti"]
    username  = payload["sub"]
    family_id = payload.get(FAMILY_KEY)

    if not family_id:
        raise JWTError("Refresh token missing family claim")

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM jwt_refresh_families WHERE family_id = %s", (family_id,))
            family = cur.fetchone()

        if not family:
            raise JWTError("Unknown token family")
        if family["invalidated"]:
            raise JWTError("Token family has been invalidated")

        if not hmac.compare_digest(family["current_jti"], jti):
            with conn.cursor() as cur:
                cur.execute("UPDATE jwt_refresh_families SET invalidated = 1 WHERE family_id = %s", (family_id,))
            conn.commit()
            raise JWTError("Refresh token reuse detected — please log in again")

        _revoke_jti(conn, jti, "refresh", payload["exp"])
        conn.commit()

    new_pair = create_token_pair(username)

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE jwt_refresh_families SET invalidated = 1 WHERE family_id = %s", (family_id,))
        conn.commit()

    return new_pair


# ── Revocation ────────────────────────────────────────────────────────────────

def _revoke_jti(conn, jti, token_type, exp):
    if isinstance(exp, (int, float)):
        exp_dt = datetime.fromtimestamp(exp, tz=timezone.utc)
    else:
        exp_dt = exp
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO jwt_denylist(jti, token_type, expires_at) VALUES(%s, %s, %s) ON CONFLICT DO NOTHING",
            (jti, token_type, exp_dt),
        )


def revoke_token(token, token_type):
    try:
        payload = jwt.decode(
            token, current_app.config["JWT_PUBLIC_KEY"],
            algorithms=[ALGORITHM], issuer=ISSUER, audience=AUDIENCE,
            options={"verify_exp": False},
        )
    except jwt.PyJWTError:
        return
    with db_connection() as conn:
        _revoke_jti(conn, payload["jti"], token_type, payload.get("exp", 0))
        if token_type == "refresh" and FAMILY_KEY in payload:
            with conn.cursor() as cur:
                cur.execute("UPDATE jwt_refresh_families SET invalidated = 1 WHERE family_id = %s", (payload[FAMILY_KEY],))
        conn.commit()


def revoke_all_tokens_for_user(username):
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM admin_users WHERE LOWER(username) = LOWER(%s)", (username,))
            user = cur.fetchone()
        if not user:
            return
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE jwt_refresh_families SET invalidated = 1 WHERE admin_user_id = %s AND invalidated = 0",
                (user["id"],),
            )
        conn.commit()


# ── Decorators ────────────────────────────────────────────────────────────────

def _extract_bearer(req):
    auth = req.headers.get("Authorization", "")
    return auth[7:].strip() if auth.startswith("Bearer ") else None


def require_admin(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = _extract_bearer(request)
        if not token:
            return jsonify(error="Missing Authorization: Bearer token"), 401
        try:
            payload = _decode_token(token, "access")
        except JWTError as exc:
            return jsonify(error=str(exc)), exc.status

        with db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, must_change_password FROM admin_users WHERE LOWER(username) = LOWER(%s)",
                    (payload["sub"],),
                )
                user = cur.fetchone()
        if not user:
            return jsonify(error="Admin account not found"), 401

        g.admin_username       = payload["sub"]
        g.admin_user_id        = user["id"]
        g.must_change_password = bool(user["must_change_password"])
        return f(*args, **kwargs)
    return wrapper


def require_admin_html(f):
    from flask import redirect, url_for, flash

    @wraps(f)
    def wrapper(*args, **kwargs):
        token = request.cookies.get("access_token") or _extract_bearer(request)
        if not token:
            flash("Please log in.", "warning")
            return redirect(url_for("admin.login_page"))
        try:
            payload = _decode_token(token, "access")
        except JWTError:
            flash("Session expired — please log in again.", "warning")
            return redirect(url_for("admin.login_page"))

        with db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, must_change_password FROM admin_users WHERE LOWER(username) = LOWER(%s)",
                    (payload["sub"],),
                )
                user = cur.fetchone()
        if not user:
            flash("Account not found.", "danger")
            return redirect(url_for("admin.login_page"))

        g.admin_username       = payload["sub"]
        g.admin_user_id        = user["id"]
        g.must_change_password = bool(user["must_change_password"])

        if g.must_change_password and request.endpoint != "admin.change_password_page":
            flash("You must change your password before continuing.", "warning")
            return redirect(url_for("admin.change_password_page"))

        return f(*args, **kwargs)
    return wrapper
