#!/usr/bin/env python3
"""
FlutVier PollService installation helper.
All JSON / config parsing logic that used to be embedded in the bash script.
"""

import json
import os
import sys


def validate_transmission_config(config_path: str) -> None:
    """Full validation with helpful error messages (used by validate_transmission_config)."""
    if not os.path.isfile(config_path):
        print(f"Error: Transmission config file not found: '{config_path}'", file=sys.stderr)
        sys.exit(1)

    if not os.access(config_path, os.R_OK):
        print(f"Error: cannot read '{config_path}' — permission denied.", file=sys.stderr)
        print(f"  Try: sudo chmod o+r '{config_path}'", file=sys.stderr)
        sys.exit(1)

    try:
        with open(config_path) as f:
            cfg = json.load(f)
    except json.JSONDecodeError as exc:
        print(f"Error: '{config_path}' is not valid JSON: {exc}", file=sys.stderr)
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
        print(
          f"Error: '{config_path}' is missing required Transmission RPC configuration:",
          file=sys.stderr
        )
        for e in errors:
            print(e, file=sys.stderr)
        print(
          "  Re-run with --transmission-config-source to specify a different file.",
          file=sys.stderr
        )
        sys.exit(1)


def is_valid_transmission_config(config_path: str) -> bool:
    """Silent validation used by find_transmission_settings (exit code only)."""
    try:
        if not os.path.isfile(config_path) or not os.access(config_path, os.R_OK):
            return False
        with open(config_path) as f:
            cfg = json.load(f)
        port = cfg.get('rpc-port')
        return isinstance(port, int) and 1 <= port <= 65535
    except (json.JSONDecodeError, OSError, KeyError):
        return False


def select_most_recent_config(paths: list[str]) -> str:
    """Return the most recently modified path from a list (used in find_transmission_settings)."""
    if not paths:
        return ""
    try:
        return max(paths, key=lambda p: os.path.getmtime(p))
    except Exception:
        return ""


def extract_rpc_config(config_path: str) -> str:
    """Extract rpc-port|rpc-bind-address|rpc-url (with suffix fix)."""
    try:
        with open(config_path) as f:
            cfg = json.load(f)
        port = cfg.get('rpc-port', 9091)
        bind = cfg.get('rpc-bind-address', '0.0.0.0')
        suffix = cfg.get('rpc-url', '/transmission/')
        if not suffix.endswith('rpc'):
            suffix = suffix.rstrip('/') + '/rpc'
        return f"{port}|{bind}|{suffix}"
    except Exception:
        print("Error reading settings.json — using defaults.", file=sys.stderr)
        sys.exit(1)


def parse_releases_manifest(releases_json_str: str):
    """Parse releases.json and return all needed values for download_archives."""
    try:
        d = json.loads(releases_json_str)

        # PollService
        ps_latest = d['PollService']['latest']
        ps_entry = next(r for r in d['PollService']['releases'] if r['version'] == ps_latest)
        ps_zip = ps_entry['zipUrl']

        # Web frontend
        wf_latest = d['web-frontend']['latest']
        wf_entry = next(r for r in d['web-frontend']['releases'] if r['version'] == wf_latest)
        wf_zip = wf_entry['downloadUrl']

        return ps_latest, wf_latest, ps_zip, wf_zip
    except Exception as e:
        print(f"Error parsing releases manifest: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    cmd = sys.argv[1]

    if cmd == "validate-transmission-config":
        validate_transmission_config(sys.argv[2])

    elif cmd == "is-valid-transmission-config":
        sys.exit(0 if is_valid_transmission_config(sys.argv[2]) else 1)

    elif cmd == "select-most-recent-config":
        paths = sys.argv[2:]
        print(select_most_recent_config(paths))

    elif cmd == "extract-rpc-config":
        print(extract_rpc_config(sys.argv[2]))

    elif cmd == "parse-releases-manifest":
        ps_ver, wf_ver, ps_zip, wf_zip = parse_releases_manifest(sys.argv[2])
        print(f"{ps_ver}\n{wf_ver}\n{ps_zip}\n{wf_zip}")

    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)
