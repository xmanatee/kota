import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import explorerPublicationWorkflow from "../explorer-publication/workflow.js";
import {
  EXPLORER_PUBLICATION_ARTIFACT,
  EXPLORER_PUBLICATION_REQUESTED_EVENT,
  explorerPublicationKey,
  publishExplorerCompletion,
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

  it("does not advance the canonical cooldown from the writer run", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "explorer-publication-"));
    scopeRoots.push(workspaceRoot);
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
    const state = createTestTransactionalRunState();
    const result = await new WorkflowScenarioDriver(explorerWorkflow, {
      workspaceRoot,
      trigger: { event: "autonomy.queue.empty", payload: {} },
      stepOutputs: {
        explore: "explored",
      },
      ports: { state, runCommand: successfulWorkflowCommandRun },
    }).run();

    expect(result.status).toBe("success");
    const stateDir = join(workspaceRoot, ".kota");
    const runDirPath = result.runDirPath;
    const sourceRunId = basename(runDirPath);
    expect(state.read<ExplorerState>(EXPLORER_STATE_KEY)).toEqual({
      revision: 0,
      value: null,
    });
    expect(existsSync(join(runDirPath, EXPLORER_PUBLICATION_ARTIFACT))).toBe(true);
    expect(publishExplorerCompletion({ sourceRunId, scopeRoot: workspaceRoot }))
      .toEqual({ lastExplorationAt: expect.any(String) });

    const publicationKey = explorerPublicationKey(sourceRunId);
    const publication = await new WorkflowScenarioDriver(
      explorerPublicationWorkflow,
      {
        workspaceRoot,
        trigger: {
          event: EXPLORER_PUBLICATION_REQUESTED_EVENT,
          schemaRef: null,
          payload: { publicationKey, sourceRunId },
        },
        ports: { state },
      },
    ).run();
    expect(publication.status).toBe("success");
    expect(state.read<ExplorerState>(EXPLORER_STATE_KEY)).toMatchObject({
      revision: 1,
      value: { lastExplorationAt: expect.any(String) },
    });
    expect(existsSync(join(stateDir, "explorer-state.json"))).toBe(false);
  });
});
