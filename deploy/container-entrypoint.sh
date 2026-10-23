#!/usr/bin/env bash
set -Eeuo pipefail

# The mounted secret stays read-only; the API receives its own 0600 copy.
install -d -o nginx -g nginx -m 700 /run/media-keeper
install -o nginx -g nginx -m 600 /run/secrets/media-keeper-api.json "$MEDIA_KEEPER_API_CONFIG"
cd /opt/media-keeper
runuser -u nginx -- node apps/api/dist/main.js &
api_pid=$!
/docker-entrypoint.sh nginx -g 'daemon off;' &
nginx_pid=$!

stop_services() {
    trap - TERM INT
    kill -TERM "$api_pid" "$nginx_pid" 2>/dev/null || true
    wait "$api_pid" "$nginx_pid" 2>/dev/null || true
}
trap 'stop_services; exit 0' TERM INT

# Docker restarts the complete service if either long-running process exits.
set +e
wait -n "$api_pid" "$nginx_pid"
status=$?
set -e
stop_services
if [ "$status" -eq 0 ]; then status=1; fi
exit "$status"
