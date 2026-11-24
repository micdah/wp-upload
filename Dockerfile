# syntax=docker/dockerfile:1

# ---- workspace-deps: full toolchain, every workspace's dependencies ----
FROM node:24-bookworm-slim AS workspace-deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
# npm ci needs every workspace's package.json to match the lockfile, even
# for workspaces this stage doesn't build.
COPY server/package.json server/package.json
COPY client/package.json client/package.json
COPY e2e/package.json e2e/package.json
COPY plugin/package.json plugin/package.json
# The image never runs browser tests, so skip Playwright's browser download.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

# ---- client-builder: builds the React app ----
FROM workspace-deps AS client-builder
COPY shared shared
COPY server server
COPY client client
RUN npm run build

# ---- plugin-builder: builds the companion plugin zip the app offers (D12) ----
# Writes plugin/dist/: the zip plus its plugin.json and changelog.json
# sidecars, which the server reads at startup (implementation plan §2.6).
FROM workspace-deps AS plugin-builder
COPY plugin/CHANGELOG.md plugin/CHANGELOG.md
COPY plugin/scripts plugin/scripts
COPY plugin/wp-upload-companion plugin/wp-upload-companion
RUN node plugin/scripts/build.mjs

# ---- server-deps: production dependencies for the server workspace only ----
FROM node:24-bookworm-slim AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
COPY e2e/package.json e2e/package.json
COPY plugin/package.json plugin/package.json
RUN npm ci --omit=dev --workspace=server

# ---- final: distroless runtime, no shell, no package manager ----
FROM gcr.io/distroless/nodejs24-debian13:nonroot
WORKDIR /app
COPY --from=server-deps /app/node_modules /app/node_modules
COPY server/package.json server/package.json
COPY server/src server/src
# Only the dependency-free shared files: the server must never import
# schemas or fixtures at runtime (implementation-plan §2.3).
COPY shared/package.json shared/package.json
COPY shared/library-api.ts shared/library-api.ts
COPY shared/plugin-api.ts shared/plugin-api.ts
COPY --from=client-builder /app/client/dist client/dist
# The bundled plugin: served by GET api/library/plugin/download, and its
# sidecars tell bootstrap which version the app ships.
COPY --from=plugin-builder /app/plugin/dist/wp-upload-companion.zip plugin/dist/wp-upload-companion.zip
COPY --from=plugin-builder /app/plugin/dist/plugin.json plugin/dist/plugin.json
COPY --from=plugin-builder /app/plugin/dist/changelog.json plugin/dist/changelog.json
ENV WPU_PLUGIN_BUNDLE_DIR=/app/plugin/dist

ENV PORT=3001
ENV HOST=0.0.0.0
EXPOSE 3001

CMD ["/app/server/src/index.ts"]
