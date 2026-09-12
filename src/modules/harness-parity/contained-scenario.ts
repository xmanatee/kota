import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHarness } from "#core/agent-harness/index.js";
import { executeIsolatedVerifier } from "#modules/eval-harness/executable-verifier-sandbox.js";
import { resolveExecutableVerifierSandbox } from "#modules/eval-harness/executable-verifier-types.js";
import type { ExecutionProfilePreflightResult } from "#modules/eval-harness/public-surface.js";
import { executeContainedCommand } from "#modules/eval-harness/subprocess-executor.js";
import { cleanupScenarioRuntimeEnv } from "#modules/eval-harness/subprocess-executor-env.js";
import type { SubprocessExecutorOptions } from "#modules/eval-harness/subprocess-executor-types.js";
import { decodeContainedStageOutput } from "./contained-stage-protocol.js";
import { tail } from "./runner-files.js";
import type { ScenarioExecution } from "./runner-types.js";

export function containedScenarioExecution(options: SubprocessExecutorOptions, harness: AgentHarness,
  executionProfile: ExecutionProfilePreflightResult, budgetMs: number): ScenarioExecution {
  const backend = options.isolationBackend;
  if (backend?.kind !== "container") throw new Error("Contained scenarios require a container");
  const sandbox = resolveExecutableVerifierSandbox(backend);
  const isolated = async (workingDir: string, command: string, timeoutMs: number,
    scoring?: { trustedVerifierRoot: string; trustedFiles?: readonly string[] }) => {
    options.signal?.throwIfAborted();
    const outcome = await executeIsolatedVerifier({ workingDir, command, timeoutMs, maxBuffer: 8 * 1024 * 1024,
      context: { sandbox, executionProfile, workspace: scoring ? { kind: "scoring", ...scoring } : { kind: "candidate" } } });
    options.signal?.throwIfAborted();
    if (!outcome.started) throw new Error(outcome.issue);
    if (outcome.result.error) throw outcome.result.error;
    return outcome.result;
  };
  return {
    profile: executionProfile,
    async run(request, writer) {
      if (!request.cwd) throw new Error("Contained stage requires its materialized workspace");
      const result = await executeContainedCommand({ ...options, scopeMode: "runtime-home" }, {
        workflowName: "harness-parity-stage", workingDir: request.cwd, budgetMs, executionProfile,
      }, [backend.kotaBinaryPath, "harness-parity", "contained-stage", JSON.stringify({
        harness: harness.name, model: request.model, prompt: request.prompt, effort: request.effort,
        harnessOverrides: request.harnessOverrides, modelOutputTokenLimits: request.modelOutputTokenLimits, maxTurns: request.maxTurns,
      })]).finally(() => cleanupScenarioRuntimeEnv(request.cwd!));
      const decoded = decodeContainedStageOutput(result.stdout.text);
      if (decoded.result.isError) options.onExecutionFailure?.(new Error(decoded.result.text));
      options.signal?.throwIfAborted();
      for (const message of decoded.messages) request.onMessage?.(message);
      writer.write(decoded.result.streamedText);
      return decoded.result;
    },
    async verify(workingDir, verification, initialDir) {
      if (verification.trustedFiles === undefined) throw new Error("Contained scenario must declare verification.trustedFiles (empty for inline-only verifiers)");
      const result = await isolated(workingDir, verification.command, verification.timeoutMs,
        { trustedVerifierRoot: initialDir, trustedFiles: verification.trustedFiles });
      const timedOut = result.signal !== null;
      return { ...verification, passed: result.status === 0 && !timedOut, exitStatus: result.status, timedOut,
        output: tail([result.stdout, result.stderr].join("\n"), 32 * 1024) };
    },
    async diff(initialDir, workingDir) {
      const pair = mkdtempSync(join(tmpdir(), "kota-contained-diff-"));
      try {
        cpSync(initialDir, join(pair, "initial"), { recursive: true });
        cpSync(workingDir, join(pair, "working"), { recursive: true });
        const prefix = "git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c diff.external= diff --no-ext-diff --no-textconv --no-index";
        const diff = await isolated(pair, `${prefix} --no-color --unified=3 initial working`, 30_000);
        const names = await isolated(pair, `${prefix} --name-only initial working`, 30_000);
        if (![0, 1].includes(diff.status ?? -1) || ![0, 1].includes(names.status ?? -1)) throw new Error("Contained diff collection failed");
        return { diff: diff.stdout, changedFiles: names.stdout.split("\n").filter(Boolean).map((path) => path.replace(/^(initial|working)\//, "")).sort() };
      } finally { rmSync(pair, { recursive: true, force: true }); }
    },
  };
}
