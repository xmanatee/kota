#!/usr/bin/env bash
# Host-owned isolated deploy verification. Uses no real credentials or chat
# messages, no host mounts, and no runtime network. Requires Compose >= 2.30.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CASE_DIR="$(mktemp -d)"
KOTA_TELEGRAM_INSTANCE="kota-telegram-check-$(basename "$CASE_DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
export KOTA_TELEGRAM_INSTANCE
export KOTA_TELEGRAM_NETWORK_MODE=none
cleanup() {
  local result=$?
  "$HERE/rollback.sh" --mode docker --purge-state || result=1
  rm -rf "$CASE_DIR"
  exit "$result"
}
trap cleanup EXIT
umask 077
cat > "$CASE_DIR/inputs" <<'INPUTS'
TELEGRAM_BOT_TOKEN=123456:isolated-fixture-only
TELEGRAM_ALERT_CHAT_ID=123
KOTA_MODEL=openrouter/openrouter/auto
OPENROUTER_API_KEY=isolated-$literal-fixture
INPUTS
"$HERE/install.sh" --mode docker --env-file "$CASE_DIR/inputs"
"$HERE/smoke-test.sh" docker
# Inspect only selected non-secret provenance fields, never Config.Env.
docker inspect --format '{{.Id}} {{.Image}} {{.State.StartedAt}} {{.State.Health.Status}} {{.HostConfig.RestartPolicy.Name}} {{.HostConfig.NetworkMode}}' "$KOTA_TELEGRAM_INSTANCE"
docker exec "$KOTA_TELEGRAM_INSTANCE" node -e '
  const fs = require("node:fs");
  const p = "/var/lib/kota/.kota/config.json";
  const raw = fs.readFileSync(p, "utf8");
  for (const key of ["TELEGRAM_BOT_TOKEN", "OPENROUTER_API_KEY"]) {
    if (!process.env[key] || raw.includes(process.env[key])) throw Error("Secret boundary failed");
  }
  if (process.env.OPENROUTER_API_KEY !== "isolated-$literal-fixture") throw Error("Secret interpolation occurred");
  if ((fs.statSync(p).mode & 0o777) !== 0o600) throw Error("Config is not private");
  fs.writeFileSync("/var/lib/kota/deploy-check-state", "retained");
'
rm "$CASE_DIR/inputs"
"$HERE/rollback.sh" --mode docker
if "$HERE/smoke-test.sh" docker; then
  echo "Rollback failed: daemon still reachable" >&2
  exit 1
fi
docker run --rm --network none --user 1001:1001 \
  --volume "$KOTA_TELEGRAM_INSTANCE-state:/var/lib/kota" \
  --entrypoint node "$KOTA_TELEGRAM_INSTANCE:latest" -e '
    if (require("node:fs").readFileSync("/var/lib/kota/deploy-check-state", "utf8") !== "retained") process.exit(1);
  '
"$HERE/rollback.sh" --mode docker --purge-state
if docker volume inspect "$KOTA_TELEGRAM_INSTANCE-state" >/dev/null 2>&1; then
  echo "Purge failed: volume still exists" >&2
  exit 1
fi
echo "Isolated build, launch, health, literal secrets, rollback and purge passed."
echo "Telegram transport and a real staging /status exchange were not exercised."
