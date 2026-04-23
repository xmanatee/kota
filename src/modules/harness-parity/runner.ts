/**
 * Execute a coding-task scenario against a single `AgentHarness` and capture
 * paired artifacts for operator review. Reuses the existing `runAgentHarness`
 * entry point the CLI already calls — there is no second benchmarking path.
 *
 * Artifacts land under `<outBaseDir>/<harnessName>/` so every harness result
 * for a scenario is side-by-side in one directory.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentEffort,
  AgentHarness,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import { runAgentHarness } from "#core/agent-harness/index.js";
import type { LoadedScenario, ScenarioVerification } from "./scenario.js";

const DEFAULT_EFFORT: AgentEffort = "xhigh";

const TRACE_TAIL_LIMIT = 32_000;
const DIFF_TAIL_LIMIT = 200_000;

export type HarnessParityCallOptions = {
  /** Model identifier the harness should use (e.g. "claude-sonnet-4-6"). */
  model: string;
  /** Optional system prompt to forward to the adapter. */
  systemPrompt?: string;
  /**
   * Upper turn bound for harnesses that iterate. Thin harness ignores this.
   * Applied verbatim to `AgentHarnessRunOptions.maxTurns`.
   */
  maxTurns?: number;
};

export type HarnessParityRunParams = {
  scenario: LoadedScenario;
  harness: AgentHarness;
  callOptions: HarnessParityCallOptions;
  /** Base artifact directory. The runner writes into `<outBaseDir>/<harness.name>/`. */
  outBaseDir: string;
  /** Keep the materialized working directory for post-mortem inspection. */
  keepWorkingDir?: boolean;
};

export type VerificationResult = {
  command: string;
  timeoutMs: number;
  passed: boolean;
  exitStatus: number | null;
  timedOut: boolean;
  output: string;
};

export type HarnessParityArtifact = {
  scenarioId: string;
  harnessName: string;
  model: string;
  /**
   * Reasoning posture the harness actually ran under. Paired artifacts
   * show this alongside `harness` and `model` so an operator comparing
   * adapters can see which reasoning surface (if any) was engaged.
   */
  effort: AgentEffort;
  startedAt: string;
  durationMs: number;
  turns: number;
  isError: boolean;
  inputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  subtype?: string;
  sessionId?: string;
  verification: VerificationResult;
  /** Files changed under the working directory relative to the initial tree. */
  changedFiles: readonly string[];
  /** Where artifacts for this harness × scenario run landed. */
  artifactDir: string;
};

type CollectingWriter = AgentHarnessWriter & { collected(): string };

function createCollectingWriter(): CollectingWriter {
  const chunks: string[] = [];
  return {
    write(text: string): boolean {
      chunks.push(text);
      return true;
    },
    collected(): string {
      return chunks.join("");
    },
  };
}

function materializeWorkingDir(scenario: LoadedScenario): string {
  const workingDir = mkdtempSync(
    join(tmpdir(), `kota-harness-parity-${scenario.spec.id}-`),
  );
  cpSync(scenario.initialStateDir, workingDir, { recursive: true });
  return workingDir;
}

function tail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `[... ${text.length - limit} chars truncated ...]\n${text.slice(-limit)}`;
}

function runVerification(
  workingDir: string,
  verification: ScenarioVerification,
): VerificationResult {
  const result = spawnSync(verification.command, {
    shell: true,
    cwd: workingDir,
    timeout: verification.timeoutMs,
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const timedOut =
    result.signal === "SIGTERM" || result.error?.message.includes("ETIMEDOUT") === true;
  const passed = !timedOut && result.status === 0;
  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return {
    command: verification.command,
    timeoutMs: verification.timeoutMs,
    passed,
    exitStatus: result.status ?? null,
    timedOut,
    output: tail(combined, TRACE_TAIL_LIMIT),
  };
}

/**
 * Compute a git-style diff of the working directory vs the scenario initial
 * tree. The two trees are placed under a shared parent so git diff renders
 * paths as `a/initial/...` vs `b/working/...`, keeping the output stable
 * regardless of where the real directories live.
 */
function computeDiff(initialDir: string, workingDir: string): {
  diff: string;
  changedFiles: string[];
} {
  const pairDir = mkdtempSync(join(tmpdir(), "kota-harness-parity-pair-"));
  const initialLink = join(pairDir, "initial");
  const workingLink = join(pairDir, "working");
  cpSync(initialDir, initialLink, { recursive: true });
  cpSync(workingDir, workingLink, { recursive: true });

  const diffResult = spawnSync(
    "git",
    [
      "diff",
      "--no-index",
      "--no-color",
      "--unified=3",
      "initial",
      "working",
    ],
    {
      cwd: pairDir,
      encoding: "utf-8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const diffCombined = [diffResult.stdout, diffResult.stderr]
    .filter(Boolean)
    .join("\n");

  const namesResult = spawnSync(
    "git",
    [
      "diff",
      "--no-index",
      "--name-only",
      "initial",
      "working",
    ],
    {
      cwd: pairDir,
      encoding: "utf-8",
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const changed = new Set<string>();
  for (const line of (namesResult.stdout ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const stripped = trimmed.startsWith("working/")
      ? trimmed.slice("working/".length)
      : trimmed.startsWith("initial/")
        ? trimmed.slice("initial/".length)
        : trimmed;
    if (stripped.length > 0) changed.add(stripped);
  }

  rmSync(pairDir, { recursive: true, force: true });

  return {
    diff: tail(diffCombined, DIFF_TAIL_LIMIT),
    changedFiles: [...changed].sort(),
  };
}

/**
 * Run one scenario through one harness. The caller is responsible for
 * resolving the harness from the registry; this function stays oblivious to
 * which adapters exist so it can be reused by both CLI and tests.
 */
export async function runScenarioOnHarness(
  params: HarnessParityRunParams,
): Promise<HarnessParityArtifact> {
  const { scenario, harness, callOptions } = params;
  const artifactDir = join(params.outBaseDir, harness.name);
  mkdirSync(artifactDir, { recursive: true });

  const workingDir = materializeWorkingDir(scenario);
  const writer = createCollectingWriter();
  const startedAt = new Date();
  const startMs = startedAt.getTime();

  let runError: Error | null = null;
  let runResult: Awaited<ReturnType<typeof runAgentHarness>> | null = null;
  const effort: AgentEffort = DEFAULT_EFFORT;
  try {
    runResult = await runAgentHarness(
      harness,
      {
        prompt: scenario.spec.prompt,
        model: callOptions.model,
        cwd: workingDir,
        effort,
        ...(callOptions.systemPrompt !== undefined
          ? { systemPrompt: callOptions.systemPrompt }
          : {}),
        ...(callOptions.maxTurns !== undefined
          ? { maxTurns: callOptions.maxTurns }
          : {}),
      },
      writer,
    );
  } catch (err) {
    runError = err instanceof Error ? err : new Error(String(err));
  }

  const durationMs = Date.now() - startMs;
  const { diff, changedFiles } = computeDiff(
    scenario.initialStateDir,
    workingDir,
  );
  const verification = runVerification(workingDir, scenario.spec.verification);

  writeFileSync(join(artifactDir, "prompt.txt"), scenario.spec.prompt);
  writeFileSync(join(artifactDir, "diff.patch"), diff);
  writeFileSync(
    join(artifactDir, "verification.json"),
    JSON.stringify(verification, null, 2),
  );
  writeFileSync(
    join(artifactDir, "trace.txt"),
    tail(writer.collected(), TRACE_TAIL_LIMIT),
  );

  const artifact: HarnessParityArtifact = {
    scenarioId: scenario.spec.id,
    harnessName: harness.name,
    model: callOptions.model,
    effort,
    startedAt: startedAt.toISOString(),
    durationMs,
    turns: runResult?.turns ?? 0,
    isError: runError !== null || runResult?.isError === true,
    verification,
    changedFiles,
    artifactDir,
    ...(runResult?.inputTokens !== undefined
      ? { inputTokens: runResult.inputTokens }
      : {}),
    ...(runResult?.outputTokens !== undefined
      ? { outputTokens: runResult.outputTokens }
      : {}),
    ...(runResult?.totalCostUsd !== undefined
      ? { totalCostUsd: runResult.totalCostUsd }
      : {}),
    ...(runResult?.subtype !== undefined ? { subtype: runResult.subtype } : {}),
    ...(runResult?.sessionId !== undefined ? { sessionId: runResult.sessionId } : {}),
  };

  writeFileSync(
    join(artifactDir, "run-meta.json"),
    JSON.stringify(
      {
        ...artifact,
        workingDir,
        error: runError
          ? { message: runError.message, stack: runError.stack }
          : null,
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(artifactDir, "trace-summary.md"),
    buildTraceSummary(artifact, runError, writer.collected()),
  );

  if (!params.keepWorkingDir) {
    rmSync(workingDir, { recursive: true, force: true });
  }

  return artifact;
}

function buildTraceSummary(
  artifact: HarnessParityArtifact,
  runError: Error | null,
  streamedText: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${artifact.harnessName} — ${artifact.scenarioId}`);
  lines.push("");
  lines.push(`- model: ${artifact.model}`);
  lines.push(`- effort: ${artifact.effort}`);
  lines.push(`- startedAt: ${artifact.startedAt}`);
  lines.push(`- durationMs: ${artifact.durationMs}`);
  lines.push(`- turns: ${artifact.turns}`);
  lines.push(`- isError: ${artifact.isError}`);
  if (artifact.subtype !== undefined) lines.push(`- subtype: ${artifact.subtype}`);
  if (artifact.inputTokens !== undefined) {
    lines.push(`- inputTokens: ${artifact.inputTokens}`);
  }
  if (artifact.outputTokens !== undefined) {
    lines.push(`- outputTokens: ${artifact.outputTokens}`);
  }
  if (artifact.totalCostUsd !== undefined) {
    lines.push(`- totalCostUsd: ${artifact.totalCostUsd}`);
  }
  lines.push(
    `- verification: ${artifact.verification.passed ? "pass" : "fail"} (exit ${artifact.verification.exitStatus ?? "null"}${artifact.verification.timedOut ? ", timeout" : ""})`,
  );
  lines.push(`- changedFiles (${artifact.changedFiles.length}):`);
  for (const path of artifact.changedFiles) lines.push(`  - ${path}`);
  if (runError) {
    lines.push("");
    lines.push("## Run error");
    lines.push("");
    lines.push("```");
    lines.push(runError.message);
    lines.push("```");
  }
  lines.push("");
  lines.push("## Streamed text (tail)");
  lines.push("");
  lines.push("```");
  lines.push(tail(streamedText, 8_000));
  lines.push("```");
  return `${lines.join("\n")}\n`;
}

/**
 * Run one scenario across every harness in `harnesses`, in order. Writes a
 * combined `parity.json` under `outBaseDir/<scenario.id>/` summarizing the
 * paired outcomes and returns every per-harness artifact.
 */
export async function runScenarioAcrossHarnesses(params: {
  scenario: LoadedScenario;
  harnesses: readonly AgentHarness[];
  callOptions: HarnessParityCallOptions;
  outBaseDir: string;
  keepWorkingDir?: boolean;
}): Promise<HarnessParityArtifact[]> {
  const scenarioBaseDir = join(params.outBaseDir, params.scenario.spec.id);
  mkdirSync(scenarioBaseDir, { recursive: true });

  const artifacts: HarnessParityArtifact[] = [];
  for (const harness of params.harnesses) {
    const artifact = await runScenarioOnHarness({
      scenario: params.scenario,
      harness,
      callOptions: params.callOptions,
      outBaseDir: scenarioBaseDir,
      ...(params.keepWorkingDir !== undefined
        ? { keepWorkingDir: params.keepWorkingDir }
        : {}),
    });
    artifacts.push(artifact);
  }

  writeFileSync(
    join(scenarioBaseDir, "parity.json"),
    JSON.stringify(
      {
        scenarioId: params.scenario.spec.id,
        model: params.callOptions.model,
        artifacts: artifacts.map((a) => ({
          harnessName: a.harnessName,
          effort: a.effort,
          durationMs: a.durationMs,
          turns: a.turns,
          verificationPassed: a.verification.passed,
          changedFiles: a.changedFiles,
          isError: a.isError,
          totalCostUsd: a.totalCostUsd,
          inputTokens: a.inputTokens,
          outputTokens: a.outputTokens,
          artifactDir: a.artifactDir,
        })),
      },
      null,
      2,
    ),
  );

  return artifacts;
}
