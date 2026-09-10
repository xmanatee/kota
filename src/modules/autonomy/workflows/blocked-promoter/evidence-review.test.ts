import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { registerAgentHarness, UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import { projectNativeCliScope } from "#core/agent-harness/native-cli-scope-policy.js";
import * as probeSandbox from "#core/agent-harness/task-probe-sandbox.js";
import { agentHarnessToolExecutionOptions } from "#core/agent-harness/tool-execution-options.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import { deregisterTool, registerTool } from "#core/tools/index.js";
import { validateToolCallInput } from "#core/tools/tool-input-validation.js";
import { enforceAgentWriteScope } from "#core/tools/tool-runner-agent-write-scope.js";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import { reviewBlockedTasks } from "./evidence-review.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  deregisterTool("reviewer_write");
  deregisterTool("reviewer_read");
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("recollects corrected probe source and newly trusted declarations before reusing a failed review", async () => {
  const root = mkdtempSync(join(tmpdir(), "blocked-probe-review-"));
  roots.push(root);
  mkdirSync(join(root, "data/tasks"), { recursive: true });
  const taskPath = join(root, "data/tasks/task-probe.md");
  const task = "---\nstatus: blocked\npriority: p1\n---\n# Probe\n\n## Runtime Probe\ncommand: pnpm run probe\ntimeoutMs: 5000\n\n## Blocked on\nkind: operator-capture\npath: .kota/runs\ndescription: Positive and negative results required\n";
  writeFileSync(taskPath, task);
  const state = createTestTransactionalRunState(root);
  const store = RunStateDatabase.openExisting(state.stateDir);
  store.admitRun({
    id: "review", scopeId: state.scopeId, workflow: "blocked-promoter", repository: "write",
    resources: ["task:task-probe"], trigger: { event: "manual", schemaRef: null, payload: {} },
    admittedAt: new Date().toISOString(),
  });
  // Control the external containment capability and command ports. The actual
  // provenance, cache, probe runner, reviewer handoff and task mutation execute.
  vi.spyOn(probeSandbox, "resolveTaskProbeSandbox").mockReturnValue({
    status: "available", kind: "linux-bubblewrap", processBoundary: "pid-namespace",
    command: "controlled-sandbox", prefixArgs: [], probeExecutable: "pnpm", evidence: "controlled OS port",
  });
  const runtime = resolveAgentRuntime(undefined);
  registerAgentHarness({
    name: runtime.harness, description: "controlled reviewer", supportsMultiTurn: false,
    supportedHookKinds: [], askOwnerToolName: "ask_owner", emitsAgentMessageStream: true,
    toolControl: "kota",
    run: async () => { throw new Error("Use scoped runner"); },
  });
  let trusted = false;
  let corrected = false;
  let probes = 0;
  let judges = 0;
  let observations = 0;
  const ctx: Parameters<typeof reviewBlockedTasks>[0] = {
    workspaceRoot: root, scopeRoot: root, state, agentRuntime: runtime,
    runEvidence: { getRun: (id) => store.getRun(id), listRuns: () => store.listRuns(state.scopeId) },
    workflow: { name: "blocked-promoter", runId: "review", runDir: ".kota/runs/review", runDirPath: join(root, ".kota/runs/review"), definitionPath: "workflow.ts" },
    runtimeResources: { profileId: "review", env: {}, agentRunDir: join(root, "agent") },
    runBlocking: runWorkflowBlockingOperation,
    runCommand: async (input) => {
      const response = await successfulWorkflowCommandRun(input);
      let text: string;
      if (input.command === "git" && input.args?.[0] === "show") text = trusted ? task : "# No declared probe";
      else if (input.command === "git" && input.args?.[0] === "ls-tree") {
        observations += 1;
        text = `100644 blob ${(corrected ? "b" : "a").repeat(40)}\tprobe.js\0` +
          `100644 blob ${String(observations).padStart(40, "0")}\tdata/tasks/task-other.md\0`;
      } else if (input.command === "controlled-sandbox") {
        probes += 1;
        text = corrected ? "positive allowed; negative denied" : "negative unexpectedly allowed";
      } else throw new Error(`Unexpected command ${input.command}`);
      return { ...response, stdout: { text, totalBytes: text.length, truncated: false } };
    },
    runAgentHarness: async () => {
      judges += 1;
      const pinned = JSON.parse(readFileSync(join(root, "agent/task-probe.evidence.json"), "utf8"));
      expect(pinned.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
      expect(pinned.probe.execution).toBe("os-contained-command");
      expect(pinned.provenance.status).toBe("trusted");
      expect(pinned.probe.output).toBe(corrected ? "positive allowed; negative denied" : "negative unexpectedly allowed");
      const text = JSON.stringify({ verdict: corrected ? "pass" : "fail",
        critical_issues: corrected ? [] : ["Negative boundary failed"], warnings: [], summary: "Inspected contained probe outcomes",
      });
      return { text, streamedText: text, isError: false, turns: 1, usage: UNKNOWN_AGENT_USAGE };
    },
  };
  try {
    expect((await reviewBlockedTasks(ctx)).reviews[0]?.promoted).toBe(false);
    expect((await reviewBlockedTasks(ctx)).reviews).toEqual([]);
    expect(probes).toBe(0);
    trusted = true;
    const first = (await reviewBlockedTasks(ctx)).reviews[0];
    expect(first?.promoted).toBe(false);
    expect((await reviewBlockedTasks(ctx)).reviews).toEqual([]);
    expect(probes).toBe(1);
    expect(judges).toBe(1);
    corrected = true;
    const repaired = (await reviewBlockedTasks(ctx)).reviews[0];
    expect(repaired?.fingerprint).not.toBe(first?.fingerprint);
    expect(repaired?.promoted).toBe(true);
    expect(probes).toBe(2);
    expect(judges).toBe(2);
    expect(readFileSync(taskPath, "utf8")).toContain("status: open");
  } finally { store.close(); }
});

it.each(["task-reference", "cited-export", "narrow-hint"] as const)("restrains unchanged rejected evidence and reopens on changed proof: %s", async (linkage) => {
  const root = mkdtempSync(join(tmpdir(), "blocked-review-"));
  roots.push(root);
  const taskPath = join(root, "data/tasks/task-evidence.md");
  mkdirSync(join(root, "data/tasks"), { recursive: true });
  const artifactDir = join(root, ".kota/runs/capture");
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "result.json");
  const taskLink = linkage === "task-reference" ? { taskId: "task-evidence" } : {};
  const hint = linkage === "narrow-hint" ? ".kota/runs/capture" : ".kota/runs";
  writeFileSync(taskPath, `---\nstatus: blocked\npriority: p1\n---\n# Evidence\n\n## Blocked on\nkind: operator-capture\npath: ${hint}\ndescription: Attributable positive and negative results\n${linkage === "cited-export" ? "\nExisting evidence: .kota/runs/capture\n" : ""}`);
  writeFileSync(artifactPath, JSON.stringify({ ...taskLink, outcome: "success", provenance: "missing", capturedAt: "2026-09-10T01:00:00Z" }));
  const state = createTestTransactionalRunState(root);
  const store = RunStateDatabase.openExisting(state.stateDir);
  store.admitRun({
    id: "review", scopeId: state.scopeId, workflow: "blocked-promoter", repository: "write",
    resources: ["task:task-evidence"], trigger: { event: "manual", schemaRef: null, payload: {} },
    admittedAt: new Date().toISOString(),
  });
  const runtime = resolveAgentRuntime(undefined);
  for (const kind of ["read", "write"] as const) {
    registerTool({
      name: `reviewer_${kind}`, description: "Controlled filesystem tool port",
      input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    }, async () => ({ content: "controlled" }), undefined, {
      effect: { kind, scope: "local-fs", idempotent: true, openWorld: false },
    });
  }
  registerAgentHarness({
    name: runtime.harness, description: "controlled reviewer port", supportsMultiTurn: false,
    supportedHookKinds: [], askOwnerToolName: "ask_owner", emitsAgentMessageStream: true,
    toolControl: linkage === "narrow-hint" ? "native" : "kota",
    run: async () => { throw new Error("Use the scoped runner port"); },
  });
  let verdict: "pass" | "fail" = "fail";
  let calls = 0;
  const ctx: Parameters<typeof reviewBlockedTasks>[0] = {
    workspaceRoot: root, scopeRoot: root, state, agentRuntime: runtime,
    runEvidence: { getRun: (id) => store.getRun(id), listRuns: () => store.listRuns(state.scopeId) },
    workflow: { name: "blocked-promoter", runId: "review", runDir: ".kota/runs/review", runDirPath: join(root, ".kota/runs/review"), definitionPath: "workflow.ts" },
    runtimeResources: { profileId: "review", env: {}, agentRunDir: join(root, "agent") },
    runCommand: successfulWorkflowCommandRun,
    runBlocking: runWorkflowBlockingOperation,
    runAgentHarness: async (_harness, options) => {
      // Exercise the actual shared write boundary with the reviewer's resolved
      // options, including the native projection that has no canUseTool callback.
      const write = validateToolCallInput("reviewer_write", { path: join(root, "unrelated.ts") });
      const read = validateToolCallInput("reviewer_read", { path: artifactPath });
      if (!write.ok || !read.ok) throw new Error("Invalid controlled tool input");
      const toolOptions = agentHarnessToolExecutionOptions(options, { resultLimit: 1000 });
      expect(enforceAgentWriteScope({
        type: "tool_use", id: "attempted-reviewer-write", name: "reviewer_write",
        input: write.input,
      }, toolOptions)).toMatchObject({ is_error: true, content: expect.stringContaining("writes are denied") });
      expect(enforceAgentWriteScope({
        type: "tool_use", id: "reviewer-evidence-read", name: "reviewer_read",
        input: read.input,
      }, toolOptions)).toBeNull();
      expect(projectNativeCliScope({
        cwd: root, autonomyMode: options.autonomyMode, scopePolicy: undefined,
        agentWriteScope: options.agentWriteScope,
      })).toEqual({ executionMode: "plan", writableRoots: [] });
      calls += 1;
      const text = JSON.stringify({ verdict, critical_issues: verdict === "fail" ? ["Missing provenance"] : [], warnings: [], summary: "Reviewed source and outcome" });
      return {
        text, streamedText: text,
        isError: false, turns: 1, usage: UNKNOWN_AGENT_USAGE,
      };
    },
  };
  try {
    expect((await reviewBlockedTasks(ctx)).reviews[0]?.promoted).toBe(false);
    expect(readFileSync(taskPath, "utf8")).toContain("status: blocked");
    expect((await reviewBlockedTasks(ctx)).reviews).toEqual([]);
    expect(calls).toBe(1);
    const unrelated = join(root, ".kota/runs/daily-digest");
    mkdirSync(unrelated, { recursive: true });
    writeFileSync(join(unrelated, "metadata.json"), JSON.stringify({ workflow: "daily-digest", status: "success" }));
    writeFileSync(artifactPath, JSON.stringify({ capturedAt: "2026-09-10T02:00:00Z", provenance: "missing", outcome: "success", ...taskLink }));
    expect((await reviewBlockedTasks(ctx)).reviews).toEqual([]);
    expect(calls).toBe(1);
    writeFileSync(artifactPath, JSON.stringify({ ...taskLink, outcome: "success", provenance: "scoped-execution", positive: "pass", negative: "rejected" }));
    verdict = "pass";
    expect((await reviewBlockedTasks(ctx)).reviews[0]?.promoted).toBe(true);
    expect(readFileSync(taskPath, "utf8")).toContain("status: open");
    expect(calls).toBe(2);
  } finally { store.close(); }
});
