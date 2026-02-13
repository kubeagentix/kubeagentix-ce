#!/bin/sh
set -eu

KUBE_SOURCE_DIR="${KUBE_SOURCE_DIR:-/root/.kube}"
KUBE_TARGET_DIR="${KUBE_TARGET_DIR:-/tmp/kubeagentix/.kube}"
SOURCE_CONFIG="${KUBE_SOURCE_DIR}/config"
TARGET_CONFIG="${KUBE_TARGET_DIR}/config"
LOCALHOST_BRIDGE_ENABLED="${KUBEAGENTIX_PROXY_LOCALHOST_KUBECONFIG:-${KUBEAGENTIX_REWRITE_LOCALHOST_KUBECONFIG:-true}}"

if [ -f "$SOURCE_CONFIG" ]; then
  mkdir -p /tmp/kubeagentix
  rm -rf "$KUBE_TARGET_DIR"
  mkdir -p "$KUBE_TARGET_DIR"
  cp -R "$KUBE_SOURCE_DIR/." "$KUBE_TARGET_DIR/"

  if [ "$LOCALHOST_BRIDGE_ENABLED" = "true" ] || [ "$LOCALHOST_BRIDGE_ENABLED" = "1" ]; then
    if command -v socat >/dev/null 2>&1; then
      for port in $(grep -Eo 'https://(localhost|127\.0\.0\.1|\[::1\]):[0-9]+' "$TARGET_CONFIG" | sed -E 's#.*:([0-9]+)$#\1#' | sort -u || true); do
        socat TCP-LISTEN:"$port",bind=127.0.0.1,reuseaddr,fork TCP:host.docker.internal:"$port" >/tmp/kubeagentix-socat-"$port".log 2>&1 &
      done
    fi
  fi

  export KUBECONFIG="$TARGET_CONFIG"
fi

exec "$@"
