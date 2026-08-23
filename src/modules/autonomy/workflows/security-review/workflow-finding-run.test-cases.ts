import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import type {
  SecurityInvestigationOutput,
  SecurityRevalidationVerdictOutput,
} from "./security-review.js";
import { expectSecurityReviewWorkflowReplayNoop } from "./workflow-task-identity.test-cases.js";
import { SecurityReviewProjectFixture } from "./workflow-test-fixture.js";

export function describeSecurityReviewFindingRunTests(
  securityReviewWorkflow: WorkflowDefinitionInput,
): void {
  describe("workflow finding output behavior", () => {
    let fixture: SecurityReviewProjectFixture;

    beforeEach(() => {
      fixture = new SecurityReviewProjectFixture();
    });

    afterEach(() => {
      fixture.cleanup();
    });

    it("turns confirmed revalidation findings into tasks and leaves rejected findings in artifacts", async () => {
      fixture.writeProjectFile(
        "src/modules/web-access/web-fetch.ts",
        "await fetch(url, { headers });\n",
      );
      fixture.writeProjectFile(
        "src/modules/secrets/index.ts",
        "const token = await get_secret('TOKEN');\n",
      );

      const investigation: SecurityInvestigationOutput = {
        findings: [
          {
            id: "confirmed-fetch",
            candidateId: "external-fetch:src/modules/web-access/web-fetch.ts:1",
            claim: "Caller-controlled URL reaches fetch without validation.",
            severity: "high",
            affectedPath: "src/modules/web-access/web-fetch.ts",
            evidence: [
              {
                path: "src/modules/web-access/web-fetch.ts",
                line: 1,
                excerpt: "await fetch(url, { headers });",
              },
            ],
            recommendedOutcome: "Add explicit URL validation before fetch.",
          },
          {
            id: "rejected-secret",
            candidateId: "secret-handling:src/modules/secrets/index.ts:1",
            claim: "Secret is logged.",
            severity: "medium",
            affectedPath: "src/modules/secrets/index.ts",
            evidence: [
              {
                path: "src/modules/secrets/index.ts",
                line: 1,
                excerpt: "const token = await get_secret('TOKEN');",
              },
            ],
            recommendedOutcome: "No task needed.",
          },
        ],
      };
      const revalidation: SecurityRevalidationVerdictOutput = {
        findings: [
          {
            id: investigation.findings[0].id,
            verdict: "confirmed",
            rationale: "The candidate remains exploitable after reviewing call sites.",
          },
          {
            id: investigation.findings[1].id,
            verdict: "rejected",
            rationale: "No logging sink is present.",
          },
        ],
        summary: "Confirmed fetch issue; rejected secret false positive.",
      };

      const harness = new WorkflowTestHarness(securityReviewWorkflow, {
        projectDir: fixture.projectDir,
        trigger: { event: "autonomy.security-review.requested", payload: {} },
        stepMocks: {
          "investigate-candidates": investigation,
          "revalidate-findings": revalidation,
        },
      });

      const result = await harness.run();

      expect(result.status).toBe("success");
      expect(result.steps["record-investigation-findings"].status).toBe("success");
      expect(result.steps["record-revalidation"].status).toBe("success");
      expect(result.steps["create-follow-up-tasks"].status).toBe("success");
      expect(result.steps["validate-before-commit"].status).toBe("success");
      const created = result.steps["create-follow-up-tasks"].output as { createdTaskIds: string[] };
      expect(created.createdTaskIds).toHaveLength(1);
      const createdTaskId = created.createdTaskIds[0];
      if (!createdTaskId) throw new Error("security-review did not create its confirmed finding");
      expect(
        readFileSync(
          join(fixture.projectDir, ".kota/runs/harness/security-review-revalidation.json"),
          "utf-8",
        ),
      ).toContain("rejected-secret");
      const preflight = JSON.parse(
        readFileSync(
          join(fixture.projectDir, ".kota/runs/harness/security-review-preflight.json"),
          "utf-8",
        ),
      ) as {
        ok: boolean;
        checks: Array<{ rail: string; status: string; message: string }>;
      };
      expect(preflight.ok).toBe(true);
      expect(preflight.checks.map((check) => check.rail)).toEqual([
        "task-validation",
        "scratch-artifacts",
        "commit-stageable",
        "commit-message",
      ]);
      expect(preflight.checks.every((check) => check.status === "passed")).toBe(true);
      await expectSecurityReviewWorkflowReplayNoop({
        fixture,
        investigation,
        revalidation,
        taskId: createdTaskId,
        workflow: securityReviewWorkflow,
      });
      expect(() => assertTaskQueueValid(fixture.projectDir, { minReady: 0 })).not.toThrow();
    });

    it("writes preflight diagnostics and skips commit when task validation fails", async () => {
      fixture.writeProjectFile(
        "src/modules/web-access/web-fetch.ts",
        "await fetch(url, { headers });\n",
      );
      fixture.writeProjectFile(
        "data/tasks/ready/task-invalid-status.md",
        [
          "---",
          "id: task-invalid-status",
          "title: invalid status fixture",
          "status: done",
          "priority: p1",
          "area: autonomy",
          "created_at: 2026-06-19T00:00:00.000Z",
          "updated_at: 2026-06-19T00:00:00.000Z",
          "---",
          "",
          "## Problem",
          "",
          "Invalid status for validation fixture.",
          "",
        ].join("\n"),
      );

      const investigation: SecurityInvestigationOutput = {
        findings: [
          {
            id: "confirmed-fetch",
            candidateId: "external-fetch:src/modules/web-access/web-fetch.ts:1",
            claim: "Caller-controlled URL reaches fetch without validation.",
            severity: "high",
            affectedPath: "src/modules/web-access/web-fetch.ts",
            evidence: [
              {
                path: "src/modules/web-access/web-fetch.ts",
                line: 1,
                excerpt: "await fetch(url, { headers });",
              },
            ],
            recommendedOutcome: "Add explicit URL validation before fetch.",
          },
        ],
      };
      const revalidation: SecurityRevalidationVerdictOutput = {
        findings: [
          {
            id: investigation.findings[0].id,
            verdict: "confirmed",
            rationale: "The candidate remains exploitable after reviewing call sites.",
          },
        ],
        summary: "Confirmed fetch issue.",
      };

      const harness = new WorkflowTestHarness(securityReviewWorkflow, {
        projectDir: fixture.projectDir,
        trigger: { event: "autonomy.security-review.requested", payload: {} },
        stepMocks: {
          "investigate-candidates": investigation,
          "revalidate-findings": revalidation,
        },
      });

      const result = await harness.run();

      expect(result.status).toBe("failed");
      expect(result.steps["validate-before-commit"].status).toBe("failed");
      expect(result.steps.commit).toBeUndefined();
      const preflight = JSON.parse(
        readFileSync(
          join(fixture.projectDir, ".kota/runs/harness/security-review-preflight.json"),
          "utf-8",
        ),
      ) as {
        ok: boolean;
        blockedBy?: string;
        checks: Array<{ rail: string; status: string; message: string }>;
      };
      expect(preflight.ok).toBe(false);
      expect(preflight.blockedBy).toBe("task-validation");
      expect(preflight.checks[0]).toMatchObject({
        rail: "task-validation",
        status: "failed",
      });
    });

    it("fails when revalidation omits an investigation finding", async () => {
      fixture.writeProjectFile(
        "src/modules/web-access/web-fetch.ts",
        "await fetch(url, { headers });\n",
      );
      fixture.writeProjectFile(
        "src/modules/secrets/index.ts",
        "const token = await get_secret('TOKEN');\n",
      );

      const investigation: SecurityInvestigationOutput = {
        findings: [
          {
            id: "confirmed-fetch",
            candidateId: "external-fetch:src/modules/web-access/web-fetch.ts:1",
            claim: "Caller-controlled URL reaches fetch without validation.",
            severity: "high",
            affectedPath: "src/modules/web-access/web-fetch.ts",
            evidence: [
              {
                path: "src/modules/web-access/web-fetch.ts",
                line: 1,
                excerpt: "await fetch(url, { headers });",
              },
            ],
            recommendedOutcome: "Add explicit URL validation before fetch.",
          },
          {
            id: "missing-secret",
            candidateId: "secret-handling:src/modules/secrets/index.ts:1",
            claim: "Secret is logged.",
            severity: "medium",
            affectedPath: "src/modules/secrets/index.ts",
            evidence: [
              {
                path: "src/modules/secrets/index.ts",
                line: 1,
                excerpt: "const token = await get_secret('TOKEN');",
              },
            ],
            recommendedOutcome: "No task needed.",
          },
        ],
      };
      const revalidation: SecurityRevalidationVerdictOutput = {
        findings: [
          {
            id: investigation.findings[0].id,
            verdict: "confirmed",
            rationale: "The candidate remains exploitable after reviewing call sites.",
          },
        ],
        summary: "Confirmed fetch issue.",
      };

      const harness = new WorkflowTestHarness(securityReviewWorkflow, {
        projectDir: fixture.projectDir,
        trigger: { event: "autonomy.security-review.requested", payload: {} },
        stepMocks: {
          "investigate-candidates": investigation,
          "revalidate-findings": revalidation,
        },
      });

      const result = await harness.run();

      expect(result.status).toBe("failed");
      expect(result.steps["record-revalidation"].status).toBe("failed");
      expect(result.steps["record-revalidation"].error).toContain("missing-secret");
      expect(result.steps["create-follow-up-tasks"]).toBeUndefined();
    });
  });
}
