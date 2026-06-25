# ───────────────────────────────────────────────────────────────────────────
# Valerion frontend (Vite + React) — multi-stage build
#
#   build  : compile the SPA to static files (dist/)
#   runtime: nginx serving dist/ + reverse-proxying /api/v1 and /icd-bot
#
# Vite inlines VITE_* values at BUILD time, so the API base / bot path / Azure
# IDs are baked in here from build args (see docker-compose.yml). Defaults keep
# the app same-origin (/api/v1, /icd-bot), which is exactly what nginx proxies.
# ───────────────────────────────────────────────────────────────────────────
FROM node:20 AS build
WORKDIR /app

# Build-time public config (safe to embed — these are not secrets).
ARG VITE_API_BASE=/api/v1
ARG VITE_ICD_BOT_API=/icd-bot
ARG VITE_DEPLOYMENT=uat
ARG VITE_AZURE_CLIENT_ID=
ARG VITE_AZURE_TENANT_ID=
ARG VITE_AZURE_REDIRECT_URI=

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Generate .env.production deterministically from the build args so the build
# never depends on a gitignored env file being present in the context.
RUN printf 'VITE_API_BASE=%s\nVITE_ICD_BOT_API=%s\nVITE_DEPLOYMENT=%s\nVITE_AZURE_CLIENT_ID=%s\nVITE_AZURE_TENANT_ID=%s\nVITE_AZURE_REDIRECT_URI=%s\n' \
    "$VITE_API_BASE" "$VITE_ICD_BOT_API" "$VITE_DEPLOYMENT" \
    "$VITE_AZURE_CLIENT_ID" "$VITE_AZURE_TENANT_ID" "$VITE_AZURE_REDIRECT_URI" \
    > .env.production \
    && npm run build

# ───────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# SPA + reverse-proxy config (proxies /api/v1 -> backend, /icd-bot -> bot box).
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
