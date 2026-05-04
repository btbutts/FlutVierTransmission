#!/usr/bin/env bash
# PollService/scripts/install.sh
# FlutVier PollService — Ubuntu/Debian installation script.
#
# Installs Node.js, deploys the PollService and SPA files to /opt/flutvier/,
# and registers the service with systemd so it starts automatically on boot.
#
# Usage (run from the repo root after running 'npm run build:all'):
#   sudo bash PollService/scripts/install.sh
#
# Prerequisites:
#   - Ubuntu 20.04+ or Debian 11+ (amd64 / arm64)
#   - Built output: dist/spa/ and dist/pollservice/ must exist in the repo root
#   - Must be run as root (sudo)

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

INSTALL_DIR="/opt/flutvier"
SERVICE_NAME="flutviercompanion"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
SERVICE_USER="www-data"
PORT="19091"
NODE_MAJOR="22"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ── Preflight checks ──────────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  echo "Error: this script must be run as root." >&2
  echo "  Try: sudo bash PollService/scripts/install.sh" >&2
  exit 1
fi

if [[ ! -f /etc/debian_version ]]; then
  echo "Error: this script requires a Debian/Ubuntu system." >&2
  exit 1
fi

if [[ ! -d "${REPO_ROOT}/dist/spa" || ! -d "${REPO_ROOT}/dist/pollservice" ]]; then
  echo "Error: dist/spa/ and dist/pollservice/ not found in ${REPO_ROOT}" >&2
  echo "  Run 'npm run build:all' from the repo root first, then re-run this script." >&2
  exit 1
fi

echo "========================================"
echo " FlutVier PollService — Installation"
echo "========================================"
echo ""

# ── Node.js ───────────────────────────────────────────────────────────────────

install_node() {
  echo "Installing Node.js ${NODE_MAJOR}.x LTS via NodeSource..."
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs
  echo "Node.js $(node --version) installed."
}

if command -v node &>/dev/null; then
  CURRENT_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
  if [[ ${CURRENT_MAJOR} -lt 18 ]]; then
    echo "Node.js v${CURRENT_MAJOR} is too old (minimum: v18). Upgrading to v${NODE_MAJOR}..."
    install_node
  else
    echo "Node.js $(node --version) already installed — skipping."
  fi
else
  install_node
fi

# ── Stop existing service ─────────────────────────────────────────────────────

if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
  echo "Stopping existing ${SERVICE_NAME} service..."
  systemctl stop "${SERVICE_NAME}"
fi

# ── Create install directories ────────────────────────────────────────────────

echo "Creating installation directories in ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}/spa" "${INSTALL_DIR}/pollservice" "${INSTALL_DIR}/data"

# ── Copy built files ──────────────────────────────────────────────────────────

echo "Copying SPA files..."
rm -rf "${INSTALL_DIR}/spa"
cp -r "${REPO_ROOT}/dist/spa" "${INSTALL_DIR}/spa"

echo "Copying PollService files..."
rm -rf "${INSTALL_DIR}/pollservice"
cp -r "${REPO_ROOT}/dist/pollservice" "${INSTALL_DIR}/pollservice"

# ── Install production Node.js dependencies ───────────────────────────────────

echo "Installing production dependencies..."
cd "${INSTALL_DIR}/pollservice"
npm install --omit=dev --silent

# ── Set permissions ───────────────────────────────────────────────────────────

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

# ── Write systemd service unit ────────────────────────────────────────────────

echo "Writing systemd service: ${SERVICE_FILE}"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=FlutVier PollService companion server
Documentation=https://github.com/$(git -C "${REPO_ROOT}" remote get-url origin 2>/dev/null | sed 's/.*github.com[:/]\(.*\)\.git/\1/' || echo 'your-repo')
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/pollservice/index.js
Environment=PORT=${PORT}
Environment=POLLSERVICE_BUILD_DIR=${INSTALL_DIR}/spa
Environment=POLLSERVICE_DATA_DIR=${INSTALL_DIR}/data
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
echo "  Service status: ${STATUS}"
echo "  Web app URL:    http://${HOST_IP}:${PORT}"
echo ""
echo "  Useful commands:"
echo "    systemctl status ${SERVICE_NAME}      # check status"
echo "    journalctl -u ${SERVICE_NAME} -f      # stream logs"
echo "    systemctl restart ${SERVICE_NAME}     # restart"
echo "    systemctl disable ${SERVICE_NAME}     # uninstall from autostart"
echo ""
echo "  To update: run 'npm run build:all' in the repo, then re-run this script."
echo ""
