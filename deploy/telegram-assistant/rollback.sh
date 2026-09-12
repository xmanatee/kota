#!/usr/bin/env bash
# Stop the deployed service. State persists unless --purge-state is explicit.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PURGE=0
MODE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      [[ "${2:-}" == docker || "${2:-}" == systemd ]] || { echo "--mode requires docker or systemd" >&2; exit 2; }
      MODE="$2"
      shift 2 ;;
    --purge-state) PURGE=1; shift ;;
    -h|--help) echo "Usage: rollback.sh [--mode docker|systemd] [--purge-state]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ -z "$MODE" ]]; then
  if [[ -f /etc/systemd/system/kota-telegram.service ]]; then MODE=systemd; else MODE=docker; fi
fi
if [[ "$MODE" == systemd ]]; then
  [[ $EUID -eq 0 ]] || { echo "systemd mode requires root" >&2; exit 1; }
  systemctl disable --now kota-telegram.service
  rm -f /etc/systemd/system/kota-telegram.service
  systemctl daemon-reload
  rm -f /etc/kota/telegram-assistant.env
  if [[ $PURGE -eq 1 ]]; then rm -rf /var/lib/kota; fi
  echo "Systemd deployment stopped; installed package retained under /opt/kota."
  exit 0
fi
# Teardown must work after credentials have been removed or rotated.
export KOTA_TELEGRAM_ENV_FILE=/dev/null
if [[ $PURGE -eq 1 ]]; then
  docker compose --env-file /dev/null --file "$HERE/docker-compose.yml" down --volumes
else
  docker compose --env-file /dev/null --file "$HERE/docker-compose.yml" down
fi
echo "Docker deployment stopped."
