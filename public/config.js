// Runtime configuration for self-hosted deployments.
//
// Leave empty for the default behaviour (visitors enter their own Last.fm API
// key). To bake in a key so visitors don't need one, set it here:
//
//     window.__LSG_CONFIG__ = { apiKey: "your-read-only-api-key" };
//
// The systemd service regenerates this file from $LASTFM_API_KEY on start
// (see deploy/gen-config.sh), so you normally don't edit it by hand in prod.
//
// NOTE: anything here is served to every visitor and is publicly readable.
// Only ever put a read-only API key here — never the shared secret.
window.__LSG_CONFIG__ = {};
