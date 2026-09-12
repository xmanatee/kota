import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestWorkflowRuntime } from "#core/workflow/testing/runtime-fixture.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { codexAgentHarness } from "#modules/codex-agent-harness/adapter.js";
import { runGitEvidenceCommand } from "../git-evidence-test-support.js";
import { SECURITY_REVIEW_DUE_EVENT } from "./due-check.js";
import type { SecurityReviewCandidate } from "./security-review.js";
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

    it("durably retains distinct explicit evidence requests while dispatch is occupied", async () => {
      const unregisterHarness = registerAgentHarness(codexAgentHarness);
      const bus = new EventBus();
      const host = createTestWorkflowRuntime({
        bus, scopeRoot: fixture.workspaceRoot, idleIntervalMs: 60_000,
        workflows: [{ ...securityReviewWorkflow, definitionPath: "src/modules/autonomy/workflows/security-review/workflow.ts", moduleRoot: process.cwd() }],
      });
      const first = { evidence: { id: "critical-boundary", paths: ["src/service/gate.ts"], critical: true, reason: "New exploit on unchanged code" } };
      const second = { evidence: { id: "other-boundary", paths: ["src/service/other.ts"], critical: false, reason: "Independent report" } };
      try {
        host.runtime.start();
        host.runtime.setDispatchPaused(true);
        bus.emit("autonomy.security-review.requested", first);
        bus.emit("autonomy.security-review.requested", second);
        await host.runtime.stop();
        const pending = host.runtime.getState().pendingRuns;
        expect(pending.map((run) => run.trigger.payload)).toEqual([first, second]);
        expect(pending.map((run) => {
          if (!run.runId) throw new Error("Security request has no durable run identity");
          return host.runState.getRun(run.runId)?.trigger.payload;
        })).toEqual([first, second]);
      } finally {
        await host.stop();
        unregisterHarness();
      }
    });

    it("completes as an explicit no-op when the deterministic scan is empty", async () => {
      const harness = new WorkflowScenarioDriver(securityReviewWorkflow, {
        workspaceRoot: fixture.workspaceRoot,
        ports: { runCommand: runGitEvidenceCommand },
        trigger: { event: "autonomy.security-review.requested", payload: {} },
        stepOutputs: {},
      });

      const result = await harness.run();

      expect(result.status, result.error).toBe("success");
      expect(result.steps["investigate-candidates"].status).toBe("skipped");
      expect(result.steps["revalidate-findings"].status).toBe("skipped");
      expect(
        JSON.parse(readFileSync(join(result.runDirPath, "security-review-outcome.json"), "utf8")),
      ).toMatchObject({ outcome: "no-op" });
    });

    it("accepts due events while retaining the manual request trigger", async () => {
      expect(securityReviewWorkflow.triggers.map((trigger) => trigger.event)).toEqual(
        expect.arrayContaining([
          "autonomy.security-review.requested",
          SECURITY_REVIEW_DUE_EVENT,
        ]),
      );

      const harness = new WorkflowScenarioDriver(securityReviewWorkflow, {
        workspaceRoot: fixture.workspaceRoot,
        ports: { runCommand: runGitEvidenceCommand },
        trigger: { event: SECURITY_REVIEW_DUE_EVENT, payload: {} },
        stepOutputs: {},
      });

      const result = await harness.run();

      expect(result.status, result.error).toBe("success");
    });

    it("keeps full scan evidence in the artifact while exposing compact candidate metadata", async () => {
      fixture.writeProjectFile(
        "src/modules/web-access/a-full-tree.ts",
        "await fetch('https://noise.example');\n",
      );
      fixture.writeProjectFile("src/modules/web-access/z-due.ts", "await fetch(url, { headers });\n");
      fixture.writeProjectFile("notes/no-matcher.md", "No security-sensitive content here.\n");
      fixture.commitProjectState();

      const harness = new WorkflowScenarioDriver(securityReviewWorkflow, {
        workspaceRoot: fixture.workspaceRoot,
        ports: { runCommand: runGitEvidenceCommand },
        trigger: {
          event: SECURITY_REVIEW_DUE_EVENT,
          payload: {
            changedPaths: [
              "src/modules/web-access/z-due.ts",
              "notes/no-matcher.md",
            ],
          },
        },
        stepOutputs: {
          "investigate-candidates": { findings: [], coverage: [
            { path: "src/modules/web-access/z-due.ts", disposition: "reviewed", rationale: "Caller URLs were inspected" },
            { path: "src/modules/web-access/a-full-tree.ts", disposition: "reviewed", rationale: "Literal destination" },
          ] },
        },
      });

      const result = await harness.run();

      expect(result.status, result.error).toBe("success");
      expect(result.steps["describe-candidates"].output).toEqual(
        expect.objectContaining({
          candidates: expect.any(Array),
          candidateCount: expect.any(Number),
          artifactPath: expect.any(String),
          truncated: expect.any(Boolean),
        }),
      );
      expect(result.steps["describe-candidates"].output).not.toHaveProperty("dueTargets");
      expect(result.steps["describe-candidates"].output).not.toHaveProperty(
        "totalMatchedCandidates",
      );
      const agentPacket = result.steps["describe-candidates"].output as {
        candidates: Array<Omit<SecurityReviewCandidate, "excerpt">>;
      };
      expect(agentPacket.candidates).not.toHaveLength(0);
      expect(agentPacket.candidates.every((candidate) => !("excerpt" in candidate))).toBe(
        true,
      );
      const artifact = JSON.parse(
        readFileSync(
          join(result.runDirPath, "security-review-candidates.json"),
          "utf-8",
        ),
      ) as {
        candidates: Array<{ path: string; excerpt: string }>;
        dueTargets: {
          total: number;
          matched: number;
          missed: number;
          diagnostics: Array<{ path: string; status: string; reason?: string }>;
        };
      };
      expect(artifact.candidates[0]?.path).toBe("src/modules/web-access/z-due.ts");
      expect(artifact.candidates[0]?.excerpt).toBe("await fetch(url, { headers });");
      expect(artifact.dueTargets).toMatchObject({
        total: 1,
        matched: 1,
        missed: 0,
      });
    });

  });
}
