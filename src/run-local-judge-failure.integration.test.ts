import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { registerAgentHarness, resolveAgentHarness, UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import { EventBus } from "#core/events/event-bus.js";
import { createTestWorkflowRuntime } from "#core/workflow/testing/runtime-fixture.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { invokeAgentJudge, invokeStructuredAgentJudge, resolveAgentJudgeRunContract } from "#modules/autonomy/agent-judge.js";

// Control only socket availability; production allocation and persistence remain.
vi.mock("#core/workflow/run-resources.js", async (original) => {
  const actual = await original<typeof import("#core/workflow/run-resources.js")>();
  return { ...actual, RunResourceAllocator: class extends actual.RunResourceAllocator {
    constructor(store: import("#core/workflow/run-state-database.js").RunStateDatabase, options: import("#core/workflow/run-resources.js").RunResourceAllocatorOptions) {
      super(store, { ...options, isPortAvailable: async () => true });
    }
  } };
});

// Detect a nested evidence rejection being promoted to fleet backoff: exercise
// real handoff retention, judge wrapping, dispatch, capacity and writer ownership.
it.each(["direct", "critic", "structured"] as const)("contains an oversized %s handoff while another agent runs", async (judge) => {
  const scopeRoot = mkdtempSync(join(tmpdir(), "kota-local-judge-"));
  const harnessName = `local-judge-${judge}`;
  const scopeId = "local-judge-scope";
  let releaseHealthy!: () => void;
  const healthyGate = new Promise<void>((resolve) => { releaseHealthy = resolve; });
  let healthySignal: AbortSignal | undefined;
  let healthyLaunches = 0;
  let reviewLaunches = 0;
  let failedInvocations = 0;
  let evidencePath = "";
  const unregister = registerAgentHarness({
    name: harnessName, description: "Controlled inference port", supportsMultiTurn: false,
    supportedHookKinds: [], askOwnerToolName: null, emitsAgentMessageStream: false, toolControl: "kota",
    run: async (options) => {
      if (options.prompt.startsWith("Continue independent work")) {
        healthyLaunches++;
        healthySignal = options.abortController?.signal;
        await healthyGate;
        healthySignal?.throwIfAborted();
      } else reviewLaunches++;
      return { text: "complete", streamedText: "complete", turns: 1, usage: UNKNOWN_AGENT_USAGE, isError: false };
    },
  });
  writeFileSync(join(scopeRoot, ".gitignore"), ".kota/\n");
  for (const args of [["init", "--quiet"], ["add", ".gitignore"], ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "baseline"]]) {
    execFileSync("git", args, { cwd: scopeRoot });
  }
  const config = { label: "Required review", systemPrompt: "Assess the evidence.", harness: harnessName, model: "test", effort: "low" as const };
  const base = { definitionPath: "local-judge.fixture.ts", moduleRoot: scopeRoot, triggers: [{ event: "manual" }] };
  const workflows: RegisteredWorkflowDefinitionInput[] = [{
    ...base, name: "failed-review", repository: "write", resources: () => ["task:retained"],
    integration: { validationCommand: ["true"] },
    steps: [{ id: "review", type: "code", resolveAgentContract: () => resolveAgentJudgeRunContract(config), run: async (ctx) => {
      failedInvocations++;
      writeFileSync(join(ctx.workspaceRoot, "candidate.txt"), "retained implementation\n");
      evidencePath = join(ctx.workflow.runDirPath, "assessment.json");
      writeFileSync(evidencePath, Buffer.alloc(40_091_312, "x"));
      const reviewConfig = { ...config, evidence: { currentRunReviewFiles: ["assessment.json"] } };
      if (judge === "direct") return ctx.runAgentHarness(resolveAgentHarness(harnessName), {
        prompt: "Review the evidence", cwd: ctx.workspaceRoot, effort: "low", autonomyMode: "autonomous", agentWriteScope: "deny-all",
      }, { signal: ctx.signal, evidence: reviewConfig.evidence });
      return judge === "critic"
        ? invokeAgentJudge("Review the evidence", ctx.workspaceRoot, reviewConfig, ctx.runAgentHarness, ctx.scopeRoot, ctx.signal)
        : invokeStructuredAgentJudge("Review the evidence", ctx.workspaceRoot, reviewConfig, ctx.runAgentHarness, JSON.parse, ctx.scopeRoot, ctx.signal);
    } }],
  }, {
    ...base, name: "healthy-agent", repository: "none",
    steps: [{ id: "work", type: "code", resolveAgentContract: () => resolveAgentJudgeRunContract(config), run: async (ctx) =>
      ctx.runAgentHarness(resolveAgentHarness(harnessName), {
        prompt: "Continue independent work", cwd: ctx.workspaceRoot, effort: "low", autonomyMode: "autonomous", agentWriteScope: "deny-all",
      }, { signal: ctx.signal }) }],
  }];
  const deadLetters = new DeadLetterQueueStore(join(scopeRoot, ".kota/dead-letters"));
  const fixture = createTestWorkflowRuntime({
    bus: new EventBus(), scopeRoot, scopeId, workflows, deadLetterQueue: deadLetters,
    config: { defaultAgentHarness: harnessName }, idleIntervalMs: 60_000,
  }, 2);
  try {
    fixture.runtime.start();
    expect((await fixture.runtime.enqueuePendingRun("healthy-agent")).ok).toBe(true);
    await expect.poll(() => healthyLaunches, { timeout: 5000 }).toBe(1);
    expect((await fixture.runtime.enqueuePendingRun("failed-review")).ok).toBe(true);
    await expect.poll(() => fixture.runState.listRuns(scopeId, ["needs_attention"]), { timeout: 15_000 }).toHaveLength(1);
    const retained = fixture.runState.listRuns(scopeId, ["needs_attention"])[0]!;
    expect(retained).toMatchObject({ resources: ["task:retained"], attempt: 1 });
    expect(retained.lastError).toMatch(/Required review evidence.*unavailable/);
    expect(reviewLaunches).toBe(0);
    expect(failedInvocations).toBe(1);
    expect(healthySignal?.aborted).toBe(false);
    expect(fixture.runtime.getState().agentBackoff).toBeUndefined();
    expect(statSync(evidencePath).size).toBe(40_091_312);
    expect(readFileSync(join(retained.sandbox!.workspaceDir, "candidate.txt"), "utf8")).toBe("retained implementation\n");
    expect(existsSync(join(scopeRoot, "candidate.txt"))).toBe(false);
    expect(deadLetters.list({ workflowName: "failed-review" })).toEqual([expect.objectContaining({
      failure: expect.objectContaining({ lastErrorClass: "execution" }),
    })]);
    expect(deadLetters.list()[0]?.failure.backoffUntil).toBeUndefined();
    releaseHealthy();
    await expect.poll(() => fixture.runState.listRuns(scopeId, ["succeeded"])).toHaveLength(1);
    // Admission remains usable after the local failure; no unchanged retry of
    // the retained writer is admitted when fresh independent work completes.
    expect((await fixture.runtime.enqueuePendingRun("healthy-agent")).ok).toBe(true);
    await expect.poll(() => healthyLaunches).toBe(2);
    await expect.poll(() => fixture.runState.listRuns(scopeId, ["succeeded"])).toHaveLength(2);
    expect(failedInvocations).toBe(1);
    expect(fixture.runState.getRun(retained.id)).toMatchObject({ state: "needs_attention", attempt: 1, resources: ["task:retained"] });
  } finally {
    releaseHealthy();
    await fixture.stop();
    unregister();
    rmSync(scopeRoot, { recursive: true, force: true });
  }
});
