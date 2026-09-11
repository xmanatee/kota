/** Explicit live CLI smoke across configured presets; invoked by test:preset-parity.
 * Provider readiness and responses are environment-dependent and belong outside
 * deterministic checks. Preserve per-preset transcripts for operator inspection.
 */
import {
  type ChildProcess,
  spawn,
} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import {
  listShippedPresets,
  type Preset,
} from "#core/model/preset.js";
import {
  collectPresetHarnessReadiness,
  isPresetHarnessReadinessReady,
  type PresetHarnessReadiness,
} from "#core/model/preset-readiness.js";
import { antigravityCliAgentHarness } from "#modules/antigravity-cli-agent-harness/adapter.js";
import { claudeAgentHarness } from "#modules/claude-agent-harness/adapter.js";
import { codexAgentHarness } from "#modules/codex-agent-harness/adapter.js";
import { geminiAgentHarness } from "#modules/gemini-agent-harness/adapter.js";
import { geminiCliAgentHarness } from "#modules/gemini-cli-agent-harness/adapter.js";
import { openaiToolsAgentHarness } from "#modules/openai-tools-agent-harness/adapter.js";

for (const harness of [
  antigravityCliAgentHarness,
  claudeAgentHarness,
  codexAgentHarness,
  geminiCliAgentHarness,
  geminiAgentHarness,
  openaiToolsAgentHarness,
]) {
  registerAgentHarness(harness);
}

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const CLI_PATH = join(REPO_ROOT, "dist", "cli.js");

/** Single run-id for this test invocation. Every preset's evidence lands under it. */
const RUN_ID = `${new Date().toISOString().replace(/[:.]/g, "-")}-preset-parity`;

const RUN_ROOT = join(REPO_ROOT, ".kota", "runs", RUN_ID, "preset-parity");

type PreflightArtifact = {
  presetId: string;
  authEnv: readonly string[];
  missing: readonly string[];
  readiness: PresetHarnessReadiness;
  decision: "scenario-runnable" | "preflight-failure";
  message: string;
  capturedAt: string;
};

type ScenarioResult = {
  presetId: string;
  command: readonly string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdoutTailLines: readonly string[];
  stderrTailLines: readonly string[];
  bannerModelId: string | null;
  responseText: string;
  durationMs: number;
};

function presetRunDir(presetId: string): string {
  return join(RUN_ROOT, presetId);
}

function ensureRunDir(presetId: string): string {
  const dir = presetRunDir(presetId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Format a per-preset preflight failure as a single-line actionable message.
 * The wording mirrors the CLI's own preflight message so an operator who
 * sees this in a test transcript reaches for the same fix as a CLI user.
 */
function formatPreflightMessage(preset: Preset, missing: readonly string[]): string {
  const list = missing.join(" or ");
  return `preset "${preset.id}" requires ${list} — set the env var or run \`kota doctor --preset ${preset.id}\` to diagnose.`;
}

function recordPreflight(preset: Preset): PreflightArtifact {
  const readiness = collectPresetHarnessReadiness(preset);
  const missing = readiness.auth.missing;
  const dir = ensureRunDir(preset.id);
  const decision: PreflightArtifact["decision"] =
    isPresetHarnessReadinessReady(readiness)
      ? "scenario-runnable"
      : "preflight-failure";
  let message: string;
  if (decision === "scenario-runnable") {
    message =
      preset.authEnv.length === 0
        ? `preset "${preset.id}" auth ok (harness-managed auth)`
        : `preset "${preset.id}" auth ok (one of ${preset.authEnv.join(", ")} is set)`;
  } else if (missing.length > 0) {
    message = formatPreflightMessage(preset, missing);
  } else if (!readiness.auth.ready) {
    message =
      `preset "${preset.id}" auth not ready (${readiness.auth.summary}) — ` +
      `run \`kota doctor --preset ${preset.id}\` to diagnose.`;
  } else if (readiness.adapter.localRuntime.status !== "ready") {
    message =
      `preset "${preset.id}" local runtime not ready (${readiness.adapter.localRuntime.summary}) — ` +
      `run \`kota doctor --preset ${preset.id}\` to diagnose.`;
  } else if (
    readiness.adapter.modelEffort !== undefined &&
    readiness.adapter.modelEffort.status !== "ready"
  ) {
    message =
      `preset "${preset.id}" model/effort not ready ` +
      `(${readiness.adapter.modelEffort.summary}) — ` +
      `run \`kota doctor --preset ${preset.id}\` to diagnose.`;
  } else {
    message = `preset "${preset.id}" has an unclassified readiness failure.`;
  }
  const artifact: PreflightArtifact = {
    presetId: preset.id,
    authEnv: preset.authEnv,
    missing,
    readiness,
    decision,
    message,
    capturedAt: new Date().toISOString(),
  };
  writeFileSync(
    join(dir, "preflight.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  return artifact;
}

function tail(text: string, maxLines: number): string[] {
  const lines = text.split("\n");
  return lines.slice(-maxLines);
}

/**
 * Parse the kota stderr banner of the form `kota [<preset-id>] <model>` and
 * extract the resolved model id. Returns null when the banner is absent —
 * the assertion path then fails with a "no banner emitted" message rather
 * than a silent zero-recording.
 */
// ANSI escape sequences begin with U+001B (ESC) by definition; matching the
// byte literally via `String.fromCharCode` keeps the regex source free of
// control characters so the linter and the byte stay in sync.
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function parseBannerModelId(stderr: string): string | null {
  // Strip ANSI styling before matching so the regex stays simple.
  const stripped = stderr.replace(ANSI_ESCAPE, "");
  const match = stripped.match(/kota \[[^\]]+\]\s+(\S+)/);
  if (!match) return null;
  const modelId = match[1].trim();
  return modelId.length > 0 ? modelId : null;
}

async function spawnSingleTurn(
  preset: Preset,
  prompt: string,
  timeoutMs: number,
): Promise<ScenarioResult> {
  const args = [CLI_PATH, "run", prompt, "--no-history"];
  const env = {
    ...process.env,
    KOTA_PRESET: preset.id,
    NODE_OPTIONS: "",
  };
  const startedAt = Date.now();
  return await new Promise<ScenarioResult>((resolveResult, rejectResult) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, args, {
        cwd: REPO_ROOT,
        env,
      });
    } catch (err) {
      rejectResult(err);
      return;
    }
    child.stdout?.on("data", (d) => stdoutChunks.push(Buffer.from(d)));
    child.stderr?.on("data", (d) => stderrChunks.push(Buffer.from(d)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 5_000);
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString();
      const stderr = Buffer.concat(stderrChunks).toString();
      const bannerModelId = parseBannerModelId(stderr);
      resolveResult({
        presetId: preset.id,
        command: [process.execPath, ...args],
        exitCode: code,
        signal,
        timedOut,
        stdoutTailLines: tail(stdout, 200),
        stderrTailLines: tail(stderr, 200),
        bannerModelId,
        responseText: stdout.trim(),
        durationMs: Date.now() - startedAt,
      });
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      rejectResult(err);
    });
  });
}

function recordScenario(result: ScenarioResult): void {
  const dir = ensureRunDir(result.presetId);
  writeFileSync(
    join(dir, "transcript.txt"),
    [
      `# preset-parity scenario transcript: ${result.presetId}`,
      `# command: ${result.command.join(" ")}`,
      `# exit-code: ${result.exitCode}`,
      `# signal: ${result.signal ?? "<none>"}`,
      `# timed-out: ${result.timedOut}`,
      `# duration-ms: ${result.durationMs}`,
      `# banner-model-id: ${result.bannerModelId ?? "<absent>"}`,
      "",
      "## stdout (tail)",
      ...result.stdoutTailLines,
      "",
      "## stderr (tail)",
      ...result.stderrTailLines,
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "result.json"),
    `${JSON.stringify(
      {
        presetId: result.presetId,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        bannerModelId: result.bannerModelId,
        responseText: result.responseText,
      },
      null,
      2,
    )}\n`,
  );
}

beforeAll(() => {
  if (!existsSync(CLI_PATH)) {
    throw new Error(
      `dist/cli.js missing at ${CLI_PATH}. Run \`pnpm build\` before \`pnpm test:preset-parity\`. ` +
        `This gate exercises the shipped CLI on purpose: the failure modes it pins down ` +
        `(KOTA_PRESET routing, banner model id, preset auth) only surface through the full ` +
        `bootstrap, not through unit-level stubs.`,
    );
  }
  mkdirSync(RUN_ROOT, { recursive: true });
  writeFileSync(
    join(RUN_ROOT, "README.txt"),
    [
      "preset-parity gate run artifacts.",
      `run-id: ${RUN_ID}`,
      `started: ${new Date().toISOString()}`,
      "",
      "Per-preset directories:",
      "  preflight.json — auth/runtime/model readiness snapshot and decision.",
      "  transcript.txt — stdout/stderr tail of the spawned CLI.",
      "  result.json    — exit code, banner model id, response text.",
      "",
    ].join("\n"),
  );
});

describe("preset-parity gate — single-turn scenario (boot + first response)", () => {
  for (const preset of listShippedPresets()) {
    const artifact = recordPreflight(preset);
    const skipReason =
      artifact.decision === "preflight-failure"
        ? `${artifact.message}; preflight failure recorded`
        : null;
    const runner = skipReason ? it.skip : it;
    const scenarioTimeoutMs = preset.authEnv.length > 0 ? 120_000 : 30_000;
    runner(
      `preset=${preset.id}: \`KOTA_PRESET=${preset.id} kota run "Reply with OK"\` emits a banner naming the preset's defaultModel${
        skipReason ? ` — SKIPPED (${skipReason})` : ""
      }`,
      async () => {
        const result = await spawnSingleTurn(
          preset,
          "Reply with the single word OK and nothing else.",
          scenarioTimeoutMs,
        );
        recordScenario(result);
        // The strongest invariant the task highlights: the model id sent to
        // the adapter (proxied here through the banner) must equal the
        // active preset's defaultModel — never a foreign-preset literal.
        expect(
          result.bannerModelId,
          `expected banner to declare a model id; banner missing in stderr.\n` +
            `transcript: ${join(presetRunDir(preset.id), "transcript.txt")}`,
        ).toBeTruthy();
        expect(
          result.bannerModelId,
          `preset=${preset.id} banner reported model id "${result.bannerModelId}" ` +
            `but the preset's defaultModel is "${preset.defaultModel}". ` +
            `transcript: ${join(presetRunDir(preset.id), "transcript.txt")}`,
        ).toBe(preset.defaultModel);
        // Every runnable scenario must produce successful exit and non-empty model response,
        // asserting real terminal behavior rather than stopping at the banner.
        expect(
          result.exitCode,
          `kota run exited with non-zero code ${result.exitCode} for preset ${preset.id}; ` +
            `transcript: ${join(presetRunDir(preset.id), "transcript.txt")}`,
        ).toBe(0);
        expect(result.responseText.length).toBeGreaterThan(0);
      },
      scenarioTimeoutMs + 60_000,
    );
  }
});

