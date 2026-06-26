#!/bin/sh
# Generate <dist>/config.js from $LASTFM_API_KEY so the served SPA can bake in a
# read-only Last.fm API key (visitors then only need a username). Run before the
# static server starts; safe to run with an empty/unset key (default behaviour).
#
# Usage: gen-config.sh [DIST_DIR]   (DIST_DIR defaults to "dist")
set -eu

dist="${1:-dist}"
key="${LASTFM_API_KEY:-}"

# Escape backslashes first, then double quotes, so an arbitrary key can't break
# out of the JS double-quoted string literal in config.js. (A Last.fm key is
# normally 32 hex chars, but don't assume that.)
esc="$(printf '%s' "$key" | sed 's/\\/\\\\/g; s/"/\\"/g')"

printf 'window.__LSG_CONFIG__ = { apiKey: "%s" };\n' "$esc" > "$dist/config.js"
