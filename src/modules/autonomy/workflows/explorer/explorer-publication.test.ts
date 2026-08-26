import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
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
    const state = createTestTransactionalRunState();
    const result = await new WorkflowTestHarness(explorerWorkflow, {
      workspaceRoot,
      trigger: { event: "autonomy.queue.empty", payload: {} },
      stepMocks: {
        "inspect-queue": {
          counts: { inbox: 0, backlog: 0, ready: 0, doing: 0, blocked: 0 },
          inboxCount: 0,
          openCount: 0,
          pullableCount: 0,
          actionableCount: 0,
          promotableBacklogCount: 0,
          dispatchableCount: 0,
          hasDispatchableWork: false,
          dirty: false,
          needsAttention: true,
          explorationRefreshDue: true,
          strategicReadyCoverageGap: false,
          strategicBlockedAlternatives: [],
        },
        "inspect-watchlist": { entries: [], updateReportPath: "watchlist-updates.json" },
        explore: "explored",
      },
      contextOverrides: { state },
    }).run();

    expect(result.status).toBe("success");
    const stateDir = join(workspaceRoot, ".kota");
    const runDirPath = join(stateDir, "runs", "harness");
    expect(state.read<ExplorerState>(EXPLORER_STATE_KEY)).toEqual({
      revision: 0,
      value: null,
    });
    expect(existsSync(join(runDirPath, EXPLORER_PUBLICATION_ARTIFACT))).toBe(true);
    expect(publishExplorerCompletion({ sourceRunId: "harness", scopeRoot: workspaceRoot }))
      .toEqual({ lastExplorationAt: expect.any(String) });

    const publicationKey = explorerPublicationKey("harness");
    const publication = await new WorkflowTestHarness(
      explorerPublicationWorkflow,
      {
        workspaceRoot,
        trigger: {
          event: EXPLORER_PUBLICATION_REQUESTED_EVENT,
          schemaRef: null,
          payload: { publicationKey, sourceRunId: "harness" },
        },
        contextOverrides: { state },
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
