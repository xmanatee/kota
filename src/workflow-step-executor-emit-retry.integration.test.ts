// biome-ignore-all lint/correctness/noUnusedImports: split integration suites share one runtime fixture
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { EventBus } from "#core/events/event-bus.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import { RepairAgentRuntimeError } from "#core/workflow/repair-loop.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepContext,
} from "#core/workflow/run-types.js";
import type { WorkflowNotifyConfig } from "#core/workflow/step-input-base.js";
import type { WorkflowAgentStep, WorkflowEmitStep, WorkflowToolStep } from "#core/workflow/step-types.js";
import type { AgentStepConfig } from "#core/workflow/steps/step-executor.js";
import {
  buildAgentPrompt,
  buildRepairPrompt,
  executeAgentStep,
  executeEmitStep,
  executeStep,
  executeToolStep,
  withRetry,
} from "#core/workflow/steps/step-executor.js";
import { classifyAgentRuntimeFailure } from "#core/workflow/steps/step-executor-retry.js";
import { createWorkflowAgentHarnessRunner } from "#core/workflow/steps/workflow-agent-harness-runner.js";
import {
  KOTA_OWNER_QUESTIONS_MCP_SERVER,
  KOTA_OWNER_QUESTIONS_MCP_TOOL,
} from "#modules/claude-agent-harness/kota-tools-mcp.js";
import {
  makeDefinition,
  makeMetadata,
  makeStep,
  mockedExecuteWithAgentSDK,
  SUCCESS_RESULT,
  TRIGGER,
} from "./workflow-step-executor-fixture.integration.js";

describe("executeEmitStep — notify config", () => {
  function makeEmitContext(): Parameters<typeof executeEmitStep>[1] {
    const staged: Array<{ stepId: string; event: string; payload: unknown }> = [];
    return {
      emit: vi.fn(
        (
          event: string,
          payload: Record<string, unknown>,
          options?: { delivery: "on-run-success"; stepId: string },
        ) => {
          if (options?.delivery === "on-run-success") {
            staged.push({ stepId: options.stepId, event, payload });
          }
        },
      ),
      _staged: staged,
    } as unknown as Parameters<typeof executeEmitStep>[1] & { _staged: typeof staged };
  }

  function makeEmitStep(event: string): WorkflowEmitStep {
    return { id: "emit-step", type: "emit", event };
  }

  it("stages the event under the declarative step identity", async () => {
    const ctx = makeEmitContext();
    const staged = (ctx as unknown as {
      _staged: Array<{ stepId: string; event: string; payload: unknown }>;
    })._staged;
    await executeEmitStep(makeEmitStep("example.completed"), ctx);
    expect(staged).toEqual([
      { stepId: "emit-step", event: "example.completed", payload: {} },
    ]);
    expect(ctx.emit).toHaveBeenCalledWith(
      "example.completed",
      {},
      { delivery: "on-run-success", stepId: "emit-step" },
    );
  });

  it("does not apply per-event notify conditionals to declarative publications", async () => {
    const ctx = makeEmitContext();
    const staged = (ctx as unknown as {
      _staged: Array<{ stepId: string; event: string; payload: unknown }>;
    })._staged;
    const notify: WorkflowNotifyConfig = { onSuccess: false };
    const result = await executeEmitStep(makeEmitStep("example.completed"), ctx, notify);
    expect(staged).toEqual([
      { stepId: "emit-step", event: "example.completed", payload: {} },
    ]);
    expect(result).toEqual({ event: "example.completed", payload: {} });
  });
});

describe("classifyAgentRuntimeFailure", () => {
  it("classifies 429 HTTP status as non-retryable rate_limit", () => {
    expect(classifyAgentRuntimeFailure({ message: "", status: 429 })).toEqual({
      kind: "rate_limit",
      retryable: false,
    });
  });

  it("classifies 401 and 403 HTTP status as non-retryable auth", () => {
    expect(classifyAgentRuntimeFailure({ message: "", status: 401 })).toEqual({
      kind: "auth",
      retryable: false,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 403 })).toEqual({
      kind: "auth",
      retryable: false,
    });
  });

  it("classifies 5xx and 408 HTTP statuses as retryable provider", () => {
    expect(classifyAgentRuntimeFailure({ message: "", status: 500 })).toEqual({
      kind: "provider",
      retryable: true,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 502 })).toEqual({
      kind: "provider",
      retryable: true,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 503 })).toEqual({
      kind: "provider",
      retryable: true,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 529 })).toEqual({
      kind: "provider",
      retryable: true,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 408 })).toEqual({
      kind: "provider",
      retryable: true,
    });
  });

  it("classifies Node network error codes as retryable provider", () => {
    for (const code of ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EPIPE"]) {
      expect(classifyAgentRuntimeFailure({ message: "", code })).toEqual({
        kind: "provider",
        retryable: true,
      });
    }
  });

  it("parses API Error: <status> from SDK result text", () => {
    expect(
      classifyAgentRuntimeFailure({
        message:
          'Claude Code returned an error result: API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}',
      }),
    ).toEqual({ kind: "provider", retryable: true });
    expect(
      classifyAgentRuntimeFailure({ message: "API Error: 529 overloaded" }),
    ).toEqual({ kind: "provider", retryable: true });
    expect(
      classifyAgentRuntimeFailure({ message: "API Error: 429" }),
    ).toEqual({ kind: "rate_limit", retryable: false });
  });

  it("classifies rate-limit and auth CLI text markers", () => {
    expect(
      classifyAgentRuntimeFailure({ message: "you've hit your limit for today" }),
    ).toEqual({ kind: "rate_limit", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "rate limit exceeded" }),
    ).toEqual({ kind: "rate_limit", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "quota exceeded" }),
    ).toEqual({ kind: "rate_limit", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "not logged in" }),
    ).toEqual({ kind: "auth", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "please run /login" }),
    ).toEqual({ kind: "auth", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "unauthorized" }),
    ).toEqual({ kind: "auth", retryable: false });
    expect(
      classifyAgentRuntimeFailure({
        message:
          "Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access",
      }),
    ).toEqual({ kind: "auth", retryable: false });
  });

  it("classifies SDK 'Stream idle timeout' as retryable provider", () => {
    expect(
      classifyAgentRuntimeFailure({
        message:
          'Agent step "build" failed (success): API Error: Stream idle timeout - partial response received',
      }),
    ).toEqual({ kind: "provider", retryable: true });
    expect(
      classifyAgentRuntimeFailure({
        message: "API Error: Stream idle timeout",
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("classifies SDK connection refusal text as retryable provider", () => {
    expect(
      classifyAgentRuntimeFailure({
        message: "API Error: Unable to connect to API (ConnectionRefused)",
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("does not classify max-turns SDK subtype (step fails hard)", () => {
    expect(
      classifyAgentRuntimeFailure({
        message: "Agent exhausted max turns",
        subtype: "error_max_turns",
      }),
    ).toBeNull();
  });

  it("never classifies AbortError (propagated as-is)", () => {
    expect(
      classifyAgentRuntimeFailure({
        message: "aborted",
        errorName: "AbortError",
        code: "ECONNRESET",
      }),
    ).toBeNull();
  });

  it("returns null for unrecognized errors", () => {
    expect(
      classifyAgentRuntimeFailure({ message: "something unexpected happened" }),
    ).toBeNull();
    expect(classifyAgentRuntimeFailure({ message: "" })).toBeNull();
    // Broad fuzzy matches that used to retry no longer do.
    expect(
      classifyAgentRuntimeFailure({ message: "network error occurred" }),
    ).toBeNull();
    expect(
      classifyAgentRuntimeFailure({ message: "timed out after 30s" }),
    ).toBeNull();
    expect(
      classifyAgentRuntimeFailure({ message: "internal server error" }),
    ).toBeNull();
  });
});
