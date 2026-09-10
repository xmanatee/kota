import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import {
  EXPLORER_PUBLICATION_ARTIFACT,
} from "./explorer-publication.js";
import { EXPLORER_STATE_KEY, type ExplorerState } from "./explorer-state.js";
import explorerWorkflow from "./workflow.js";

describe("explorer post-integration publication", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("publishes the canonical cooldown when the original writer completes", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "explorer-publication-"));
    scopeRoots.push(workspaceRoot);
    const authority = new RunStateDatabase(join(workspaceRoot, ".kota"));
    authority.registerScope({ id: deriveDirectoryScopeId(workspaceRoot), rootPath: workspaceRoot, createdAt: new Date().toISOString() });
    authority.close();
    writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n");
    execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: workspaceRoot,
    });
    execFileSync("git", ["config", "user.name", "KOTA test"], {
      cwd: workspaceRoot,
    });
    execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "scenario input"], {
      cwd: workspaceRoot,
    });
    const result = await new WorkflowScenarioDriver(explorerWorkflow, {
      workspaceRoot,
      trigger: { event: "autonomy.queue.empty", payload: {} },
      stepOutputs: {
        explore: "explored",
      },
      ports: {
        state: { stateDir: join(workspaceRoot, ".kota"), scopeId: deriveDirectoryScopeId(workspaceRoot) },
        runCommand: successfulWorkflowCommandRun,
      },
    }).run();

    expect(result.status, result.error).toBe("success");
    const stateDir = join(workspaceRoot, ".kota");
    const runDirPath = result.runDirPath;
    expect(existsSync(join(runDirPath, EXPLORER_PUBLICATION_ARTIFACT))).toBe(true);
    const database = new RunStateDatabase(stateDir);
    try {
      expect(database.readScopeStateValue<ExplorerState>(deriveDirectoryScopeId(workspaceRoot), EXPLORER_STATE_KEY)).toMatchObject({
        revision: 1,
        value: { observedAt: expect.any(String), lastExplorationAt: expect.any(String), lastReviewedFingerprint: expect.any(String), sources: {} },
      });
      expect(database.listRuns(deriveDirectoryScopeId(workspaceRoot)).map((run) => run.workflow)).toEqual(["explorer"]);
    } finally {
      database.close();
    }
    expect(existsSync(join(stateDir, "explorer-state.json"))).toBe(false);
  });
});
