import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import { AUTONOMY_ISSUE_PROJECTION_STATE_KEY, applyAutonomyIssueObservations, buildAutonomyIssueObservation, emptyAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import { architectureReviewRequested } from "./events.js";
import { GARDENER_STATE_KEY } from "./gardener-state.js";
import type { ArchitectureGardenerRunState, ArchitectureObservation } from "./types.js";
import architectureGardenerWorkflow, {
  ARCHITECTURE_GARDENER_RUN_ARTIFACT,
} from "./workflow.js";

function runGit(cwd: string, args: string[]) {
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("Architecture Gardener Workflow", () => {
  let testWorkspace: string;

  beforeEach(() => {
    testWorkspace = mkdtempSync(join(tmpdir(), "kota-gardener-wf-test-"));
    mkdirSync(join(testWorkspace, "src", "core"), { recursive: true });
    mkdirSync(join(testWorkspace, "src", "modules", "foo"), { recursive: true });
    mkdirSync(join(testWorkspace, "data", "tasks"), { recursive: true });
    mkdirSync(join(testWorkspace, ".kota"), { recursive: true });

    writeFileSync(
      join(testWorkspace, "src", "core", "clean.ts"),
      "export const coreUtil = () => true;\n",
      "utf-8",
    );
    writeFileSync(
      join(testWorkspace, "src", "modules", "foo", "index.ts"),
      "export default { name: \"foo\", dependencies: [] };\n",
      "utf-8",
    );
    writeFileSync(
      join(testWorkspace, "package.json"),
      `${JSON.stringify({ name: "test-pkg", version: "1.0.0", scripts: { "validate-tasks": "echo ok" } }, null, 2)}\n`,
      "utf-8",
    );
    writeFileSync(join(testWorkspace, ".gitignore"), ".kota/\n", "utf-8");

    runGit(testWorkspace, ["init", "--quiet"]);
    runGit(testWorkspace, ["add", "."]);
    runGit(testWorkspace, [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      "init",
    ]);
  });

  afterEach(() => {
    rmSync(testWorkspace, { recursive: true, force: true });
  });

  it("investigates an empty request as no action and suppresses the same cohort after restart", async () => {
    const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "test-state"));
    const trigger = { event: architectureReviewRequested.name, payload: { scopeId: state.scopeId, targetScope: "repo", reason: "Review architecture" } };
    const first = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, trigger, ports: { state },
      stepOutputs: { investigate: { action: "no-action", rationale: "Only one maintained implementation and no delivery evidence.", evidenceRefs: ["src/modules/foo/index.ts"], existingTaskId: null, proposal: null } },
    }).run();
    expect(first.status, first.error).toBe("success");
    expect(listFullRepoTasks(testWorkspace)).toHaveLength(0);
    const artifact = JSON.parse(readFileSync(join(first.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
    expect(artifact.observations).toEqual([]);
    expect(artifact.decision.action).toBe("no-action");
    expect(state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY).value?.dispositions.repo?.disposition).toBe("no-action");
    const restarted = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, trigger, ports: { state: { stateDir: state.stateDir, scopeId: state.scopeId } },
    }).run();
    expect(restarted.status, restarted.error).toBe("success");
    expect(restarted.steps.investigate?.status).toBe("skipped");
  });

  it("investigates a changed structural/friction cohort once through the durable issue projection", async () => {
    writeFileSync(join(testWorkspace, "src/core/bad.ts"), 'import "#modules/foo/index.js";');
    runGit(testWorkspace, ["add", "src/core/bad.ts"]);
    runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", "structural evidence"]);
    const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "issue-state"));
    const observation = buildAutonomyIssueObservation({
      kind: "present", rootCauseKey: "workflow:builder:module-load", observedAt: "2026-09-09T10:00:00Z",
      source: { kind: "workflow", id: "builder", workflow: "builder" }, severity: "error", actionability: "local-code",
      labels: ["workflow-failure"], summaries: ["Delivery failed while loading foo"], evidenceRefs: [{ kind: "run", ref: ".kota/runs/failed-build" }],
      observationCount: 1, signalIds: ["module-load-failure"],
    });
    const projection = applyAutonomyIssueObservations({ current: emptyAutonomyIssueProjection(), observations: [observation] }).projection;
    state.compareAndSet(AUTONOMY_ISSUE_PROJECTION_STATE_KEY, 0, projection);
    const trigger = { event: "workflow.completed", payload: { workflow: "builder", scopeId: state.scopeId } };
    const first = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, trigger, ports: { state },
      stepOutputs: { investigate: { action: "no-action", rationale: "The loader failure and the import need separate owner investigation; no shared mechanism established.", evidenceRefs: ["src/core/bad.ts", ".kota/runs/failed-build"], existingTaskId: null, proposal: null } },
    }).run();
    expect(first.status, first.error).toBe("success");
    const evidence = JSON.parse(readFileSync(join(first.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
    expect(evidence.observations.some((o: { kind: string }) => o.kind === "delivery-friction")).toBe(true);
    const repeated = await new WorkflowScenarioDriver(architectureGardenerWorkflow, { workspaceRoot: testWorkspace, trigger, ports: { state } }).run();
    expect(repeated.status, repeated.error).toBe("success");
    expect(repeated.steps.investigate?.status).toBe("skipped");
  });

  it.each(["src/modules/foo", "module:foo", "src/modules/foo/index.ts"])(
    "readmits %s for changed imports and clone sites, but suppresses unrelated or repeated evidence",
    async (targetScope) => {
      const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "target-state"));
      const review = async (target = targetScope) => {
        const result = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
          workspaceRoot: testWorkspace,
          trigger: { event: architectureReviewRequested.name, payload: { scopeId: state.scopeId, targetScope: target } },
          ports: { state: { stateDir: state.stateDir, scopeId: state.scopeId } },
          stepOutputs: { investigate: { action: "no-action", rationale: "These observations still need caller evidence before consolidation.",
            evidenceRefs: ["src/modules/foo/index.ts"], existingTaskId: null, proposal: null } },
        }).run();
        expect(result.status, result.error).toBe("success");
        const artifact: { observations: ArchitectureObservation[] } = JSON.parse(
          readFileSync(join(result.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
        return { investigated: result.steps.investigate?.status === "success", observations: artifact.observations };
      };
      const changeSource = (path: string, source: string) => {
        writeFileSync(join(testWorkspace, path), source);
        runGit(testWorkspace, ["add", path]);
        runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "--no-gpg-sign", "-qm", "change evidence"]);
      };

      expect((await review()).investigated).toBe(true);
      // A sibling with the same prefix must not change this target's cohort.
      mkdirSync(join(testWorkspace, "src/modules/foo-other"));
      changeSource("src/modules/foo-other/index.ts", 'import "#modules/foo/index.js"; export default { dependencies: [] };');
      expect(await review()).toEqual({ investigated: false, observations: [] });

      const source = 'import "#modules/foo-other/index.js"; export default { dependencies: [] };';
      changeSource("src/modules/foo/index.ts", source);
      const changedImport = await review();
      expect(changedImport.investigated).toBe(true);
      expect(changedImport.observations.map((observation) => observation.kind)).toEqual(["undeclared-runtime-cross-module-import"]);
      expect((await review(targetScope === "module:foo" ? "./src/modules/foo/" : targetScope)).investigated).toBe(false);

      const clone = 'export function compute(value: number) { const next = value + 1; const doubled = next * 2; return doubled; }';
      changeSource("src/core/clone.ts", clone);
      changeSource("src/modules/foo/index.ts", `${source}\n${clone}`);
      const changedClone = await review();
      expect(changedClone.investigated).toBe(true);
      expect(changedClone.observations.find((observation) => observation.kind === "duplicated-implementation-chunk")?.evidence.sites)
        .toEqual(expect.arrayContaining([expect.objectContaining({ file: "src/modules/foo/index.ts" }), expect.objectContaining({ file: "src/core/clone.ts" })]));
      expect((await review()).investigated).toBe(false);
      expect(listFullRepoTasks(testWorkspace)).toEqual([]);
    },
  );

});
