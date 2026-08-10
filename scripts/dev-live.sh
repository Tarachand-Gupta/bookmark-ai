#!/usr/bin/env bash
# One-command local live-sessions server, so the Live features work in dev
# exactly like prod (web .env.local already points NEXT_PUBLIC_LIVE_API_URL at
# http://localhost:8091). Starts a throwaway Redis in Docker if none is
# listening, then the Fastify live server in watch mode.
#
#   ./scripts/dev-live.sh          # foreground (Ctrl-C stops the server; redis stays)
#
# Auth in dev: the same dev Clerk instance the web app uses. CLERK_SECRET_KEY
# comes from apps/web/.env.local; DEVICE_TOKEN_SECRET from the root .env — so
# real sessions AND extension device tokens both verify, matching production.
set -euo pipefail
cd "$(dirname "$0")/.."

REDIS_PORT="${REDIS_PORT:-6379}"
if ! nc -z localhost "$REDIS_PORT" 2>/dev/null; then
  echo "[dev-live] no redis on :$REDIS_PORT — starting docker container bookmark-redis"
  docker start bookmark-redis 2>/dev/null ||
    docker run -d --name bookmark-redis -p "$REDIS_PORT":6379 redis:7-alpine
  until nc -z localhost "$REDIS_PORT"; do sleep 0.3; done
fi

# Pull the two secrets from the same files the web dev server reads. Never
# echo them.
DEVICE_TOKEN_SECRET="${DEVICE_TOKEN_SECRET:-$(grep -E '^DEVICE_TOKEN_SECRET=' .env 2>/dev/null | cut -d= -f2-)}"
CLERK_SECRET_KEY="${CLERK_SECRET_KEY:-$(grep -E '^CLERK_SECRET_KEY=' apps/web/.env.local 2>/dev/null | tail -1 | cut -d= -f2-)}"

export PORT="${PORT:-8091}"
export REDIS_URL="redis://localhost:$REDIS_PORT"
export DEVICE_TOKEN_SECRET CLERK_SECRET_KEY

echo "[dev-live] live server → http://localhost:$PORT (redis :$REDIS_PORT)"
exec pnpm --filter @bookmark-ai/live-server dev
