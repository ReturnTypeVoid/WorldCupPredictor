#!/usr/bin/env bash
# install.sh - World Cup 2026 Bracket App server install
#
# Usage:
#   ./install.sh
#
# What it does:
#   1. Installs system packages: Python and PostgreSQL
#   2. Creates a Python virtualenv and installs pip dependencies
#   3. Sets up PostgreSQL user/database/authentication
#   4. Generates a JWT key pair if missing
#   5. Creates a systemd service using Gunicorn
#   6. Prints the generated DATABASE_URL for the user to add to .env
#
# This script does not create, copy, read, or validate .env.
# The app reads .env when the service starts.

set -euo pipefail

# -----------------------------------------------------------------------------
# User configuration
# -----------------------------------------------------------------------------
# Edit these values before running ./install.sh.

# App install directory. This directory must contain this script and the app files.
APP_DIR="${HOME}/WorldCupPredictor"

# systemd service name.
SERVICE_NAME="WorldCupPredictor"

# Port the app listens on.
APP_PORT=5000

# Gunicorn worker count.
# Common starting point: 2 x CPU cores + 1.
GUNICORN_WORKERS=3

# PostgreSQL connection details.
DB_NAME="worldcup"
DB_USER="worldcup"
DB_PORT=5432

# JWT key filenames created inside APP_DIR/instance.
JWT_PRIVATE_KEY_FILE="jwt_private.pem"
JWT_PUBLIC_KEY_FILE="jwt_public.pem"

# -----------------------------------------------------------------------------
# No user-editable values below this line
# -----------------------------------------------------------------------------

info()  { printf '[INFO] %s\n' "$*"; }
ok()    { printf '[OK] %s\n' "$*"; }
warn()  { printf '[WARN] %s\n' "$*"; }
fatal() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }
section() { printf '\n%s\n' "== $* =="; }

validate_identifier() {
    local name="$1"
    local value="$2"

    if [[ ! "$value" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
        fatal "$name must contain only letters, numbers, and underscores, and must not start with a number. Current value: $value"
    fi
}

# Guards
[[ $EUID -eq 0 ]] && fatal "Run as your normal user, not root. The script uses sudo where needed."
[[ -f "${APP_DIR}/wsgi.py" ]] || fatal "App not found at ${APP_DIR}. Copy the app there first."
[[ -f "${APP_DIR}/requirements.txt" ]] || fatal "requirements.txt not found at ${APP_DIR}."

validate_identifier "DB_NAME" "$DB_NAME"
validate_identifier "DB_USER" "$DB_USER"

APP_USER="$(whoami)"
VENV_DIR="${APP_DIR}/.venv"
ENV_FILE="${APP_DIR}/.env"

section "1 / 5 System packages"

install_packages() {
    if command -v apt-get >/dev/null 2>&1; then
        info "Using apt."
        sudo apt-get update -qq
        sudo apt-get install -y python3 python3-venv python3-pip postgresql postgresql-contrib openssl
    elif command -v dnf >/dev/null 2>&1; then
        info "Using dnf."
        sudo dnf install -y python3 python3-pip postgresql-server postgresql-contrib openssl
        sudo postgresql-setup --initdb 2>/dev/null || true
    elif command -v yum >/dev/null 2>&1; then
        info "Using yum."
        sudo yum install -y python3 python3-pip postgresql-server postgresql-contrib openssl
        sudo postgresql-setup initdb 2>/dev/null || true
    else
        fatal "Unsupported package manager. Install python3, postgresql, and openssl manually."
    fi

    ok "System packages installed."
}

install_packages

section "2 / 5 Python virtualenv"

if [[ ! -d "$VENV_DIR" ]]; then
    info "Creating virtualenv at ${VENV_DIR}."
    python3 -m venv "$VENV_DIR"
    ok "Virtualenv created."
else
    ok "Virtualenv already exists. Skipping."
fi

info "Installing Python dependencies."
"${VENV_DIR}/bin/pip" install --upgrade pip -q
"${VENV_DIR}/bin/pip" install -r "${APP_DIR}/requirements.txt" -q

if ! "${VENV_DIR}/bin/python" -c "import gunicorn" >/dev/null 2>&1; then
    info "Gunicorn is not in requirements.txt. Installing it because the systemd service uses it."
    "${VENV_DIR}/bin/pip" install gunicorn -q
fi

ok "Python dependencies installed."

section "3 / 5 PostgreSQL"

PG_SERVICE="postgresql"
for svc in postgresql postgresql@14-main postgresql@15-main postgresql@16-main postgresql-14 postgresql-15 postgresql-16; do
    if systemctl list-unit-files "${svc}.service" >/dev/null 2>&1 | grep -q "${svc}"; then
        PG_SERVICE="$svc"
        break
    fi
done

info "Starting PostgreSQL service: ${PG_SERVICE}."
sudo systemctl enable "$PG_SERVICE" >/dev/null 2>&1 || true
sudo systemctl start "$PG_SERVICE" >/dev/null 2>&1 || true

for _ in $(seq 1 15); do
    pg_isready -q 2>/dev/null && break
    sleep 1
done

pg_isready -q 2>/dev/null || fatal "PostgreSQL did not become ready. Check: sudo systemctl status ${PG_SERVICE}"
ok "PostgreSQL is running."

DB_PASS="$(python3 -c "import secrets, string; print(''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(32)))")"

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}';" 2>/dev/null | grep -q 1; then
    warn "DB user '${DB_USER}' exists. Rotating password."
    sudo -u postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" >/dev/null
else
    info "Creating DB user '${DB_USER}'."
    sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" >/dev/null
    ok "DB user created."
fi

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}';" 2>/dev/null | grep -q 1; then
    warn "Database '${DB_NAME}' already exists. Skipping."
else
    info "Creating database '${DB_NAME}'."
    sudo -u postgres createdb -O "$DB_USER" "$DB_NAME" 2>/dev/null \
        || sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" >/dev/null
    ok "Database '${DB_NAME}' created."
fi

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null || true

PG_HBA="$(sudo -u postgres psql -tAc "SHOW hba_file;" 2>/dev/null | tr -d '[:space:]')"
if [[ -n "$PG_HBA" && -f "$PG_HBA" ]]; then
    if ! sudo grep -q "^host[[:space:]]*${DB_NAME}[[:space:]]*${DB_USER}" "$PG_HBA" 2>/dev/null; then
        sudo cp "$PG_HBA" "${PG_HBA}.bak.$(date +%Y%m%d%H%M%S)"
        HBA_RULE="host    ${DB_NAME}    ${DB_USER}    127.0.0.1/32    scram-sha-256"
        echo "$HBA_RULE" | sudo tee -a "$PG_HBA" >/dev/null

        PG_CONF="$(sudo -u postgres psql -tAc "SHOW config_file;" 2>/dev/null | tr -d '[:space:]')"
        if [[ -n "$PG_CONF" ]] && ! sudo grep -q "^password_encryption" "$PG_CONF" 2>/dev/null; then
            echo "password_encryption = scram-sha-256" | sudo tee -a "$PG_CONF" >/dev/null
        fi

        sudo systemctl reload "$PG_SERVICE" 2>/dev/null || true
        ok "scram-sha-256 rule added to pg_hba.conf."
    else
        ok "pg_hba.conf rule already present."
    fi
fi

if PGPASSWORD="$DB_PASS" psql -U "$DB_USER" -h 127.0.0.1 -p "$DB_PORT" -d "$DB_NAME" -c '\q' >/dev/null 2>&1; then
    ok "Database connection verified."
else
    warn "Connection test failed. The app may still work if PostgreSQL needs a reload."
    warn "Try: sudo systemctl reload ${PG_SERVICE}"
fi

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:${DB_PORT}/${DB_NAME}"

section "4 / 5 JWT key pair"

INSTANCE_DIR="${APP_DIR}/instance"
mkdir -p "$INSTANCE_DIR"
chmod 700 "$INSTANCE_DIR"

JWT_PRIV="${INSTANCE_DIR}/${JWT_PRIVATE_KEY_FILE}"
JWT_PUB="${INSTANCE_DIR}/${JWT_PUBLIC_KEY_FILE}"

if [[ ! -f "$JWT_PRIV" ]]; then
    info "Generating RS2048 JWT key pair."
    openssl genrsa -out "$JWT_PRIV" 2048 2>/dev/null
    openssl rsa -in "$JWT_PRIV" -pubout -out "$JWT_PUB" 2>/dev/null
    chmod 600 "$JWT_PRIV"
    chmod 644 "$JWT_PUB"
    ok "JWT keys generated at ${INSTANCE_DIR}."
else
    ok "JWT keys already exist. Skipping."
fi

section "5 / 5 Systemd service"

BIND_ADDR="0.0.0.0:${APP_PORT}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

sudo tee "$SERVICE_FILE" > /dev/null << SERVICEEOF
[Unit]
Description=World Cup 2026 Bracket App
After=network.target postgresql.service
Requires=postgresql.service

[Service]
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${VENV_DIR}/bin/gunicorn \\
    --workers ${GUNICORN_WORKERS} \\
    --bind ${BIND_ADDR} \\
    --timeout 120 \\
    --access-logfile - \\
    --error-logfile - \\
    wsgi:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICEEOF

sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
ok "Systemd service '${SERVICE_NAME}' installed and enabled."

printf '\nInstall complete.\n\n'
printf 'This installer has not created, copied, read, or validated .env.\n'
printf 'Create or edit the app environment file yourself:\n'
printf '  nano %s\n\n' "$ENV_FILE"
printf 'Add this database connection string to .env:\n'
printf '  DATABASE_URL=%s\n\n' "$DATABASE_URL"
