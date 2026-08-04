import { describe, expect, it, vi } from "vitest";
import { agentHarnessToolExecutionOptions } from "./tool-execution-options.js";
import type { AgentHarnessRunOptions } from "./types.js";

describe("agentHarnessToolExecutionOptions", () => {
  it("preserves every shared authorization and execution resource", () => {
    const abortController = new AbortController();
    const clientApprovalResolver = vi.fn();
    const canUseTool = vi.fn();
    const guardrailsConfig = {
      policies: {
        safe: "allow",
        moderate: "confirm",
        dangerous: "queue",
      },
    } as const;
    const idempotencyStore = {} as NonNullable<
      AgentHarnessRunOptions["idempotencyStore"]
    >;
    const approvalQueue = {} as NonNullable<
      AgentHarnessRunOptions["approvalQueue"]
    >;
    const tokenBudget = {} as NonNullable<
      AgentHarnessRunOptions["tokenBudget"]
    >;
    const getScopePolicySnapshot = vi.fn();
    const options: AgentHarnessRunOptions = {
      prompt: "go",
      effort: "xhigh",
      verbose: true,
      autonomyMode: "supervised",
      cwd: "/project",
      authorityConfigPath: "/operator/machine/config.json",
      env: { KOTA_TEST_VALUE: "1" },
      allowedTools: ["allowed"],
      disallowedTools: ["denied"],
      canUseTool,
      guardrailsConfig,
      getScopePolicySnapshot,
      clientApprovalResolver,
      approvalQueue,
      idempotencyStore,
      tokenBudget,
      abortController,
      sessionContext: {
        sessionId: "session-a",
        scopeId: "scope-a",
        projectId: "scope-a",
      },
      workflowContext: {
        workflowName: "builder",
        runId: "run-a",
        stepId: "build",
        spanId: "span-a",
        scopeId: "scope-a",
        projectId: "scope-a",
      },
    };

    expect(
      agentHarnessToolExecutionOptions(options, { resultLimit: 12_345 }),
    ).toMatchObject({
      resultLimit: 12_345,
      verbose: true,
      autonomyMode: "supervised",
      guardrailsConfig,
      getScopePolicySnapshot,
      clientApprovalResolver,
      approvalQueue,
      sessionId: "session-a",
      cwd: "/project",
      authorityConfigPath: "/operator/machine/config.json",
      env: { KOTA_TEST_VALUE: "1" },
      scopeId: "scope-a",
      projectId: "scope-a",
      workflowContext: options.workflowContext,
      idempotencyStore,
      tokenBudget,
      signal: abortController.signal,
      canUseTool,
      allowedTools: ["allowed"],
      disallowedTools: ["denied"],
    });
  });

  it("defaults direct in-process harness calls to the canonical machine authority path", () => {
    const projected = agentHarnessToolExecutionOptions(
      { prompt: "go", effort: "xhigh" },
      { resultLimit: 100 },
    );

    expect(projected.authorityConfigPath).toMatch(/[/\\]\.kota[/\\]config\.json$/);
  });

});
