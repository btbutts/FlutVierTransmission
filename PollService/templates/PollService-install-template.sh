#!/usr/bin/env bash
# Regenerate: npm run build:release   (or: node scripts/generate-install.mjs)
#
# PollService/scripts/install.sh
# FlutVier PollService — Ubuntu/Debian installation script.
#
# Downloads and installs the latest PollService companion and web frontend
# from GitHub Releases, and registers the service with systemd so it starts
# automatically on boot.
#
# Usage:
#   sudo bash install.sh
#
# Prerequisites:
#   - Ubuntu 20.04+ or Debian 11+ (amd64 / arm64)
#   - Must be run as root (sudo)
#   - Requires internet access to download release archives

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

INSTALL_DIR="/opt/flutvier"
SERVICE_NAME="FlutVierCompanion"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
SERVICE_USER="www-data"
NODE_MAJOR="{{NODE_MAJOR}}"

# Secure env file — holds runtime secrets (Transmission credentials) and
# port/URL config. chmod 640 + chown root:www-data keeps it unreadable by
# other users while still accessible to the service process.
ENV_FILE="/etc/flutvier/pollservice.env"

# ── Preflight checks ──────────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  echo "Error: this script must be run as root." >&2
  echo "  Try: sudo bash install.sh" >&2
  exit 1
fi

if [[ ! -f /etc/debian_version ]]; then
  echo "Error: this script requires a Debian/Ubuntu system." >&2
  exit 1
fi

echo "========================================"
echo " FlutVier PollService — Installation"
echo "========================================"
echo ""

# ── Detect Transmission configuration ────────────────────────────────────────
# Read settings.json to determine the RPC port, bind address, and URL prefix.
# This lets the installer auto-configure the companion without user intervention.

TRANSMISSION_PORT="9091"
TRANSMISSION_BIND="0.0.0.0"
TRANSMISSION_URL_PREFIX="/transmission/rpc"
TRANSMISSION_DETECTED=false

if dpkg-query -W -f='${Status}' transmission-daemon 2>/dev/null | grep -q "install ok installed"; then
  echo "Detected transmission-daemon — reading configuration..."
  SETTINGS_CANDIDATE=""

  # The Transmission settings file may sit at one of several paths. Resolve any
  # symlink so we always get the real on-disk location.
  for candidate in \
    "/var/lib/transmission-daemon/info/settings.json" \
    "/var/lib/transmission-daemon/.config/transmission-daemon/settings.json" \
    "/etc/transmission-daemon/settings.json"; do
    if [[ -f "${candidate}" ]]; then
      SETTINGS_CANDIDATE=$(readlink -f "${candidate}")
      break
    fi
  done

  if [[ -n "${SETTINGS_CANDIDATE}" ]]; then
    # Use Python (already required for releases.json parsing) to extract values.
    PARSED=$(python3 - "${SETTINGS_CANDIDATE}" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    cfg = json.load(f)
port   = cfg.get('rpc-port', 9091)
bind   = cfg.get('rpc-bind-address', '0.0.0.0')
prefix = cfg.get('rpc-url', '/transmission/')
# Ensure prefix ends with 'rpc'
if not prefix.endswith('rpc'):
    prefix = prefix.rstrip('/') + '/rpc'
print(f"{port}|{bind}|{prefix}")
PYEOF
)
    TRANSMISSION_PORT="${PARSED%%|*}"
    remainder="${PARSED#*|}"
    TRANSMISSION_BIND="${remainder%%|*}"
    TRANSMISSION_URL_PREFIX="${remainder#*|}"
    TRANSMISSION_DETECTED=true
    echo "  RPC port:   ${TRANSMISSION_PORT}"
    echo "  Bind addr:  ${TRANSMISSION_BIND}"
    echo "  URL prefix: ${TRANSMISSION_URL_PREFIX}"
  else
    echo "  settings.json not found — using defaults."
  fi
else
  echo "transmission-daemon not installed — using default Transmission URL."
fi

# Derive companion port: Transmission RPC port + 10000, capped at 65535.
COMPANION_PORT=$(( TRANSMISSION_PORT + 10000 ))
if [[ ${COMPANION_PORT} -gt 65535 ]]; then
  COMPANION_PORT="19091"
  echo "Warning: computed companion port > 65535; falling back to 19091."
fi

# Build Transmission RPC URL.
# If Transmission binds to all interfaces (0.0.0.0 or ::) use localhost so the
# companion talks over the loopback; otherwise use the configured bind address.
if [[ "${TRANSMISSION_BIND}" == "0.0.0.0" || "${TRANSMISSION_BIND}" == "::" || -z "${TRANSMISSION_BIND}" ]]; then
  TRANSMISSION_RPC_HOST="localhost"
else
  TRANSMISSION_RPC_HOST="${TRANSMISSION_BIND}"
fi
TRANSMISSION_URL="http://${TRANSMISSION_RPC_HOST}:${TRANSMISSION_PORT}${TRANSMISSION_URL_PREFIX}"

echo "  Companion port: ${COMPANION_PORT}"
echo "  Transmission URL: ${TRANSMISSION_URL}"

# ── Node.js ───────────────────────────────────────────────────────────────────

install_node() {
  echo "Installing Node.js ${NODE_MAJOR}.x LTS via NodeSource..."
  apt-get update -qq
  # build-essential and python3-dev are required by node-gyp to compile
  # better-sqlite3's native addon. On Node 22 with prebuilt binaries this is
  # typically a no-op, but the tools must be present as a fallback.
  apt-get install -y -qq curl ca-certificates gnupg build-essential python3-dev unzip
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs
  echo "Node.js $(node --version) installed."
}

if command -v node &>/dev/null; then
  CURRENT_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
  if [[ ${CURRENT_MAJOR} -lt ${NODE_MAJOR} ]]; then
    echo "Node.js v${CURRENT_MAJOR} is too old (minimum: v${NODE_MAJOR}). Upgrading to v${NODE_MAJOR}..."
    install_node
  else
    echo "Node.js $(node --version) already installed — skipping."
  fi
else
  install_node
fi

# Ensure unzip is available regardless of whether Node.js was installed above.
if ! command -v unzip &>/dev/null; then
  echo "Installing unzip..."
  apt-get install -y -qq unzip
fi

# ── Stop existing service ─────────────────────────────────────────────────────
# Also stop and remove any prior install that used a differently-cased service
# name — systemd unit names are case-sensitive on Linux, so a renamed unit
# leaves the old one running and holding the port, causing EADDRINUSE.

OLD_SERVICE_NAME="flutviercompanion"
if systemctl is-active --quiet "${OLD_SERVICE_NAME}" 2>/dev/null; then
  echo "Stopping old ${OLD_SERVICE_NAME} service (renamed to ${SERVICE_NAME})..."
  systemctl stop "${OLD_SERVICE_NAME}"
  systemctl disable "${OLD_SERVICE_NAME}" 2>/dev/null || true
  rm -f "/etc/systemd/system/${OLD_SERVICE_NAME}.service"
  systemctl daemon-reload
fi

if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
  echo "Stopping existing ${SERVICE_NAME} service..."
  systemctl stop "${SERVICE_NAME}"
fi

# ── Create install directories ────────────────────────────────────────────────

echo "Creating installation directories in ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}/web-frontend" "${INSTALL_DIR}/pollservice" "${INSTALL_DIR}/data"

# ── Download release archives ─────────────────────────────────────────────────

RELEASES_JSON_URL="https://api.github.com/repos/{{REPO}}/contents/releases.json"

echo "Fetching releases manifest..."
RELEASES_JSON=$(curl -fsSL -H "Accept: application/vnd.github.raw+json" "${RELEASES_JSON_URL}")

PS_VERSION=$(python3 - "${RELEASES_JSON}" <<'PYEOF'
import json, sys
d = json.loads(sys.argv[1])
print(d['PollService']['latest'])
PYEOF
)

POLLSERVICE_ZIP_URL=$(python3 - "${RELEASES_JSON}" <<'PYEOF'
import json, sys
d = json.loads(sys.argv[1])
v = d['PollService']['latest']
entry = next(r for r in d['PollService']['releases'] if r['version'] == v)
print(entry['zipUrl'])
PYEOF
)

WF_VERSION=$(python3 - "${RELEASES_JSON}" <<'PYEOF'
import json, sys
d = json.loads(sys.argv[1])
print(d['web-frontend']['latest'])
PYEOF
)

FRONTEND_ZIP_URL=$(python3 - "${RELEASES_JSON}" <<'PYEOF'
import json, sys
d = json.loads(sys.argv[1])
v = d['web-frontend']['latest']
entry = next(r for r in d['web-frontend']['releases'] if r['version'] == v)
print(entry['downloadUrl'])
PYEOF
)

if [[ -z "${POLLSERVICE_ZIP_URL}" ]]; then
  echo "Error: PollService download URL is empty in the releases manifest." >&2
  echo "  The PollService release may not have been published yet." >&2
  exit 1
fi

if [[ -z "${FRONTEND_ZIP_URL}" ]]; then
  echo "Error: Web frontend download URL is empty in the releases manifest." >&2
  echo "  The web frontend release may not have been published yet." >&2
  exit 1
fi

echo "Downloading PollService archive (v${PS_VERSION})..."
curl -fsSL "${POLLSERVICE_ZIP_URL}" -o /tmp/flutvier-pollservice.zip
rm -rf "${INSTALL_DIR}/pollservice"
mkdir -p "${INSTALL_DIR}/pollservice"
unzip -q /tmp/flutvier-pollservice.zip -d "${INSTALL_DIR}/pollservice"
rm /tmp/flutvier-pollservice.zip

echo "Downloading web frontend archive (v${WF_VERSION})..."
curl -fsSL "${FRONTEND_ZIP_URL}" -o /tmp/flutvier-web-frontend.zip
rm -rf "${INSTALL_DIR}/web-frontend"
mkdir -p "${INSTALL_DIR}/web-frontend"
unzip -q /tmp/flutvier-web-frontend.zip -d "${INSTALL_DIR}/web-frontend"
rm /tmp/flutvier-web-frontend.zip

# ── Patch companion port into the POJO config file ────────────────────────────
# The web frontend ships with companionPort: 0.  We update it here so the
# browser can locate the companion without a port-offset guess.

POJO_FILE=$(find "${INSTALL_DIR}/web-frontend" -path "*/pollServiceCompanionConfig/pollServiceConf_001.js" 2>/dev/null | head -n 1)
if [[ -n "${POJO_FILE}" ]]; then
  sed -i "s/companionPort: [0-9]*/companionPort: ${COMPANION_PORT}/" "${POJO_FILE}"
  echo "Patched companion port (${COMPANION_PORT}) into ${POJO_FILE}"
else
  echo "Warning: pollServiceConf_001.js not found in web-frontend archive — browser will use port-offset discovery."
fi

# ── Install production Node.js dependencies ───────────────────────────────────

echo "Installing production dependencies..."
cd "${INSTALL_DIR}/pollservice"
npm install --omit=dev --silent

# ── Set permissions ───────────────────────────────────────────────────────────

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

# ── Write secure environment file ─────────────────────────────────────────────
# Credentials and runtime config are kept outside the systemd unit so they are
# not visible to unprivileged users via 'systemctl show' or 'journalctl'.

echo "Writing environment file: ${ENV_FILE}"
mkdir -p "$(dirname "${ENV_FILE}")"
cat > "${ENV_FILE}" <<EOF
PORT=${COMPANION_PORT}
POLLSERVICE_BUILD_DIR=${INSTALL_DIR}/web-frontend
POLLSERVICE_DATA_DIR=${INSTALL_DIR}/data
POLLSERVICE_MIGRATIONS_DIR=${INSTALL_DIR}/pollservice/drizzle
TRANSMISSION_URL=${TRANSMISSION_URL}
POLLSERVICE_POLL_INTERVAL_MS=1000
# Uncomment and fill in the lines below if Transmission RPC requires HTTP Basic Auth:
# TRANSMISSION_USERNAME=your-username
# TRANSMISSION_PASSWORD=your-password
EOF
chmod 640 "${ENV_FILE}"
chown root:"${SERVICE_USER}" "${ENV_FILE}"

# ── Write systemd service unit ────────────────────────────────────────────────

echo "Writing systemd service: ${SERVICE_FILE}"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=FlutVier PollService companion server
Documentation=https://github.com/{{REPO}}
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/pollservice/index.js
EnvironmentFile=${ENV_FILE}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# ── Enable and start the service ──────────────────────────────────────────────

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl start "${SERVICE_NAME}"

# Wait briefly and confirm the service came up.
sleep 2
if systemctl is-active --quiet "${SERVICE_NAME}"; then
  STATUS="running"
else
  STATUS="failed — check logs with: journalctl -u ${SERVICE_NAME} -n 50"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo "========================================"
echo " Installation complete"
echo "========================================"
echo ""
echo "  PollService:    v${PS_VERSION}"
echo "  Web frontend:   v${WF_VERSION}"
echo "  Service status: ${STATUS}"
echo "  Web app URL:    http://${HOST_IP}:${COMPANION_PORT}"
echo ""
if [[ "${TRANSMISSION_DETECTED}" == true ]]; then
  echo "  Transmission RPC auto-detected:"
  echo "    Port:  ${TRANSMISSION_PORT}"
  echo "    URL:   ${TRANSMISSION_URL}"
else
  echo "  Transmission URL: ${TRANSMISSION_URL} (default)"
  echo "  To override: edit ${ENV_FILE} and restart the service."
fi
echo ""
echo "  Useful commands:"
echo "    systemctl status ${SERVICE_NAME}      # check status"
echo "    journalctl -u ${SERVICE_NAME} -f      # stream logs"
echo "    systemctl restart ${SERVICE_NAME}     # restart"
echo "    systemctl disable ${SERVICE_NAME}     # uninstall from autostart"
echo "    nano ${ENV_FILE}                      # edit configuration"
echo ""
echo "  To update: download and re-run this script."
echo ""
