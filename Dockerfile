# syntax=docker/dockerfile:1

# ==============================================================================
# The image this application ships as (plan §16).
#
# Multi-stage, so the compiler, the dev dependencies and the TypeScript never
# reach the thing you run: the final stage receives a compiled `build/` and a
# production-only `node_modules`, and nothing else.
#
# Two processes come out of one image — `node bin/server.js` for the web and
# `node ace queue:work` for the worker (see compose.yaml). The worker is not
# optional: mail, webhooks and every scheduled job are queued, so an
# application deployed without one accepts work it will never do.
# ==============================================================================

ARG NODE_VERSION=24-slim

# ------------------------------------------------------------------------------
# Base — the runtime, and nothing on top of it.
# ------------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
ENV NODE_ENV=production
WORKDIR /app

# ------------------------------------------------------------------------------
# Dependencies — everything, including the dev ones the build needs.
#
# `better-sqlite3` is a native module. It has prebuilt binaries for most
# platforms, and a toolchain here for when yours is not one of them: SQLite is
# a dependency of this application even when it is deployed on Postgres,
# because the same code runs on both (§5.1).
# ------------------------------------------------------------------------------
FROM base AS deps
ENV NODE_ENV=development
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ------------------------------------------------------------------------------
# Build — TypeScript to JavaScript, and the front-end bundle.
#
# `node ace build` runs Vite as part of the build, so `public/assets` and its
# manifest are produced here. Without the manifest every page renders without
# styles, and the only clue is a missing file.
# ------------------------------------------------------------------------------
FROM base AS build
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN node ace build

# ------------------------------------------------------------------------------
# Runtime — the compiled application and its production dependencies.
#
# The toolchain is installed and removed in a single layer, so it is present
# while `better-sqlite3` may need to compile and absent in the image you ship.
# ------------------------------------------------------------------------------
FROM base AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci --omit=dev \
  && apt-get purge -y --auto-remove python3 make g++ \
  && rm -rf /var/lib/apt/lists/* /root/.npm

COPY --from=build /app/build ./

# ------------------------------------------------------------------------------
# Where uploads land when `DRIVE_DISK=fs`.
#
# Deployed, this should be R2 (§10) and this directory stays empty — it exists
# so that a container started without object storage configured writes
# somewhere it is allowed to, rather than crashing on the first upload.
# ------------------------------------------------------------------------------
RUN mkdir -p storage tmp && chown -R node:node storage tmp

# The `node` user ships with the image. Root is not needed to run this and is
# one privilege escalation away from mattering.
USER node

ENV PORT=3333 HOST=0.0.0.0
EXPOSE 3333

# Liveness, from the platform's point of view: the process, not its
# dependencies (`/ready` is the one that checks those).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "bin/server.js"]
