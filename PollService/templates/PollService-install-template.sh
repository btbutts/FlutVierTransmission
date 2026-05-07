#!/usr/bin/env bash
# Regenerate: npm run build:release   (or: node build-scripts/generate-install.mjs)
#
# PollService/scripts/install.sh
# FlutVier PollService — Multi-distro installation script.
#
# Supports modern, in-support versions of:
#   - Debian 12+, Ubuntu 22.04+, Linux Mint 21+, Raspberry Pi OS (apt + systemd)
#   - Arch Linux (current rolling, pacman + systemd)
#   - Alpine Linux 3.20+ (apk + OpenRC)   [requires bash: apk add bash]
#   - Fedora 38+, CentOS Stream 9+, Rocky Linux 9+, AlmaLinux 9+ (dnf + systemd)
#
# Downloads and installs the latest PollService companion and web frontend
# from GitHub Releases, installs Node.js (if needed), creates a dedicated
# service user, registers the service (systemd or OpenRC), and configures
# it to start automatically on boot.
#
# Usage:
#   sudo bash install.sh [OPTIONS]
#   sudo bash install.sh --help
#
# Prerequisites:
#   - One of the supported Linux distributions above (amd64 / arm64)
#   - Must be run as root (sudo)
#   - Requires internet access to download release archives and packages

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

INSTALL_DIR="/opt/flutvier"
SERVICE_NAME="FlutVierCompanion"
SERVICE_USER="www-data"
SERVICE_GROUP="www-data"
NODE_MAJOR="{{NODE_MAJOR}}"

# Secure env file — holds runtime secrets (Transmission credentials) and
# port/URL config. chmod 640 + chown root:www-data keeps it unreadable by
# other users while still accessible to the service process.
ENV_FILE="/etc/flutvier/pollservice.env"

# Set during distro/init detection
DISTRO_FAMILY=""
INIT_SYSTEM=""
SERVICE_FILE=""

# Set during Transmission detection
TRANSMISSION_PORT="9091"
TRANSMISSION_BIND="0.0.0.0"
TRANSMISSION_URL_PREFIX="/transmission/rpc"
TRANSMISSION_DETECTED=false
COMPANION_PORT=""
TRANSMISSION_URL=""

# Set after archive download (used in print_summary)
PS_VERSION=""
WF_VERSION=""

# Set after service start attempt (used in print_summary)
STATUS=""

# Populated by parse_args; empty string means "use auto-detection / default".
CUSTOM_PORT=""
CUSTOM_SETTINGS_PATH=""

# ── print_usage ───────────────────────────────────────────────────────────────

print_usage() {
  cat <<'EOF'
Usage:
  sudo bash install.sh [OPTIONS]

Description:
  Installs and configures the FlutVier PollService companion and web frontend
  from GitHub Releases. Detects Transmission's RPC configuration automatically
  and registers the service with systemd (or OpenRC on Alpine Linux).

Supported distributions:
  Debian 12+, Ubuntu 22.04+, Linux Mint 21+, Raspberry Pi OS
  Arch Linux (current rolling release)
  Alpine Linux 3.20+  (requires bash pre-installed: apk add bash)
  Fedora 38+, CentOS Stream 9+, Rocky Linux 9+, AlmaLinux 9+

Options:
  -h, --help                       Show this help text and exit.
  -u, --usage                      Alias for --help.

  -p, --port <PORT>                Port for the PollService companion to listen
                                   on. When omitted, the port is derived from
                                   Transmission's RPC port + 10000 (default
                                   result: 19091). The supplied port is checked
                                   to be free before installation proceeds.

  -t, --transmission-config-source <PATH>
                                   Explicit path to Transmission's settings.json.
                                   When omitted, the script searches /var/lib
                                   automatically. The file is validated for the
                                   required RPC keys before use.

  -U, --service-user <USER>        OS user the PollService process runs as.
                                   Default: www-data

  -G, --service-group <GROUP>      OS group used for file-permission ownership.
                                   Default: www-data

Examples:
  sudo bash install.sh
  sudo bash install.sh --port 18080
  sudo bash install.sh --transmission-config-source /etc/transmission-daemon/settings.json
  sudo bash install.sh --service-user myuser --service-group mygroup
  sudo bash install.sh -p 18080 -t /etc/transmission-daemon/settings.json -U svcuser -G svcgrp

EOF
}

# ── parse_args ────────────────────────────────────────────────────────────────
# Must be called before check_root so --help works without sudo.

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help|-u|--usage)
        print_usage
        exit 0
        ;;
      -p|--port)
        if [[ $# -lt 2 || "$2" == -* ]]; then
          echo "Error: --port requires a value." >&2
          echo "  Example: --port 18080" >&2
          exit 1
        fi
        CUSTOM_PORT="$2"
        shift 2
        ;;
      -t|--transmission-config-source)
        if [[ $# -lt 2 || "$2" == -* ]]; then
          echo "Error: --transmission-config-source requires a value." >&2
          echo "  Example: --transmission-config-source /etc/transmission-daemon/settings.json" >&2
          exit 1
        fi
        CUSTOM_SETTINGS_PATH="$2"
        shift 2
        ;;
      -U|--service-user)
        if [[ $# -lt 2 || "$2" == -* ]]; then
          echo "Error: --service-user requires a value." >&2
          echo "  Example: --service-user myuser" >&2
          exit 1
        fi
        SERVICE_USER="$2"
        shift 2
        ;;
      -G|--service-group)
        if [[ $# -lt 2 || "$2" == -* ]]; then
          echo "Error: --service-group requires a value." >&2
          echo "  Example: --service-group mygroup" >&2
          exit 1
        fi
        SERVICE_GROUP="$2"
        shift 2
        ;;
      *)
        echo "Error: unknown argument: $1" >&2
        echo "  Run with --help for usage information." >&2
        exit 1
        ;;
    esac
  done
}

# ── check_root ────────────────────────────────────────────────────────────────

check_root() {
  if [[ $EUID -ne 0 ]]; then
    echo "Error: this script must be run as root." >&2
    echo "  Try: sudo bash install.sh" >&2
    exit 1
  fi
}

# ── print_header ──────────────────────────────────────────────────────────────

print_header() {
  echo "========================================"
  echo " FlutVier PollService — Installation"
  echo "========================================"
  echo ""
}

# ── detect_distro_and_init ────────────────────────────────────────────────────
# Uses /etc/os-release (standard on all modern Linux) to identify the distro
# family and init system. Only modern, in-support releases are targeted.
#
# Raspberry Pi OS carries ID=raspios (or ID=raspbian on older images) and
# ID_LIKE=debian, so it falls into the debian family automatically.
# Linux Mint carries ID=linuxmint and ID_LIKE=ubuntu, likewise detected below.
# ID_LIKE is optional in the spec, so it is guarded with a default-empty
# expansion to avoid errors under set -u.

detect_distro_and_init() {
  if [[ ! -f /etc/os-release ]]; then
    echo "Error: /etc/os-release not found — unsupported system." >&2
    exit 1
  fi

  # shellcheck source=/dev/null
  . /etc/os-release

  local ID_LIKE_SAFE="${ID_LIKE-}"

  if [[ "${ID}" == "debian"    || "${ID}" == "ubuntu"    || \
        "${ID}" == "linuxmint" || "${ID}" == "raspios"   || \
        "${ID}" == "raspbian"  || \
        "${ID_LIKE_SAFE}" == *"debian"* || "${ID_LIKE_SAFE}" == *"ubuntu"* ]]; then
    DISTRO_FAMILY="debian"
    echo "Detected Debian-family system (${PRETTY_NAME:-${ID}}) — using apt + systemd"
  elif [[ "${ID}" == "arch" ]]; then
    DISTRO_FAMILY="arch"
    echo "Detected Arch Linux (${PRETTY_NAME:-arch}) — using pacman + systemd"
  elif [[ "${ID}" == "alpine" ]]; then
    DISTRO_FAMILY="alpine"
    echo "Detected Alpine Linux (${PRETTY_NAME:-alpine}) — using apk + OpenRC"
  elif [[ "${ID}" == "fedora"    || "${ID}" == "centos"    || \
          "${ID}" == "rhel"      || "${ID}" == "rocky"     || \
          "${ID}" == "almalinux" || \
          "${ID_LIKE_SAFE}" == *"rhel"* || "${ID_LIKE_SAFE}" == *"fedora"* ]]; then
    DISTRO_FAMILY="fedora"
    echo "Detected Fedora-family system (${PRETTY_NAME:-${ID}}) — using dnf + systemd"
  else
    echo "Error: unsupported distribution: ${ID} (${PRETTY_NAME:-unknown})." >&2
    echo "  Supported: Debian 12+, Ubuntu 22.04+, Mint 21+, Raspberry Pi OS," >&2
    echo "             Arch Linux, Alpine 3.20+, Fedora 38+, CentOS Stream 9+" >&2
    exit 1
  fi

  # Determine init system. systemd is standard on all supported distros except
  # Alpine, which defaults to OpenRC.
  if command -v systemctl >/dev/null 2>&1; then
    INIT_SYSTEM="systemd"
    SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
  elif [[ "${DISTRO_FAMILY}" == "alpine" ]]; then
    INIT_SYSTEM="openrc"
    SERVICE_FILE="/etc/init.d/${SERVICE_NAME}"
  else
    echo "Error: could not detect init system (systemd not found)." >&2
    exit 1
  fi

  echo "  Init system: ${INIT_SYSTEM}"
}

# ── install_base_dependencies ─────────────────────────────────────────────────
# Installs tools needed before any other step: curl (downloads), python3 (JSON
# parsing and node-gyp invocation), unzip (archive extraction), and TLS/GPG
# support for package manager key verification and HTTPS downloads.

install_base_dependencies() {
  echo "Installing base dependencies..."

  case "${DISTRO_FAMILY}" in
    debian)
      apt-get update -qq
      apt-get install -y -qq curl ca-certificates gnupg unzip python3 python3-dev
      ;;
    arch)
      # python is the Arch package name for Python 3 (includes headers).
      pacman -Sy --noconfirm --needed curl unzip python
      ;;
    alpine)
      # python3-dev provides Python headers — needed as a node-gyp fallback
      # for native addon compilation (same rationale as Debian's python3-dev).
      apk add --no-cache curl ca-certificates unzip python3 python3-dev
      ;;
    fedora)
      dnf install -y -q curl ca-certificates unzip python3 python3-devel
      ;;
  esac
}

# ── ensure_service_user ───────────────────────────────────────────────────────
# Creates the SERVICE_USER/SERVICE_GROUP if absent. Debian-family systems ship
# www-data by default. Arch, Alpine, and Fedora-family require explicit creation.
# If --service-user / --service-group were supplied, those values are used here.

ensure_service_user() {
  echo "Ensuring service user/group (${SERVICE_USER}:${SERVICE_GROUP}) exists..."

  if ! getent group "${SERVICE_GROUP}" >/dev/null 2>&1; then
    echo "  Creating group ${SERVICE_GROUP}..."
    if [[ "${DISTRO_FAMILY}" == "alpine" ]]; then
      addgroup -S "${SERVICE_GROUP}"
    else
      groupadd -r "${SERVICE_GROUP}" 2>/dev/null || true
    fi
  fi

  if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
    echo "  Creating user ${SERVICE_USER}..."
    if [[ "${DISTRO_FAMILY}" == "alpine" ]]; then
      adduser -S -D -H -s /sbin/nologin -G "${SERVICE_GROUP}" "${SERVICE_USER}"
    else
      useradd -r -g "${SERVICE_GROUP}" -s /usr/sbin/nologin -d /nonexistent "${SERVICE_USER}" 2>/dev/null || true
    fi
  fi
}

# ── check_port_available ──────────────────────────────────────────────────────
# Validates that PORT is a legal integer (1-65535) and is not currently bound
# by a listening process. Exits with a descriptive error — and names the
# offending process where possible — if the port is taken.
#
# Uses ss (iproute2, universal on modern Linux). Falls back to netstat if ss
# is absent (e.g. a minimal Alpine image). If neither tool is available the
# check is skipped with a warning.
#
# Call this AFTER stop_existing_service so the previous FlutVier service does
# not produce a false "port in use" conflict on the same port.

check_port_available() {
  local PORT="$1"

  if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
    echo "Error: invalid port '${PORT}' — must be an integer between 1 and 65535." >&2
    exit 1
  fi

  local IN_USE=false
  local IN_USE_BY=""

  if command -v ss >/dev/null 2>&1; then
    # Column 5 of 'ss -ltn' is the local address:port (e.g. 0.0.0.0:9091 or
    # [::]:9091). Splitting on ':' and taking the last field isolates the port
    # number for both IPv4 and IPv6 address formats.
    if ss -ltn 2>/dev/null \
        | awk '{print $5}' \
        | awk -F: '{print $NF}' \
        | grep -qx "${PORT}"; then
      IN_USE=true
      # Running as root so ss -p includes process ownership in the last field:
      # users:(("processname",pid=N,fd=N)). Extract the process name from it.
      IN_USE_BY=$(ss -ltnp 2>/dev/null \
        | awk -v p="${PORT}" '{n=split($5,a,":"); if(a[n]==p) print $NF}' \
        | sed 's/users:(("//;s/".*//' \
        | head -1 2>/dev/null || true)
    fi
  elif command -v netstat >/dev/null 2>&1; then
    # netstat -ltn column 4 is the local address:port.
    if netstat -ltn 2>/dev/null \
        | awk '{print $4}' \
        | awk -F: '{print $NF}' \
        | grep -qx "${PORT}"; then
      IN_USE=true
      # netstat -ltnp column 7 is "PID/processname"; strip the PID prefix.
      IN_USE_BY=$(netstat -ltnp 2>/dev/null \
        | awk -v p=":${PORT}" '$4 ~ p {print $7}' \
        | sed 's|[0-9]*/||' \
        | head -1 2>/dev/null || true)
    fi
  else
    echo "Warning: neither ss nor netstat found — skipping port availability check."
    return 0
  fi

  if [[ "${IN_USE}" == true ]]; then
    if [[ -n "${IN_USE_BY}" ]]; then
      echo "Error: port ${PORT} is already in use by '${IN_USE_BY}'." >&2
    else
      echo "Error: port ${PORT} is already in use." >&2
    fi
    echo "  Choose a different port and re-run with: --port <PORT>" >&2
    exit 1
  fi
}

# ── validate_transmission_config ──────────────────────────────────────────────
# Validates that CONFIG_PATH is a readable, well-formed Transmission
# settings.json containing the RPC keys this script requires. Exits with a
# clear, actionable error message if the file is absent, unreadable, not valid
# JSON, or missing/malformed required keys.
#
# Required keys: rpc-port (integer 1-65535), rpc-bind-address (any string),
#                rpc-url (non-empty string).

validate_transmission_config() {
  local CONFIG_PATH="$1"

  if [[ ! -f "${CONFIG_PATH}" ]]; then
    echo "Error: Transmission config file not found: '${CONFIG_PATH}'" >&2
    exit 1
  fi

  if [[ ! -r "${CONFIG_PATH}" ]]; then
    echo "Error: cannot read '${CONFIG_PATH}' — permission denied." >&2
    echo "  Try: sudo chmod o+r '${CONFIG_PATH}'" >&2
    exit 1
  fi

  python3 - "${CONFIG_PATH}" <<'PYEOF'
import json, sys

path = sys.argv[1]
try:
    with open(path) as f:
        cfg = json.load(f)
except json.JSONDecodeError as exc:
    print(f"Error: '{path}' is not valid JSON: {exc}", file=sys.stderr)
    sys.exit(1)

errors = []

port = cfg.get('rpc-port')
if port is None:
    errors.append("  - 'rpc-port' key is missing")
elif not isinstance(port, int) or not (1 <= port <= 65535):
    errors.append(f"  - 'rpc-port' value {port!r} is not a valid port number (1-65535)")

if 'rpc-bind-address' not in cfg:
    errors.append("  - 'rpc-bind-address' key is missing")

url = cfg.get('rpc-url')
if url is None:
    errors.append("  - 'rpc-url' key is missing")
elif not isinstance(url, str) or not url.strip():
    errors.append(f"  - 'rpc-url' value {url!r} is not a valid non-empty string")

if errors:
    print(f"Error: '{path}' is missing required Transmission RPC configuration:", file=sys.stderr)
    for e in errors:
        print(e, file=sys.stderr)
    print("  Re-run with --transmission-config-source to specify a different file.", file=sys.stderr)
    sys.exit(1)
PYEOF
}

# ── _is_valid_transmission_config ─────────────────────────────────────────────
# Silent helper used during automatic discovery. Returns 0 if PATH is a
# readable, well-formed settings.json with at least an 'rpc-port' key set to a
# valid integer. Returns 1 for any failure without printing anything.
# Intentionally minimal — full error reporting is handled by
# validate_transmission_config when a file is actually selected for use.

_is_valid_transmission_config() {
  local path="$1"
  [[ -f "${path}" && -r "${path}" ]] || return 1
  python3 - "${path}" <<'PYEOF' 2>/dev/null
import json, sys
try:
    with open(sys.argv[1]) as f:
        cfg = json.load(f)
    port = cfg.get('rpc-port')
    sys.exit(0 if isinstance(port, int) and 1 <= port <= 65535 else 1)
except Exception:
    sys.exit(1)
PYEOF
}

# ── find_transmission_settings ────────────────────────────────────────────────
# Searches /var/lib for settings.json files whose path contains "transmission",
# resolves all results to their real on-disk paths via readlink -f to eliminate
# duplicates arising from symlinked directories (e.g. Debian's
# transmission-daemon/info/ -> .config/transmission-daemon/ relationship).
#
# Each unique real path is silently validated. Among valid candidates the most
# recently modified file is preferred — that is the one Transmission-daemon is
# actively writing its state to.
#
# /etc/transmission-daemon/settings.json is treated as a last-resort fallback
# only: it is the template file shipped by the package and almost never the
# live config the daemon actually reads. It is only accepted if it passes
# validation (i.e. has a configured rpc-port) and no /var/lib candidate exists.
#
# Prints diagnostic messages to stderr. Emits the selected path (or nothing
# when no valid config is found) to stdout for capture by the caller.

find_transmission_settings() {
  echo "  Searching /var/lib for Transmission settings.json..." >&2

  local candidate real dup existing found=""
  local -a real_paths=()
  local -a valid_paths=()

  # find -type f skips symlinks, so symlinked paths to the same underlying
  # file are seen only once by find. readlink -f then normalises any remaining
  # path differences (e.g. double-slashes, . components) for deduplication.
  while IFS= read -r candidate; do
    real=$(readlink -f "${candidate}" 2>/dev/null || echo "${candidate}")
    dup=false
    for existing in "${real_paths[@]+"${real_paths[@]}"}"; do
      if [[ "${existing}" == "${real}" ]]; then
        dup=true
        break
      fi
    done
    [[ "${dup}" == false ]] && real_paths+=("${real}")
  done < <(find /var/lib -type f -name "settings.json" -path "*transmission*" 2>/dev/null | sort)

  for real in "${real_paths[@]+"${real_paths[@]}"}"; do
    if _is_valid_transmission_config "${real}"; then
      valid_paths+=("${real}")
    fi
  done

  if [[ ${#valid_paths[@]} -eq 1 ]]; then
    found="${valid_paths[0]}"
  elif [[ ${#valid_paths[@]} -gt 1 ]]; then
    # Multiple valid files — prefer the most recently modified (Transmission's
    # active config is written on every settings change). Python's os.path.getmtime
    # handles paths with spaces and avoids locale/collation issues with ls.
    found=$(python3 - "${valid_paths[@]}" <<'PYEOF'
import os, sys
paths = sys.argv[1:]
print(max(paths, key=lambda p: os.path.getmtime(p)))
PYEOF
)
    echo "  Multiple Transmission config files found; using most recently modified:" >&2
    echo "    ${found}" >&2
    echo "  Override with: --transmission-config-source <PATH>" >&2
  fi

  # Fall back to the /etc template ONLY if no /var/lib candidate was found AND
  # the template actually contains a configured rpc-port (not a zero/null default).
  if [[ -z "${found}" ]]; then
    local etc_path="/etc/transmission-daemon/settings.json"
    if _is_valid_transmission_config "${etc_path}"; then
      echo "  Warning: only found Transmission config at ${etc_path}." >&2
      echo "  This file is typically a package template, not the active config." >&2
      echo "  If RPC settings appear incorrect, re-run with:" >&2
      echo "    --transmission-config-source <PATH>" >&2
      found="${etc_path}"
    fi
  fi

  echo "${found}"
}

# ── is_transmission_installed ─────────────────────────────────────────────────
# Returns 0 (true) if transmission-daemon is installed, 1 (false) otherwise.
# Used by detect_transmission_config for accurate pre-detection messaging.

is_transmission_installed() {
  case "${DISTRO_FAMILY}" in
    debian)
      dpkg-query -W -f='${Status}' transmission-daemon 2>/dev/null | grep -q "install ok installed"
      ;;
    arch)
      # On Arch the daemon is provided by the transmission-cli package.
      pacman -Q transmission-cli >/dev/null 2>&1 || pacman -Q transmission-daemon >/dev/null 2>&1
      ;;
    alpine)
      apk info -e transmission-daemon >/dev/null 2>&1
      ;;
    fedora)
      rpm -q transmission-daemon >/dev/null 2>&1
      ;;
    *)
      return 1
      ;;
  esac
}

# ── detect_transmission_config ────────────────────────────────────────────────
# Determines the Transmission RPC port, bind address, and URL prefix so the
# companion can be pre-configured to talk to the local daemon.
#
# Config source priority:
#   1. --transmission-config-source <PATH>  (user-supplied; validated then used)
#   2. Automatic /var/lib search via find_transmission_settings()
#   3. Defaults (port 9091, bind 0.0.0.0, prefix /transmission/rpc)
#
# COMPANION_PORT is derived here as TRANSMISSION_PORT + 10000. If --port was
# supplied, main() overrides COMPANION_PORT after this function returns.

detect_transmission_config() {
  local SETTINGS_CANDIDATE=""

  if [[ -n "${CUSTOM_SETTINGS_PATH}" ]]; then
    # User explicitly provided a path — validate it and always use it,
    # regardless of whether transmission-daemon is detectable via package manager.
    echo "Using user-supplied Transmission config: ${CUSTOM_SETTINGS_PATH}"
    validate_transmission_config "${CUSTOM_SETTINGS_PATH}"
    SETTINGS_CANDIDATE="${CUSTOM_SETTINGS_PATH}"
    TRANSMISSION_DETECTED=true
  elif is_transmission_installed; then
    echo "Detected transmission-daemon — reading configuration..."
    SETTINGS_CANDIDATE=$(find_transmission_settings)
    [[ -n "${SETTINGS_CANDIDATE}" ]] && TRANSMISSION_DETECTED=true
  else
    echo "transmission-daemon not installed — using default Transmission URL."
  fi

  if [[ -n "${SETTINGS_CANDIDATE}" ]]; then
    # Use Python (guaranteed installed by install_base_dependencies) to extract values.
    local PARSED
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
    local remainder="${PARSED#*|}"
    TRANSMISSION_BIND="${remainder%%|*}"
    TRANSMISSION_URL_PREFIX="${remainder#*|}"
    echo "  Config:     ${SETTINGS_CANDIDATE}"
    echo "  RPC port:   ${TRANSMISSION_PORT}"
    echo "  Bind addr:  ${TRANSMISSION_BIND}"
    echo "  URL prefix: ${TRANSMISSION_URL_PREFIX}"
  else
    echo "  settings.json not found — using defaults."
  fi

  # Derive companion port: Transmission RPC port + 10000, capped at 65535.
  # If --port was supplied, main() will override this value after returning.
  COMPANION_PORT=$(( TRANSMISSION_PORT + 10000 ))
  if [[ ${COMPANION_PORT} -gt 65535 ]]; then
    COMPANION_PORT="19091"
    echo "Warning: computed companion port > 65535; falling back to 19091."
  fi

  # Build Transmission RPC URL.
  # If Transmission binds to all interfaces (0.0.0.0 or ::) use localhost so the
  # companion talks over the loopback; otherwise use the configured bind address.
  local TRANSMISSION_RPC_HOST
  if [[ "${TRANSMISSION_BIND}" == "0.0.0.0" || "${TRANSMISSION_BIND}" == "::" || -z "${TRANSMISSION_BIND}" ]]; then
    TRANSMISSION_RPC_HOST="localhost"
  else
    TRANSMISSION_RPC_HOST="${TRANSMISSION_BIND}"
  fi
  TRANSMISSION_URL="http://${TRANSMISSION_RPC_HOST}:${TRANSMISSION_PORT}${TRANSMISSION_URL_PREFIX}"

  echo "  Companion port: ${COMPANION_PORT}"
  echo "  Transmission URL: ${TRANSMISSION_URL}"
}

# ── install_node ──────────────────────────────────────────────────────────────
# Installs Node.js following each distro's recommended practices. NodeSource is
# used for Debian-family and Fedora-family to pin a specific LTS major version.
# Arch and Alpine pull from their native repositories (always current).
#
# Build tools are installed on every distro as a fallback for node-gyp in case
# better-sqlite3's native addon cannot use a prebuilt binary and must be
# compiled from source.

install_node() {
  case "${DISTRO_FAMILY}" in
    debian)
      echo "Installing Node.js ${NODE_MAJOR}.x LTS via NodeSource..."
      # build-essential is required by node-gyp to compile better-sqlite3's
      # native addon. On Node 22 with prebuilt binaries this is typically a
      # no-op, but the tools must be present as a fallback.
      apt-get install -y -qq build-essential
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
      apt-get install -y -qq nodejs
      ;;
    arch)
      echo "Installing/upgrading Node.js via pacman..."
      # base-devel provides make, gcc, etc. required by node-gyp (fallback only).
      pacman -S --noconfirm --needed nodejs npm base-devel
      ;;
    alpine)
      echo "Installing/upgrading Node.js via apk..."
      # build-base provides gcc, make, musl-dev, etc. required by node-gyp (fallback only).
      apk add --no-cache nodejs npm build-base
      ;;
    fedora)
      echo "Installing Node.js ${NODE_MAJOR}.x LTS via NodeSource..."
      # gcc-c++ and make are required by node-gyp (fallback only).
      dnf install -y -q gcc-c++ make
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
      dnf install -y -q nodejs
      ;;
  esac
  echo "Node.js $(node --version) installed."
}

# ── check_and_install_node ────────────────────────────────────────────────────

check_and_install_node() {
  if command -v node &>/dev/null; then
    local CURRENT_MAJOR
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
    case "${DISTRO_FAMILY}" in
      debian) apt-get install -y -qq unzip ;;
      arch)   pacman -S --noconfirm --needed unzip ;;
      alpine) apk add --no-cache unzip ;;
      fedora) dnf install -y -q unzip ;;
    esac
  fi
}

# ── stop_existing_service ─────────────────────────────────────────────────────
# Stops any running instance of the service before files are replaced.
# Also removes the legacy lowercase unit name (flutviercompanion) used in early
# releases — systemd unit names are case-sensitive on Linux, so a renamed unit
# leaves the old one running and holding the port, causing EADDRINUSE.

stop_existing_service() {
  echo "Stopping any existing ${SERVICE_NAME} service..."

  case "${INIT_SYSTEM}" in
    systemd)
      local OLD_SERVICE_NAME="flutviercompanion"
      if systemctl is-active --quiet "${OLD_SERVICE_NAME}" 2>/dev/null; then
        echo "  Stopping old ${OLD_SERVICE_NAME} service (renamed to ${SERVICE_NAME})..."
        systemctl stop "${OLD_SERVICE_NAME}"
        systemctl disable "${OLD_SERVICE_NAME}" 2>/dev/null || true
        rm -f "/etc/systemd/system/${OLD_SERVICE_NAME}.service"
        systemctl daemon-reload
      fi
      if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
        echo "  Stopping existing ${SERVICE_NAME} service..."
        systemctl stop "${SERVICE_NAME}"
      fi
      ;;
    openrc)
      if rc-service --exists "${SERVICE_NAME}" 2>/dev/null && \
         rc-service "${SERVICE_NAME}" status >/dev/null 2>&1; then
        rc-service "${SERVICE_NAME}" stop
      fi
      ;;
  esac
}

# ── create_install_dirs ───────────────────────────────────────────────────────

create_install_dirs() {
  echo "Creating installation directories in ${INSTALL_DIR}..."
  mkdir -p "${INSTALL_DIR}/web-frontend" "${INSTALL_DIR}/pollservice" "${INSTALL_DIR}/data"
}

# ── download_archives ─────────────────────────────────────────────────────────
# Fetches releases.json from the GitHub repository to discover the latest
# PollService and web-frontend versions, then downloads and extracts both
# archives into their respective install directories.

download_archives() {
  local RELEASES_JSON_URL="https://api.github.com/repos/{{REPO}}/contents/releases.json"

  echo "Fetching releases manifest..."
  local RELEASES_JSON
  RELEASES_JSON=$(curl -fsSL -H "Accept: application/vnd.github.raw+json" "${RELEASES_JSON_URL}")

  PS_VERSION=$(python3 - "${RELEASES_JSON}" <<'PYEOF'
import json, sys
d = json.loads(sys.argv[1])
print(d['PollService']['latest'])
PYEOF
)

  local POLLSERVICE_ZIP_URL
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

  local FRONTEND_ZIP_URL
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
}

# ── patch_pojo_config ─────────────────────────────────────────────────────────
# The web frontend ships with companionPort: 0.  We update it here so the
# browser can locate the companion without a port-offset guess.

patch_pojo_config() {
  local POJO_FILE
  POJO_FILE=$(find "${INSTALL_DIR}/web-frontend" \
    -path "*/pollServiceCompanionConfig/pollServiceConf_001.js" 2>/dev/null | head -n 1)
  if [[ -n "${POJO_FILE}" ]]; then
    sed -i "s/companionPort: [0-9]*/companionPort: ${COMPANION_PORT}/" "${POJO_FILE}"
    echo "Patched companion port (${COMPANION_PORT}) into ${POJO_FILE}"
  else
    echo "Warning: pollServiceConf_001.js not found in web-frontend archive — browser will use port-offset discovery."
  fi
}

# ── install_npm_dependencies ──────────────────────────────────────────────────

install_npm_dependencies() {
  echo "Installing production dependencies..."
  cd "${INSTALL_DIR}/pollservice"
  npm install --omit=dev --silent
}

# ── set_permissions ───────────────────────────────────────────────────────────

set_permissions() {
  chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${INSTALL_DIR}"
}

# ── write_env_file ────────────────────────────────────────────────────────────
# Credentials and runtime config are kept outside the service unit so they are
# not visible to unprivileged users via 'systemctl show' or 'journalctl'.

write_env_file() {
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
  chown root:"${SERVICE_GROUP}" "${ENV_FILE}"
}

# ── write_service ─────────────────────────────────────────────────────────────
# Writes a systemd unit or OpenRC init script depending on the detected init
# system. The node binary path is resolved at install time and baked in so
# the service definition does not depend on PATH at runtime.

write_service() {
  echo "Writing service definition: ${SERVICE_FILE}"

  local NODE_BIN
  NODE_BIN=$(command -v node)

  case "${INIT_SYSTEM}" in
    systemd)
      cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=FlutVier PollService companion server
Documentation=https://github.com/{{REPO}}
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_BIN} ${INSTALL_DIR}/pollservice/index.js
EnvironmentFile=${ENV_FILE}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
      ;;
    openrc)
      # env_file= requires OpenRC 0.45+ (Alpine 3.18+; we target Alpine 3.20+).
      # It loads ENV_FILE into the service's environment before start —
      # the equivalent of systemd's EnvironmentFile=. Using env_file= means
      # node is started directly (not wrapped in a shell), so the pidfile
      # correctly tracks the node process and rc-service stop works properly.
      cat > "${SERVICE_FILE}" <<EOF
#!/sbin/openrc-run

name="${SERVICE_NAME}"
description="FlutVier PollService companion server"

command="${NODE_BIN}"
command_args="${INSTALL_DIR}/pollservice/index.js"
pidfile="/run/\${SVCNAME}.pid"
command_user="${SERVICE_USER}:${SERVICE_GROUP}"
command_background="yes"
env_file="${ENV_FILE}"

depend() {
	need net
}

start_pre() {
	[ -r "${ENV_FILE}" ] || { eerror "Environment file ${ENV_FILE} is not readable"; return 1; }
}
EOF
      chmod +x "${SERVICE_FILE}"
      ;;
  esac
}

# ── enable_and_start_service ──────────────────────────────────────────────────

enable_and_start_service() {
  echo "Enabling and starting ${SERVICE_NAME} service..."

  case "${INIT_SYSTEM}" in
    systemd)
      systemctl daemon-reload
      systemctl enable "${SERVICE_NAME}"
      systemctl start "${SERVICE_NAME}"
      ;;
    openrc)
      rc-update add "${SERVICE_NAME}" default
      rc-service "${SERVICE_NAME}" start
      ;;
  esac

  # Wait briefly and confirm the service came up.
  sleep 2
  case "${INIT_SYSTEM}" in
    systemd)
      if systemctl is-active --quiet "${SERVICE_NAME}"; then
        STATUS="running"
      else
        STATUS="failed — check logs with: journalctl -u ${SERVICE_NAME} -n 50"
      fi
      ;;
    openrc)
      if rc-service "${SERVICE_NAME}" status >/dev/null 2>&1; then
        STATUS="running"
      else
        STATUS="failed — check logs with: rc-service ${SERVICE_NAME} status"
      fi
      ;;
  esac
}

# ── print_summary ─────────────────────────────────────────────────────────────

print_summary() {
  local HOST_IP
  HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

  echo ""
  echo "========================================"
  echo " Installation complete"
  echo "========================================"
  echo ""
  echo "  PollService:    v${PS_VERSION}"
  echo "  Web frontend:   v${WF_VERSION}"
  echo "  Service status: ${STATUS}"
  echo "  Service user:   ${SERVICE_USER}:${SERVICE_GROUP}"
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
  case "${INIT_SYSTEM}" in
    systemd)
      echo "    systemctl status ${SERVICE_NAME}      # check status"
      echo "    journalctl -u ${SERVICE_NAME} -f      # stream logs"
      echo "    systemctl restart ${SERVICE_NAME}     # restart"
      echo "    systemctl disable ${SERVICE_NAME}     # uninstall from autostart"
      ;;
    openrc)
      echo "    rc-service ${SERVICE_NAME} status      # check status"
      echo "    rc-service ${SERVICE_NAME} restart     # restart"
      echo "    rc-update del ${SERVICE_NAME} default  # uninstall from autostart"
      echo "    logread | grep ${SERVICE_NAME}         # view recent logs"
      ;;
  esac
  echo "    nano ${ENV_FILE}                      # edit configuration"
  echo ""
  echo "  To update: download and re-run this script."
  echo ""
}

# ── main ──────────────────────────────────────────────────────────────────────

main() {
  # parse_args runs before check_root so --help works without sudo.
  parse_args "$@"
  check_root
  print_header
  detect_distro_and_init
  install_base_dependencies
  ensure_service_user
  detect_transmission_config

  # If --port was supplied, override the auto-derived companion port.
  # The port availability check runs AFTER stop_existing_service so our own
  # previously-running service doesn't produce a false conflict.
  if [[ -n "${CUSTOM_PORT}" ]]; then
    COMPANION_PORT="${CUSTOM_PORT}"
    echo "Companion port overridden via --port: ${COMPANION_PORT}"
  fi

  check_and_install_node
  stop_existing_service

  # Validate the custom port now that the previous FlutVier instance is stopped.
  if [[ -n "${CUSTOM_PORT}" ]]; then
    check_port_available "${COMPANION_PORT}"
  fi

  create_install_dirs
  download_archives
  patch_pojo_config
  install_npm_dependencies
  set_permissions
  write_env_file
  write_service
  enable_and_start_service
  print_summary
}

main "$@"
