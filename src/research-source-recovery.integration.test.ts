import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { networkReadEffect } from "#core/tools/effect.js";
import { registerTool } from "#core/tools/tool-registry.js";
import { createRunContext } from "#core/workflow/run-context.js";
import { makeRunContext } from "#core/workflow/run-executor-test-fixture.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunToolRunner } from "#core/workflow/run-types.js";
import { createStepContext } from "#core/workflow/steps/step-context.js";
import { unexpectedWorkflowAgentHarnessRun } from "#core/workflow/testing/agent-harness-runner.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import { collectResearchHttpReadings, collectResearchSourceEvidence } from "#modules/autonomy/workflows/research-retry/source-evidence.js";
import browserModule from "#modules/browser/index.js";
import { webFetchTool } from "#modules/web-access/web-fetch.js";

// Exercise the production collector, step context and SQLite effect journal.
// Only external tool execution is controlled, including an ambiguous response.
it.each([false, true])("preserves the HTTP checkpoint and browser identities across recovery (fallback=%s)", async (fallback) => {
  const root = mkdtempSync(join(tmpdir(), "research-recovery-"));
  const state = new RunStateDatabase(join(root, ".kota/state"));
  const cleanups: Array<() => void> = [];
  const now = () => new Date().toISOString();
  const seed = makeRunContext(root);
  const { id: runId } = seed.run;
  state.registerScope({ id: seed.scope.id, rootPath: root, createdAt: now() });
  const { epoch } = state.beginDaemonSession(now());
  state.admitRun({ id: runId, scopeId: seed.scope.id, workflow: "research-source-collection", repository: "none", trigger: seed.trigger, resources: [], admittedAt: now() });
  state.startRun(runId, epoch, now());
  const context = createRunContext({
    runId, attempt: 1, daemonEpoch: epoch, scopeId: seed.scope.id, scopeRoot: root,
    workflow: "research-source-collection", trigger: seed.trigger,
    sandbox: seed.sandbox, resources: seed.resources, signal: seed.signal, store: state, now,
  });
  const bus = new EventBus();
  const calls: string[] = [];
  let recovered = false;
  const runTool: WorkflowRunToolRunner = async (tool, input) => {
    calls.push(`${tool}:${input.url}`);
    if (tool === "web_fetch") return { content: recovered !== fallback ? "Requires JavaScript" : "Original HTTP content" };
    if (input.url === "https://openai.com/index/b") throw new Error("Connection lost after browser action");
    return { content: recovered ? "Changed browser content" : "Original browser content" };
  };
  const stepContext = () => createStepContext({
    id: runId, workflow: "research-source-collection", definitionPath: "collection", trigger: seed.trigger,
    startedAt: now(), status: "running", runDir: `.kota/runs/${runId}`, steps: [],
  }, seed.trigger, undefined, {}, {}, [], {
    workspaceRoot: seed.sandbox.workspaceDir, scopeRoot: root, bus,
    pbus: new ScopedEventBus(bus, seed.scope.id), store: new WorkflowRunStore(root),
    runContext: context, runTool, readRuntimeState: readEmptyTestWorkflowRuntimeState,
    runAgentHarness: unexpectedWorkflowAgentHarnessRun,
  });
  try {
    cleanups.push(registerTool(webFetchTool, async () => ({ content: "unused port" }), "web-access", { effect: networkReadEffect() }));
    if (!Array.isArray(browserModule.tools)) throw new Error("Browser declarations unavailable");
    for (const def of browserModule.tools) cleanups.push(registerTool(def.tool, def.runner, "browser", { effect: def.effect }));
    const urls = ["https://example.com/a", "https://openai.com/index/completed", "https://openai.com/index/b"];
    const capability = { availableTools: ["web_fetch", "rendered_article_read"] as Array<"web_fetch" | "rendered_article_read">,
      playwrightAvailable: true, authProfileConfigured: false, authProfileExists: false, authProfileRevision: null };
    // This is the ordinary persisted collect-http-sources output, available before
    // any browser effect. Replay supplies it unchanged, even if HTTP has changed.
    const httpReadings = await collectResearchHttpReadings({ urls, runTool: stepContext().runTool });
    const input = { urls, capability, httpReadings };
    await expect(collectResearchSourceEvidence({ ...input, runTool: stepContext().runTool })).rejects.toThrow(/automatic replay is unsafe/);
    const originalCalls = [...calls];
    recovered = true;
    await expect(collectResearchSourceEvidence({ ...input, runTool: stepContext().runTool })).rejects.toThrow(/automatic replay is unsafe/);
    expect(calls).toEqual(originalCalls);
    // Completed browser content survives too; only the ambiguous source blocks.
    const completed = await collectResearchSourceEvidence({ ...input, urls: urls.slice(0, 2).reverse(), runTool: stepContext().runTool });
    expect(completed.sources[0].readings[0].content).toBe("Original browser content");
    expect(completed.sources[1].readings[0].content).toBe(httpReadings[0].content);
    expect(calls).toEqual(originalCalls);
  } finally {
    for (const cleanup of cleanups) cleanup();
    state.close();
    rmSync(root, { recursive: true, force: true });
  }
});
