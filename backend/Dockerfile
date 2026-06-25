# ───────────────────────────────────────────────────────────────────────────
# Valerion API (NestJS) — multi-stage build
#
#   build  : install ALL deps, compile TypeScript -> dist/, prune to prod deps
#   runtime: slim image, runs the compiled JS (dist/src/main.js)
#
# Native modules (bcrypt, pg) are compiled in the full `node:20` builder
# (which ships gcc/python via buildpack-deps) and copied into the slim runtime;
# both images are glibc + Node 20, so the prebuilt .node binaries are ABI-safe.
# ───────────────────────────────────────────────────────────────────────────
FROM node:20 AS build
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Compile.
COPY . .
RUN npm run build \
    && npm prune --omit=dev

# ───────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

# Default port (overridden by compose). The app reads APP_PORT at runtime.
ENV APP_PORT=2500
EXPOSE 2500

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Liveness: the API is up when the Swagger JSON responds (<500). Uses Node so
# the slim image needs no curl/wget.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.APP_PORT||2500)+'/'+(process.env.APP_GLOBAL_PREFIX||'api/v1')+'/docs-json',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

# Entry is dist/src/main.js (NOT dist/main.js — see ecosystem.config.js).
CMD ["node", "dist/src/main.js"]
