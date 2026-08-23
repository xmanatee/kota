import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import {
  createOrUpdateSecurityFindingTasks,
  type SecurityInvestigationOutput,
  type SecurityRevalidationVerdictOutput,
} from "./security-review.js";
import { SecurityReviewProjectFixture } from "./workflow-test-fixture.js";

export function describeSecurityReviewTaskIdentityTests(): void {
  describe("finding task stable identity", () => {
    let fixture: SecurityReviewProjectFixture;

    beforeEach(() => {
      fixture = new SecurityReviewProjectFixture();
    });

    afterEach(() => {
      fixture.cleanup();
    });

    it("updates a terminal task with new provenance instead of creating a duplicate ready task", () => {
      const claim = "Terminal task retains repeated confirmed finding provenance.";
      const baseId = fixture.securityFindingTaskIdForClaim(claim);
      fixture.writeLegacySecurityFindingTask({
        id: baseId,
        state: "done",
        runId: "security-review-run-one",
        claim,
      });
      const finding = fixture.confirmedFindingForClaim(claim);

      const result = createOrUpdateSecurityFindingTasks(fixture.projectDir, {
        runId: "security-review-run-two",
        findings: [finding],
      });

      expect(result.createdTaskIds).toEqual([]);
      expect(result.updatedTaskIds).toEqual([baseId]);
      expect(result.unchangedFindingIds).toEqual([]);
      const terminalPath = join(fixture.projectDir, "data/tasks/done", `${baseId}.md`);
      const terminalTask = readFileSync(terminalPath, "utf-8");
      const terminalAttrs = parseFlatFrontMatter(terminalTask).attrs;
      expect(terminalAttrs.status).toBe("done");
      expect(terminalAttrs.security_finding_key).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(terminalAttrs.security_review_runs).toEqual([
        "security-review-run-one",
        "security-review-run-two",
      ]);
      expect(terminalTask).toContain("Terminal task retains repeated confirmed finding provenance.");
      expect(existsSync(join(fixture.projectDir, "data/tasks/ready", `${baseId}-2.md`))).toBe(
        false,
      );

      const replay = createOrUpdateSecurityFindingTasks(fixture.projectDir, {
        runId: "security-review-run-two",
        findings: [finding],
      });
      expect(replay.createdTaskIds).toEqual([]);
      expect(replay.updatedTaskIds).toEqual([]);
      expect(replay.unchangedFindingIds).toEqual([finding.id]);
      expect(readFileSync(terminalPath, "utf-8")).toBe(terminalTask);
      expect(() => assertTaskQueueValid(fixture.projectDir, { minReady: 0 })).not.toThrow();
    });

    it("merges an explicitly superseded duplicate into the canonical stable-identity record", () => {
      const canonicalClaim = "First wording for a stable trust-boundary finding.";
      const repeatedClaim = "Later wording for the same stable trust-boundary finding.";
      const canonicalId = fixture.securityFindingTaskIdForClaim(canonicalClaim);
      const supersededId = fixture.securityFindingTaskIdForClaim(repeatedClaim);
      fixture.writeLegacySecurityFindingTask({
        id: canonicalId,
        state: "ready",
        runId: "security-review-run-one",
        claim: canonicalClaim,
      });
      fixture.writeLegacySecurityFindingTask({
        id: supersededId,
        state: "dropped",
        runId: "security-review-run-two",
        claim: repeatedClaim,
        supersededBy: canonicalId,
      });
      const supersededPath = join(
        fixture.projectDir,
        "data/tasks/dropped",
        `${supersededId}.md`,
      );
      const supersededBefore = readFileSync(supersededPath, "utf-8");
      const finding = fixture.confirmedFindingForClaim(repeatedClaim);

      const merged = createOrUpdateSecurityFindingTasks(fixture.projectDir, {
        runId: "security-review-run-two",
        findings: [finding],
      });

      expect(merged.createdTaskIds).toEqual([]);
      expect(merged.updatedTaskIds).toEqual([canonicalId]);
      expect(merged.unchangedFindingIds).toEqual([]);
      const canonicalPath = join(
        fixture.projectDir,
        "data/tasks/ready",
        `${canonicalId}.md`,
      );
      const canonicalAfterMerge = readFileSync(canonicalPath, "utf-8");
      const canonicalAttrs = parseFlatFrontMatter(canonicalAfterMerge).attrs;
      expect(canonicalAttrs.id).toBe(canonicalId);
      expect(canonicalAttrs.security_review_runs).toEqual([
        "security-review-run-one",
        "security-review-run-two",
      ]);
      expect(canonicalAfterMerge).toContain(repeatedClaim);
      expect(readFileSync(supersededPath, "utf-8")).toBe(supersededBefore);

      const replay = createOrUpdateSecurityFindingTasks(fixture.projectDir, {
        runId: "security-review-run-two",
        findings: [finding],
      });
      expect(replay.createdTaskIds).toEqual([]);
      expect(replay.updatedTaskIds).toEqual([]);
      expect(replay.unchangedFindingIds).toEqual([finding.id]);
      expect(readFileSync(canonicalPath, "utf-8")).toBe(canonicalAfterMerge);
      expect(() => assertTaskQueueValid(fixture.projectDir, { minReady: 0 })).not.toThrow();
    });
  });
}

export async function expectSecurityReviewWorkflowReplayNoop(args: {
  fixture: SecurityReviewProjectFixture;
  investigation: SecurityInvestigationOutput;
  revalidation: SecurityRevalidationVerdictOutput;
  taskId: string;
  workflow: WorkflowDefinitionInput;
}): Promise<void> {
  const taskPath = join(args.fixture.projectDir, "data/tasks/ready", `${args.taskId}.md`);
  const taskBeforeReplay = readFileSync(taskPath, "utf-8");
  const replay = await new WorkflowTestHarness(args.workflow, {
    projectDir: args.fixture.projectDir,
    trigger: { event: "autonomy.security-review.requested", payload: {} },
    stepMocks: {
      "investigate-candidates": args.investigation,
      "revalidate-findings": args.revalidation,
    },
  }).run();
  expect(replay.status).toBe("success");
  expect(replay.steps["create-follow-up-tasks"].output).toMatchObject({
    createdTaskIds: [],
    updatedTaskIds: [],
    unchangedFindingIds: ["confirmed-fetch"],
  });
  expect(replay.steps["write-commit-message"].status).toBe("skipped");
  expect(replay.steps["validate-before-commit"].status).toBe("skipped");
  expect(readFileSync(taskPath, "utf-8")).toBe(taskBeforeReplay);
  const replayOutcome = JSON.parse(
    readFileSync(
      join(args.fixture.projectDir, ".kota/runs/harness/security-review-outcome.json"),
      "utf-8",
    ),
  ) as { outcome: string; reason: string };
  expect(replayOutcome).toMatchObject({
    outcome: "no-op",
    reason: "confirmed-findings-current",
  });
}
