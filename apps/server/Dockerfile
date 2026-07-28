# Phase 7 (Release Prep) production image for apps/server. Build context
# MUST be the repo ROOT (npm workspaces need the root package.json/
# package-lock.json), not this directory:
#   docker build -f apps/server/Dockerfile -t lockaltime-server .
# Railway/Render/Fly.io all support a Dockerfile path + build context this
# way; this Dockerfile is deliberately plain (no platform-specific syntax)
# so it isn't locked to any one of the three (CLAUDE.md: PaaS choice is
# Railway, but not irreversibly).

FROM node:24-slim AS build
WORKDIR /repo

# Root workspace manifest first (better layer caching — dependencies only
# reinstall when a package.json/lockfile actually changes, not on every
# source edit).
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
RUN npm ci --workspace apps/server

COPY apps/server apps/server
RUN npm run build --workspace apps/server

FROM node:24-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
RUN npm ci --workspace apps/server --omit=dev

COPY --from=build /repo/apps/server/dist apps/server/dist

# The sweep/streak-expiry/streak-risk-notification pollers (server.ts) are
# in-process setInterval loops -- this MUST run as a long-lived process
# (a PaaS "web service"/"worker", never a serverless function that only
# lives for the duration of one request), the whole reason a PaaS was
# chosen over serverless (CLAUDE.md's Phase 7 decision).
EXPOSE 3000
CMD ["node", "apps/server/dist/server.js"]
