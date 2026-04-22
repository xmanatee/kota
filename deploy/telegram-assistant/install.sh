#!/usr/bin/env bash
# KOTA Telegram personal assistant — one-command installer.
#
# Picks between docker-compose (default when docker is present) and a
# system-level systemd unit. Both paths converge on the same daemon
# process that owns the telegram channels, the scheduler, and every
# workflow.
#
# Usage:
#   ./install.sh [--mode docker|systemd] [--env-file /path/to/.env]
#
# Required inputs:
#   An .env file populated from .env.example. Pass with --env-file, or
#   the script looks for ./.env next to this script.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"

MODE=""
ENV_FILE="$HERE/.env"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,15p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "install.sh: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$MODE" ]]; then
  if command -v docker >/dev/null 2>&1; then
    MODE="docker"
  elif command -v systemctl >/dev/null 2>&1; then
    MODE="systemd"
  else
    echo "install.sh: neither docker nor systemctl found; install one or pass --mode explicitly" >&2
    exit 1
  fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "install.sh: env file not found at $ENV_FILE" >&2
  echo "Copy $HERE/.env.example to $ENV_FILE and populate the required secrets." >&2
  exit 1
fi

require_env() {
  local name="$1"
  local value
  # shellcheck disable=SC1090
  value="$(set -a && . "$ENV_FILE" && printf '%s' "${!name:-}")"
  if [[ -z "$value" ]]; then
    echo "install.sh: $ENV_FILE is missing required value: $name" >&2
    exit 1
  fi
}

require_env ANTHROPIC_API_KEY
require_env TELEGRAM_BOT_TOKEN
require_env TELEGRAM_ALERT_CHAT_ID

case "$MODE" in
  docker)
    if ! command -v docker >/dev/null 2>&1; then
      echo "install.sh: docker not found in PATH" >&2
      exit 1
    fi
    echo "Installing via docker compose from $REPO_ROOT"
    (
      cd "$REPO_ROOT"
      docker compose \
        --file "$HERE/docker-compose.yml" \
        --env-file "$ENV_FILE" \
        up --detach --build
    )
    echo "Up. Follow logs: docker logs -f kota-telegram"
    echo "Rollback:       $HERE/rollback.sh --mode docker"
    ;;
  systemd)
    if [[ $EUID -ne 0 ]]; then
      echo "install.sh: systemd mode requires root (sudo)" >&2
      exit 1
    fi
    if ! command -v systemctl >/dev/null 2>&1; then
      echo "install.sh: systemctl not found" >&2
      exit 1
    fi
    if ! id kota >/dev/null 2>&1; then
      useradd --system --home-dir /var/lib/kota --shell /usr/sbin/nologin kota
    fi
    install -d -o kota -g kota -m 0750 /var/lib/kota /var/lib/kota/.kota /var/lib/kota/data
    install -d -m 0750 /etc/kota
    install -m 0640 -o root -g kota "$ENV_FILE" /etc/kota/telegram-assistant.env

    if [[ ! -x /usr/local/bin/kota ]]; then
      echo "install.sh: /usr/local/bin/kota not present; build and install first, e.g.:" >&2
      echo "  (cd $REPO_ROOT && pnpm install --frozen-lockfile && pnpm run build)" >&2
      echo "  install -m 0755 $REPO_ROOT/bin/kota.mjs /usr/local/bin/kota" >&2
      exit 1
    fi

    install -m 0644 "$HERE/kota-telegram.service" /etc/systemd/system/kota-telegram.service
    systemctl daemon-reload
    systemctl enable --now kota-telegram.service
    echo "Up. Follow logs: journalctl -u kota-telegram -f"
    echo "Rollback:       sudo $HERE/rollback.sh --mode systemd"
    ;;
  *)
    echo "install.sh: unsupported --mode: $MODE (expected docker or systemd)" >&2
    exit 2
    ;;
esac
