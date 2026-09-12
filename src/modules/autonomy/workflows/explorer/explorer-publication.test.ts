import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("publishes exact source observations even when diagnostic keys are redacted", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "explorer-publication-"));
    scopeRoots.push(workspaceRoot);
    const authority = new RunStateDatabase(join(workspaceRoot, ".kota"));
    authority.registerScope({ id: deriveDirectoryScopeId(workspaceRoot), rootPath: workspaceRoot, createdAt: new Date().toISOString() });
    const sourceUrl = "https://example.com/authorization";
    const source = { checkedAt: new Date().toISOString(), fingerprint: "sha256:source" };
    authority.compareAndSetScopeStateValue({
      scopeId: deriveDirectoryScopeId(workspaceRoot), key: EXPLORER_STATE_KEY, expectedRevision: 0,
      updatedAt: new Date().toISOString(),
      value: { observedAt: null, lastExplorationAt: null, lastReviewedFingerprint: null, sources: { [sourceUrl]: source } },
    });
    authority.close();
    mkdirSync(join(workspaceRoot, "data"));
    writeFileSync(join(workspaceRoot, "data/watchlist.yaml"), `resources:\n  - url: ${sourceUrl}\n    added: 2026-09-01\n`);
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
        revision: 2,
        value: { observedAt: expect.any(String), lastExplorationAt: null, lastReviewedFingerprint: null, sources: {
          [sourceUrl]: source,
        } },
      });
      expect(database.listRuns(deriveDirectoryScopeId(workspaceRoot)).map((run) => run.workflow)).toEqual(["explorer"]);
    } finally {
      database.close();
    }
    expect(existsSync(join(stateDir, "explorer-state.json"))).toBe(false);
  });
});
