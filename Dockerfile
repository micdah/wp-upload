# syntax=docker/dockerfile:1

# ---- client-builder: full toolchain, builds the React app ----
FROM node:24-bookworm-slim AS client-builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci
COPY server server
COPY client client
RUN npm run build

# ---- server-deps: production dependencies for the server workspace only ----
FROM node:24-bookworm-slim AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --omit=dev --workspace=server

# ---- final: distroless runtime, no shell, no package manager ----
FROM gcr.io/distroless/nodejs24-debian13:nonroot
WORKDIR /app
COPY --from=server-deps /app/node_modules /app/node_modules
COPY server/package.json server/package.json
COPY server/src server/src
COPY --from=client-builder /app/client/dist client/dist

ENV PORT=3001
ENV HOST=0.0.0.0
EXPOSE 3001

CMD ["/app/server/src/index.ts"]
