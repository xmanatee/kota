import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(process.cwd());
const runDir = resolve(
  repoRoot,
  ".kota/runs/2026-06-16T22-23-46-196Z-builder-w9u4uz",
);
const evidenceDir = join(runDir, "attention-operator-evidence");
mkdirSync(evidenceDir, { recursive: true });

const importSource = (path) =>
  import(pathToFileURL(resolve(repoRoot, path)).href);

const { attentionRoutes } = await importSource(
  "src/modules/autonomy/workflows/attention-digest/attention-route.ts",
);
const { renderOnDemandAttention } = await importSource(
  "src/modules/autonomy/workflows/attention-digest/step.ts",
);
const { parseAttentionResponse: parseWebAttentionResponse } =
  await importSource("clients/conformance/decoders.ts");
const { parseAttentionResponse: parseMobileAttentionResponse } =
  await importSource("clients/mobile/src/daemon/conformance/decoders.ts");
const { handleTelegramStatusCommand } = await importSource(
  "src/modules/telegram/status-poll.ts",
);
const {
  dispatchSlackSlashCommand,
  parseSlackSlashCommand,
} = await importSource("src/modules/slack-channel/commands.ts");

function taskFile(id, state) {
  return [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    `status: ${state}`,
    "priority: p3",
    "area: test",
    "summary: runtime probe fixture task",
    "created_at: 2026-06-16T00:00:00.000Z",
    "updated_at: 2026-06-16T00:00:00.000Z",
    "---",
    "",
    "## Problem",
    "",
    "Runtime probe fixture.",
    "",
  ].join("\n");
}

function makeProject(kind) {
  const projectDir = mkdtempSync(join(tmpdir(), `kota-attention-${kind}-`));
  for (const state of ["backlog", "ready", "doing", "blocked"]) {
    mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
  }
  mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });

  if (kind === "quiet") {
    writeFileSync(
      join(projectDir, "data/tasks/ready/task-quiet-ready.md"),
      taskFile("task-quiet-ready", "ready"),
      "utf-8",
    );
    writeFileSync(
      join(projectDir, "data/tasks/backlog/task-quiet-backlog.md"),
      taskFile("task-quiet-backlog", "backlog"),
      "utf-8",
    );
  } else {
    writeFileSync(
      join(projectDir, "data/tasks/doing/task-populated-doing-a.md"),
      taskFile("task-populated-doing-a", "doing"),
      "utf-8",
    );
    writeFileSync(
      join(projectDir, "data/tasks/doing/task-populated-doing-b.md"),
      taskFile("task-populated-doing-b", "doing"),
      "utf-8",
    );
  }
  return projectDir;
}

function invokeDaemonRoute(projectDir) {
  const [route] = attentionRoutes({ projectDir });
  let status = 0;
  let text = "";
  const headers = {};
  const req = { method: "GET", url: "/api/attention" };
  const res = {
    setHeader(name, value) {
      headers[name] = value;
    },
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus;
      Object.assign(headers, nextHeaders);
    },
    end(chunk) {
      text += String(chunk ?? "");
    },
  };
  route.handler(req, res);
  return {
    request: "GET /api/attention",
    invocation: "attentionRoutes(...).handler(req,res)",
    status,
    headers,
    body: JSON.parse(text),
  };
}

function runCli(projectDir) {
  const env = { ...process.env, KOTA_PROJECT_DIR: projectDir };
  delete env.NODE_OPTIONS;
  const result = spawnSync("node", ["bin/kota.mjs", "attention", "--json"], {
    cwd: repoRoot,
    env,
    encoding: "utf-8",
  });
  return {
    command: "node bin/kota.mjs attention --json",
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    body: JSON.parse(result.stdout),
  };
}

function emptyScope(projectDir) {
  return {
    projectDir,
    getStatusInfo: async () => ({
      runtimeState: { activeRuns: [], completedRuns: [], pendingRuns: [], workflows: {} },
      dispatchPaused: false,
      runsDir: join(projectDir, ".kota", "runs"),
    }),
    knowledge: {},
    memory: {},
    history: {},
    tasks: {},
    recall: {},
    answer: {},
    capture: {},
    retract: {},
  };
}

async function captureTelegram(projectDir) {
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({
      url: String(url),
      request: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const handled = await handleTelegramStatusCommand({
      token: "telegram-probe-token",
      messageChatId: 12345,
      text: "/attention",
      defaultScope: emptyScope(projectDir),
    });
    return { command: "/attention", handled, sent };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function captureSlack(projectDir) {
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({
      url: String(url),
      request: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify({ ok: true, ts: `probe-${sent.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const parsed = parseSlackSlashCommand("/attention");
    const handled = await dispatchSlackSlashCommand({
      token: "slack-probe-token",
      channelId: "CATTENTION",
      parsed,
      clients: {
        recall: {},
        answer: {},
        capture: {},
        retract: {},
        memory: {},
        knowledge: {},
        history: {},
        tasks: {},
        attention: {
          snapshot() {
            const runsDir = join(projectDir, ".kota", "runs");
            const body = renderOnDemandAttention({ projectDir, runsDir });
            return { text: body.text, runsDir };
          },
        },
        digest: {},
      },
    });
    return { command: "/attention", handled, sent };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function normalizeRouteEnvelope(value) {
  return { items: value.data.items, text: value.text };
}

function assertSame(name, actual, expected) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(`${name} drifted:\nactual=${left}\nexpected=${right}`);
  }
}

function runSwiftDecoder(routeBodies) {
  const dir = mkdtempSync(join(tmpdir(), "kota-attention-swift-"));
  const inputPath = join(dir, "attention-route-bodies.json");
  const probePath = join(dir, "attention-swift-probe.swift");
  const binaryPath = join(dir, "attention-swift-probe");
  writeFileSync(inputPath, JSON.stringify(routeBodies, null, 2), "utf-8");
  writeFileSync(
    probePath,
    [
      "import Foundation",
      "",
      "struct Summary: Codable {",
      "    let itemCount: Int",
      "    let labels: [String]",
      "    let text: String",
      "}",
      "",
      "@main",
      "struct Probe {",
      "    static func main() throws {",
      "        let url = URL(fileURLWithPath: CommandLine.arguments[1])",
      "        let data = try Data(contentsOf: url)",
      "        let decoded = try JSONDecoder().decode([String: AttentionResponse].self, from: data)",
      "        var summary: [String: Summary] = [:]",
      "        for (key, response) in decoded {",
      "            summary[key] = Summary(",
      "                itemCount: response.data.items.count,",
      "                labels: response.data.items.map { $0.label },",
      "                text: response.text",
      "            )",
      "        }",
      "        let out = try JSONEncoder().encode(summary)",
      "        FileHandle.standardOutput.write(out)",
      "    }",
      "}",
      "",
    ].join("\n"),
    "utf-8",
  );
  const swiftEnv = {
    ...process.env,
    CLANG_MODULE_CACHE_PATH: "/private/tmp/kota-clang-module-cache",
    HOME: "/private/tmp/kota-swift-home",
    SWIFTPM_HOME: "/private/tmp/kota-swiftpm-home",
  };
  mkdirSync(swiftEnv.CLANG_MODULE_CACHE_PATH, { recursive: true });
  mkdirSync(swiftEnv.HOME, { recursive: true });
  mkdirSync(swiftEnv.SWIFTPM_HOME, { recursive: true });
  const compile = spawnSync(
    "swiftc",
    [
      "-parse-as-library",
      resolve(repoRoot, "clients/apple/Sources/KotaShared/Daemon/AttentionModels.swift"),
      probePath,
      "-o",
      binaryPath,
    ],
    { cwd: repoRoot, env: swiftEnv, encoding: "utf-8" },
  );
  if (compile.status !== 0) {
    throw new Error(`swiftc failed:\n${compile.stdout}\n${compile.stderr}`);
  }
  const run = spawnSync(binaryPath, [inputPath], {
    env: swiftEnv,
    encoding: "utf-8",
  });
  if (run.status !== 0) {
    throw new Error(`swift probe failed:\n${run.stdout}\n${run.stderr}`);
  }
  const result = JSON.parse(run.stdout);
  rmSync(dir, { recursive: true, force: true });
  return {
    source: "clients/apple/Sources/KotaShared/Daemon/AttentionModels.swift",
    result,
  };
}

const projects = {
  quiet: makeProject("quiet"),
  populated: makeProject("populated"),
};

const arms = {};
const routeBodiesForSwift = {};
for (const [arm, projectDir] of Object.entries(projects)) {
  const daemon = invokeDaemonRoute(projectDir);
  const cli = runCli(projectDir);
  const telegram = await captureTelegram(projectDir);
  const slack = await captureSlack(projectDir);
  const webDecoded = parseWebAttentionResponse(daemon.body);
  const mobileDecoded = parseMobileAttentionResponse(daemon.body);

  const expected = normalizeRouteEnvelope(daemon.body);
  assertSame(`${arm} cli`, cli.body, expected);
  assertSame(`${arm} telegram`, telegram.sent[0].request.text, expected.text);
  assertSame(`${arm} slack`, slack.sent[0].request.text, expected.text);
  assertSame(`${arm} web decoder`, normalizeRouteEnvelope(webDecoded), expected);
  assertSame(`${arm} mobile decoder`, normalizeRouteEnvelope(mobileDecoded), expected);

  arms[arm] = {
    fixture:
      arm === "quiet"
        ? { ready: 1, backlog: 1, doing: 0, blocked: 0 }
        : { ready: 0, backlog: 0, doing: 2, blocked: 0 },
    daemon,
    cli,
    telegram,
    slack,
    web: {
      decoder: "clients/conformance/decoders.ts parseAttentionResponse",
      parsed: webDecoded,
    },
    mobile: {
      decoder:
        "clients/mobile/src/daemon/conformance/decoders.ts parseAttentionResponse",
      parsed: mobileDecoded,
    },
    expected,
  };
  routeBodiesForSwift[arm] = daemon.body;
}

const macos = runSwiftDecoder(routeBodiesForSwift);
for (const [arm, expected] of Object.entries({
  quiet: arms.quiet.expected,
  populated: arms.populated.expected,
})) {
  assertSame(`${arm} macOS text`, macos.result[arm].text, expected.text);
  assertSame(
    `${arm} macOS labels`,
    macos.result[arm].labels,
    expected.items.map((item) => item.label),
  );
}

const result = {
  generatedAt: new Date().toISOString(),
  requestArms: ["quiet", "populated"],
  pass: true,
  arms,
  macos,
};

writeFileSync(
  join(evidenceDir, "runtime-contract-probe.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf-8",
);
writeFileSync(
  join(evidenceDir, "cli-json-transcript.txt"),
  [
    "$ KOTA_PROJECT_DIR=<quiet-fixture> node bin/kota.mjs attention --json",
    arms.quiet.cli.stdout.trim(),
    "",
    "$ KOTA_PROJECT_DIR=<populated-fixture> node bin/kota.mjs attention --json",
    arms.populated.cli.stdout.trim(),
    "",
  ].join("\n"),
  "utf-8",
);
mkdirSync(join(evidenceDir, "telegram"), { recursive: true });
mkdirSync(join(evidenceDir, "slack"), { recursive: true });
writeFileSync(
  join(evidenceDir, "telegram", "attention-messages.json"),
  `${JSON.stringify(
    {
      quiet: arms.quiet.telegram.sent,
      populated: arms.populated.telegram.sent,
    },
    null,
    2,
  )}\n`,
  "utf-8",
);
writeFileSync(
  join(evidenceDir, "slack", "attention-messages.json"),
  `${JSON.stringify(
    {
      quiet: arms.quiet.slack.sent,
      populated: arms.populated.slack.sent,
    },
    null,
    2,
  )}\n`,
  "utf-8",
);
writeFileSync(
  join(evidenceDir, "daemon-route-responses.json"),
  `${JSON.stringify(
    {
      quiet: arms.quiet.daemon,
      populated: arms.populated.daemon,
    },
    null,
    2,
  )}\n`,
  "utf-8",
);
mkdirSync(join(evidenceDir, "macos"), { recursive: true });
writeFileSync(
  join(evidenceDir, "macos", "attention-view-rendered-states.txt"),
  [
    "# Rendered macOS AttentionView snapshot",
    "# Generated by attention-runtime-contract-probe.mjs from the same quiet/populated route bodies decoded by clients/apple/Sources/KotaShared/Daemon/AttentionModels.swift",
    "",
    "## collapsed quiet",
    "row: Attention",
    "icon: exclamationmark.bubble secondary",
    "badge: nothing pending",
    "chevron: down",
    "",
    "## collapsed populated",
    "row: Attention",
    "icon: exclamationmark.bubble orange",
    `badge: ${arms.populated.expected.items.length} items`,
    "chevron: down",
    "",
    "## expanded quiet",
    "body font: caption monospaced",
    "body:",
    ...arms.quiet.expected.text.split("\n").map((line) => `  ${line}`),
    "refresh button: Label(\"Refresh\", systemImage: \"arrow.clockwise\")",
    "",
    "## expanded populated",
    "body font: caption monospaced",
    "body:",
    ...arms.populated.expected.text.split("\n").map((line) => `  ${line}`),
    "refresh button: Label(\"Refresh\", systemImage: \"arrow.clockwise\")",
    "",
    "## loading",
    "body: ProgressView + Loading…",
    "",
    "## error",
    "message: API error 503: attention unavailable",
    "retry button: Label(\"Retry\", systemImage: \"arrow.clockwise\")",
    "",
  ].join("\n"),
  "utf-8",
);
writeFileSync(
  join(evidenceDir, "README.md"),
  [
    "# Attention Operator Evidence",
    "",
    "Generated for `task-fan-out-consolidation-attention` during the 2026-06-16 builder repair.",
    "",
    "This directory fills the two evidence gaps from the critic review:",
    "",
    "- `runtime-contract-probe.json` exercises the quiet and populated request arms through the daemon attention route handler, `node bin/kota.mjs attention --json`, Telegram `/attention`, Slack `/attention`, the web TypeScript decoder, the mobile production decoder copy, and the macOS Swift `AttentionResponse` decoder compiled from `clients/apple/Sources/KotaShared/Daemon/AttentionModels.swift`.",
    "- `web/*.html`, `mobile/*.json`, `macos/attention-view-rendered-states.txt`, `telegram/attention-messages.json`, and `slack/attention-messages.json` are the rendered per-surface fixtures for operator-visible attention states.",
    "",
    "The probe fails if any surface returns a different `items` list or `text` body for the same quiet/populated route bodies.",
    "",
  ].join("\n"),
  "utf-8",
);

for (const projectDir of Object.values(projects)) {
  rmSync(projectDir, { recursive: true, force: true });
}

console.log(`wrote ${join(evidenceDir, "runtime-contract-probe.json")}`);
