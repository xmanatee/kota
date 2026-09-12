#!/usr/bin/env bash
# Deploy with Docker Compose >= 2.30 or systemd and a prebuilt /opt/kota.
# Usage: install.sh [--mode docker|systemd] [--env-file /path/to/secrets]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/.env"
MODE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      [[ $# -ge 2 && -n "$2" ]] || { echo "--env-file requires a path" >&2; exit 2; }
      ENV_FILE="$2"; shift 2 ;;
    --mode)
      [[ "${2:-}" == docker || "${2:-}" == systemd ]] || { echo "--mode requires docker or systemd" >&2; exit 2; }
      MODE="$2"
      shift 2 ;;
    -h|--help) sed -n '2,3p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ -z "$MODE" ]]; then
  if command -v docker >/dev/null 2>&1; then MODE=docker; else MODE=systemd; fi
fi
[[ -f "$ENV_FILE" ]] || { echo "Secrets file not found: $ENV_FILE" >&2; exit 1; }
# Compose raw env_file uses literal KEY=VALUE lines. Never source this file or
# print its values. Restrict keys to deploy inputs so it cannot override process
# authority (HOME, NODE_OPTIONS, etc.). Values are literal, without shell quotes.
awk '
  /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
  {
    pos = index($0, "="); key = substr($0, 1, pos - 1); value = substr($0, pos + 1)
    if (!pos || key !~ /^(TELEGRAM_BOT_TOKEN|TELEGRAM_ALERT_CHAT_ID|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY|KOTA_MODEL|KOTA_DEFAULT_PRESET|KOTA_DEFAULT_AGENT_HARNESS|KOTA_TELEGRAM_DEFAULT_AUTONOMY_MODE|KOTA_TELEGRAM_ALLOWED_CHAT_IDS)$/ || seen[key]++) {
      print "Invalid or duplicate deploy input at line " NR > "/dev/stderr"; bad = 1
    }
    if (value != "") present[key] = 1
  }
  END {
    if (!present["TELEGRAM_BOT_TOKEN"] || !present["TELEGRAM_ALERT_CHAT_ID"]) {
      print "TELEGRAM_BOT_TOKEN and TELEGRAM_ALERT_CHAT_ID are required" > "/dev/stderr"; bad = 1
    }
    exit bad
  }
' "$ENV_FILE"
if [[ "$MODE" == systemd ]]; then
  [[ $EUID -eq 0 ]] || { echo "systemd mode requires root" >&2; exit 1; }
  command -v systemctl >/dev/null
  # Check the complete installed package before mutating host service state.
  node /opt/kota/bin/kota.mjs --version >/dev/null
  if ! id kota >/dev/null 2>&1; then
    useradd --system --home-dir /var/lib/kota --shell /usr/sbin/nologin kota
  fi
  install -d -o kota -g kota -m 0750 /var/lib/kota /var/lib/kota/.kota /var/lib/kota/data
  install -d -m 0750 /etc/kota
  # Quote literal values for systemd's EnvironmentFile grammar. Neither shell
  # substitution nor systemd specifier expansion is applied to these values.
  umask 077
  TEMP_ENV="$(mktemp /etc/kota/telegram-assistant.XXXXXX)"
  trap 'rm -f "$TEMP_ENV"' EXIT
  node "$HERE/systemd-env.mjs" "$ENV_FILE" "$TEMP_ENV"
  install -m 0640 -o root -g kota "$TEMP_ENV" /etc/kota/telegram-assistant.env
  install -m 0755 "$HERE/entrypoint.sh" /opt/kota/entrypoint.sh
  install -m 0644 "$HERE/kota-telegram.service" /etc/systemd/system/kota-telegram.service
  systemctl daemon-reload
  systemctl enable kota-telegram.service
  systemctl restart kota-telegram.service
  echo "Service started. Check health: $HERE/smoke-test.sh systemd"
  exit 0
fi
KOTA_TELEGRAM_ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
export KOTA_TELEGRAM_ENV_FILE
# Disable automatic dotenv discovery. Secrets use only the raw service env_file.
docker compose --env-file /dev/null --file "$HERE/docker-compose.yml" config --quiet
docker compose --env-file /dev/null --file "$HERE/docker-compose.yml" up --detach --build --wait --wait-timeout 180
echo "Daemon healthy. Run $HERE/smoke-test.sh docker to inspect it."
echo "Rollback: $HERE/rollback.sh --mode docker"
