import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  buildLocalWorkflowHandler,
  makeWorkflowOpsScopeRoot,
} from "./local-client-test-helpers.js";

describe("workflow-ops localClient — local definitions", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeWorkflowOpsScopeRoot();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("listDefinitions resolves through ctx.resolveAgentDef-friendly definitions source", async () => {
    const definition = {
      name: "demo-watch",
      enabled: true,
      definitionPath: "ignored",
      moduleRoot: workspaceRoot,
      repository: "read",
      defaultAutonomyMode: "autonomous",
      triggers: [{ watch: ["**/*.md"], debounceMs: 750, cooldownMs: 0 }],
      steps: [{ id: "review", type: "agent", agentName: "demo-agent" }],
    } as unknown as RegisteredWorkflowDefinitionInput;
    writeFileSync(join(workspaceRoot, "agent.md"), "Review the project.\n", "utf-8");
    const resolveAgentDef = vi.fn((name: string) =>
      name === "demo-agent"
        ? {
            name: "demo-agent",
            role: "Review the project.",
            promptPath: "agent.md",
            model: "test-model",
            effort: "low" as const,
            writeScope: [],
          }
        : undefined
    );
    const handler = buildLocalWorkflowHandler(workspaceRoot, {
      resolveAgentDef,
      resolveSkillsPrompt: vi.fn(),
      config: { defaultAgentHarness: "thin" } as ModuleContext["config"],
      getContributedWorkflows: () => [definition],
    } as unknown as Partial<ModuleContext>);
    const result = await handler.listDefinitions();
    expect(result.source).toBe("static");
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]).toMatchObject({
      name: "demo-watch",
      enabled: true,
      stepCount: 1,
    });
    expect(resolveAgentDef).toHaveBeenCalledWith("demo-agent");
    expect(result.definitions[0]?.triggers).toEqual([
      { type: "watch", patterns: ["**/*.md"], debounceMs: 750 },
    ]);
  });

  it("triggerByName requires daemon-owned durable admission", async () => {
    const handler = buildLocalWorkflowHandler(workspaceRoot);
    const result = await handler.triggerByName("builder", {
      event: "runtime.idle",
      schemaRef: { name: "runtime-idle", version: 1 },
      runId: "2026-04-25T21-00-00-000Z-builder-bbb222",
      payload: { replayOf: "2026-04-25T20-00-00-000Z-builder-aaa111" },
      tags: ["smoke"],
      notBeforeMs: 100,
    });
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
    expect(existsSync(join(workspaceRoot, ".kota", "kota.sqlite"))).toBe(false);
  });

  it("explain resolves compiled automation locally from contributed workflows", async () => {
    const definition = {
      name: "client-channel-match",
      enabled: true,
      definitionPath: "ignored",
      moduleRoot: workspaceRoot,
      repository: "none",
      triggers: [
        {
          event: "inbound.signal.received",
          filter: { channel: "telegram" },
          cooldownMs: 0,
        },
      ],
      steps: [{ id: "matched", type: "emit", event: "opportunity.matched" }],
    } as unknown as RegisteredWorkflowDefinitionInput;
    const handler = buildLocalWorkflowHandler(workspaceRoot, {
      config: { defaultAgentHarness: "thin" } as ModuleContext["config"],
      resolveAgentDef: vi.fn(),
      getContributedWorkflows: () => [definition],
      getModuleSummaries: () => [],
    } as unknown as Partial<ModuleContext>);

    const result = await handler.explain({
      sampleEvent: {
        event: "inbound.signal.received",
        payload: {
          scopeId: "scope-a",
          channel: "telegram",
        },
      },
    });

    expect(result.outcome).toBe("queued");
    expect(result.matches[0]).toMatchObject({
      workflow: "client-channel-match",
      triggerEvent: "inbound.signal.received",
    });
    expect(result.matches[0].downstream).toEqual([
      {
        fromWorkflow: "client-channel-match",
        kind: "event",
        target: "opportunity.matched",
        consumers: [],
        stepId: "matched",
      },
    ]);
  });

  it("simulate resolves event previews locally from contributed workflows", async () => {
    const definition = {
      name: "client-simulation-match",
      enabled: true,
      definitionPath: "ignored",
      moduleRoot: workspaceRoot,
      repository: "none",
      triggers: [{ event: "simulation.event", cooldownMs: 0 }],
      steps: [{ id: "preview", type: "code", run: () => ({ ok: true }) }],
    } as unknown as RegisteredWorkflowDefinitionInput;
    const handler = buildLocalWorkflowHandler(workspaceRoot, {
      config: { defaultAgentHarness: "thin" } as ModuleContext["config"],
      resolveAgentDef: vi.fn(),
      getContributedWorkflows: () => [definition],
      getModuleSummaries: () => [],
      listTools: () => [],
    } as unknown as Partial<ModuleContext>);

    const result = await handler.simulate({
      event: "simulation.event",
      payload: { scopeId: "scope-a" },
    });

    expect(result.summary).toMatchObject({ total: 1, "would-queue": 1 });
    expect(result.inputs[0]).toMatchObject({
      event: "simulation.event",
      outcome: "would-queue",
      matches: [{ workflow: "client-simulation-match" }],
    });
  });

});
