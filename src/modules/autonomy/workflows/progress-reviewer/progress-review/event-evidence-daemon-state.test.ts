import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveDirectoryScopeId,
  GLOBAL_SCOPE_ID,
  ScopeRegistry,
} from "#core/daemon/scope-registry.js";
import { EventJournal } from "#core/events/event-journal.js";
import { collectProgressReviewEvidence } from "../progress-review.js";
import {
  appendJournalEvent,
  batchPayload,
  cleanupTempDirs,
  collectFromBatch,
  DROPPED_AT,
  makeProjectDir,
  makeStateDir,
  NOW,
} from "./event-evidence-test-support.js";

describe("progress-review daemon state evidence", () => {
  afterEach(() => {
    cleanupTempDirs();
  });

  it("backfills from the daemon stateDir journal when project-local journal is absent", () => {
    const projectDir = makeProjectDir("progress-reviewer-daemon-journal");
    const stateDir = makeStateDir("progress-reviewer-daemon-journal");
    const scopeId = deriveDirectoryScopeId(projectDir);
    const droppedEnvelope = appendJournalEvent({
      projectDir,
      stateDir,
      event: "workflow.completed",
      receivedAt: DROPPED_AT,
      payload: {
        scopeId,
        projectId: scopeId,
        workflow: "builder",
        runId: "state-dir-builder-run",
        status: "success",
      },
    });

    const evidence = collectFromBatch(
      projectDir,
      batchPayload({ projectDir }),
      {
        stateDir,
        eventJournal: new EventJournal(join(stateDir, "events")),
      },
    );

    expect(evidence.batch).toEqual(
      expect.objectContaining({
        droppedInputCount: 1,
        journalBackfillCount: 1,
      }),
    );
    expect(evidence.events).toEqual([
      expect.objectContaining({
        id: `event:${droppedEnvelope.id}`,
        source: "journal",
        journalId: droppedEnvelope.id,
      }),
    ]);
    expect(evidence.excluded.join("\n")).not.toContain(
      join(projectDir, ".kota", "events"),
    );
  });

  it("loads global scope configuration from the daemon stateDir", () => {
    const projectA = makeProjectDir("progress-reviewer-global-state-a");
    const projectB = makeProjectDir("progress-reviewer-global-state-b");
    const stateDir = makeStateDir("progress-reviewer-global-state");
    const scopeA = deriveDirectoryScopeId(projectA);
    const scopeB = deriveDirectoryScopeId(projectB);
    new ScopeRegistry({
      stateDir,
      projects: [
        { projectDir: projectA, displayName: "scope a" },
        { projectDir: projectB, displayName: "scope b" },
      ],
    });

    const evidence = collectProgressReviewEvidence({
      projectDir: projectA,
      stateDir,
      trigger: {
        event: "autonomy.progress-review.requested",
        schemaRef: null,
        payload: {
          scopeId: GLOBAL_SCOPE_ID,
          projectId: GLOBAL_SCOPE_ID,
        },
      },
      now: NOW,
    });

    expect(evidence.scope.scopeId).toBe(GLOBAL_SCOPE_ID);
    expect(evidence.scopes.map((scope) => scope.scope.scopeId)).toEqual([
      scopeA,
      scopeB,
    ]);
  });
});
