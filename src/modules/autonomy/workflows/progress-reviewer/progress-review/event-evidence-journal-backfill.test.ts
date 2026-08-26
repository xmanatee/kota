import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import {
  appendJournalEvent,
  batchPayload,
  cleanupTempDirs,
  collectFromBatch,
  DROPPED_AT,
  LIVE_AT,
  makeScopeRoot,
  reviewBatchCases,
} from "./event-evidence-test-support.js";

describe("progress-review event journal evidence", () => {
  afterEach(() => {
    cleanupTempDirs();
  });

  it("backfills dropped run, task, and message batch context from the journal", () => {
    const workspaceRoot = makeScopeRoot("progress-reviewer-journal-backfill");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);

    for (const item of reviewBatchCases(scopeId)) {
      const droppedEnvelope = appendJournalEvent({
        workspaceRoot,
        event: item.sourceEventName,
        receivedAt: DROPPED_AT,
        payload: item.droppedPayload,
      });
      const liveEnvelope = appendJournalEvent({
        workspaceRoot,
        event: item.sourceEventName,
        receivedAt: LIVE_AT,
        payload: item.livePayload,
      });
      const evidence = collectFromBatch(
        workspaceRoot,
        batchPayload({
          workspaceRoot,
          sourceEventName: item.sourceEventName,
          triggerIndex: item.triggerIndex,
          liveEnvelope,
          livePayload: item.livePayload,
        }),
      );

      expect(evidence.batch).toEqual(
        expect.objectContaining({
          sourceEventName: item.sourceEventName,
          inputEventCount: 1,
          droppedInputCount: 1,
          journalBackfillCount: 1,
        }),
      );
      expect(evidence.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `event:${liveEnvelope.id}`,
            source: "batch",
            journalId: liveEnvelope.id,
          }),
          expect.objectContaining({
            id: `event:${droppedEnvelope.id}`,
            source: "journal",
            journalId: droppedEnvelope.id,
          }),
        ]),
      );
      expect(evidence.evidence.map((entry) => entry.id)).toEqual(
        expect.arrayContaining([
          `event:${liveEnvelope.id}`,
          `event:${droppedEnvelope.id}`,
        ]),
      );
      expect(evidence.excluded.join("\n")).not.toContain("event journal:");
      const recovered = evidence.events.find(
        (event) => event.journalId === droppedEnvelope.id,
      );
      expect(recovered?.summary).toContain(`journal ${droppedEnvelope.id}`);
      if (item.rawSecret !== undefined) {
        expect(recovered?.summary).not.toContain(item.rawSecret);
      }
    }
  });

  it("records explicit exclusions when dropped inputs cannot be backfilled", () => {
    const missingProject = makeScopeRoot("progress-reviewer-missing-journal");
    const missingEvidence = collectFromBatch(missingProject, batchPayload({
      workspaceRoot: missingProject,
    }));

    expect(missingEvidence.events).toHaveLength(0);
    expect(missingEvidence.batch).toEqual(
      expect.objectContaining({
        inputEventCount: 0,
        droppedInputCount: 1,
        journalBackfillCount: 0,
      }),
    );
    expect(missingEvidence.excluded).toEqual(
      expect.arrayContaining([expect.stringContaining("event journal: missing")]),
    );

    const expiredProject = makeScopeRoot("progress-reviewer-expired-journal");
    const expiredScopeId = deriveDirectoryScopeId(expiredProject);
    appendJournalEvent({
      workspaceRoot: expiredProject,
      event: "workflow.completed",
      receivedAt: "2026-06-04T11:55:00.000Z",
      payload: {
        scopeId: expiredScopeId,
        workflow: "builder",
        runId: "expired-builder-run",
        status: "success",
      },
      retention: { kind: "expire-after-ms", durationMs: 1 },
    });
    const expiredEvidence = collectFromBatch(expiredProject, batchPayload({
      workspaceRoot: expiredProject,
    }));

    expect(expiredEvidence.events).toEqual([
      expect.objectContaining({
        id: "event:evtj-000000000001",
        source: "journal",
        journalId: "evtj-000000000001",
        payloadSummary: "policy-pruned-payload",
        pruned: expect.objectContaining({
          reasonCode: "policy-pruned-payload",
          artifactType: "event-envelope",
          id: "evtj-000000000001",
          retained: expect.objectContaining({
            event: "workflow.completed",
            scopeId: expiredScopeId,
          }),
        }),
      }),
    ]);
    expect(expiredEvidence.batch?.journalBackfillCount).toBe(1);
    expect(expiredEvidence.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining("policy-pruned workflow.completed metadata-only reference"),
      ]),
    );
  });
});
