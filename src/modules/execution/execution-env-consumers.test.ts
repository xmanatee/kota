import { afterEach, expect, it, vi } from "vitest";
import type { ToolRunner } from "#core/tools/index.js";
import { cleanupSessions, runCodeExec } from "./code-exec.js";
import { buildExecutionEnv } from "./execution-env.js";
import { clearProcesses, runProcess } from "./process.js";
import { runShell } from "./shell.js";

const shellProbe = "printf '%s|%s|%s|%s' \"${KOTA_SESSION_ID-missing}\" \"${KOTA_TOOL_USE_ID-missing}\" \"${OTEL_EXPORTER_OTLP_ENDPOINT-missing}\" \"${OTLP_ENDPOINT-missing}\"";
const keys = ["KOTA_SESSION_ID", "KOTA_TOOL_USE_ID", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTLP_ENDPOINT"];

afterEach(() => {
  cleanupSessions();
  clearProcesses();
  vi.unstubAllEnvs();
});

it("does not inherit parent correlation or telemetry routing without context", () => {
  for (const key of keys) vi.stubEnv(key, "parent-value");
  const env = buildExecutionEnv();
  for (const key of keys) expect(env[key], key).toBeUndefined();
});

// Each adapter has its own process launch path. Observe the environment inside
// the real child; policy permutations stay at buildExecutionEnv's boundary.
it.each([
  { name: "shell", run: runShell, input: { command: shellProbe, stream_output: false } },
  { name: "process", run: runProcess, input: { action: "start", command: shellProbe } },
  { name: "Python REPL", run: runCodeExec, input: {
    language: "python", reset: true,
    code: `import os; print('|'.join(os.environ.get(key, 'missing') for key in ${JSON.stringify(keys)}))`,
  } },
  { name: "Node REPL", run: runCodeExec, input: {
    language: "node", reset: true,
    code: `console.log(${JSON.stringify(keys)}.map(key => process.env[key] ?? 'missing').join('|'))`,
  } },
] satisfies Array<{ name: string; run: ToolRunner; input: Parameters<ToolRunner>[0] }>)("$name propagates context and filters inherited environment at launch", async ({ run, input }) => {
  for (const key of keys) vi.stubEnv(key, "parent-value");
  const result = await run(input, { sessionId: "child-session", toolUseId: "child-call" });
  expect(result.is_error).toBeFalsy();
  expect(result.content).toContain("child-session|child-call|missing|missing");
});
