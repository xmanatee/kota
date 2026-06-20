import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { SECURITY_REVIEW_DUE_EVENT } from "./due-check.js";
import { SecurityReviewProjectFixture } from "./workflow-test-fixture.js";

export function describeSecurityReviewRunTests(
  securityReviewWorkflow: WorkflowDefinitionInput,
): void {
  describe("workflow run behavior", () => {
    let fixture: SecurityReviewProjectFixture;

    beforeEach(() => {
      fixture = new SecurityReviewProjectFixture();
    });

    afterEach(() => {
      fixture.cleanup();
    });

    it("completes as an explicit no-op when the deterministic scan is empty", async () => {
      const harness = new WorkflowTestHarness(securityReviewWorkflow, {
        projectDir: fixture.projectDir,
        trigger: { event: "autonomy.security-review.requested", payload: {} },
        stepMocks: {},
      });

      const result = await harness.run();

      expect(result.status).toBe("success");
      expect(result.steps["scan-candidates"].status).toBe("success");
      expect(result.steps["record-empty-scan"].status).toBe("success");
      expect(result.steps["investigate-candidates"].status).toBe("skipped");
      expect(result.steps["revalidate-findings"].status).toBe("skipped");
      expect(result.steps["create-follow-up-tasks"].status).toBe("skipped");
      expect(
        existsSync(join(fixture.projectDir, ".kota/runs/harness/security-review-outcome.json")),
      ).toBe(true);
    });

    it("resets recovery state without decoding skipped agent outputs", async () => {
      fixture.writeProjectFile("src/modules/web-access/web-fetch.ts", "await fetch(url, { headers });\n");

      const harness = new WorkflowTestHarness(securityReviewWorkflow, {
        projectDir: fixture.projectDir,
        trigger: { event: "runtime.recovered", payload: {} },
        stepMocks: {},
      });

      const result = await harness.run();

      expect(result.status).toBe("success");
      expect(result.steps["reset-for-recovery"].status).toBe("success");
      expect(result.steps["scan-candidates"].status).toBe("skipped");
      expect(result.steps["investigate-candidates"].status).toBe("skipped");
      expect(result.steps["record-investigation-findings"].status).toBe("skipped");
      expect(result.steps["record-no-findings"].status).toBe("skipped");
      expect(result.steps["revalidate-findings"].status).toBe("skipped");
      expect(result.steps["record-revalidation"].status).toBe("skipped");
      expect(result.steps["create-follow-up-tasks"].status).toBe("skipped");
    });

    it("accepts due events while retaining the manual request trigger", async () => {
      expect(securityReviewWorkflow.triggers.map((trigger) => trigger.event)).toEqual(
        expect.arrayContaining([
          "autonomy.security-review.requested",
          SECURITY_REVIEW_DUE_EVENT,
        ]),
      );

      const harness = new WorkflowTestHarness(securityReviewWorkflow, {
        projectDir: fixture.projectDir,
        trigger: { event: SECURITY_REVIEW_DUE_EVENT, payload: {} },
        stepMocks: {},
      });

      const result = await harness.run();

      expect(result.status).toBe("success");
      expect(result.steps["record-empty-scan"].status).toBe("success");
    });

    it("writes due target diagnostics into the candidate artifact for due events", async () => {
      fixture.writeProjectFile(
        "src/modules/web-access/a-full-tree.ts",
        "await fetch('https://noise.example');\n",
      );
      fixture.writeProjectFile("src/modules/web-access/z-due.ts", "await fetch(url, { headers });\n");
      fixture.writeProjectFile("notes/no-matcher.md", "No security-sensitive content here.\n");

      const harness = new WorkflowTestHarness(securityReviewWorkflow, {
        projectDir: fixture.projectDir,
        trigger: {
          event: SECURITY_REVIEW_DUE_EVENT,
          payload: {
            changedSurfaces: [
              {
                surface: "external-fetch",
                paths: [
                  "src/modules/web-access/z-due.ts",
                  "notes/no-matcher.md",
                ],
              },
            ],
          },
        },
        stepMocks: {
          "investigate-candidates": { findings: [] },
        },
      });

      const result = await harness.run();

      expect(result.status).toBe("success");
      const artifact = JSON.parse(
        readFileSync(
          join(fixture.projectDir, ".kota/runs/harness/security-review-candidates.json"),
          "utf-8",
        ),
      ) as {
        candidates: Array<{ path: string }>;
        dueTargets: {
          total: number;
          matched: number;
          missed: number;
          diagnostics: Array<{ path: string; status: string; reason?: string }>;
        };
      };
      expect(artifact.candidates[0]?.path).toBe("src/modules/web-access/z-due.ts");
      expect(artifact.dueTargets).toMatchObject({
        total: 2,
        matched: 1,
        missed: 1,
      });
      expect(artifact.dueTargets.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "src/modules/web-access/z-due.ts",
            status: "matched",
          }),
          expect.objectContaining({
            path: "notes/no-matcher.md",
            status: "missed",
            reason: "no-matcher",
          }),
        ]),
      );
    });

  });
}
