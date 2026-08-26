import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/registry.js";
import type {
  AgentHarness,
  AgentHarnessResult,
} from "#core/agent-harness/types.js";
import { EventBus } from "#core/events/event-bus.js";
import { EventJournal, installEventJournal } from "#core/events/event-journal.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  CONTROL_MONITOR_COVERAGE_ARTIFACT,
  type ControlMonitorCoverageArtifact,
} from "./control-monitor-coverage.js";
import type { RunContext } from "./run-context.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import { createTestTransactionalRunState } from "./testing/run-context-fixture.js";
import type { WorkflowDefinition } from "./types.js";

function makeRunContext(
  workspaceRoot: string,
  trigger: RunContext["trigger"],
  runId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  workspaceDir = workspaceRoot,
): RunContext {
  return {
    run: { id: runId, attempt: 1, daemonEpoch: 1 },
    scope: { id: "test-scope", root: workspaceRoot },
    workflow: "test",
    trigger,
    sandbox: {
      runId,
      repository: "none",
      rootDir: workspaceRoot,
      workspaceDir,
      tempDir: workspaceRoot,
      artifactDir: workspaceRoot,
    },
    resources: {
      runId,
      attempt: 1,
      daemonEpoch: 1,
      workspaceDir,
      runDir: workspaceRoot,
      tempDir: workspaceRoot,
      artifactDir: workspaceRoot,
      agentDir: workspaceRoot,
      packageCacheDir: workspaceRoot,
      ports: { start: 41_000, end: 41_000, size: 1, values: [41_000] },
      env: {},
    },
    signal: new AbortController().signal,
    processes: { register: vi.fn() },
    effects: { execute: (effect) => effect.execute() },
    publications: { stageEmit: vi.fn() },
    state: createTestTransactionalRunState(),
  };
}



const AGENT_OK_RESULT: AgentHarnessResult = {
  text: "done",
  streamedText: "done",
  turns: 1,
  isError: false,
};

describe("control monitor coverage event journal", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-control-coverage-journal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("uses the normal run event journal for guardrail and injection evidence", async () => {
    const bus = new EventBus();
    const eventJournal = new EventJournal(join(workspaceRoot, ".kota", "events"));
    const uninstallJournal = installEventJournal(bus, eventJournal);
    const sessionId = "session-coverage";
    const harness: AgentHarness = {
      name: "coverage-journal-harness",
      description: "coverage journal harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: true,
      toolControl: "kota",
      run: async (options) => {
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "tool-1",
          toolName: "web_fetch",
          input: { url: "https://example.test" },
          sessionId,
        });
        bus.emit("guardrail.assessed", {
          tool: "web_fetch",
          risk: "read",
          policy: "allow",
          reason: "fixture",
          session: sessionId,
        });
        bus.emit("injection.defense.assessed", {
          tool: "web_fetch",
          suspicious: false,
          reasons: [],
          action: "skip",
          autonomyMode: "autonomous",
          session: sessionId,
        });
        bus.emit("approval.requested", {
          scopeId: "coverage-journal-scope",
          id: "approval-1",
          tool: "shell",
          risk: "write",
          reason: "fixture approval",
          source: sessionId,
          sessionId,
        });
        bus.emit("approval.resolved", {
          scopeId: "coverage-journal-scope",
          id: "approval-1",
          tool: "shell",
          approved: true,
          reason: "approved in fixture",
          source: sessionId,
          sessionId,
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: "tool-1",
          isError: false,
          content: "external page text",
          sessionId,
        });
        return AGENT_OK_RESULT;
      },
    };
    registerAgentHarness(harness);
    writeFileSync(join(workspaceRoot, "prompt.md"), "Run.\n", "utf-8");
    const definition: WorkflowDefinition = {
      name: "coverage-journal",
      enabled: true,
      repository: "none",
      definitionPath: "src/modules/test/workflows/coverage-journal/workflow.ts",
      moduleRoot: workspaceRoot,
      triggers: [],
      tags: [],
      steps: [
        {
          id: "build",
          type: "agent",
          harness: harness.name,
          promptPath: "prompt.md",
          moduleRoot: workspaceRoot,
          model: "test-model",
          effort: "low",
          autonomyMode: "autonomous",
        },
      ],
    };
    const trigger: RunContext["trigger"] = {
      event: "runtime.idle",
      schemaRef: null,
      payload: {},
    };

    try {
      const { promise } = executeWorkflowRun(
        definition,
        trigger,
        {
          runContext: makeRunContext(workspaceRoot, trigger, "journal-run"),
          bus,
          eventJournal,
          store: new WorkflowRunStore(workspaceRoot),
          log: vi.fn(),
        },
      );
      const result = await promise;
      const artifact =
        readOptionalJsonFile<ControlMonitorCoverageArtifact>(
          join(workspaceRoot, result.metadata.runDir, CONTROL_MONITOR_COVERAGE_ARTIFACT),
        );

      expect(artifact).toMatchObject({
        monitoredSurfaceCounts: {
          toolCalls: 1,
          externalPayloadIngests: 1,
          approvalRequests: 1,
        },
        summary: { gapCount: 0 },
      });
      expect(artifact?.families).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            family: "approval-owner-gates",
            status: "covered",
            numerator: 1,
            denominator: 1,
          }),
        ]),
      );
      const refs =
        artifact?.families.flatMap((family) => family.evidenceRefs) ?? [];
      expect(refs.some((ref) => ref.includes(".kota/events/journal.jsonl"))).toBe(true);
    } finally {
      uninstallJournal();
    }
  });

  it("threads dynamic external MCP provenance through agent-step telemetry", async () => {
    const bus = new EventBus();
    const eventJournal = new EventJournal(join(workspaceRoot, ".kota", "events"));
    const uninstallJournal = installEventJournal(bus, eventJournal);
    const sessionId = "session-mcp-coverage";
    const provenance = {
      kind: "external-mcp" as const,
      serverName: "remote",
      source: "tool" as const,
      name: "lookup",
    };
    const harness: AgentHarness = {
      name: "coverage-mcp-harness",
      description: "coverage MCP harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: true,
      toolControl: "kota",
      run: async (options) => {
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "tool-remote",
          toolName: "mcp__remote__lookup",
          input: { query: "fixture" },
          sessionId,
        });
        bus.emit("guardrail.assessed", {
          tool: "mcp__remote__lookup",
          risk: "read",
          policy: "allow",
          reason: "fixture",
          session: sessionId,
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: "tool-remote",
          isError: false,
          content: "remote MCP body",
          resultContentProvenance: provenance,
          sessionId,
        });
        return AGENT_OK_RESULT;
      },
    };
    registerAgentHarness(harness);
    writeFileSync(join(workspaceRoot, "prompt.md"), "Run.\n", "utf-8");
    const definition: WorkflowDefinition = {
      name: "coverage-mcp",
      enabled: true,
      repository: "none",
      definitionPath: "src/modules/test/workflows/coverage-mcp/workflow.ts",
      moduleRoot: workspaceRoot,
      triggers: [],
      tags: [],
      steps: [
        {
          id: "build",
          type: "agent",
          harness: harness.name,
          promptPath: "prompt.md",
          moduleRoot: workspaceRoot,
          model: "test-model",
          effort: "low",
          autonomyMode: "autonomous",
        },
      ],
    };
    const trigger: RunContext["trigger"] = {
      event: "runtime.idle",
      schemaRef: null,
      payload: {},
    };

    try {
      const { promise } = executeWorkflowRun(
        definition,
        trigger,
        {
          runContext: makeRunContext(workspaceRoot, trigger, "mcp-run"),
          bus,
          eventJournal,
          store: new WorkflowRunStore(workspaceRoot),
          log: vi.fn(),
        },
      );
      const result = await promise;
      const telemetry = readOptionalJsonFile<{
        calls?: Array<{
          tool?: string;
          resultContentProvenance?: typeof provenance;
        }>;
      }>(
        join(workspaceRoot, result.metadata.runDir, "steps", "build.tool-telemetry.json"),
      );
      const artifact =
        readOptionalJsonFile<ControlMonitorCoverageArtifact>(
          join(workspaceRoot, result.metadata.runDir, CONTROL_MONITOR_COVERAGE_ARTIFACT),
        );

      expect(telemetry?.calls?.[0]).toMatchObject({
        tool: "mcp__remote__lookup",
        resultContentProvenance: provenance,
      });
      expect(artifact?.monitoredSurfaceCounts.externalPayloadIngests).toBe(1);
      expect(artifact?.gaps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            family: "injection-defense",
            reason: "external-payload-unscreened",
            severity: "error",
          }),
        ]),
      );
    } finally {
      uninstallJournal();
    }
  });
});
