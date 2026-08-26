#!/usr/bin/env bash
# KOTA Telegram personal assistant — post-install smoke test.
#
# Verifies the running daemon is reachable. Call after install.sh completes.
# This intentionally does not call getUpdates; the daemon-owned interactive
# channel is the single Bot API update consumer. Capture the Telegram /status
# exchange separately from the operator chat before treating staging proof as
# complete.

set -euo pipefail

MODE="${1:-}"

if [[ -z "$MODE" ]]; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx kota-telegram; then
    MODE="docker"
  elif systemctl is-active --quiet kota-telegram.service 2>/dev/null; then
    MODE="systemd"
  else
    echo "smoke-test.sh: daemon not running under docker or systemd" >&2
    exit 1
  fi
fi

case "$MODE" in
  docker)
    docker exec kota-telegram node /opt/kota/bin/kota.mjs daemon status
    ;;
  systemd)
    sudo -u kota /usr/local/bin/kota daemon status --scope-root /var/lib/kota
    ;;
  *)
    echo "smoke-test.sh: unsupported mode: $MODE (docker|systemd)" >&2
    exit 2
    ;;
esac

echo
echo "Daemon reachable. Next: send /status to the bot and capture the"
echo "operator chat reply under .kota/runs/telegram-deploy-staging/."
echo "That separate capture is the staging-bot proof for this artifact."
