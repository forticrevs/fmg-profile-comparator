#!/usr/bin/env bash
# Start the Redis container used by the ARQ job queue.
#
# We prefer `docker compose up -d redis` because docker-compose.yml is the
# canonical declarative config for deployment targets. On this dev host
# `docker` is a podman shim and the legacy docker-compose v1 binary can't
# reach the podman socket, so we fall back to a direct `podman run` that
# mirrors the compose service definition.
#
# Usage:
#   scripts/start-redis.sh          # start if not running
#   scripts/start-redis.sh stop     # stop
#   scripts/start-redis.sh status   # show container state
set -euo pipefail

NAME=fmg-redis
IMAGE=docker.io/redis:7-alpine
PORT=127.0.0.1:6379:6379
VOLUME=fmg-redis-data

cmd=${1:-start}

run_container() {
  if command -v podman >/dev/null 2>&1; then
    RUNTIME=podman
  elif command -v docker >/dev/null 2>&1; then
    RUNTIME=docker
  else
    echo "error: neither podman nor docker found on PATH" >&2
    exit 1
  fi

  # Try docker compose first when we're on a real Docker daemon.
  if [ "$RUNTIME" = docker ] && docker compose version >/dev/null 2>&1; then
    exec docker compose up -d redis
  fi

  # Otherwise: direct container run (works for podman + for docker without compose).
  if $RUNTIME ps --format '{{.Names}}' 2>/dev/null | grep -qx "$NAME"; then
    echo "$NAME already running"
    exit 0
  fi

  if $RUNTIME ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$NAME"; then
    echo "starting existing $NAME container..."
    exec $RUNTIME start "$NAME"
  fi

  echo "creating and starting $NAME..."
  exec $RUNTIME run -d \
    --name "$NAME" \
    --restart unless-stopped \
    -p "$PORT" \
    -v "$VOLUME:/data" \
    "$IMAGE" \
    redis-server --appendonly yes
}

stop_container() {
  for rt in podman docker; do
    if command -v "$rt" >/dev/null 2>&1 && $rt ps --format '{{.Names}}' 2>/dev/null | grep -qx "$NAME"; then
      exec $rt stop "$NAME"
    fi
  done
  echo "$NAME not running"
}

status_container() {
  for rt in podman docker; do
    if command -v "$rt" >/dev/null 2>&1; then
      $rt ps -a --filter "name=^${NAME}$" 2>/dev/null || true
    fi
  done
}

case "$cmd" in
  start) run_container ;;
  stop) stop_container ;;
  status) status_container ;;
  *)
    echo "usage: $0 {start|stop|status}" >&2
    exit 64
    ;;
esac
