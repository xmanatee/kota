import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const evidenceRoot = join(root, "surface-runtime-evidence");
const outPath = join(root, "surface-runtime-probe.json");

const checks = [];

function add(id, passed, detail) {
  checks.push({ id, passed, detail });
}

function json(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function text(path) {
  return readFileSync(path, "utf-8");
}

function hasCase(manifest, id) {
  return manifest.cases?.some((entry) => entry.id === id);
}

function nonEmpty(path, minBytes = 20) {
  return existsSync(path) && statSync(path).size >= minBytes;
}

const expectedWebCases = [
  "empty",
  "success-memory",
  "success-knowledge",
  "success-tasks",
  "success-inbox",
  "ambiguous",
  "no-contributors",
  "contributor-failed",
  "decode-error",
];

const expectedMobileCases = [
  "empty",
  "loading",
  "success-memory",
  "success-knowledge",
  "success-tasks",
  "success-inbox",
  "ambiguous",
  "no-contributors",
  "contributor-failed",
  "http-error-retry",
  "offline",
  "no-daemon",
];

const expectedMacosCases = [
  "expanded-empty-draft",
  "expanded-ready-before-submit",
  "expanded-loading",
  "success-memory",
  "success-knowledge",
  "success-tasks",
  "success-inbox",
  "ambiguous",
  "no-contributors",
  "contributor-failed",
  "http-error-retry",
];

const expectedChatCommands = [
  "/capture remember to call alice",
  "/capture-to-knowledge architecture decision",
  "/capture-to-tasks fix the login redirect",
  "/capture-to-inbox raw morning thought",
  "/capture something vague",
  "/capture-to-memory anything",
  "/capture-to-tasks file the bug",
  "/capture",
];

function verifyWeb() {
  const dir = join(evidenceRoot, "web");
  const manifestPath = join(dir, "capture-panel-mounted-dom-manifest.json");
  if (!existsSync(manifestPath)) {
    add("web-manifest", false, "missing capture-panel-mounted-dom-manifest.json");
    return;
  }
  const manifest = json(manifestPath);
  add(
    "web-mounted-capture-panel",
    manifest.surface === "clients/web/src/components/sidebar/CapturePanel.tsx" &&
      manifest.decoder?.includes("parseCaptureResult"),
    "web manifest names CapturePanel and the strict capture decoder",
  );
  for (const id of expectedWebCases) {
    const entry = manifest.cases?.find((item) => item.id === id);
    add(
      `web-case-${id}`,
      Boolean(entry) && nonEmpty(join(dir, entry.artifact), 200),
      `web mounted DOM artifact exists for ${id}`,
    );
  }
}

function verifyMobile() {
  const dir = join(evidenceRoot, "mobile");
  const manifestPath = join(dir, "capture-screen-mounted-tree-manifest.json");
  if (!existsSync(manifestPath)) {
    add("mobile-manifest", false, "missing capture-screen-mounted-tree-manifest.json");
    return;
  }
  const manifest = json(manifestPath);
  add(
    "mobile-mounted-capture-screen",
    manifest.surface === "clients/mobile/src/screens/CaptureScreen.tsx" &&
      manifest.requestPath?.includes("parseCaptureResult"),
    "mobile manifest names CaptureScreen and the strict capture decoder",
  );
  for (const id of expectedMobileCases) {
    const entry = manifest.cases?.find((item) => item.id === id);
    add(
      `mobile-case-${id}`,
      Boolean(entry) && nonEmpty(join(dir, entry.artifact), 200),
      `mobile mounted tree artifact exists for ${id}`,
    );
  }
}

function verifyChat(surface, expectedCommands) {
  const dir = join(evidenceRoot, surface);
  const manifestPath = join(dir, "capture-command-runtime-manifest.json");
  const jsonPath = join(dir, "capture-command-runtime.json");
  const mdPath = join(dir, "capture-command-runtime.md");
  if (!existsSync(manifestPath) || !existsSync(jsonPath) || !existsSync(mdPath)) {
    add(`${surface}-manifest`, false, `missing ${surface} chat runtime artifacts`);
    return;
  }
  const payload = json(jsonPath);
  const body = text(mdPath);
  add(
    `${surface}-runtime-path`,
    payload.path?.includes("renderCaptureReplyPlain") && payload.cases?.length >= 8,
    `${surface} evidence comes from the command dispatcher and shared chat renderer`,
  );
  for (const command of expectedCommands) {
    add(
      `${surface}-command-${command}`,
      payload.cases?.some((entry) => entry.command === command) &&
        body.includes(`## ${command.trimEnd()}`),
      `${surface} evidence includes ${command}`,
    );
  }
  add(
    `${surface}-ambiguous-reply`,
    body.includes(
      "Capture target ambiguous. Suggestions: memory, knowledge, tasks, inbox. Re-run with one of: /capture-to-memory, /capture-to-knowledge, /capture-to-tasks, /capture-to-inbox.",
    ),
    `${surface} evidence includes the full ambiguous reply`,
  );
}

function verifyMacos() {
  const dir = join(evidenceRoot, "macos");
  const manifestPath = join(dir, "capture-view-rendered-states.txt");
  const imageDir = join(dir, "capture-view-rendered-states");
  if (!existsSync(manifestPath)) {
    add("macos-manifest", false, "missing capture-view-rendered-states.txt");
    return;
  }
  const manifest = text(manifestPath);
  add(
    "macos-renderer-manifest",
    manifest.includes("CaptureView.swift") &&
      manifest.includes("SwiftUI.ImageRenderer -> PNG"),
    "macOS manifest names CaptureView.swift and ImageRenderer PNG output",
  );
  for (const id of expectedMacosCases) {
    const pngPath = join(imageDir, `${id}.png`);
    add(
      `macos-png-${id}`,
      manifest.includes(`## ${id}`) && nonEmpty(pngPath, 1000),
      `macOS rendered PNG exists for ${id}`,
    );
  }
}

verifyWeb();
verifyMobile();
verifyChat("telegram", expectedChatCommands);
verifyChat("slack", [
  "/capture remember to call alice",
  "/capture-to-knowledge architecture decision",
  "/capture-to-tasks fix the login redirect",
  "/capture-to-inbox raw morning thought",
  "/capture something vague",
  "/capture-to-memory anything",
  "/capture-to-inbox raw thought",
  "/capture   ",
]);
verifyMacos();

const passed = checks.every((check) => check.passed);
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      generatedBy: "capture-consolidation/probe-surface-runtime-evidence.mjs",
      evidenceRoot: "capture-consolidation/surface-runtime-evidence",
      passed,
      checks,
    },
    null,
    2,
  )}\n`,
  "utf-8",
);
if (!passed) {
  process.exitCode = 1;
}
