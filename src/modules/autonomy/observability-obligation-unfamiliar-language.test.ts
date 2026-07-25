import { describe, expect, it } from "vitest";
import { detectObservabilityObligationReview } from "./observability-obligation.js";

function diffFor(
  file: string,
  addedLines: readonly string[],
  deletedLines: readonly string[] = [],
): string {
  return [
    `diff --git a/${file} b/${file}`,
    "index 0000001..0000002 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${Math.max(deletedLines.length, 1)} +1,${Math.max(addedLines.length, 1)} @@`,
    ...deletedLines.map((line) => `-${line}`),
    ...addedLines.map((line) => `+${line}`),
  ].join("\n");
}

describe("unfamiliar-language runtime observability recheck", () => {
  it("maps the cited runtime changes to focused evidence and narrow rationales", () => {
    const citedEvidenceFiles = [
      "src/core/agent-harness/types.ts",
      "src/modules/autonomy/workflows/builder/repair-checks.ts",
      "src/modules/autonomy/workflows/builder/runtime-resource-ports.ts",
      "src/modules/autonomy/workflows/builder/runtime-resources.ts",
      "src/modules/autonomy/workflows/builder/task-state-repair-checks.ts",
      "src/modules/codex-agent-harness/adapter.ts",
    ];
    const review = detectObservabilityObligationReview(
      [
        diffFor("src/core/agent-harness/types.ts", [
          "readonly resolveIsolatedHostAuthEnv?: (env: NodeJS.ProcessEnv) => Readonly<Record<string, string>>;",
        ]),
        diffFor(
          "src/modules/autonomy/workflows/builder/repair-checks.ts",
          [
            "run: (ctx) => checkClaimedTaskStateStaged(workflowWorkspaceDir(ctx), claim),",
            'ctx.stepOutputs["claim-task"]',
          ],
        ),
        diffFor(
          "src/modules/autonomy/workflows/builder/runtime-resource-ports.ts",
          [
            'export type BuilderPortAvailability = "available" | "unavailable" | "permission-denied";',
            'return { available: true, checkedPorts: [], portAvailability: "skipped-host-restricted" };',
          ],
        ),
        diffFor(
          "src/modules/autonomy/workflows/builder/runtime-resources.test-helpers.ts",
          [
            "let portPreflightRestricted = false;",
            'if (portPreflightRestricted) return "permission-denied";',
          ],
        ),
        diffFor(
          "src/modules/autonomy/workflows/builder/runtime-resources.ts",
          ['portAvailability: "checked" | "skipped-host-restricted";'],
          ['portAvailability: "checked" | "skipped-eval-harness-replay";'],
        ),
        diffFor(
          "src/modules/autonomy/workflows/builder/task-state-repair-checks.ts",
          [
            'throw new Error("Builder cannot stage task state without a claimed task id");',
            "return `OK: staged ${paths.length} state path(s) for claimed task ${claimedTaskId}`;",
          ],
        ),
        diffFor("src/modules/codex-agent-harness/adapter.ts", [
          "export function resolveCodexIsolatedHostAuthEnv(env: NodeJS.ProcessEnv) {",
          "return { CODEX_HOME: resolveCodexHome(env) };",
          "}",
        ]),
        diffFor(
          "src/modules/autonomy/workflows/builder/claimed-task-state-staging.test.ts",
          [
            'expect(status).toBe("OK: staged 2 state path(s) for claimed task task-claimed");',
            'expect(metadata.indexOf("claimed-task-state-staged")).toBeLessThan(1);',
          ],
        ),
        diffFor(
          "src/modules/autonomy/workflows/builder/runtime-resource-ports.test.ts",
          [
            'expect(metadata.portAvailability).toBe("skipped-host-restricted");',
            'await expect(assignBuilderRuntimeResources(input)).rejects.toThrow("unavailable");',
          ],
        ),
        diffFor(
          "src/modules/autonomy/workflows/builder/runtime-resources.test.ts",
          [
            "expect(metadata.agentRunDir).toBe(runDirPath);",
            "expect(metadata.env.KOTA_RUN_DIR).toBe(runDirPath);",
          ],
        ),
        diffFor("src/modules/codex-agent-harness/adapter.test.ts", [
          'expect(metadata).toEqual({ CODEX_HOME: "/operator/.codex" });',
        ]),
      ].join("\n"),
      new Map([
        [
          "src/core/agent-harness/types.ts",
          "Type-only harness protocol seam; concrete adapter and host-runner behavior is covered by focused tests.",
        ],
        [
          "src/modules/autonomy/workflows/builder/runtime-resources.test-helpers.ts",
          "Test-only hook module with no production import path; observable port metadata is asserted by the focused runtime-resource test.",
        ],
      ]),
    );

    expect(review).toMatchObject({
      outcome: "ok",
      missingFiles: [],
    });
    expect(review.satisfiedFiles).toEqual(
      expect.arrayContaining(citedEvidenceFiles),
    );
    expect(review.candidates.map((candidate) => candidate.file)).not.toContain(
      "src/modules/autonomy/workflows/builder/runtime-resources.test-helpers.ts",
    );
    expect(
      review.candidates.find(
        (candidate) => candidate.file === "src/core/agent-harness/types.ts",
      )?.evidence,
    ).toContainEqual(expect.objectContaining({ kind: "run-artifact-rationale" }));
    expect(
      review.candidates.find(
        (candidate) =>
          candidate.file ===
          "src/modules/autonomy/workflows/builder/runtime-resource-ports.ts",
      )?.evidence,
    ).toContainEqual(
      expect.objectContaining({
        kind: "focused-test-assertion",
        ref: "src/modules/autonomy/workflows/builder/runtime-resource-ports.test.ts",
      }),
    );
    expect(
      review.candidates.find(
        (candidate) =>
          candidate.file === "src/modules/codex-agent-harness/adapter.ts",
      )?.evidence,
    ).toContainEqual(
      expect.objectContaining({
        kind: "focused-test-assertion",
        ref: "src/modules/codex-agent-harness/adapter.test.ts",
      }),
    );
  });
});
