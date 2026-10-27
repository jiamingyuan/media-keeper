#!/usr/bin/env bash
set -Eeuo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
release_directory="$(cd -- "$project_root/runtime/deploy/current" && pwd -P)"
api_config="$project_root/runtime/api.container.local.json"
runtime_image='node-nginx:24.20.0-1.31-trixie'
test -f "$release_directory/apps/api/dist/main.js"
test -f "$release_directory/deploy/container-entrypoint.sh"
test -f "$api_config"
docker image inspect "$runtime_image" >/dev/null
docker network inspect agent-services >/dev/null

if docker container inspect media-keeper >/dev/null 2>&1; then
    docker stop --timeout 20 media-keeper
    docker rm media-keeper
fi

docker run --detach --pull never --name media-keeper \
    --init --restart unless-stopped --stop-timeout 20 \
    --network agent-services --publish 127.0.0.1:8081:80 \
    --workdir /opt/media-keeper --entrypoint /bin/bash \
    --env NODE_ENV=production \
    --env MEDIA_KEEPER_API_CONFIG=/run/media-keeper/api.json \
    --mount "type=bind,source=$release_directory,target=/opt/media-keeper,readonly" \
    --mount "type=bind,source=$release_directory/apps/web/dist,target=/usr/share/nginx/html/media-keeper,readonly" \
    --mount "type=bind,source=$release_directory/deploy/nginx.conf,target=/etc/nginx/conf.d/default.conf,readonly" \
    --mount "type=bind,source=$api_config,target=/run/secrets/media-keeper-api.json,readonly" \
    --health-cmd 'curl --fail --silent --noproxy "*" http://127.0.0.1/healthz || exit 1' \
    --health-interval 15s --health-timeout 5s --health-start-period 20s --health-retries 3 \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
    "$runtime_image" /opt/media-keeper/deploy/container-entrypoint.sh

for ((attempt=0; attempt<60; attempt++)); do
    status="$(docker inspect --format '{{.State.Health.Status}}' media-keeper)"
    if [ "$status" = healthy ]; then
        docker ps --filter name=^/media-keeper$ --format '{{.Names}} {{.Image}} {{.Status}} {{.Ports}}'
        exit 0
    fi
    if [ "$status" = unhealthy ]; then break; fi
    sleep 1
done
docker logs --tail 40 media-keeper
exit 1
