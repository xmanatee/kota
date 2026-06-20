import { describe, expect, it, vi } from "vitest";
import { validatePayloadSchema } from "#core/workflow/payload-validator.js";
import securityReviewWorkflow from "./workflow.js";
import { describeSecurityReviewFindingRunTests } from "./workflow-finding-run.test-cases.js";
import { describeSecurityReviewRunTests } from "./workflow-run.test-cases.js";
import { describeSecurityReviewScanTests } from "./workflow-scan.test-cases.js";
import { describeSecurityReviewTaskTests } from "./workflow-task.test-cases.js";

vi.mock("#modules/autonomy/commit.js", () => ({
  checkCommitStageable: vi.fn(() => "OK: mock stageable"),
  commitWorkflowChanges: vi.fn(() => ({ committed: true })),
}));

describe("security-review workflow", () => {
  it("orders security-review commit behind the explicit preflight gate", () => {
    const stepIds = securityReviewWorkflow.steps.map((step) => step.id);

    expect(stepIds.indexOf("create-follow-up-tasks")).toBeLessThan(
      stepIds.indexOf("write-commit-message"),
    );
    expect(stepIds.indexOf("write-commit-message")).toBeLessThan(
      stepIds.indexOf("validate-before-commit"),
    );
    expect(stepIds.indexOf("validate-before-commit")).toBe(stepIds.indexOf("commit") - 1);
  });

  it("declares retryable output schemas for run-observed malformed agent output", () => {
    const investigationStep = securityReviewWorkflow.steps.find(
      (step) => step.id === "investigate-candidates",
    );
    const revalidationStep = securityReviewWorkflow.steps.find(
      (step) => step.id === "revalidate-findings",
    );
    if (!investigationStep || !("outputSchema" in investigationStep)) {
      throw new Error("investigate-candidates step missing outputSchema");
    }
    if (!revalidationStep || !("outputSchema" in revalidationStep)) {
      throw new Error("revalidate-findings step missing outputSchema");
    }

    const objectEvidence = {
      findings: [
        {
          id: "finding-one",
          candidateId: "external-fetch:src/modules/web-access/web-fetch.ts:1",
          claim: "Caller-controlled URL reaches fetch without validation.",
          severity: "high",
          affectedPath: "src/modules/web-access/web-fetch.ts",
          evidence: {
            path: "src/modules/web-access/web-fetch.ts",
            line: 1,
            excerpt: "await fetch(url);",
          },
          recommendedOutcome: "Validate URL scheme and host before fetch.",
        },
      ],
    };

    expect(validatePayloadSchema(investigationStep.outputSchema!, objectEvidence)).toContain(
      "evidence",
    );
    expect(validatePayloadSchema(investigationStep.outputSchema!, { skipped: true })).toContain(
      "findings",
    );
    expect(validatePayloadSchema(revalidationStep.outputSchema!, { findings: [] })).toContain(
      "summary",
    );
    expect(
      validatePayloadSchema(revalidationStep.outputSchema!, {
        findings: [
          {
            ...objectEvidence.findings[0],
            evidence: [
              {
                path: "src/modules/web-access/web-fetch.ts",
                line: 1,
                excerpt: "await fetch(url);",
              },
            ],
            verdict: "confirmed",
            rationale: "The reviewed call path is exploitable.",
          },
        ],
        summary: "Confirmed one fetch finding.",
      }),
    ).toContain("unexpected field");
    expect(
      validatePayloadSchema(revalidationStep.outputSchema!, {
        findings: [
          {
            id: "finding-one",
            verdict: "confirmed",
            rationale: "The reviewed call path is exploitable.",
          },
        ],
        summary: "Confirmed one fetch finding.",
      }),
    ).toBeNull();
  });

  describeSecurityReviewScanTests();
  describeSecurityReviewTaskTests();
  describeSecurityReviewRunTests(securityReviewWorkflow);
  describeSecurityReviewFindingRunTests(securityReviewWorkflow);
});
