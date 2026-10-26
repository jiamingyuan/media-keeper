FROM nginx:1.31-trixie@sha256:4c41e2d0a3a55b325ed572cd0200bdb72af1433c3daa2bca6ef8eea68ce504a2 AS runtime-base

ARG NODE_VERSION=24.20.0
ARG NPM_VERSION=11.19.0
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl xz-utils; \
    case "$(dpkg --print-architecture)" in arm64) node_arch=arm64 ;; amd64) node_arch=x64 ;; *) exit 1 ;; esac; \
    cd /tmp; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " node-v${NODE_VERSION}-linux-${node_arch}.tar.xz$" SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -C /usr/local --strip-components=1; \
    npm install --global "npm@${NPM_VERSION}" --ignore-scripts --no-audit --no-fund; \
    test "$(node --version)" = "v${NODE_VERSION}"; \
    test "$(npm --version)" = "${NPM_VERSION}"; \
    npm cache clean --force; \
    rm -rf /tmp/node-* /tmp/SHASUMS256.txt /var/lib/apt/lists/*

FROM runtime-base AS dependencies
WORKDIR /opt/media-keeper
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY skills/media-keeper/package.json skills/media-keeper/package.json

FROM dependencies AS build
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY apps/api/ apps/api/
COPY apps/web/ apps/web/
COPY packages/ packages/
RUN npm run build:api && npm run build:web

FROM dependencies AS production-dependencies
RUN npm ci --omit=dev --workspace=@media-keeper/api --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM runtime-base AS runtime
LABEL org.opencontainers.image.title="media-keeper" \
      org.opencontainers.image.version="0.4.0" \
      org.opencontainers.image.source="https://github.com/jiamingyuan/media-keeper"
ENV NODE_ENV=production \
    MEDIA_KEEPER_API_CONFIG=/run/media-keeper/api.json
WORKDIR /opt/media-keeper
COPY --from=production-dependencies /opt/media-keeper/node_modules/ node_modules/
COPY --from=build /opt/media-keeper/apps/api/package.json apps/api/package.json
COPY --from=build /opt/media-keeper/apps/api/dist/ apps/api/dist/
COPY --from=build /opt/media-keeper/packages/core/ packages/core/
COPY --from=build /opt/media-keeper/packages/db/ packages/db/
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /opt/media-keeper/apps/web/dist/ /usr/share/nginx/html/media-keeper/
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 deploy/container-entrypoint.sh /usr/local/bin/media-keeper-entrypoint
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent --noproxy '*' http://127.0.0.1/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/media-keeper-entrypoint"]
