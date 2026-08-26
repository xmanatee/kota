import { describe, expect, it } from "vitest";
import { renderToString } from "#modules/rendering/transport.js";
import {
  buildContinuityProjection,
  buildContinuityUiSurface,
  CONTINUITY_COMPOSED_STORES,
  renderUiSurface,
} from "./operator-ui.js";
import { continuityInput, ok } from "./operator-ui-continuity-test-helpers.js";

describe("operator continuity UI surface", () => {
  it("builds a projection and shared UI surface from typed namespace reads", () => {
    const projection = buildContinuityProjection(continuityInput());

    expect(projection.state).toBe("healthy");
    expect(projection.composedStores).toEqual(CONTINUITY_COMPOSED_STORES);
    expect(projection.composedStores.some((source) => source.includes(".kota"))).toBe(false);
    expect(projection.workItems.map((item) => item.name)).toContain("Improve operator continuity");
    expect(projection.reviewArtifacts[0]?.route?.path).toBe(
      "/api/workflow/runs/2026-06-25T09-00-00-000Z-builder-success/artifacts",
    );
    expect(projection.recurringFollowUps[0]).toMatchObject({
      name: "daily-digest",
      state: "cron",
    });

    const surface = buildContinuityUiSurface(projection);
    expect(surface.surfaceId).toBe("continuity");
    expect(surface.intent).toBe("Work");
    expect(surface.nodes.map((node) => node.kind)).toEqual([
      "status-summary",
      "text",
      "table",
      "list",
      "list",
      "list",
      "list",
      "action-list",
    ]);

    const rendered = renderToString(renderUiSurface(surface), { width: 120 });
    expect(rendered).toContain("Continuity");
    expect(rendered).toContain("Review recent artifacts");
    expect(rendered).toContain("Run artifacts to review");
    expect(rendered).toContain("daily-digest");
  });

  it("redacts sensitive memory and knowledge text before rendering", () => {
    const projection = buildContinuityProjection(continuityInput({
      memory: ok({
        entries: [{
          id: "mem-secret",
          created: "2026-06-25T08:00:00.000Z",
          content: "restart failed because token=raw-token reached owner@example.test",
        }],
      }),
      knowledge: ok({
        entries: [{
          id: "kn-secret",
          title: "callback https://auth.example.test/start?token=raw-token&next=/setup",
          type: "decision",
          tags: [],
          status: "active",
          created: "2026-06-25T08:00:00.000Z",
          updated: "2026-06-25T08:00:00.000Z",
          content: "secret note",
          meta: {},
        }],
      }),
    }));
    const rendered = renderToString(renderUiSurface(buildContinuityUiSurface(projection)), {
      width: 140,
    });

    expect(rendered).toContain("token=[redacted]");
    expect(rendered).not.toContain("raw-token");
    expect(rendered).not.toContain("owner@example.test");
  });

  it("renders empty, blocked, and failed states distinctly", () => {
    const empty = buildContinuityProjection(continuityInput({
      tasks: ok({ tasks: [] }),
      workflowStatus: ok({
        activeRuns: [],
        pendingRuns: [],
        queueLength: 0,
        completedRuns: 0,
        workflows: {},
        paused: false,
        concurrency: 4,
        pendingAbort: false,
      }),
      runs: ok({ runs: [] }),
      definitions: ok({ source: "static", definitions: [] }),
      memory: ok({ entries: [] }),
      knowledge: ok({ entries: [] }),
    }));
    expect(empty.state).toBe("empty");
    expect(buildContinuityUiSurface(empty).nodes.some((node) => node.kind === "empty")).toBe(true);

    const blocked = buildContinuityProjection(continuityInput({
      tasks: ok({
        tasks: [{
          id: "task-blocked",
          priority: "p1",
          title: "Blocked capture",
          state: "blocked",
          waitingOnTasks: [],
        }],
      }),
      approvals: ok({
        approvals: [{
          id: "approval-1",
          scopeId: "scope-test",
          kind: "tool_call",
          tool: "shell.exec",
          input: {},
          risk: "dangerous",
          reason: "deploy needs approval",
          createdAt: "2026-06-25T08:00:00.000Z",
          status: "pending",
        }],
      }),
      ownerQuestions: ok({
        questions: [{
          id: "question-1",
          seq: 1,
          context: "Need direction",
          question: "Use production credentials?",
          reason: "High stakes",
          source: "workflow",
          answerBehavior: "workflow-resume",
          origin: {
            kind: "workflow",
            workflowName: "builder",
            runId: "run-1",
            stepId: "build",
            taskId: "task-blocked",
          },
          createdAt: "2026-06-25T08:00:00.000Z",
          status: "pending",
        }],
      }),
      ownerDecisions: ok({
        decisions: [{
          id: "decision-1",
          seq: 1,
          scopeId: "p-kota-fixture-default",
          status: "pending",
          request: { kind: "free-text", prompt: "Pick the provider." },
          requester: { kind: "manual", source: "test" },
          evidence: [],
          createdAt: "2026-06-25T08:00:00.000Z",
          updatedAt: "2026-06-25T08:00:00.000Z",
        }],
      }),
      setup: ok({
        requirements: [{
          moduleName: "telegram",
          requirementId: "bot-credentials",
          kind: "secret",
          title: "Telegram bot credentials",
          required: true,
          scope: "project",
          sensitivity: "secret",
          setup: { mode: "url", url: "https://t.me/BotFather", label: "Open BotFather" },
          state: "missing",
          reason: "secret_missing",
          message: "Required credential is missing",
          secretRefs: [{ name: "TELEGRAM_BOT_TOKEN", scope: "project", present: false }],
        }],
        summary: {
          ready: 0,
          missing: 1,
          pending: 0,
          expired: 0,
          revoked: 0,
          unknown: 0,
          unavailable: 0,
        },
      }),
    }));
    expect(blocked.state).toBe("blocked");
    expect(blocked.unblocks.map((item) => item.id)).toEqual([
      "task-task-blocked",
      "approval-approval-1",
      "owner-question-question-1",
      "owner-decision-decision-1",
      "setup-telegram-bot-credentials",
    ]);

    const failed = buildContinuityProjection(continuityInput({
      runs: ok({
        runs: [{
          id: "2026-06-25T09-00-00-000Z-builder-failed",
          workflow: "builder",
          status: "failed",
          triggerEvent: "autonomy.queue.available",
          triggerSchemaRef: null,
          startedAt: "2026-06-25T09:00:00.000Z",
        }],
      }),
    }));
    expect(failed.state).toBe("failed");
    expect(failed.nextAction).toContain("failed run artifact");

    const failedRendered = renderToString(renderUiSurface(buildContinuityUiSurface(failed)), {
      width: 120,
    });
    expect(failedRendered).toContain("failed");
    expect(failedRendered).toContain(
      "/api/workflow/runs/2026-06-25T09-00-00-000Z-builder-failed/artifacts",
    );
  });
});
