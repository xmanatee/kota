import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  resolveTaskProbeSandbox,
  type TaskProbeSandbox,
} from "#core/agent-harness/task-probe-sandbox.js";
import { buildRequiredInheritedSubprocessEnv } from "#core/modules/subprocess-env.js";
import { runProcessGroupCommandSync } from "#modules/execution/process-group-command.js";
import type { TaskProbe, TaskProbeResult } from "./task-probe.js";

const MAX_PROBE_OUTPUT_CHARS = 20_000;

export function runTaskProbe(
  probe: TaskProbe,
  projectDir: string,
): TaskProbeResult {
  return runTaskProbeInSandbox(
    probe,
    projectDir,
    resolveTaskProbeSandbox(projectDir, probe.timeoutMs),
  );
}

function runTaskProbeInSandbox(
  probe: TaskProbe,
  projectDir: string,
  sandbox: TaskProbeSandbox,
): TaskProbeResult {
  if (sandbox.status === "unavailable") {
    return {
      verdict: "fail",
      exitCode: -1,
      durationMs: 0,
      output: `Runtime Probe not executed: ${sandbox.reason}`,
      probe,
      execution: "not-executed",
      isolation: sandbox,
    };
  }
  const runtimeHome = mkdtempSync(join(projectDir, ".kota-runtime-probe-"));
  const start = Date.now();
  try {
    const result = runProcessGroupCommandSync({
      command: sandbox.command,
      args: [...sandbox.prefixArgs, sandbox.probeExecutable, ...probe.args],
      cwd: projectDir,
      env: buildTaskProbeEnv(runtimeHome),
      timeoutMs: probe.timeoutMs,
      outputLimit: MAX_PROBE_OUTPUT_CHARS,
    });
    const durationMs = Date.now() - start;
    const combined = [
      result.stdout,
      result.stderr,
    ]
      .filter((part) => part.length > 0)
      .join("\n");
    const output = truncateTail(combined, MAX_PROBE_OUTPUT_CHARS);
    const exitCode = result.exitCode ?? -1;
    return {
      verdict: exitCode === 0 ? "pass" : "fail",
      exitCode,
      durationMs,
      output,
      probe,
      execution: "os-contained-command",
      isolation: {
        status: "enforced",
        kind: sandbox.kind,
        processBoundary: sandbox.processBoundary,
        evidence: sandbox.evidence,
      },
    };
  } finally {
    rmSync(runtimeHome, { recursive: true, force: true });
  }
}

function buildTaskProbeEnv(runtimeHome: string): NodeJS.ProcessEnv {
  return {
    ...buildRequiredInheritedSubprocessEnv(),
    HOME: runtimeHome,
    TMPDIR: runtimeHome,
    NO_COLOR: "1",
    KOTA_RUNTIME_PROBE: "1",
  };
}

function truncateTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `[... ${text.length - limit} chars truncated — showing tail ...]\n${text.slice(-limit)}`;
}
