#!/usr/bin/env bash
# Build deploy-time KOTA config from environment, then exec the CLI.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

umask 077

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const scopeRoot = process.env.KOTA_SCOPE_ROOT || "/var/lib/kota";
const configPath = path.join(scopeRoot, ".kota", "config.json");

function readExistingConfig() {
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function readCsvIntegers(value, name) {
  if (!value) throw new Error(`${name} must contain at least one chat id`);
  return value.split(",")
    .map((part) => part.trim())
    .map((part) => {
      if (!/^-?\d+$/.test(part) || !Number.isSafeInteger(Number(part))) {
        throw new Error(`${name} must contain safe integer chat ids`);
      }
      return Number.parseInt(part, 10);
    });
}

const config = readExistingConfig();
if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}
if (readCsvIntegers(process.env.TELEGRAM_ALERT_CHAT_ID, "TELEGRAM_ALERT_CHAT_ID").length !== 1) {
  throw new Error("TELEGRAM_ALERT_CHAT_ID requires exactly one chat id");
}

const trustedScopes = Array.isArray(config.trustedScopes)
  ? config.trustedScopes.filter((entry) => typeof entry === "string")
  : [];
if (!trustedScopes.includes(scopeRoot)) {
  config.trustedScopes = [...trustedScopes, scopeRoot];
}

if (process.env.KOTA_MODEL) {
  config.model = process.env.KOTA_MODEL;
}
if (process.env.KOTA_DEFAULT_PRESET) {
  config.defaultPreset = process.env.KOTA_DEFAULT_PRESET;
}
// Chat model selection alone does not select workflow tier models. Keep the
// shipped preset as the owner of the complete harness/model/effort bundle.
if (!config.defaultPreset) {
  if (config.model?.startsWith("openrouter/")) {
    config.defaultPreset = "openrouter";
  } else {
    throw new Error("KOTA_DEFAULT_PRESET is required unless KOTA_MODEL selects OpenRouter");
  }
}
if (process.env.KOTA_DEFAULT_AGENT_HARNESS) {
  config.defaultAgentHarness = process.env.KOTA_DEFAULT_AGENT_HARNESS;
}

const telegram = {
  ...((config.modules && config.modules.telegram) || {}),
};
telegram.defaultAutonomyMode =
  process.env.KOTA_TELEGRAM_DEFAULT_AUTONOMY_MODE ||
  telegram.defaultAutonomyMode ||
  "supervised";
if (!["passive", "supervised", "autonomous"].includes(telegram.defaultAutonomyMode)) {
  throw new Error("KOTA_TELEGRAM_DEFAULT_AUTONOMY_MODE must be passive, supervised or autonomous");
}

const allowedChatIds = readCsvIntegers(
  process.env.KOTA_TELEGRAM_ALLOWED_CHAT_IDS || process.env.TELEGRAM_ALERT_CHAT_ID || "",
  "KOTA_TELEGRAM_ALLOWED_CHAT_IDS",
);
if (allowedChatIds.length > 0) {
  telegram.allowedChatIds = allowedChatIds;
}

config.modules = {
  ...(config.modules || {}),
  telegram,
};

fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
  mode: 0o600,
});
fs.chmodSync(configPath, 0o600);
NODE

exec node "$HERE/bin/kota.mjs" "$@"
