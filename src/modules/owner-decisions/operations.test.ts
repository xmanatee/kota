import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OwnerDecisionStore } from "#core/daemon/owner-decision-store.js";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { answerOwnerDecisionLocal, showOwnerDecisionLocal } from "./operations.js";

describe("owner-decisions operations", () => {
  let dir: string;
  let decisionStore: OwnerDecisionStore;
  let questionQueue: OwnerQuestionQueue;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "owner-decisions-operations-"));
    decisionStore = new OwnerDecisionStore(join(dir, "decisions"), "scope-a");
    questionQueue = new OwnerQuestionQueue(join(dir, "questions"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("answering a decision resolves its linked owner question", () => {
    const decision = decisionStore.create({
      request: {
        kind: "single-choice",
        prompt: "Book the 7pm slot?",
        options: [
          { id: "yes", label: "Book it" },
          { id: "no", label: "Do not book" },
        ],
      },
      requester: { kind: "manual", source: "test" },
      evidence: [{ summary: "Channel opportunity confirmation." }],
    });
    const question = questionQueue.enqueue({
      context: "Decision id attached.",
      question: "Book the 7pm slot?",
      reason: "External side effect.",
      source: "test",
      answerBehavior: "workflow-resume",
      origin: { kind: "manual", source: "test" },
    });
    decisionStore.linkOwnerQuestion(decision.id, question.id);

    const answered = answerOwnerDecisionLocal(
      decisionStore,
      questionQueue,
      decision.id,
      { kind: "single-choice", optionId: "yes" },
      "test",
    );

    expect(answered?.status).toBe("answered");
    expect(questionQueue.get(question.id)?.status).toBe("answered");
    expect(questionQueue.get(question.id)?.answer).toBe("yes");
  });

  it("resolves linked owner questions with the persisted redacted selection", () => {
    const decision = decisionStore.create({
      request: {
        kind: "form",
        prompt: "Confirm provider reference.",
        fields: [
          { id: "apiToken", label: "API token", type: "text", required: true },
          { id: "destination", label: "Destination", type: "text", required: true },
        ],
      },
      requester: { kind: "manual", source: "test" },
      evidence: [{ summary: "Linked owner question should not receive raw credentials." }],
    });
    const question = questionQueue.enqueue({
      context: "Decision id attached.",
      question: "Confirm provider reference.",
      reason: "Persisted decision answer.",
      source: "test",
      answerBehavior: "workflow-resume",
      origin: { kind: "manual", source: "test" },
    });
    decisionStore.linkOwnerQuestion(decision.id, question.id);

    answerOwnerDecisionLocal(
      decisionStore,
      questionQueue,
      decision.id,
      { kind: "form", fields: { apiToken: "secret-value", destination: "calendar" } },
      "test",
    );

    const answer = questionQueue.get(question.id)?.answer ?? "";
    expect(answer).toContain("[redacted]");
    expect(answer).not.toContain("secret-value");
  });

  it("does not project files outside the owner-decision store for traversal ids", () => {
    writeFileSync(join(dir, "secrets.json"), JSON.stringify({ token: "raw-secret" }));

    expect(showOwnerDecisionLocal(decisionStore, "../secrets")).toBeNull();
  });
});
