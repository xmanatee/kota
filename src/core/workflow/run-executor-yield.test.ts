import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { subscribeWorkflowFailureAlert } from "./failure-alert.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition } from "./types.js";

describe("workflow preserve-yield completion", () => {
  let projectDir: string;
  let bus: EventBus;
  let pbus: ProjectScopedEventBus;
  let store: WorkflowRunStore;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-run-executor-yield-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "prompt.md"), "Run.\n");
    bus = new EventBus();
    pbus = new ProjectScopedEventBus(bus, deriveDirectoryScopeId(projectDir));
    store = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("finishes as resumable without running later steps or alerting", async () => {
    const harness = `workflow-repair-preserve-yield-${Date.now()}`;
    registerAgentHarness({
      name: harness,
      description: "workflow preserve-yield test harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: true,
      toolControl: "kota",
      run: async () => ({
        text: "done",
        streamedText: "done",
        turns: 1,
        isError: false,
      }),
    });
    const laterStep = vi.fn();
    const completedEvents: unknown[] = [];
    const alerts: unknown[] = [];
    subscribeWorkflowFailureAlert(pbus, projectDir);
    bus.on("workflow.completed", (payload) => completedEvents.push(payload));
    bus.on("workflow.failure.alert", (payload) => alerts.push(payload));

    const definition: WorkflowDefinition = {
      name: "test",
      enabled: true,
      recoveryCapable: false,
      definitionPath: "src/modules/test/workflows/test/workflow.ts",
      moduleRoot: projectDir,
      triggers: [],
      tags: [],
      steps: [
        {
          id: "agent",
          type: "agent",
          harness,
          promptPath: "prompt.md",
          moduleRoot: projectDir,
          model: "test-model",
          effort: "low",
          autonomyMode: "autonomous",
          repairLoop: {
            checks: [{
              id: "post-check",
              type: "code",
              run: () => { throw new Error("work remains"); },
            }],
            continuation: {
              evaluate: (input) => ({
                decision: "preserve-yield",
                evidenceKey: "priority-boundary",
                summary: "Useful work is durable and higher-priority work is ready.",
                nextAction: "Resume this exact lineage after priority work.",
                packet: {
                  schemaVersion: 1,
                  boundaryKey: "priority-boundary",
                  boundaryReasons: ["higher-priority:task-p0:p0:Safety"],
                  attempt: input.attempt,
                  failureIds: input.failureIds,
                  warningIds: input.warningIds,
                  progressKey: input.progressKey,
                  trajectory: {
                    classification: "fresh",
                    attempts: input.attempt,
                    failureIdsByAttempt: [input.failureIds],
                  },
                  context: [],
                },
              }),
            },
          },
        },
        { id: "must-not-run", type: "code", run: laterStep },
      ],
    };
    const { promise } = executeWorkflowRun(
      definition,
      { event: "runtime.idle", schemaRef: null, payload: {} },
      { projectDir, bus, pbus, store, log: vi.fn() },
    );
    const result = await promise;

    expect(result.metadata.status).toBe("yielded");
    expect(result.metadata.steps).toHaveLength(1);
    expect(result.metadata.steps[0]).toMatchObject({
      status: "yielded",
      output: {
        continuationDecisions: [expect.objectContaining({ decision: "preserve-yield" })],
      },
    });
    expect(laterStep).not.toHaveBeenCalled();
    expect(completedEvents).toContainEqual(expect.objectContaining({ status: "yielded" }));
    expect(alerts).toEqual([]);
    expect(existsSync(join(projectDir, result.metadata.runDir, "error.txt"))).toBe(false);
  });
});
