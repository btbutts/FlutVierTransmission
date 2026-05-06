// FlutVier PollService companion configuration.
// This file is served unmodified — it is intentionally plain JavaScript so it
// works regardless of which HTTP server hosts the web frontend (Transmission's
// built-in web server, the companion itself, nginx, etc.).
//
// companionPort is written by the PollService install.sh script at install time.
// 0 means the companion has not been installed on this host; the frontend will
// fall back to the port-offset discovery strategy (current port + 10000), where
// "current port" is the port the frontend is being served on, such as the
// Transmission RPC port, nginx proxied port, etc.
window.POLL_SERVICE_COMPANION_CONFIG = {
  companionPort: 0
};
