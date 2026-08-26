import { describe, expect, it, vi } from "vitest";
import type { PendingApproval } from "#core/daemon/approval-queue.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import { executeUiAction, renderUiSurface } from "#modules/daemon-ops/operator-ui.js";
import { MAX_TERMINAL_TEXT_RENDER_CODE_UNITS } from "#modules/rendering/safe-terminal-text.js";
import { NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import type { WorkflowStatusSnapshot } from "#modules/workflow-ops/client.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import { buildRuntimeUiSurface } from "./ui-surface.js";

const RAW_TERMINAL_CONTROL_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the assertion rejects untrusted terminal controls
  /[\x00-\x09\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

function approval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: "approval-1",
    scopeId: "scope-main",
    kind: "tool_call",
    tool: "shell.exec",
    input: { cmd: "deploy" },
    risk: "dangerous",
    reason: "external write",
    createdAt: "2026-07-07T00:04:00.000Z",
    status: "pending",
    ...overrides,
  };
}

function ownerQuestion(overrides: Partial<PendingOwnerQuestion> = {}): PendingOwnerQuestion {
  return {
    id: "question-1",
    seq: 1,
    context: "Need owner input.",
    question: "Should KOTA continue?",
    reason: "The workflow cannot infer this choice.",
    source: "builder",
    answerBehavior: "workflow-resume",
    origin: {
      kind: "workflow",
      workflowName: "builder",
      runId: "run-1",
      stepId: "ask-owner",
      taskId: "task-1",
    },
    createdAt: "2026-07-07T00:05:00.000Z",
    status: "pending",
    ...overrides,
  };
}

function runtimeStatus(): WorkflowStatusSnapshot {
  return {
    activeRuns: [{ runId: "run-active-1", workflow: "builder", startedAt: "2026-07-07T00:00:00.000Z" }],
    pendingRuns: [{
      runId: "queued-run-1",
      workflowName: "improver",
      trigger: { event: "manual", schemaRef: null, payload: {} },
      enqueuedAtMs: Date.parse("2026-07-07T00:01:00.000Z"),
      notBeforeMs: Date.parse("2026-07-07T00:01:00.000Z"),
    }],
    queueLength: 1,
    completedRuns: 2,
    workflows: {},
    paused: false,
    pendingAbort: false,
    concurrency: 4,
  };
}

describe("operator UI runtime actions", () => {
  it("strips terminal controls from approval and owner-question rows", () => {
    const surface = buildRuntimeUiSurface({
      scopeId: "scope-main",
      workflowStatus: { ok: true, value: runtimeStatus() },
      runs: { ok: true, value: { runs: [] } },
      definitions: { ok: true, value: { source: "daemon", definitions: [] } },
      approvals: {
        ok: true,
        value: {
          approvals: [approval({
            tool: "\x1b]2;forged approval title\x07shell\x1b[31m.exec\x1b[0m",
            reason: "needs\x9b31m review\x9b0m\x01\u202eforged\u2066",
          })],
        },
      },
      ownerQuestions: {
        ok: true,
        value: {
          questions: [ownerQuestion({
            question: "\x9d2;forged question title\x9cShould\x1b[32m KOTA\x1b[0m continue?\x7f\u202dnow\u2069",
          })],
        },
      },
      sessions: { ok: true, value: { sessions: [] } },
    });

    const rendered = renderToString(renderUiSurface(surface), {
      theme: NO_COLOR_THEME,
      width: 120,
    });
    expect(rendered).toContain("shell.exec  needs reviewforged");
    expect(rendered).toContain("Should KOTA continue?now");
    expect(rendered).not.toMatch(RAW_TERMINAL_CONTROL_PATTERN);
    expect(rendered).not.toContain("forged approval title");
    expect(rendered).not.toContain("forged question title");
  });

  it("bounds repeated unterminated OSC prefixes in approval and owner-question rows", () => {
    const surface = buildRuntimeUiSurface({
      scopeId: "scope-main",
      workflowStatus: { ok: true, value: runtimeStatus() },
      runs: { ok: true, value: { runs: [] } },
      definitions: { ok: true, value: { source: "daemon", definitions: [] } },
      approvals: {
        ok: true,
        value: {
          approvals: [approval({
            tool: `visible approval${"\x1b]".repeat(MAX_TERMINAL_TEXT_RENDER_CODE_UNITS + 1)}`,
            reason: "must not render",
          })],
        },
      },
      ownerQuestions: {
        ok: true,
        value: {
          questions: [ownerQuestion({
            question: `visible question${"\x9d".repeat(MAX_TERMINAL_TEXT_RENDER_CODE_UNITS + 1)}`,
          })],
        },
      },
      sessions: { ok: true, value: { sessions: [] } },
    });

    const rendered = renderToString(renderUiSurface(surface), {
      theme: NO_COLOR_THEME,
      width: 120,
    });
    expect(rendered).toContain("visible approval…");
    expect(rendered).toContain("visible question…");
    expect(rendered).not.toContain("must not render");
    expect(rendered).not.toMatch(RAW_TERMINAL_CONTROL_PATTERN);
  });

  it("builds executable queued and recent run supervision controls", async () => {
    const surface = buildRuntimeUiSurface({
      scopeId: "scope-main",
      workflowStatus: { ok: true, value: runtimeStatus() },
      runs: {
        ok: true,
        value: {
          runs: [
            {
              id: "run-failed-1",
              workflow: "builder",
              status: "failed",
              triggerEvent: "manual",
              triggerSchemaRef: null,
              startedAt: "2026-07-07T00:02:00.000Z",
            },
            {
              id: "run-success-1",
              workflow: "builder",
              status: "success",
              triggerEvent: "manual",
              triggerSchemaRef: null,
              startedAt: "2026-07-07T00:03:00.000Z",
            },
          ],
        },
      },
      definitions: { ok: true, value: { source: "daemon", definitions: [] } },
      approvals: { ok: true, value: { approvals: [] } },
      ownerQuestions: { ok: true, value: { questions: [] } },
      sessions: { ok: true, value: { sessions: [] } },
    });

    expect(surface.actions.map((action) => action.actionId)).toEqual(expect.arrayContaining([
      "run.abort",
      "run.cancel-queued",
      "run.retry",
      "run.replay",
      "run.resume",
    ]));
    const queued = surface.nodes.find((node) => node.kind === "table" && node.title === "Queued workflow runs");
    expect(queued?.kind === "table" ? queued.rows[0]?.action?.actionId : undefined).toBe("run.cancel-queued");
    const recent = surface.nodes.find((node) => node.kind === "table" && node.title === "Recent run results");
    expect(recent?.kind === "table" ? recent.rows[0]?.action?.actionId : undefined).toBe("run.retry");
    const rendered = renderToString(renderUiSurface(surface), { width: 120 });
    expect(rendered).toContain("Cancel queued run");
    expect(rendered).toContain("Retry failed run");

    const retry = surface.actions.find((candidate) => candidate.actionId === "run.retry");
    if (!retry) throw new Error("run.retry action missing");
    const triggerByName = vi.fn(async () => ({ ok: true as const, path: "daemon" as const, queued: "builder" }));
    const client = {
      workflow: {
        getRun: vi.fn(async () => ({
          found: true as const,
          run: {
            id: "run-failed-1",
            workflow: "builder",
            status: "failed",
            triggerEvent: "manual",
            triggerSchemaRef: null,
            startedAt: "2026-07-07T00:02:00.000Z",
            steps: [],
          },
        })),
        triggerByName,
      },
    } as unknown as KotaClient;
    const result = await executeUiAction({
      action: retry,
      client,
      parameters: { runId: "run-failed-1" },
    });
    expect(result).toEqual({ ok: true, message: "Queued retry of builder from run-failed-1." });
    expect(triggerByName).toHaveBeenCalledWith("builder", {
      event: "manual",
      schemaRef: null,
      runId: expect.stringMatching(/-builder-/),
      payload: { retryOf: "run-failed-1" },
    });
  });
});
