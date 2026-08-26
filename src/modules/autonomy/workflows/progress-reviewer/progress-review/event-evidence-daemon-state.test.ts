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
  makeScopeRoot,
  makeStateDir,
  NOW,
} from "./event-evidence-test-support.js";

describe("progress-review daemon state evidence", () => {
  afterEach(() => {
    cleanupTempDirs();
  });

  it("backfills from the daemon stateDir journal when the scope-local journal is absent", () => {
    const workspaceRoot = makeScopeRoot("progress-reviewer-daemon-journal");
    const stateDir = makeStateDir("progress-reviewer-daemon-journal");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const droppedEnvelope = appendJournalEvent({
      workspaceRoot,
      stateDir,
      event: "workflow.completed",
      receivedAt: DROPPED_AT,
      payload: {
        scopeId,
        workflow: "builder",
        runId: "state-dir-builder-run",
        status: "success",
      },
    });

    const evidence = collectFromBatch(
      workspaceRoot,
      batchPayload({ workspaceRoot }),
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
      join(workspaceRoot, ".kota", "events"),
    );
  });

  it("loads global scope configuration from the daemon stateDir", () => {
    const scopeARoot = makeScopeRoot("progress-reviewer-global-state-a");
    const scopeBRoot = makeScopeRoot("progress-reviewer-global-state-b");
    const stateDir = makeStateDir("progress-reviewer-global-state");
    const scopeAId = deriveDirectoryScopeId(scopeARoot);
    const scopeBId = deriveDirectoryScopeId(scopeBRoot);
    new ScopeRegistry({
      stateDir,
      scopes: [
        { scopeRoot: scopeARoot, displayName: "scope a" },
        { scopeRoot: scopeBRoot, displayName: "scope b" },
      ],
    });

    const evidence = collectProgressReviewEvidence({
      workspaceRoot: scopeARoot,
      scopeRoot: scopeARoot,
      stateDir,
      trigger: {
        event: "autonomy.progress-review.requested",
        schemaRef: null,
        payload: {
          scopeId: GLOBAL_SCOPE_ID,
        },
      },
      now: NOW,
    });

    expect(evidence.scope.scopeId).toBe(GLOBAL_SCOPE_ID);
    expect(evidence.scopes.map((scope) => scope.scope.scopeId)).toEqual([
      scopeAId,
      scopeBId,
    ]);
  });
});
