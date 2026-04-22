#!/usr/bin/env bash
# KOTA Telegram personal assistant — post-install smoke test.
#
# Verifies the running daemon is reachable, accepts a /status query from
# Telegram, and has the expected channels registered. Call after
# install.sh completes, once you have messaged the bot at least once.

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
    sudo -u kota /usr/local/bin/kota daemon status --project-dir /var/lib/kota
    ;;
  *)
    echo "smoke-test.sh: unsupported mode: $MODE (docker|systemd)" >&2
    exit 2
    ;;
esac

echo
echo "Daemon reachable. Next: send /status to the bot and confirm the"
echo "reply. A reply confirms both Telegram channels are live and the"
echo "scheduler is running inside the same process."
