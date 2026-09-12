#!/usr/bin/env bash
# Read daemon health without consuming any Telegram updates.
set -euo pipefail
[[ $# -le 1 ]] || { echo "Usage: smoke-test.sh [docker|systemd]" >&2; exit 2; }
MODE="${1:-}"
if [[ -z "$MODE" ]]; then
  if [[ -f /etc/systemd/system/kota-telegram.service ]]; then MODE=systemd; else MODE=docker; fi
fi
case "$MODE" in
  docker) docker exec "${KOTA_TELEGRAM_INSTANCE:-kota-telegram}" node /opt/kota/bin/kota.mjs daemon status ;;
  systemd) sudo -u kota node /opt/kota/bin/kota.mjs daemon status --scope-root /var/lib/kota ;;
  *) echo "Usage: smoke-test.sh [docker|systemd]" >&2; exit 2 ;;
esac
echo "Daemon reachable. A real staging-bot exchange remains unverified until"
echo "an authentic chat sends /status after a host-owned poll handoff."
