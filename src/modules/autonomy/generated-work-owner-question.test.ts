import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  applyGeneratedWorkQuestionDismissal,
  dismissGeneratedWorkQuestion,
  findGeneratedWorkQuestion,
  generatedWorkProvenanceContext,
  generatedWorkQuestionDedupeKey,
  planGeneratedWorkQuestionDismissals,
  reconcileGeneratedWorkQuestion,
} from "./generated-work-owner-question.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function questionHistory() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-question-history-"));
  roots.push(workspaceRoot);
  const queue = new OwnerQuestionQueue(join(workspaceRoot, ".kota", "owner-questions"));
  const proposalKey = "scope-improver:guidance";
  const input = {
    dedupeKey: generatedWorkQuestionDedupeKey(proposalKey),
    question: "Which scope policy should apply?",
    context: generatedWorkProvenanceContext("Scope review", proposalKey, {
      source: "scope-improver",
      runId: "review-1",
      evidenceRefs: ["guidance"],
    }),
    reason: "The owner must select a policy.",
    source: "scope-improver",
    answerBehavior: "record-only" as const,
    origin: {
      kind: "workflow" as const, workflowName: "scope-improver", runId: "review-1",
      stepId: null, taskId: null,
    },
  };
  const old = queue.enqueue(input);
  queue.dismiss(old.id, "Superseded by revised question", "scope-improver");
  const current = queue.enqueue(input);
  return { workspaceRoot, queue, proposalKey, input, old, current };
}

describe("generated-work question history", () => {
  it.each(["revised", "origin", "answered", "dismissed", "expired"] as const)(
    "does not apply a retained dismissal over a %s question",
    (change) => {
      const history = questionHistory();
      const { queue, proposalKey, current } = history;
      const [dismissal] = planGeneratedWorkQuestionDismissals({
        queue, proposalKey, linkedQuestionIds: [current.id],
        reason: "Issue cleared", source: "autonomy-health-reviewer",
      });
      if (change === "revised") {
        reconcileGeneratedWorkQuestion({ ...history, input: { ...history.input, question: "Which newer policy?" } });
      } else if (change === "origin") {
        writeFileSync(join(history.workspaceRoot, ".kota", "owner-questions", `${current.id}.json`),
          JSON.stringify({ ...current, origin: { ...history.input.origin, runId: "review-2" } }));
      } else if (change === "answered") queue.answer(current.id, "Keep it", "owner");
      else if (change === "dismissed") queue.dismiss(current.id, "Owner decision", "owner");
      else queue.expire(current.id);
      const before = queue.list();
      expect(applyGeneratedWorkQuestionDismissal(queue, dismissal!)).toBe(false);
      expect(queue.list()).toEqual(before);
    },
  );
  it("revises the pending question and dismisses it when its disposition changes", () => {
    const history = questionHistory();
    const { queue, proposalKey, current, old } = history;
    const oldRecord = queue.get(old.id);
    const input = { ...history.input, question: "Should the scope use the proposed policy?" };
    const revised = reconcileGeneratedWorkQuestion({ ...history, input });

    expect(revised).toMatchObject({
      item: { id: current.id, question: input.question },
      created: false,
      updated: true,
      reopened: false,
    });
    expect(queue.list("pending").map((item) => item.id)).toEqual([current.id]);
    expect(findGeneratedWorkQuestion(queue, proposalKey)?.id).toBe(current.id);
    expect(reconcileGeneratedWorkQuestion({
      ...history, input: { ...input, origin: { ...input.origin, runId: "review-2" } },
    })).toMatchObject({ item: revised.item, updated: false, reopened: false });
    expect(dismissGeneratedWorkQuestion(queue, proposalKey, "Task created", "scope-improver"))
      .toEqual([{ kind: "dismissed-owner-question", questionId: current.id }]);
    expect(queue.list("pending")).toEqual([]);
    expect(queue.get(old.id)).toEqual(oldRecord);
  });

  it.each(["answered", "dismissed", "expired"] as const)(
    "preserves %s responses across review runs and retains them when a revised question opens",
    (status) => {
      const history = questionHistory();
      const { queue, current, old, proposalKey } = history;
      const oldRecord = queue.get(old.id);
      if (status === "answered") queue.answer(current.id, "Proceed");
      else if (status === "dismissed") queue.dismiss(current.id);
      else queue.expire(current.id);
      const terminalRecord = queue.get(current.id);

      expect(findGeneratedWorkQuestion(queue, proposalKey)?.id).toBe(current.id);
      const input = { ...history.input, origin: { ...history.input.origin, runId: "review-2" } };
      expect(reconcileGeneratedWorkQuestion({ ...history, input })).toMatchObject({
        item: terminalRecord,
        updated: false,
        reopened: false,
      });
      expect(queue.list("pending")).toEqual([]);

      const revised = reconcileGeneratedWorkQuestion({
        ...history,
        input: { ...input, question: "Should the revised scope policy apply?" },
      });
      expect(revised).toMatchObject({
        item: { status: "pending" },
        reopened: true,
      });
      expect(revised.item.id).not.toBe(current.id);
      expect(queue.list("pending").map((item) => item.id)).toEqual([revised.item.id]);
      expect(queue.get(current.id)).toEqual(terminalRecord);
      expect(queue.get(old.id)).toEqual(oldRecord);
    },
  );

  it("rejects ambiguous pending duplicates without mutating history", () => {
    const history = questionHistory();
    history.queue.enqueue(history.input);
    const before = history.queue.list();
    expect(() => reconcileGeneratedWorkQuestion(history)).toThrow(/multiple pending/);
    expect(() => dismissGeneratedWorkQuestion(
      history.queue, history.proposalKey, "Task created", "scope-improver",
    )).toThrow(/multiple pending/);
    expect(history.queue.list()).toEqual(before);
  });
});
