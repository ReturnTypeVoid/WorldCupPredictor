# World Cup 2026 Bracket Predictor

A Flask/PostgreSQL web app for creating and sharing FIFA World Cup 2026 bracket predictions, with a fully JWT-secured admin area.

---

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Copy and edit the env file
cp .env.example .env
# Fill in SECRET_KEY, INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_PASSWORD

# 3. Run (dev)
python3 wsgi.py

# 4. Run (production, behind nginx)
gunicorn -w 3 wsgi:app
```

On first run the app will:
- Generate an RS2048 key pair at `instance/jwt_private.pem` / `instance/jwt_public.pem`
- Bootstrap the admin account (if env vars are set and valid)

---

## Admin Area

Visit `/admin/login` — this page is not linked from anywhere public.

---

## JWT Security Design

### Algorithm: RS256 (asymmetric)

The private key (`jwt_private.pem`) signs tokens. The public key (`jwt_public.pem`) verifies them. In a multi-server setup, read-only replicas only need the public key and cannot mint new tokens.

The algorithm is hardcoded to `RS256` — `alg: none` and symmetric algorithms (`HS256`) are rejected by construction.

### Token pair

| Token   | Lifetime     | Storage                          | Purpose                      |
|---------|-------------|----------------------------------|------------------------------|
| Access  | 15 minutes  | `sessionStorage` (JS-accessible) | Sent as `Authorization: Bearer` on every API call |
| Refresh | 8 hours     | `HttpOnly Secure SameSite=Strict` cookie, scoped to `/admin` | Used only to rotate access tokens |

The refresh token is **never readable by JavaScript**. An XSS attacker can steal the access token from `sessionStorage` but cannot obtain the refresh token (so they get at most 15 minutes of access).

### Claims

Every token carries:

| Claim | Value                  | Purpose                                      |
|-------|------------------------|----------------------------------------------|
| `iss` | `worldcup2026`         | Reject tokens from other issuers             |
| `sub` | admin username         | Identity                                     |
| `aud` | `worldcup-admin`       | Reject tokens intended for other services    |
| `iat` | issued-at timestamp    | Audit / ordering                             |
| `nbf` | = `iat`                | Explicit not-before (no early use)           |
| `exp` | expiry timestamp       | Hard expiry enforced server-side             |
| `jti` | UUID v4                | Unique ID — enables denylist + reuse detect  |
| `typ` | `access` / `refresh`   | Prevents access tokens being used as refresh tokens and vice-versa |
| `fam` | UUID v4 (refresh only) | Token family — enables rotation + reuse detection |

Leeway is set to **0** — no clock-skew tolerance.

### Refresh token rotation

On every use of a refresh token:
1. The token is decoded and validated.
2. Its `jti` is compared (constant-time) against the family's `current_jti` in the DB.
3. The old token is immediately added to the denylist.
4. A **new token pair** is issued under a new family ID.
5. The old family record is marked `invalidated = 1`.

**Reuse detection (theft signal):** If a previously-rotated refresh token is presented again, its JTI no longer matches `current_jti`. The entire family is immediately invalidated, forcing a full re-login. This implements the [OAuth 2.0 Security BCP §4.14](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics#section-4.14) refresh-token rotation pattern.

### Denylist

Both token types can be individually revoked by inserting their `jti` into `jwt_denylist`. Checked on every request. Expired rows are pruned at startup (rows older than 1 day past their `expires_at`).

Used for:
- Logout (revokes both current tokens)
- Password change (revokes ALL families + current tokens)
- Forced invalidation by an admin

### Password change → forced re-authentication everywhere

`POST /admin/api/change-password` calls `revoke_all_tokens_for_user()` which:
1. Sets `invalidated = 1` on every active refresh family in the DB.
2. Revokes the current access + refresh tokens via the denylist.

Any other sessions (other browsers/devices) will get a 401 on their next refresh attempt and be redirected to the login page.

### Brute-force protection

- Per-(username, IP) failed login attempts are recorded in `admin_login_attempts`.
- After **8 failures in 15 minutes**, further attempts return 429.
- The login endpoint is also rate-limited to 20 requests/minute per IP (in-memory sliding window).
- Constant-time password comparison (via Werkzeug's `check_password_hash`) even when the username does not exist, preventing timing-oracle username enumeration.

### Security headers

Every response carries:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Content-Security-Policy: default-src 'self'; script-src 'self'; ...
Strict-Transport-Security: max-age=63072000; ... (when FORCE_HTTPS=1)
```

### Key rotation

To rotate the RS256 key pair:

```bash
# Generate new keys
openssl genrsa -out instance/jwt_private_new.pem 2048
openssl rsa -in instance/jwt_private_new.pem -pubout -out instance/jwt_public_new.pem

# Revoke all active sessions (forces re-login)
flask shell
>>> from app.db import db_connection
>>> with db_connection() as conn:
...     conn.execute("UPDATE jwt_refresh_families SET invalidated = 1")
...     conn.commit()

# Swap files and restart
mv instance/jwt_private_new.pem instance/jwt_private.pem
mv instance/jwt_public_new.pem  instance/jwt_public.pem
systemctl restart worldcup
```

---

## Configuration

| Variable                    | Purpose                                              | Default          |
|-----------------------------|------------------------------------------------------|------------------|
| `SECRET_KEY`                | Flask session signing key                            | ephemeral        |
| `INITIAL_ADMIN_USERNAME`    | Bootstrap admin username (first run only)            | —                |
| `INITIAL_ADMIN_PASSWORD`    | Bootstrap admin password (≥12 chars)                 | —                |
| `JWT_PRIVATE_KEY_FILE`      | Path to RSA private key PEM (relative to `instance/`)| `jwt_private.pem`|
| `JWT_PUBLIC_KEY_FILE`       | Path to RSA public key PEM                           | `jwt_public.pem` |
| `JWT_ACCESS_TOKEN_EXPIRES`  | Access token lifetime (seconds)                      | `900` (15 min)   |
| `JWT_REFRESH_TOKEN_EXPIRES` | Refresh token lifetime (seconds)                     | `28800` (8 h)    |
| `FORCE_HTTPS`               | Set to `1` behind nginx+Certbot                      | `0`              |
| `API_FOOTBALL_KEY`          | API-Football key for live scores                     | —                |
| `LIVE_SYNC_INTERVAL_SECONDS`| Sync frequency                                       | `300`            |
| `DISABLE_LIVE_SYNC`         | Set to `1` to disable background sync               | `0`              |

---

## Project Structure

```
worldcup2026/
├── wsgi.py                    # Entry point
├── requirements.txt
├── .env.example
├── instance/                  # Created at runtime
│   ├── worldcup.db
│   ├── jwt_private.pem        # RS256 private key (chmod 600)
│   └── jwt_public.pem
└── app/
    ├── __init__.py            # create_app(), security headers, bootstrap
    ├── db.py                  # SQLite helpers, schema, migrations
    ├── jwt_auth.py            # RS256 tokens, rotation, denylist, decorators
    ├── naming.py              # word.word.word slug generator
    ├── rate_limit.py          # Sliding-window + DB brute-force protection
    ├── blueprints/
    │   ├── admin.py           # Admin login, refresh, logout, dashboard
    │   ├── api.py             # Public bracket JSON API
    │   └── public.py          # Public HTML pages
    └── templates/
        ├── admin/
        │   ├── base.html      # Token management JS, auto-refresh scheduler
        │   ├── login.html
        │   ├── dashboard.html
        │   ├── session_detail.html
        │   └── change_password.html
        └── public/
            ├── index.html
            ├── bracket.html
            └── 404.html
```
