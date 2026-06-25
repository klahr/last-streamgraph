#!/bin/sh
# Generate <dist>/config.js from $LASTFM_API_KEY so the served SPA can bake in a
# read-only Last.fm API key (visitors then only need a username). Run before the
# static server starts; safe to run with an empty/unset key (default behaviour).
#
# Usage: gen-config.sh [DIST_DIR]   (DIST_DIR defaults to "dist")
set -eu

dist="${1:-dist}"
key="${LASTFM_API_KEY:-}"

printf 'window.__LSG_CONFIG__ = { apiKey: "%s" };\n' "$key" > "$dist/config.js"
