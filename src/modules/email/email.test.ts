import { describe, expect, it } from "vitest";
import { formatEmail } from "./format.js";

describe("formatEmail", () => {
  it("formats workflow.failure.alert", () => {
    const msg = formatEmail("workflow.failure.alert", {
      workflow: "builder",
      runId: "run-123",
      status: "failed",
      errorSummary: "step timed out",
    });
    expect(msg.subject).toBe("[KOTA] Workflow failed: builder");
    expect(msg.text).toContain("Workflow: builder");
    expect(msg.text).toContain("Run: run-123");
    expect(msg.text).toContain("step timed out");
  });

  it("formats workflow.budget.exceeded", () => {
    const msg = formatEmail("workflow.budget.exceeded", {
      budget: 10.0,
      dailySpend: 12.5,
    });
    expect(msg.subject).toBe("[KOTA] Budget Exceeded");
    expect(msg.text).toContain("$10.00");
    expect(msg.text).toContain("$12.50");
  });

  it("formats workflow.attention.digest with text payload", () => {
    const msg = formatEmail("workflow.attention.digest", {
      text: "3 items need review",
    });
    expect(msg.subject).toBe("[KOTA] Attention Digest");
    expect(msg.text).toBe("3 items need review");
  });

  it("formats approval.requested with kota CLI commands", () => {
    const msg = formatEmail("approval.requested", {
      id: "abc-123",
      tool: "shell",
      risk: "high",
      reason: "rm -rf /tmp/test",
    });
    expect(msg.subject).toContain("Approval Required");
    expect(msg.subject).toContain("shell");
    expect(msg.text).toContain("kota approval approve abc-123");
    expect(msg.text).toContain("kota approval reject abc-123");
  });

  it("formats owner.question.asked with answer/dismiss CLI commands", () => {
    const msg = formatEmail("owner.question.asked", {
      id: "oq-abc",
      question: "Should we rewrite the caching layer?",
      reason: "Architectural decision blocks progress",
      source: "builder",
    });
    expect(msg.subject).toContain("Owner Question");
    expect(msg.subject).toContain("builder");
    expect(msg.text).toContain("Should we rewrite the caching layer?");
    expect(msg.text).toContain("Architectural decision blocks progress");
    expect(msg.text).toContain("builder");
    expect(msg.text).toContain("kota owner-question answer oq-abc");
    expect(msg.text).toContain("kota owner-question dismiss oq-abc");
  });

  it("formats workflow.build.committed", () => {
    const msg = formatEmail("workflow.build.committed", {
      commitMessage: "feat: add email module",
      taskId: "task-email-channel-module",
      costUsd: 0.42,
      durationMs: 120000,
    });
    expect(msg.subject).toContain("Builder committed");
    expect(msg.subject).toContain("feat: add email module");
    expect(msg.text).toContain("Task: task-email-channel-module");
    expect(msg.text).toContain("$0.42");
    expect(msg.text).toContain("2m");
  });

  it("falls back for unknown events", () => {
    const msg = formatEmail("some.unknown.event", { foo: "bar" });
    expect(msg.subject).toBe("[KOTA] some.unknown.event");
    expect(msg.text).toContain("foo");
  });

  it("formats module.crash.alert", () => {
    const msg = formatEmail("module.crash.alert", {
      module: "github-webhook",
      text: "Crashed 3 times in 5 minutes",
    });
    expect(msg.subject).toContain("Module Crash");
    expect(msg.subject).toContain("github-webhook");
    expect(msg.text).toContain("Crashed 3 times");
  });

  it("handles missing optional fields gracefully", () => {
    const msg = formatEmail("workflow.failure.alert", {});
    expect(msg.subject).toBe("[KOTA] Workflow failed: unknown");
    expect(msg.text).toContain("unknown");
  });
});
