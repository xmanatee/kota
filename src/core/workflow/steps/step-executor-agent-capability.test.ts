import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentHarnessReadiness,
  AgentHarnessRunOptions,
} from "#core/agent-harness/index.js";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
  resetHarnessHooks,
} from "#core/agent-harness/index.js";
import {
  type ResolvedScopePolicy,
  resolveScopePolicy,
  type ScopePolicyAuthority,
} from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { executeWorkflowRun } from "../run-executor.js";
import { WorkflowRunStore } from "../run-store.js";
import { createTestRunContext } from "../testing/run-context-fixture.js";
import {
  AGENT_OK_RESULT,
  makeAgentStep,
  makeDefinition,
  makeHarness,
  makeProjectDir,
  RESTRICTED_AGENT,
  readCapabilityArtifact,
  removeProjectDir,
  TRIGGER,
} from "./step-executor-agent-capability-fixtures.integration.js";

describe("workflow agent-step harness capability artifacts", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;

  beforeEach(() => {
    clearAgentHarnessRegistryForTest();
    resetHarnessHooks();
    projectDir = makeProjectDir();
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    resetHarnessHooks();
    removeProjectDir(projectDir);
  });

  it("writes a bounded capability artifact before a KOTA-controlled harness runs", async () => {
    const readiness: AgentHarnessReadiness = {
      adapterKind: "agent-sdk",
      localRuntime: {
        kind: "node-package",
        status: "ready",
        required: true,
        packageName: "fake-agent-sdk",
        version: "1.2.3",
        summary: "fake-agent-sdk@1.2.3",
      },
      optionalRuntimes: [],
      unsupportedOptions: [],
    };
    const run = vi.fn(async (options: AgentHarnessRunOptions) => {
      expect(options.allowedTools).toEqual(["Read", "ask_owner"]);
      expect(options.disallowedTools).toEqual(["Write"]);
      expect(options.canUseTool).toBeTypeOf("function");
      if (!options.canUseTool) throw new Error("missing canUseTool");
      const teardownDecision = await options.canUseTool(
        "Bash",
        { command: "terraform destroy" },
        { signal: new AbortController().signal, toolUseId: "tool-1" },
      );
      expect(teardownDecision).toMatchObject({
        behavior: "deny",
        decisionAttribution: "operator-deny",
      });
      expect(teardownDecision).not.toHaveProperty("interrupt");
      expect(options.askOwner).toEqual({
        source: expect.stringContaining("workflow:capability-artifact-test/"),
      });
      await options.onMessage?.({ type: "text", text: "progress" });
      return AGENT_OK_RESULT;
    });
    const harnessName = "capability-kota";
    registerAgentHarness(
      makeHarness(harnessName, run, {
        askOwnerToolName: "ask_owner",
        emitsAgentMessageStream: true,
        supportedHookKinds: ["preRun"],
        readiness: () => readiness,
      }),
    );

    const step = makeAgentStep(projectDir, harnessName, {
      allowedTools: ["Read"],
      disallowedTools: ["Write"],
    });
    const { promise } = executeWorkflowRun(
      makeDefinition(projectDir, step),
      TRIGGER,
      { runContext: createTestRunContext(projectDir, TRIGGER), bus, store, log: () => {} },
    );
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.steps[0]).toMatchObject({
      id: "agent",
      status: "success",
      harness: harnessName,
      model: "test-model",
    });
    expect(run).toHaveBeenCalledTimes(1);

    const artifact = readCapabilityArtifact(
      projectDir,
      result.metadata.runDir,
      "agent",
    );
    expect(artifact).toMatchObject({
      harnessName,
      toolControl: "kota",
      supportsMultiTurn: true,
      supportsOwnerQuestions: true,
      askOwnerToolName: "ask_owner",
      emitsAgentMessageStream: true,
      supportedHookKinds: ["preRun"],
      unsupportedRunOptions: [],
      localReadiness: {
        adapterKind: "agent-sdk",
        localRuntime: {
          kind: "node-package",
          status: "ready",
          required: true,
          summary: "fake-agent-sdk@1.2.3",
        },
        optionalRuntimes: [],
        unsupportedOptions: [],
      },
    });
    expect(
      (artifact.localReadiness as { localRuntime: Record<string, unknown> })
        .localRuntime,
    ).not.toHaveProperty("version");
  });

  it("caps workflow autonomy and forwards the live resolved scope policy", async () => {
    const authorityConfigPath = "/operator/machine/config.json";
    const scopeId = deriveDirectoryScopeId(projectDir);
    const scopePolicy = resolveScopePolicy({
      projection: {
        rootScopeId: "global",
        defaultScopeId: scopeId,
        scopes: [
          { scopeId: "global", displayName: "Global" },
          { scopeId, displayName: "Fixture", parentScopeId: "global", directoryRoot: projectDir },
        ],
      },
      scopeId,
      fragments: [{
        scopeId,
        reason: "Workflow fixture stays supervised and read-only.",
        autonomy: { defaultMode: "supervised", maxMode: "supervised" },
        writes: { mode: "none" },
      }],
    });
    const run = vi.fn(async (options: AgentHarnessRunOptions) => {
      expect(options.autonomyMode).toBe("supervised");
      expect(options.scopePolicy).toBe(scopePolicy);
      expect(options.scopePolicy?.writes.mode).toBe("none");
      expect(options.authorityConfigPath).toBe(authorityConfigPath);
      return AGENT_OK_RESULT;
    });
    const harnessName = "scope-policy-kota";
    registerAgentHarness(makeHarness(harnessName, run));

    const { promise } = executeWorkflowRun(
      makeDefinition(projectDir, makeAgentStep(projectDir, harnessName)),
      TRIGGER,
      {
        runContext: createTestRunContext(projectDir, TRIGGER),
        bus,
        store,
        log: () => {},
        authorityConfigPath,
        scopePolicyAuthority: authorityFor(scopePolicy),
      },
    );

    await expect(promise).resolves.toMatchObject({ metadata: { status: "success" } });
    expect(run).toHaveBeenCalledOnce();
  });

  it("passes restricted agent write scope into the runtime prompt", async () => {
    execFileSync("git", ["init", "--quiet"], { cwd: projectDir });
    let receivedPrompt = "";
    let receivedWriteScope: AgentHarnessRunOptions["agentWriteScope"];
    let receivedOutputDir: AgentHarnessRunOptions["agentOutputDir"];
    const harnessName = "capability-write-scope-prompt";
    registerAgentHarness(
      makeHarness(harnessName, async (options: AgentHarnessRunOptions) => {
        receivedPrompt = options.prompt;
        receivedWriteScope = options.agentWriteScope;
        receivedOutputDir = options.agentOutputDir;
        if (options.agentOutputDir === undefined) {
          throw new Error("missing isolated agent output directory");
        }
        writeFileSync(
          `${options.agentOutputDir}/commit-message.txt`,
          "test: isolated agent output\n",
          "utf-8",
        );
        return AGENT_OK_RESULT;
      }),
    );

    const step = makeAgentStep(projectDir, harnessName, {
      agentName: RESTRICTED_AGENT.name,
    });
    const runContext = createTestRunContext(projectDir, TRIGGER);
    const { promise } = executeWorkflowRun(
      makeDefinition(projectDir, step),
      TRIGGER,
      {
        runContext,
        bus,
        store,
        log: () => {},
        resolveAgentDef: (name) =>
          name === RESTRICTED_AGENT.name ? RESTRICTED_AGENT : undefined,
      },
    );
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(receivedWriteScope).toEqual(RESTRICTED_AGENT.writeScope);
    expect(receivedOutputDir).toBe(runContext.resources.agentDir);
    expect(receivedPrompt).toContain("Agent write scope: .kota/runs/");
    expect(receivedPrompt).toContain(`Run directory: ${receivedOutputDir}`);
    expect(receivedPrompt).toContain("out-of-scope writes fail this step");
  });
});

function authorityFor(policy: ResolvedScopePolicy): ScopePolicyAuthority {
  return {
    getSnapshot: () => ({ revision: 0, policy }),
    subscribeRestrictiveChanges: () => () => {},
  };
}
