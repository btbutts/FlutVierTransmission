#!/usr/bin/env bash
# Regenerate: npm run build:release   (or: node build-scripts/generate-install.mjs)
#
# releases/pollservice/installation/install.sh
# FlutVier PollService — Multi-distro installation script.
#
# Supports modern, in-support versions of:
#   - Debian 12+, Ubuntu 22.04+, Linux Mint 21+, Raspberry Pi OS (apt + systemd)
#   - Arch Linux (current rolling, pacman + systemd)
#   - Alpine Linux 3.20+ (apk + OpenRC)   [requires bash: apk add bash]
#   - Fedora 38+, CentOS Stream 9+, Rocky Linux 9+, AlmaLinux 9+ (dnf + systemd)
#
# Downloads and installs the latest PollService companion from GitHub Releases,
# installs Node.js (if needed), creates a dedicated service user, registers the
# service (systemd or OpenRC), and configures it to start automatically on boot.
# If the FlutVier web frontend is already installed on the host, the companion
# port is automatically patched into the web frontend's configuration file.
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
TRANSMISSION_URL_SUFFIX="/transmission/rpc"
TRANSMISSION_DETECTED=false
COMPANION_PORT=""
TRANSMISSION_URL=""

# Set after archive download (used in print_summary)
PS_VERSION=""

# Set after service start attempt (used in print_summary)
STATUS=""

# Populated by parse_args; empty string means "use auto-detection / default".
CUSTOM_PORT=""
CUSTOM_SETTINGS_PATH=""

# GitHub API URL for the latest release (used by get_latest_release_info)
GITHUB_API_ENDPOINT="https://api.github.com/repos/{{REPO}}/contents"
LOCAL_HELPER_PY="/tmp/FlutVierPollService-helpers.py"

# ── print_usage ───────────────────────────────────────────────────────────────

print_usage() {
	cat <<'EOF'
Usage:
  sudo bash install.sh [OPTIONS]

Description:
  Installs and configures the FlutVier PollService companion from GitHub
  Releases. Detects Transmission's RPC configuration automatically and
  registers the service with systemd (or OpenRC on Alpine Linux). If the
  FlutVier web frontend is already installed on the host, the companion port
  is automatically patched into the web frontend's configuration file.

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
		-h | --help | -u | --usage)
			print_usage
			exit 0
			;;
		-p | --port)
			if [[ $# -lt 2 || "$2" == -* ]]; then
				echo "Error: --port requires a value." >&2
				echo "  Example: --port 18080" >&2
				exit 1
			fi
			CUSTOM_PORT="$2"
			shift 2
			;;
		-t | --transmission-config-source)
			if [[ $# -lt 2 || "$2" == -* ]]; then
				echo "Error: --transmission-config-source requires a value." >&2
				echo "  Example: --transmission-config-source /etc/transmission-daemon/settings.json" >&2
				exit 1
			fi
			CUSTOM_SETTINGS_PATH="$2"
			shift 2
			;;
		-U | --service-user)
			if [[ $# -lt 2 || "$2" == -* ]]; then
				echo "Error: --service-user requires a value." >&2
				echo "  Example: --service-user myuser" >&2
				exit 1
			fi
			SERVICE_USER="$2"
			shift 2
			;;
		-G | --service-group)
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

# ── get_install_helper ────────────────────────────────────────────────────────
# Downloads the single supplemental Python helper once (lives only in /tmp
# during installation). All JSON/config parsing logic now lives in one clean
# Python file instead of ugly heredocs inside the bash script.

get_install_helper() {
	local pid py_helper_metadata_json remote_sha local_sha content_base64 size raw_content_extracted

	printf "Obtaining installation helper... "

	# Step 1: Obtain metadata for the helpers.py file from GitHub API.
	# This is needed for both the local file check and the download step, so we
	# fetch it once here and reuse it later instead of making duplicate API calls.
	py_helper_metadata_json=$(curl -fsSL \
		"${GITHUB_API_ENDPOINT}/releases/pollservice/installation/helpers.py" 2>/dev/null || true)
	if [[ -z "${py_helper_metadata_json}" ]]; then
		printf "%sFailed!%s (Could not fetch metadata from GitHub)\n" "${fontRED}" "${fontNC}" >&2
		exit 1
	fi

	# Step 2: Check local file + SHA verification
	if [[ -f "${LOCAL_HELPER_PY}" ]]; then
		# Extract the remote SHA from metadata
		remote_sha=$(
			python3 "${LOCAL_HELPER_PY}" get-json-key-value "${py_helper_metadata_json}" "sha"
		)

		if [[ -n "${remote_sha}" ]]; then
			# Compute exact git blob SHA that GitHub uses
			size=$(wc -c <"${LOCAL_HELPER_PY}")
			local_sha=$( (
				printf "blob %s\0" "${size}"
				cat "${LOCAL_HELPER_PY}"
			) | sha1sum | awk '{print $1}')

			if [[ "${local_sha}" == "${remote_sha}" ]]; then
				printf "Done!\n"
				return 0
			fi
		fi
	fi

	# Extract base64 content
	# This block runs when the file is absent or the SHA check fails.
	# It extracts the "content" field from the metadata JSON, which is
	# base64-encoded by GitHub API, and decodes it to the target file.
	raw_content_extracted=$(
		python3 "${LOCAL_HELPER_PY}" get-json-key-value "${py_helper_metadata_json}" "content"
	)
	content_base64=$(printf '%s' "$raw_content_extracted" | sed 's/\\n//g')

	if [[ -z "${content_base64}" ]]; then
		printf "%sFailed!%s (Could not extract helper content)\n" "${fontRED}" "${fontNC}" >&2
		exit 1
	else
		(
			printf '%s' "$content_base64" | base64 -d >"${LOCAL_HELPER_PY}"
		) &
		pid=$!
		spinner "$pid"
		wait "$pid"
		if [[ ! -f "${LOCAL_HELPER_PY}" || ! -s "${LOCAL_HELPER_PY}" ]]; then
			printf "%sFailed!%s (could not base64 decode helper)\n" "${fontRED}" "${fontNC}" >&2
			exit 1
		else
			chmod 755 "${LOCAL_HELPER_PY}"
		fi
	fi

	printf "Done!\n"
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
		printf "%sError:%s /etc/os-release not found — unsupported system.\n" "${fontRED}" "${fontNC}" >&2
		exit 1
	fi

	# Source the file to get ID, ID_LIKE, and PRETTY_NAME
	# shellcheck source=/dev/null
	. /etc/os-release

	# Create OS search string, combined to lowercase
	# Example output: " ubuntu debian " or " rocky rhel fedora "
	local os_info
	# shellcheck disable=SC2154
	os_info=" $(echo "$ID- $ID_LIKE-" | tr '[:upper:]' '[:lower:]') "

	case "${os_info}" in
	*" debian "* | *" ubuntu "* | *" linuxmint "* | *" raspios "* | *" raspbian "*)
		DISTRO_FAMILY="debian"
		printf "Detected Debian-family system (%s) " "${PRETTY_NAME:-${ID}}"
		;;
	*" arch "*)
		DISTRO_FAMILY="arch"
		printf "Detected Arch Linux (%s) " "${PRETTY_NAME:-arch}"
		;;
	*" alpine "*)
		DISTRO_FAMILY="alpine"
		printf "Detected Alpine Linux (%s) " "${PRETTY_NAME:-alpine}"
		;;
	*" fedora "* | *" rhel "* | *" centos "* | *" rocky "* | *" almalinux "*)
		DISTRO_FAMILY="fedora"
		printf "Detected Fedora-family system (%s) " "${PRETTY_NAME:-${ID}}"
		;;
	*)
		printf "%sError:%s unsupported distribution: %s (%s).\n" \
			"${fontRED}" \
			"${fontNC}" \
			"${ID}" \
			"${PRETTY_NAME:-unknown}" \
			>&2
		printf "  Supported: Debian 12+, Ubuntu 22.04+, Mint 21+, Raspberry Pi OS,\n" >&2
		printf "             Arch Linux, Alpine 3.20+, Fedora 38+, CentOS Stream 9+\n" >&2
		exit 1
		;;
	esac

	case "${DISTRO_FAMILY}" in
	debian | arch | fedora)
		if command -v systemctl >/dev/null 2>&1; then
			INIT_SYSTEM="systemd"
			SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
			printf "and init system (systemctl found).\n"
		else
			echo "Error: systemd (systemctl) not found on ${DISTRO_FAMILY} system." >&2
			exit 1
		fi
		;;
	alpine)
		# Check for OpenRC presence
		if [[ -d /etc/init.d ]]; then
			INIT_SYSTEM="openrc"
			SERVICE_FILE="/etc/init.d/${SERVICE_NAME}"
			printf "and init system (OpenRC directory found).\n"
		else
			echo "Error: OpenRC directory not found on Alpine system." >&2
			exit 1
		fi
		;;
	*)
		echo "Error: No init system mapping for family: ${DISTRO_FAMILY}" >&2
		exit 1
		;;
	esac
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
			groupadd -r "${SERVICE_GROUP}"
		fi
	fi

	if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
		echo "  Creating user ${SERVICE_USER}..."
		if [[ "${DISTRO_FAMILY}" == "alpine" ]]; then
			adduser -S -D -H -s /sbin/nologin -G "${SERVICE_GROUP}" "${SERVICE_USER}"
		else
			# Determine nologin path
			# Debian/Ubuntu use /usr/sbin/nologin
			# Arch/Fedora/CentOS use /sbin/nologin
			local nologin_path
			if [[ -x /usr/sbin/nologin ]]; then
				nologin_path="/usr/sbin/nologin"
			elif [[ -x /sbin/nologin ]]; then
				nologin_path="/sbin/nologin"
			else
				echo "Error: nologin shell not found on this system." >&2
				exit 1
			fi
			useradd -r -g "${SERVICE_GROUP}" -s "$nologin_path" -d /nonexistent "${SERVICE_USER}"
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

	if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || ((PORT < 1 || PORT > 65535)); then
		echo "Error: invalid port '${PORT}' — must be an integer between 1 and 65535." >&2
		exit 1
	fi

	local IN_USE=false
	local IN_USE_BY=""

	if command -v ss >/dev/null 2>&1; then
		# Column 5 of 'ss -ltn' is the local address:port (e.g. 0.0.0.0:9091 or
		# [::]:9091). Splitting on ':' and taking the last field isolates the port
		# number for both IPv4 and IPv6 address formats.
		if ss -ltn 2>/dev/null |
			awk '{print $5}' |
			awk -F: '{print $NF}' |
			grep -qx "${PORT}"; then
			IN_USE=true
			# Running as root so ss -p includes process ownership in the last field:
			# users:(("processname",pid=N,fd=N)). Extract the process name from it.
			IN_USE_BY=$(ss -ltnp 2>/dev/null |
				awk -v p="${PORT}" '{n=split($5,a,":"); if(a[n]==p) print $NF}' |
				sed 's/users:(("//;s/".*//' |
				head -1 2>/dev/null || true)
		fi
	elif command -v netstat >/dev/null 2>&1; then
		# netstat -ltn column 4 is the local address:port.
		if netstat -ltn 2>/dev/null |
			awk '{print $4}' |
			awk -F: '{print $NF}' |
			grep -qx "${PORT}"; then
			IN_USE=true
			# netstat -ltnp column 7 is "PID/processname"; strip the PID prefix.
			IN_USE_BY=$(netstat -ltnp 2>/dev/null |
				awk -v p=":${PORT}" '$4 ~ p {print $7}' |
				sed 's|[0-9]*/||' |
				head -1 2>/dev/null || true)
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

	python3 "${LOCAL_HELPER_PY}" validate-transmission-config "${CONFIG_PATH}"
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
	python3 "${LOCAL_HELPER_PY}" is-valid-transmission-config "${path}" >/dev/null 2>&1
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
		found=$(python3 "${LOCAL_HELPER_PY}" select-most-recent-config "${valid_paths[@]}")
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
# Determines the Transmission RPC port, bind address, and URL suffix so the
# companion can be pre-configured to talk to the local daemon.
#
# Config source priority:
#   1. --transmission-config-source <PATH>  (user-supplied; validated then used)
#   2. Automatic /var/lib search via find_transmission_settings()
#   3. Defaults (port 9091, bind 0.0.0.0, suffix /transmission/rpc)
#
# COMPANION_PORT is derived here as TRANSMISSION_PORT + 10000. If --port was
# supplied, main() overrides COMPANION_PORT after this function returns.

detect_transmission_config() {
	local transmission_rpc_host parsed settings_candidate=""

	if [[ -n "${CUSTOM_SETTINGS_PATH}" ]]; then
		# User explicitly provided a path — validate it and always use it,
		# regardless of whether transmission-daemon is detectable via package manager.
		echo "Using user-supplied Transmission config: ${CUSTOM_SETTINGS_PATH}"
		validate_transmission_config "${CUSTOM_SETTINGS_PATH}"
		settings_candidate="${CUSTOM_SETTINGS_PATH}"
		TRANSMISSION_DETECTED=true
	elif is_transmission_installed; then
		echo "Detected transmission-daemon — reading configuration..."
		settings_candidate=$(find_transmission_settings)
		[[ -n "${settings_candidate}" ]] && TRANSMISSION_DETECTED=true
	else
		echo "transmission-daemon not installed — using default Transmission URL."
	fi

	if [[ -n "${settings_candidate}" ]]; then
		# Use Python (guaranteed installed by install_base_dependencies) to extract values.
		parsed=$(python3 "${LOCAL_HELPER_PY}" extract-rpc-config "${settings_candidate}")
		if [[ -n "${parsed}" ]]; then
			IFS='|' read -r TRANSMISSION_PORT TRANSMISSION_BIND TRANSMISSION_URL_SUFFIX <<<"${parsed}"
		fi
		if [[ "$?" -eq 0 && -n "${parsed}" ]]; then
			echo "  Config:     ${settings_candidate}"
			echo "  RPC port:   ${TRANSMISSION_PORT}"
			echo "  Bind addr:  ${TRANSMISSION_BIND}"
			echo "  URL suffix: ${TRANSMISSION_URL_SUFFIX}"
		else
			echo "  Error reading settings.json — using defaults."
		fi
	else
		echo "  settings.json not found — using defaults."
	fi

	# Derive companion port: Transmission RPC port + 10000, capped at 65535.
	# If --port was supplied, main() will override this value after returning.
	COMPANION_PORT=$((TRANSMISSION_PORT + 10000))
	if [ "${COMPANION_PORT}" -gt 65535 ]; then
		COMPANION_PORT="19091"
		echo "Warning: computed companion port > 65535; falling back to 19091."
	fi

	# Build Transmission RPC URL.
	# If Transmission binds to all interfaces (0.0.0.0 or ::) use localhost so the
	# companion talks over the loopback; otherwise use the configured bind address.
	if [[ "${TRANSMISSION_BIND}" == "0.0.0.0" || "${TRANSMISSION_BIND}" == "::" || -z "${TRANSMISSION_BIND}" ]]; then
		transmission_rpc_host="localhost"
	else
		transmission_rpc_host="${TRANSMISSION_BIND}"
	fi
	TRANSMISSION_URL="http://${transmission_rpc_host}:${TRANSMISSION_PORT}${TRANSMISSION_URL_SUFFIX}"

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
		# build-essential is required by node-gyp to compile better-sqlite3's
		# native addon. On Node 22 with prebuilt binaries this is typically a
		# no-op, but the tools must be present as a fallback.
		apt-get install -y -qq build-essential >/dev/null 2>&1 &&
			curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1 &&
			apt-get install -y -qq nodejs >/dev/null 2>&1
		;;
	arch)
		# base-devel provides make, gcc, etc. required by node-gyp (fallback only).
		pacman -S --noconfirm --needed nodejs npm base-devel >/dev/null 2>&1
		;;
	alpine)
		# build-base provides gcc, make, musl-dev, etc. required by node-gyp (fallback only).
		apk add --no-cache nodejs npm build-base >/dev/null 2>&1
		;;
	fedora)
		# gcc-c++ and make are required by node-gyp (fallback only).
		dnf install -y -q gcc-c++ make >/dev/null 2>&1 &&
			curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1 &&
			dnf install -y -q nodejs >/dev/null 2>&1
		;;
	esac
}

# ── check_and_install_node ────────────────────────────────────────────────────

check_and_install_node() {
	local current_major pid
	if command -v node >/dev/null 2>&1; then
		current_major=$(node --version | sed 's/v//' | cut -d. -f1)
		if [[ ${current_major} -lt ${NODE_MAJOR} ]]; then
			printf "Node.js v%s is too old (minimum: v%s). Upgrading to v%s... " \
				"${current_major}" "${NODE_MAJOR}" "${NODE_MAJOR}"
			install_node &
			pid=$!
			spinner "$pid"
			wait "$pid"
			printf "Done!\n"
		else
			printf "Node.js %s already installed — skipping.\n" "$(node --version)"
		fi
	else
		printf "Node.js not found. Installing v%s... " "$NODE_MAJOR"
		install_node &
		pid=$!
		spinner "$pid"
		wait "$pid"
		printf "Done!\n"
	fi

	# Ensure unzip is available regardless of whether Node.js was installed above.
	if ! command -v unzip >/dev/null 2>&1; then
		printf "Installing unzip... "

		# Helper to run the install in the background
		(
			case "${DISTRO_FAMILY}" in
			debian) apt-get install -y -qq unzip >/dev/null 2>&1 ;;
			arch) pacman -S --noconfirm --needed unzip >/dev/null 2>&1 ;;
			alpine) apk add --no-cache unzip >/dev/null 2>&1 ;;
			fedora) dnf install -y -q unzip >/dev/null 2>&1 ;;
			esac
		) &
		pid=$!

		spinner "$pid"
		wait "$pid"
		printf "Done!\n"
	fi
}

# ── stop_existing_service ─────────────────────────────────────────────────────
# Stops any running instance of the service before files are replaced.
# Also removes the legacy lowercase unit name (flutviercompanion) used in early
# releases — systemd unit names are case-sensitive on Linux, so a renamed unit
# leaves the old one running and holding the port, causing EADDRINUSE.

stop_existing_service() {
	local old_service_name="flutviercompanion"
	echo "Stopping any existing ${SERVICE_NAME} service..."

	case "${INIT_SYSTEM}" in
	systemd)
		# Handle the legacy service rename
		if systemctl list-unit-files "${old_service_name}.service" >/dev/null 2>&1; then
			echo "  Removing legacy ${old_service_name}..."
			systemctl disable --now "${old_service_name}" >/dev/null 2>&1 || true
			rm -f "/etc/systemd/system/${old_service_name}.service"
			systemctl daemon-reload
			systemctl reset-failed "${old_service_name}" >/dev/null 2>&1 || true
		fi
		if systemctl is-active --quiet "${SERVICE_NAME}" >/dev/null 2>&1; then
			echo "  Stopping existing ${SERVICE_NAME} service..."
			systemctl stop "${SERVICE_NAME}"
		fi
		;;
	openrc)
		if rc-service --exists "${SERVICE_NAME}" >/dev/null 2>&1; then
			# Check if actually running before stopping
			# to avoid 'service not running' warnings
			if rc-service "${SERVICE_NAME}" status | grep -q "started"; then
				rc-service "${SERVICE_NAME}" stop >/dev/null 2>&1
			fi
		fi
		;;
	esac
}

# ── create_install_dirs ───────────────────────────────────────────────────────

create_install_dirs() {
	echo "Creating installation directories in ${INSTALL_DIR}..."
	mkdir -p "${INSTALL_DIR}/pollservice" "${INSTALL_DIR}/data"
}

# ── download_archives ─────────────────────────────────────────────────────────
# Fetches releases/releases.json from the GitHub repository to discover the
# latest PollService version, then downloads and extracts the archive into the
# install directory.

download_archives() {
	local releases_json releases_json_url pollservice_zip_url
	local pid_ps exit_ps

	releases_json_url="${GITHUB_API_ENDPOINT}/releases/releases.json"

	printf "Fetching releases manifest... "
	releases_json=$(curl -fsSL -H "Accept: application/vnd.github.raw+json" "${releases_json_url}")
	if [[ "$?" -ne 0 || -z "${releases_json}" ]]; then
		printf "%sFailed!%s\nError: Could not retrieve releases manifest.\n" "${fontRED}" "${fontNC}" >&2
		exit 1
	else
		printf "Done!\n"
	fi

	mapfile -t release_info < <(python3 "${LOCAL_HELPER_PY}" parse-releases-manifest "${releases_json}")
	PS_VERSION="${release_info[0]}"
	pollservice_zip_url="${release_info[1]}"

	if [[ -z "${pollservice_zip_url}" ]]; then
		printf "%sError:%s received empty response for PollService download URL in releases manifest.\n" \
			"${fontRED}" \
			"${fontNC}" \
			>&2
		exit 1
	fi

	echo "Latest PollService version: ${PS_VERSION}"

	printf "Downloading PollService archive (v%s)... " "${PS_VERSION}"
	(
		curl -fsSL "${pollservice_zip_url}" -o /tmp/flutvier-pollservice.zip &&
			rm -rf "${INSTALL_DIR}/pollservice" &&
			mkdir -p "${INSTALL_DIR}/pollservice" &&
			unzip -q /tmp/flutvier-pollservice.zip -d "${INSTALL_DIR}/pollservice" &&
			rm /tmp/flutvier-pollservice.zip
	) &
	pid_ps=$!
	spinner "$pid_ps"
	wait "$pid_ps"
	exit_ps="$?"

	if [[ $exit_ps -eq 0 ]]; then printf "Done!\n"; else
		printf "%sFailed!%s\n" "${fontRED}" "${fontNC}" >&2
		exit 1
	fi
}

# ── patch_pojo_config ─────────────────────────────────────────────────────────
# The web frontend ships with companionPort: 0.  We update it here so the
# browser can locate the companion without a port-offset guess.

patch_pojo_config() {
	local pojo_file
	pojo_file=$(find "${INSTALL_DIR}/web-frontend" \
		-path "*/pollServiceCompanionConfig/pollServiceConf_001.js" 2>/dev/null | head -n 1)
	if [[ -n "${pojo_file}" ]]; then
		chmod +w "${pojo_file}"
		sed -i "s/companionPort: [0-9]*/companionPort: ${COMPANION_PORT}/" "${pojo_file}"
		echo "  Patched companion port (${COMPANION_PORT}) into web-frontend config: ${pojo_file}"
	else
		echo "Warning: pollServiceConf_001.js not found in web-frontend hosting directory — will use port-offset discovery."
	fi
}

# ── install_npm_dependencies ──────────────────────────────────────────────────

install_npm_dependencies() {
	local npm_pid exit_code
	printf "Preparing to install npm dependencies for PollService.\nThis may take a few minutes on slower devices as\nbetter-sqlite3's native addon is compiled from source.\n"
	cd "${INSTALL_DIR}/pollservice" || {
		printf "\nError: Could not enter pollservice directory.\n" >&2
		exit 1
	}
	printf "Beginning dependencies installation... "

	# Run install in background
	npm install --omit=dev --no-audit --no-fund --silent >/dev/null 2>&1 &
	npm_pid=$!
	spinner "$npm_pid"

	# Wait for npm to finish and check exit code
	wait "$npm_pid"
	exit_code="$?"
	if [[ $exit_code -eq 0 ]]; then
		printf "Done!\n"
	else
		printf "%sFailed!%s (Exit code: %d)\n" "${fontRED}" "${fontNC}" "$exit_code" >&2
		exit 1
	fi
}

# ── set_permissions ───────────────────────────────────────────────────────────

set_permissions() {
	printf "Setting directory permissions for %s... " "${SERVICE_USER}"

	# Set recursive ownership of PollService install directory to service user/group
	chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${INSTALL_DIR}"

	# Ensure directories are traversable (755) and files are readable (644)
	find "${INSTALL_DIR}" -type d -exec chmod 755 {} +
	find "${INSTALL_DIR}" -type f -exec chmod 644 {} +

	# Grant explicit write access to the data directory containing SQLite DB and BW cache
	if [[ -d "${INSTALL_DIR}/data" ]]; then
		chmod 775 "${INSTALL_DIR}/data"
	fi

	printf "Done!\n"
}

# ── write_env_file ────────────────────────────────────────────────────────────
# Credentials and runtime config are kept outside the service unit so they are
# not visible to unprivileged users via 'systemctl show' or 'journalctl'.

write_env_file() {
	printf "Writing environment file at %s... " "${ENV_FILE}"
	mkdir -p "$(dirname "${ENV_FILE}")"
	cat >"${ENV_FILE}" <<-EOF
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
	printf "Done!\n"
}

# ── write_service ─────────────────────────────────────────────────────────────
# Writes a systemd unit or OpenRC init script depending on the detected init
# system. The node binary path is resolved at install time and baked in so
# the service definition does not depend on PATH at runtime.

write_service() {
	printf "Writing service definition for %s at:\n%s... " "${SERVICE_NAME}" "${SERVICE_FILE}"

	local node_bin
	node_bin=$(command -v node)

	case "${INIT_SYSTEM}" in
	systemd)
		cat >"${SERVICE_FILE}" <<-EOF
			[Unit]
			Description=FlutVier PollService Companion
			Documentation=https://github.com/{{REPO}}
			After=network.target

			[Service]
			Type=simple
			User=${SERVICE_USER}
			Group=${SERVICE_GROUP}
			WorkingDirectory=${INSTALL_DIR}
			EnvironmentFile=${ENV_FILE}
			ExecStart=${node_bin} ${INSTALL_DIR}/pollservice/index.js
			Restart=on-failure
			RestartSec=5
			StandardOutput=journal
			StandardError=journal

			[Install]
			WantedBy=multi-user.target
		EOF

		# Ensure systemd sees the new file immediately
		systemctl daemon-reload
		;;
	openrc)
		# env_file= requires OpenRC 0.45+ (Alpine 3.18+; we target Alpine 3.20+).
		# It loads ENV_FILE into the service's environment before start —
		# the equivalent of systemd's EnvironmentFile=. Using env_file= means
		# node is started directly (not wrapped in a shell), so the pidfile
		# correctly tracks the node process and rc-service stop works properly.
		cat >"${SERVICE_FILE}" <<-EOF
			#!/sbin/openrc-run

			name="${SERVICE_NAME}"
			description="FlutVier PollService Companion"

			command="${node_bin}"
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
		chmod 755 "${SERVICE_FILE}"
		;;
	esac

	printf "Done!\n"
}

# ── enable_and_start_service ──────────────────────────────────────────────────

enable_and_start_service() {
	printf "Enabling and starting %s service... " "${SERVICE_NAME}"

	case "${INIT_SYSTEM}" in
	systemd)
		systemctl daemon-reload
		systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1
		systemctl start "${SERVICE_NAME}" >/dev/null 2>&1
		;;
	openrc)
		rc-update add "${SERVICE_NAME}" default >/dev/null 2>&1
		rc-service "${SERVICE_NAME}" start >/dev/null 2>&1
		;;
	esac

	# Wait briefly and confirm the service came up.
	sleep 3
	case "${INIT_SYSTEM}" in
	systemd)
		if systemctl is-active --quiet "${SERVICE_NAME}"; then
			STATUS="${fontGREEN}running${fontNC}"
		else
			STATUS="${fontRED}failed${fontNC} (Check logs via: journalctl -u ${SERVICE_NAME})"
		fi
		;;
	openrc)
		if rc-service "${SERVICE_NAME}" status >/dev/null 2>&1; then
			STATUS="${fontGREEN}running${fontNC}"
		else
			STATUS="${fontRED}failed${fontNC} (Check logs via: tail /var/log/messages)"
		fi
		;;
	esac

	printf "Done!\n"
}

# ── print_summary ─────────────────────────────────────────────────────────────

print_summary() {
	local host_ip
	host_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
	if [[ -z "${host_ip}" ]]; then
		host_ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' || echo "localhost")
	fi

	echo ""
	echo "========================================"
	echo " Installation complete"
	echo "========================================"
	echo ""
	echo "  PollService:    v${PS_VERSION}"
	echo "  Service status: ${STATUS}"
	echo "  Service user:   ${SERVICE_USER}:${SERVICE_GROUP}"
	echo "  Web app URL:    http://${host_ip}:${COMPANION_PORT}"
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
	if [[ "${STATUS}" == *"${fontRED}"* ]]; then
		echo "  ⚠️  Installation finished with errors. Please check the logs."
	else
		echo "  Installation successful! Access the dashboard via the URL above."
		echo "  To upgrade the PollService Companion, you may re-run this script."
	fi
	echo ""
}

# ── portable spinner function for long-running operations ─────────────────────

spinner() {
	local pid="$1"
	local delay=0.1
	# The characters to cycle through
	# shellcheck disable=SC1003
	local spinstr='|/-\'
	while [ "$(ps -p "$pid" -o state= 2>/dev/null)" ]; do
		local temp=${spinstr#?}
		printf " %c  " "$spinstr"
		spinstr=$temp${spinstr%"$temp"}
		sleep "$delay"
		printf "\r"
	done
	# Clear the spinner area when done
	printf "    \r"
}

# ── main ──────────────────────────────────────────────────────────────────────

main() {
	# parse_args runs before check_root so --help works without sudo.
	parse_args "$@"

	# Define color variables here so they are available for status messages
	local fontRED='\033[0;31m' fontGREEN='\033[0;32m' fontNC='\033[0m'

	check_root
	print_header
	detect_distro_and_init

	# Install Dependencies and wait
	# User will see the spinner until this step completes, since we're doing this
	# entirely silently to avoid overwhelming them with verbose package manager output.
	local install_pid exit_code
	install_base_dependencies &
	install_pid=$!
	spinner "$install_pid"
	wait "$install_pid"
	exit_code="$?"
	if [[ $exit_code -eq 0 ]]; then
		printf "Done!\n"
	else
		printf "\n%sFailed!%s (Exit Code: %d)\n" "${fontRED}" "${fontNC}" "$exit_code" >&2
		exit 1
	fi

	# Obtain or update the Python helper script
	get_install_helper

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
