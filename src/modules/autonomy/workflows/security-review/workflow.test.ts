import { describe, expect, it } from "vitest";
import { validatePayloadSchema } from "#core/workflow/payload-validator.js";
import securityReviewWorkflow from "./workflow.js";
import { describeSecurityReviewFindingRunTests } from "./workflow-finding-run.test-cases.js";
import { describeSecurityReviewRunTests } from "./workflow-run.test-cases.js";
import { describeSecurityReviewScanTests } from "./workflow-scan.test-cases.js";
import { describeSecurityReviewTaskTests } from "./workflow-task.test-cases.js";
import { describeSecurityReviewTaskIdentityTests } from "./workflow-task-identity.test-cases.js";

describe("security-review workflow", () => {
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
  describeSecurityReviewTaskIdentityTests();
  describeSecurityReviewTaskTests();
  describeSecurityReviewRunTests(securityReviewWorkflow);
  describeSecurityReviewFindingRunTests(securityReviewWorkflow);
});
