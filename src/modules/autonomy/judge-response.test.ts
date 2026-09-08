import { describe, expect, it } from "vitest";
import { AgentStepRuntimeError } from "#core/workflow/steps/step-executor-retry.js";
import { handleVerdict, parseVerdict } from "./critic-verdict.js";
import { decideJudgeResponse } from "./judge-response.js";

const verdict = { verdict: "pass", critical_issues: [], warnings: [], summary: "The requested behavior is present." } as const;
const context = { label: "Reviewer", attempt: 1, maxAttempts: 3, emptyOutputFailures: 0 };

describe("judge response decisions", () => {
  it.each([false, true])("recovers the same complete verdict with harness error=%s", (isError) => {
    const response = { text: `Review:\n\n\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\``, isError, subtype: "error_max_turns" };
    expect(decideJudgeResponse({ ...context, response })).toEqual({ kind: "verdict", verdict });
  });

  it("uses runtime classification for provider retries and stops at the attempt boundary", () => {
    const response = { text: "API Error: 503 overloaded", isError: true };
    expect(decideJudgeResponse({ ...context, response })).toMatchObject({ kind: "retry", formatReminder: false });
    expect(decideJudgeResponse({ ...context, response, attempt: 3 })).toMatchObject({ kind: "reject" });
    expect(decideJudgeResponse({ ...context, response: { text: "unknown failure", isError: true } })).toMatchObject({ kind: "reject" });
  });

  it("requests output repair for malformed success and rejects exhaustion", () => {
    const response = { text: "Looks good", isError: false };
    expect(decideJudgeResponse({ ...context, response })).toMatchObject({ kind: "retry", formatReminder: true, emptyOutputFailures: 0 });
    expect(decideJudgeResponse({ ...context, response, attempt: 3 })).toMatchObject({ kind: "reject" });
  });

  it("distinguishes repeated typed empty output from ordinary malformed prose", () => {
    const response = { text: "", isError: false, subtype: "antigravity_cli_empty_output" };
    expect(decideJudgeResponse({ ...context, response })).toMatchObject({ kind: "retry", emptyOutputFailures: 1 });
    const exhausted = decideJudgeResponse({ ...context, response, attempt: 3, emptyOutputFailures: 2 });
    expect(exhausted).toMatchObject({ kind: "reject", error: expect.any(AgentStepRuntimeError) });
    expect(decideJudgeResponse({ ...context, emptyOutputFailures: 2, response: { text: "prose", isError: false } }))
      .toMatchObject({ kind: "retry", emptyOutputFailures: 0 });
  });

  it("rejects malformed verdict fields instead of discarding them", () => {
    for (const malformed of [
      { ...verdict, critical_issues: "missing behavior" },
      { ...verdict, warnings: [42] },
      { ...verdict, summary: null },
      { verdict: "pass" },
    ]) {
      expect(() => parseVerdict(JSON.stringify(malformed))).toThrow();
    }
  });

  it("never converts a fail verdict with no listed issues into success", () => {
    const failed = parseVerdict(JSON.stringify({ ...verdict, verdict: "fail" }));
    expect(() => handleVerdict(failed)).toThrow(/critical issue/);
  });
});
