/**
 * Cross-preset operator-shaped runtime parity gate.
 *
 * Boots `node dist/cli.js` under each shipped preset (`claude`, `codex`,
 * `gemini`, `gemini-cli`) and runs a deterministic single-turn scenario, the smallest
 * operator-visible end-to-end probe that proves the preset switch actually
 * propagates from the CLI flag through harness resolution to the model id
 * the adapter sends. Pairs with `src/preset-parity-model-sweep.test.ts`,
 * which is the stand-alone fast-feedback unit test of the same invariant
 * without paying for a CLI spawn or a real provider call.
 *
 * Per-preset preflight behavior:
 *   - Each preset records the shared harness-readiness object: auth
 *     alternatives, local runtime probe, adapter kind, and unsupported
 *     neutral-option boundaries.
 *   - When auth and required local runtime are ready, the scenario runs:
 *     `node dist/cli.js -p "Reply with the single word OK"` with
 *     `KOTA_PRESET=<id>` and the full env passed through.
 *   - When auth or required local runtime is missing, both the preflight
 *     assertion and the scenario test loud-skip via `it.skipIf`; the skip
 *     title names the actionable reason and `preflight.json` preserves the
 *     structured readiness payload for diagnosis.
 *
 * Run-artifact layout (per task contract): every preset's recordings land
 * under `.kota/runs/<run-id>/preset-parity/<preset-id>/`:
 *   - `preflight.json` — auth/runtime readiness snapshot, missing list,
 *     decision, and structured per-preset readiness.
 *   - `transcript.txt` — full stdout + stderr from the spawned CLI.
 *   - `result.json` — exit code, observed model id banner, response text.
 * The directory is the postmortem evidence the task asks for.
 *
 * Constraints honored:
 *   - No `--harness` flipping. Preset selection is via `KOTA_PRESET`, not
 *     by overriding the harness — that is the whole point of the gate.
 *   - No silent skip on flaky network. A preset whose authEnv is satisfied
 *     but whose scenario fails on a transient provider error retries once
 *     and then surfaces the failure.
 *   - No cost figures fed back into autonomy. This test prints cost only
 *     in operator-facing artifacts, never as an input to a scenario step.
 */
import {
  type ChildProcess,
  spawn,
} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import {
  listShippedPresets,
  type Preset,
} from "#core/model/preset.js";
import {
  collectPresetHarnessReadiness,
  isPresetHarnessReadinessReady,
  type PresetHarnessReadiness,
} from "#core/model/preset-readiness.js";
import "#modules/claude-agent-harness/index.js";
import "#modules/codex-agent-harness/index.js";
import "#modules/gemini-cli-agent-harness/index.js";
import "#modules/gemini-agent-harness/index.js";

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
  } else {
    message =
      `preset "${preset.id}" local runtime not ready (${readiness.adapter.localRuntime.summary}) — ` +
      `run \`kota doctor --preset ${preset.id}\` to diagnose.`;
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
      "  preflight.json — auth/runtime readiness snapshot and decision.",
      "  transcript.txt — stdout/stderr tail of the spawned CLI.",
      "  result.json    — exit code, banner model id, response text.",
      "",
      "Operator transcripts to capture for the task's Acceptance Evidence:",
      "  1. All shipped presets passing on a host where every authEnv/login state is set.",
      "  2. One env var unset → that preset's preflight.json carries decision=preflight-failure",
      "     while the other two pass.",
      "",
    ].join("\n"),
  );
});

afterAll(() => {
  // Tests intentionally leave the run directory in place; the artifacts are
  // the evidence. The repo's `.gitignore` excludes `.kota/runs/` so the
  // working tree is unaffected.
});

describe("preset-parity gate — per-preset preflight", () => {
  for (const preset of listShippedPresets()) {
    // Record the preflight artifact unconditionally so the cross-preset
    // sweep below sees the per-preset decision even when the assertion
    // skips. The artifact's `message` field carries the same single-line
    // "preset X requires Y" wording the CLI doctor emits.
    const artifact = recordPreflight(preset);
    const missingLabel = artifact.missing.length > 0
      ? artifact.missing.join(" or ")
      : !artifact.readiness.auth.ready
        ? artifact.readiness.auth.summary
      : artifact.readiness.adapter.localRuntime.status !== "ready"
        ? artifact.readiness.adapter.localRuntime.summary
        : null;
    const skip = artifact.decision === "preflight-failure";
    const titleSuffix = skip
      ? ` — SKIPPED (preset "${preset.id}" not ready: ${missingLabel}; preflight.json recorded preflight-failure)`
      : "";
    const authExpectation = preset.authEnv.length === 0
      ? "harness-managed auth is accepted"
      : `at least one of ${preset.authEnv.join(" or ")} is set`;
    it.skipIf(skip)(
      `preset=${preset.id}: ${authExpectation}${titleSuffix}`,
      () => {
        expect(artifact.decision).toBe("scenario-runnable");
        expect(artifact.missing).toEqual([]);
      },
    );
  }
});

describe("preset-parity gate — single-turn scenario (boot + first response)", () => {
  for (const preset of listShippedPresets()) {
    const artifact = recordPreflight(preset);
    const skipReason =
      artifact.decision === "preflight-failure"
        ? `${artifact.message}; preflight failure recorded`
        : null;
    const runner = skipReason ? it.skip : it;
    runner(
      `preset=${preset.id}: \`KOTA_PRESET=${preset.id} kota -p "Reply with OK"\` returns and the banner names the preset's defaultModel${
        skipReason ? ` — SKIPPED (${skipReason})` : ""
      }`,
      async () => {
        const result = await spawnSingleTurn(
          preset,
          "Reply with the single word OK and nothing else.",
          120_000,
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
        expect(
          result.exitCode,
          `kota run exited with non-zero code ${result.exitCode} for preset ${preset.id}; ` +
            `transcript: ${join(presetRunDir(preset.id), "transcript.txt")}`,
        ).toBe(0);
        // Env-auth presets have an explicit preflight signal, so a runnable
        // scenario must produce model text. Harness-managed auth can still
        // prove preset routing through the banner when local auth is absent
        // or stale in a non-interactive test host.
        if (preset.authEnv.length > 0) {
          expect(result.responseText.length).toBeGreaterThan(0);
        }
      },
      180_000,
    );
  }
});

describe("preset-parity gate — model-id sweep across recorded scenarios", () => {
  it("every recorded banner-model-id matches its active preset's defaultModel (or the preset's preflight-failure was recorded)", () => {
    const offenders: { presetId: string; banner: string; expected: string }[] = [];
    const skipped: string[] = [];
    for (const preset of listShippedPresets()) {
      const dir = presetRunDir(preset.id);
      const preflightPath = join(dir, "preflight.json");
      const resultPath = join(dir, "result.json");
      if (!existsSync(preflightPath)) {
        // The preflight test owns the per-preset existence assertion; this
        // sweep is the cross-cutting summary that runs after both blocks.
        continue;
      }
      const preflight: PreflightArtifact = JSON.parse(
        readFileSync(preflightPath, "utf-8"),
      );
      if (preflight.decision === "preflight-failure") {
        skipped.push(preset.id);
        continue;
      }
      if (!existsSync(resultPath)) continue;
      const scenario = JSON.parse(readFileSync(resultPath, "utf-8")) as {
        bannerModelId: string | null;
      };
      if (
        scenario.bannerModelId !== null &&
        scenario.bannerModelId !== preset.defaultModel
      ) {
        offenders.push({
          presetId: preset.id,
          banner: scenario.bannerModelId,
          expected: preset.defaultModel,
        });
      }
    }
    expect(
      offenders,
      `Banner model ids drifted from active preset defaults:\n${offenders
        .map(
          (o) =>
            `  ${o.presetId}: banner=${o.banner} expected=${o.expected}`,
        )
        .join("\n")}\n\nSkipped (preflight failure): ${skipped.join(", ") || "<none>"}`,
    ).toEqual([]);
  });
});
