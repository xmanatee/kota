import { describe, expect, it } from "vitest";
import type { PendingOwnerQuestion } from "./owner-question-queue.js";
import { reviewOwnerQuestion } from "./owner-question-review.js";

function validInput(overrides: Partial<Parameters<typeof reviewOwnerQuestion>[0]> = {}) {
  return {
    context: "Implementing the new escalation flow for autonomous runs.",
    question: "Should the timeout default to 10 minutes or 1 hour?",
    reason: "The default controls how long a workflow step can block on owner input.",
    ...overrides,
  };
}

function pending(overrides: Partial<PendingOwnerQuestion> = {}): PendingOwnerQuestion {
  return {
    id: "abc12345",
    seq: 0,
    context: "prior context",
    question: "previous question?",
    reason: "prior reason",
    source: "session",
    createdAt: new Date().toISOString(),
    status: "pending",
    ...overrides,
  };
}

describe("reviewOwnerQuestion", () => {
  it("accepts a well-formed question", () => {
    expect(reviewOwnerQuestion(validInput())).toEqual({ ok: true });
  });

  it("rejects missing or thin context", () => {
    const result = reviewOwnerQuestion(validInput({ context: "too short" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("context is too thin");
  });

  it("rejects short questions", () => {
    const result = reviewOwnerQuestion(validInput({ question: "why?" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("question is too short");
  });

  it("rejects questions not ending with ?", () => {
    const result = reviewOwnerQuestion(validInput({ question: "tell me what to do" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("question mark");
  });

  it("rejects thin reason", () => {
    const result = reviewOwnerQuestion(validInput({ reason: "idk" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("reason is too thin");
  });

  it("rejects oversize context", () => {
    const big = "x".repeat(3000);
    const result = reviewOwnerQuestion(validInput({ context: big }));
    expect(result.ok).toBe(false);
  });

  it("rejects too many proposed answers", () => {
    const many = Array.from({ length: 10 }, (_, i) => `option ${i + 1}`);
    const result = reviewOwnerQuestion(validInput({ proposedAnswers: many }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("too many proposed answers");
  });

  it("rejects duplicate proposed answers", () => {
    const result = reviewOwnerQuestion(validInput({ proposedAnswers: ["yes", "yes"] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("duplicates");
  });

  it("rejects empty proposed answers", () => {
    const result = reviewOwnerQuestion(validInput({ proposedAnswers: ["yes", ""] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("must not be empty");
  });

  it("rejects near-duplicate recent questions", () => {
    const recent = [
      pending({
        question: "Should the timeout default to 10 minutes or 1 hour?",
      }),
    ];
    const result = reviewOwnerQuestion(validInput(), recent);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("already in the queue");
  });

  it("allows a question that is distinct from recent ones", () => {
    const recent = [
      pending({ question: "Completely unrelated question about something else?" }),
    ];
    expect(reviewOwnerQuestion(validInput(), recent)).toEqual({ ok: true });
  });

  it("ignores old recent questions outside the dedup window", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const recent = [
      pending({
        question: "Should the timeout default to ten minutes or one hour?",
        createdAt: old,
      }),
    ];
    expect(reviewOwnerQuestion(validInput(), recent)).toEqual({ ok: true });
  });

  it("ignores answered recent questions for dedup", () => {
    const recent = [
      pending({
        question: "Should the timeout default to ten minutes or one hour?",
        status: "answered",
      }),
    ];
    expect(reviewOwnerQuestion(validInput(), recent)).toEqual({ ok: true });
  });
});
