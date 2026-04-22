#!/usr/bin/env bash
# KOTA Telegram personal assistant — rollback / uninstall.
#
# Undoes what install.sh did. State under /var/lib/kota (systemd) and
# the kota-telegram-state volume (docker) is preserved unless
# --purge-state is passed.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE=""
PURGE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --purge-state)
      PURGE=1
      shift
      ;;
    -h|--help)
      sed -n '2,10p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "rollback.sh: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$MODE" ]]; then
  if [[ -f /etc/systemd/system/kota-telegram.service ]]; then
    MODE="systemd"
  elif command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' | grep -qx kota-telegram; then
    MODE="docker"
  else
    echo "rollback.sh: nothing to roll back; pass --mode to force" >&2
    exit 0
  fi
fi

case "$MODE" in
  docker)
    (
      cd "$HERE/../.."
      docker compose --file "$HERE/docker-compose.yml" down
    )
    if [[ $PURGE -eq 1 ]]; then
      docker volume rm kota-telegram-state >/dev/null 2>&1 || true
    fi
    echo "docker stack removed."
    ;;
  systemd)
    if [[ $EUID -ne 0 ]]; then
      echo "rollback.sh: systemd mode requires root (sudo)" >&2
      exit 1
    fi
    systemctl disable --now kota-telegram.service || true
    rm -f /etc/systemd/system/kota-telegram.service
    systemctl daemon-reload
    rm -f /etc/kota/telegram-assistant.env
    if [[ $PURGE -eq 1 ]]; then
      rm -rf /var/lib/kota
    fi
    echo "systemd service removed."
    ;;
  *)
    echo "rollback.sh: unsupported --mode: $MODE" >&2
    exit 2
    ;;
esac
