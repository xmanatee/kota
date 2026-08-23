import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUTONOMY_CANONICAL_MUTATION_CONCURRENCY_GROUP,
  AUTONOMY_WORKFLOW_WORKSPACE_POLICIES,
  autonomyWorkflowConcurrencyGroupFor,
  workflowWorkspacePolicyFor,
} from "./workflow-workspace-policy.js";

const WORKFLOWS_DIR = fileURLToPath(new URL("./workflows/", import.meta.url));

function workflowDirs(): string[] {
  return readdirSync(WORKFLOWS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(WORKFLOWS_DIR, name, "workflow.ts")))
    .sort();
}

function sourceFor(workflow: string): string {
  return readFileSync(join(WORKFLOWS_DIR, workflow, "workflow.ts"), "utf8");
}

describe("autonomy workflow workspace policy", () => {
  it("covers every discovered autonomy workflow", () => {
    const actual = workflowDirs();
    const recorded = AUTONOMY_WORKFLOW_WORKSPACE_POLICIES.map(
      (policy) => policy.workflow,
    ).sort();

    expect(recorded).toEqual(actual);
  });

  it("does not name workflows that are absent from the workflow directory", () => {
    for (const policy of AUTONOMY_WORKFLOW_WORKSPACE_POLICIES) {
      expect(
        existsSync(join(WORKFLOWS_DIR, policy.workflow, "workflow.ts")),
        policy.workflow,
      ).toBe(true);
    }
  });

  it("records safety mechanisms for every canonical exception", () => {
    const canonical = AUTONOMY_WORKFLOW_WORKSPACE_POLICIES.filter(
      (policy) => policy.kind === "canonical-control-state",
    );

    expect(canonical.length).toBeGreaterThan(0);
    for (const policy of canonical) {
      expect(policy.reason.trim(), policy.workflow).not.toHaveLength(0);
      expect(policy.writes.length, policy.workflow).toBeGreaterThan(0);
      expect(policy.safetyMechanisms.length, policy.workflow).toBeGreaterThan(0);
    }
  });

  it("keeps builder as the only arbitrary project mutator", () => {
    const arbitraryMutators = AUTONOMY_WORKFLOW_WORKSPACE_POLICIES.filter(
      (policy) => policy.trackedMutationScope === "arbitrary-project-files",
    );

    expect(arbitraryMutators.map((policy) => policy.workflow)).toEqual(["builder"]);
    expect(arbitraryMutators[0]?.kind).toBe("worktree-merge-gated");
    expect(sourceFor("builder")).toContain("prepareWorktreeStep");
    expect(sourceFor("builder")).toContain("mergeGateStep");
  });

  it("serializes every tracked canonical mutator through one runtime group", () => {
    for (const policy of AUTONOMY_WORKFLOW_WORKSPACE_POLICIES) {
      const expected =
        policy.kind === "canonical-control-state" &&
        policy.trackedMutationScope !== "runtime-state"
          ? AUTONOMY_CANONICAL_MUTATION_CONCURRENCY_GROUP
          : undefined;
      expect(autonomyWorkflowConcurrencyGroupFor(policy.workflow)).toBe(expected);
    }
  });

  it("keeps improver read-only and routes dispositions through task control state", () => {
    const policy = workflowWorkspacePolicyFor("improver");
    expect(policy?.kind).toBe("canonical-control-state");
    expect(policy?.trackedMutationScope).toBe("task-control-state");
    expect(policy?.writes).not.toContain("src/modules/autonomy/");

    const source = sourceFor("improver");
    expect(source).toContain('id: "inspect-worktree"');
    expect(source).toContain("inspectWorktree.output(ctx)?.dirty === false");
    expect(source).toContain('writeScope: "deny-all"');
    expect(source).not.toContain('event: "workflow.completed"');
  });

  it("keeps research-retry scoped to task control files", () => {
    const policy = workflowWorkspacePolicyFor("research-retry");
    expect(policy?.kind).toBe("canonical-control-state");
    expect(policy?.writes).toEqual(["data/tasks/", "data/inbox/"]);

    const source = sourceFor("research-retry");
    expect(source).toContain('writeScope: ["data/tasks/", "data/inbox/"]');
    expect(source).not.toContain('"src/modules/autonomy/"');
  });
});
