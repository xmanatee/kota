import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "surface-runtime-evidence",
);
const checks = [];

function record(id, passed, detail) {
  checks.push({ id, passed, detail });
}

function requireCondition(id, condition, detail) {
  record(id, Boolean(condition), detail);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(baseDir, relativePath), "utf-8"));
}

function readText(relativePath) {
  return readFileSync(path.join(baseDir, relativePath), "utf-8");
}

function fileSize(relativePath) {
  return statSync(path.join(baseDir, relativePath)).size;
}

function hasPngSignature(relativePath) {
  const bytes = readFileSync(path.join(baseDir, relativePath)).subarray(0, 8);
  return bytes.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

const web = readJson("web/digest-panel-mounted-dom-manifest.json");
requireCondition(
  "web-mounted-digest-panel",
  web.surface === "clients/web/src/components/sidebar/DigestPanel.tsx" &&
    web.mount.includes("<DigestPanel") &&
    web.decoder.includes("parseDigestResponse"),
  "web manifest names the actual DigestPanel mount and strict digest decoder",
);
for (const id of ["active", "quiet", "error"]) {
  const entry = web.cases.find((item) => item.id === id);
  requireCondition(
    `web-${id}-request`,
    entry?.fetchUrl === "/api/digest" &&
      entry.authorizationHeader === "Bearer test-token" &&
      fileSize(`web/${entry.artifact}`) > 500,
    `web ${id} case called /api/digest and wrote mounted DOM`,
  );
}
requireCondition(
  "web-rendered-arms",
  readText("web/digest-panel-active.html").includes("active") &&
    readText("web/digest-panel-quiet.html").includes("quiet window") &&
    readText("web/digest-panel-error.html").includes("Retry"),
  "web mounted DOM covers active, quiet, and error retry arms",
);

const mobile = readJson("mobile/digest-screen-mounted-tree-manifest.json");
requireCondition(
  "mobile-mounted-digest-screen",
  mobile.surface === "clients/mobile/src/screens/DigestScreen.tsx" &&
    mobile.decoder.includes("parseDigestResponse") &&
    mobile.dataSource.includes("getDigest"),
  "mobile manifest names DigestScreen, DaemonContext, and strict digest decoder",
);
for (const id of ["active", "quiet", "error-retry", "offline", "loading", "no-daemon"]) {
  const entry = mobile.cases.find((item) => item.id === id);
  requireCondition(
    `mobile-${id}-tree`,
    entry && fileSize(`mobile/${entry.artifact}`) > 500,
    `mobile ${id} case wrote a rendered React Native tree`,
  );
}
const mobileText = [
  "mobile/digest-screen-active.json",
  "mobile/digest-screen-quiet.json",
  "mobile/digest-screen-error-retry.json",
  "mobile/digest-screen-offline.json",
  "mobile/digest-screen-no-daemon.json",
]
  .map(readText)
  .join("\n");
requireCondition(
  "mobile-rendered-arms",
  mobileText.includes("active") &&
    mobileText.includes("quiet window") &&
    mobileText.includes("Retry") &&
    mobileText.includes("Daemon offline") &&
    mobileText.includes("No daemon configured."),
  "mobile rendered trees cover active, quiet, retry, offline, and no-daemon arms",
);

const telegram = readJson("telegram/digest-command-runtime.json");
requireCondition(
  "telegram-real-command-path",
  telegram.path.includes("handleTelegramStatusCommand") &&
    telegram.path.includes("renderOnDemandDigest") &&
    telegram.active.text.includes("Builder commits") &&
    telegram.quiet.text.includes("No autonomy activity in this window.") &&
    !Object.hasOwn(telegram.active, "parse_mode") &&
    !Object.hasOwn(telegram.quiet, "parse_mode"),
  "telegram /digest evidence comes from the command handler and real on-demand renderer, with plain-text sendMessage bodies",
);

const macosManifest = readText("macos/digest-view-rendered-states.txt");
const macosPngs = readdirSync(path.join(baseDir, "macos", "digest-view-rendered-states"))
  .filter((name) => name.endsWith(".png"))
  .sort();
requireCondition(
  "macos-image-renderer-manifest",
  macosManifest.includes("clients/apple/Sources/KotaShared/DigestView.swift") &&
    macosManifest.includes("SwiftUI.ImageRenderer -> PNG") &&
    macosPngs.length === 8,
  "macOS manifest names DigestView.swift, ImageRenderer, and eight rendered states",
);
for (const png of macosPngs) {
  requireCondition(
    `macos-png-${png}`,
    fileSize(`macos/digest-view-rendered-states/${png}`) > 1_000 &&
      hasPngSignature(`macos/digest-view-rendered-states/${png}`),
    `macOS ${png} is a non-empty PNG render`,
  );
}

const output = {
  generatedBy: "digest-consolidation/probe-surface-runtime-evidence.mjs",
  evidenceRoot: "digest-consolidation/surface-runtime-evidence",
  passed: checks.every((check) => check.passed),
  checks,
};

writeFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "surface-runtime-probe.json"),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf-8",
);

if (!output.passed) {
  process.exitCode = 1;
}
