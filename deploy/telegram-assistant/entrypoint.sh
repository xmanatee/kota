#!/usr/bin/env bash
# Build deploy-time KOTA config from environment, then exec the CLI.

set -euo pipefail

PROJECT_DIR="${KOTA_PROJECT_DIR:-/var/lib/kota}"

mkdir -p "$PROJECT_DIR/.kota"

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const projectDir = process.env.KOTA_PROJECT_DIR || "/var/lib/kota";
const configPath = path.join(projectDir, ".kota", "config.json");

function readExistingConfig() {
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function readCsvIntegers(value, name) {
  if (!value) return [];
  return value.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (!/^-?\d+$/.test(part)) {
        throw new Error(`${name} contains a non-integer chat id: ${part}`);
      }
      return Number.parseInt(part, 10);
    });
}

const config = readExistingConfig();

const trustedProjects = Array.isArray(config.trustedProjects)
  ? config.trustedProjects.filter((entry) => typeof entry === "string")
  : [];
if (!trustedProjects.includes(projectDir)) {
  config.trustedProjects = [...trustedProjects, projectDir];
}

if (process.env.KOTA_MODEL) {
  config.model = process.env.KOTA_MODEL;
}
if (process.env.KOTA_DEFAULT_PRESET) {
  config.defaultPreset = process.env.KOTA_DEFAULT_PRESET;
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
NODE

exec node /opt/kota/bin/kota.mjs "$@"
