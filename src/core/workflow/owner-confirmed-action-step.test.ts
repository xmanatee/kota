import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmedOwnerActionStep } from "./owner-confirmed-action-step.js";
import {
  createOwnerDecisionWorkflowFixture,
  OWNER_ACTION,
  type OwnerDecisionWorkflowFixture,
} from "./owner-decision-step-test-fixture.js";

describe("owner-confirmed external actions", () => {
  let fixture: OwnerDecisionWorkflowFixture;

  beforeEach(() => {
    fixture = createOwnerDecisionWorkflowFixture();
  });

  afterEach(() => {
    fixture.dispose();
  });

  it("executes once after the authorizing decision and authenticated approval", async () => {
    const calls: string[] = [];
    const { promise } = fixture.execute(fixture.makeConfirmedActionWorkflow(calls));

    await fixture.answerPendingQuestion("yes");
    const approvalId = await fixture.approvePendingApproval();
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(calls).toEqual(["7pm"]);
    expect(fixture.decisionStore.list("consumed")).toMatchObject([
      { consumption: { approvalId, actionId: "book-court" } },
    ]);
  });

  it("refuses an approval record changed after endpoint authentication", async () => {
    const calls: string[] = [];
    const { promise } = fixture.execute(fixture.makeConfirmedActionWorkflow(calls));

    await fixture.answerPendingQuestion("yes");
    const approvalId = await fixture.approvePendingApproval();
    const recordPath = join(fixture.root, "approvals", `${approvalId}.json`);
    const stored = JSON.parse(readFileSync(recordPath, "utf8"));
    writeFileSync(
      recordPath,
      JSON.stringify({ ...stored, approvalNote: "forged after endpoint approval" }, null, 2),
    );
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(calls).toEqual([]);
    expect(result.metadata.steps.find((step) => step.id === "approval")?.error)
      .toMatch(/authenticated approval resolution|integrity/i);
  });

  it("dead-letters a failed effect and redrives only that action", async () => {
    const calls: string[] = [];
    const failing = fixture.makeConfirmedActionWorkflow(
      calls,
      OWNER_ACTION,
      OWNER_ACTION,
      { includeApproval: true, failAdapter: true },
    );
    const first = fixture.execute(failing, undefined, {
      deadLetterQueue: fixture.deadLetterQueue,
    });

    await fixture.answerPendingQuestion("yes");
    await fixture.approvePendingApproval();
    const failed = await first.promise;
    const item = fixture.deadLetterQueue.list()[0]!;

    expect(failed.metadata.status).toBe("failed");
    expect(item).toMatchObject({
      type: "confirmed-action-dispatch",
      status: "open",
      scopeId: "scope-a",
      owningModule: "sports-booking",
      failure: {
        lastErrorClass: "execution",
        reason: "booking provider rejected confirmed action",
      },
      source: {
        kind: "confirmed-action-dispatch",
        actionId: "book-court",
        workflowName: "owner-decision-action-fixture",
        runId: failed.metadata.id,
        stepId: "book",
      },
      redrive: {
        kind: "workflow",
        workflowName: "owner-decision-action-fixture",
        source: { kind: "resume-step", runId: failed.metadata.id, stepId: "book" },
      },
      redactedProjection: { slot: "7pm" },
    });

    const redrive = await fixture.execute(
      fixture.makeConfirmedActionWorkflow(calls),
      {
        event: "resume",
        schemaRef: null,
        payload: {
          resumedFromRunId: failed.metadata.id,
          resumeFromStep: "book",
          redriveOf: item.id,
        },
      },
      { deadLetterQueue: fixture.deadLetterQueue },
    ).promise;

    expect(redrive.metadata.status).toBe("success");
    expect(calls).toEqual(["7pm", "7pm"]);
    expect(fixture.decisionStore.list("consumed")).toHaveLength(1);
  });

  it("replays an accepted idempotency result without executing the effect twice", async () => {
    const calls: string[] = [];
    const { promise } = fixture.execute(fixture.makeConfirmedActionWorkflow(calls));

    await fixture.answerPendingQuestion("yes");
    const approvalId = await fixture.approvePendingApproval();
    const first = await promise;
    const consumed = fixture.decisionStore.list("consumed")[0]!;
    const replayAction = confirmedOwnerActionStep({
      id: "book-replay",
      decisionStore: () => fixture.decisionStore,
      approvalQueue: () => fixture.approvalQueue,
      idempotencyStore: () => fixture.idempotencyStore,
      decisionId: consumed.id,
      approvalId,
      input: { slot: "7pm" },
      adapter: {
        metadata: OWNER_ACTION,
        execute: ({ input }) => {
          calls.push(String(input.slot));
          return { ok: true, slot: String(input.slot) };
        },
      },
    });
    const replay = await fixture.execute({
      name: "owner-decision-action-replay-fixture",
      enabled: true,
      repository: "none",
      definitionPath: "src/core/workflow/owner-confirmed-action-step.test.ts",
      moduleRoot: "/test-module-root",
      triggers: [],
      steps: [replayAction],
      tags: [],
    }).promise;

    expect(first.metadata.status).toBe("success");
    expect(replay.metadata.status).toBe("success");
    expect(calls).toEqual(["7pm"]);
    expect(replay.metadata.steps[0]?.output).toMatchObject({
      idempotency: { status: "replayed" },
    });
  });

  it("rejects a non-authorizing owner answer before executing the effect", async () => {
    const calls: string[] = [];
    const { promise } = fixture.execute(fixture.makeConfirmedActionWorkflow(calls));

    await fixture.answerPendingQuestion("no");
    await fixture.approvePendingApproval();
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(calls).toEqual([]);
    expect(result.metadata.steps.find((step) => step.id === "book")?.error)
      .toContain("selected value does not authorize action book-court");
    expect(fixture.decisionStore.list("consumed")).toEqual([]);
  });

  it.each([
    {
      name: "selected value",
      decisionAction: OWNER_ACTION,
      adapterAction: {
        ...OWNER_ACTION,
        authorizingSelection: { kind: "single-choice" as const, optionId: "no" },
      },
      includeApproval: true,
      error: "authorizes a different selected value",
    },
    {
      name: "dangerous-effect posture",
      decisionAction: OWNER_ACTION,
      adapterAction: { ...OWNER_ACTION, dangerousEffect: false },
      includeApproval: false,
      error: "authorizes a different dangerous-effect posture",
    },
    {
      name: "dry-run mode",
      decisionAction: { ...OWNER_ACTION, dryRun: true, dangerousEffect: false },
      adapterAction: { ...OWNER_ACTION, dryRun: false, dangerousEffect: false },
      includeApproval: false,
      error: "authorizes a different dry-run mode",
    },
  ])("rejects adapter metadata that changes the persisted $name", async (entry) => {
    const calls: string[] = [];
    const { promise } = fixture.execute(
      fixture.makeConfirmedActionWorkflow(calls, entry.decisionAction, entry.adapterAction, {
        includeApproval: entry.includeApproval,
      }),
    );

    await fixture.answerPendingQuestion(entry.name === "selected value" ? "no" : "yes");
    if (entry.includeApproval) await fixture.approvePendingApproval();
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(calls).toEqual([]);
    expect(result.metadata.steps.find((step) => step.id === "book")?.error)
      .toContain(entry.error);
    expect(fixture.decisionStore.list("consumed")).toEqual([]);
  });
});
