import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventJournal } from "./event-journal.js";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `kota-event-journal-pruned-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("EventJournal pruned references", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function trackTempDir(): string {
    const dir = makeTempDir();
    tempDirs.push(dir);
    return dir;
  }

  it("surfaces expired payloads as metadata-only pruned references", () => {
    const dir = trackTempDir();
    let now = new Date("2026-06-05T10:00:00.000Z");
    const journal = new EventJournal(dir, {
      now: () => now,
      retention: { kind: "expire-after-ms", durationMs: 10 },
      scopeLineage: (scopeId) => ["global", scopeId],
    });

    const envelope = journal.appendFromBusEnvelope({
      type: "workflow.completed",
      schemaRef: null,
      payload: {
        scopeId: "scope-a",
        workflow: "builder",
        runId: "builder-run",
        status: "success",
        receivedAt: "2026-06-05T10:00:00.000Z",
        rawPayload: { prompt: "do not retain" },
      },
    });

    now = new Date("2026-06-05T10:00:00.011Z");
    expect(journal.query({ id: envelope.id })).toEqual([]);
    const references = journal.queryPrunedReferences({ id: envelope.id });

    expect(references).toEqual([
      expect.objectContaining({
        artifactType: "event-envelope",
        id: envelope.id,
        payloadExpired: true,
        retained: expect.objectContaining({
          id: envelope.id,
          event: "workflow.completed",
          state: "active",
          scopeId: "scope-a",
          receivedAt: "2026-06-05T10:00:00.000Z",
        }),
        provenance: expect.objectContaining({
          workflowName: "builder",
          runId: "builder-run",
        }),
      }),
    ]);
    expect(JSON.stringify(references)).not.toContain("do not retain");
  });

  it("does not surface expired payloads whose retained policy excludes them from query", () => {
    const sourceDir = trackTempDir();
    const sourceJournal = new EventJournal(sourceDir, {
      now: () => new Date("2026-06-05T10:00:00.000Z"),
      retention: { kind: "expire-after-ms", durationMs: 10 },
      scopeLineage: (scopeId) => ["global", scopeId],
    });
    const envelope = sourceJournal.appendFromBusEnvelope({
      type: "workflow.completed",
      schemaRef: null,
      payload: {
        scopeId: "scope-a",
        workflow: "builder",
        runId: "builder-run",
        status: "success",
        receivedAt: "2026-06-05T10:00:00.000Z",
        rawPayload: { prompt: "must stay excluded" },
      },
    });
    const journal = new EventJournal(trackTempDir(), {
      now: () => new Date("2026-06-05T10:00:00.011Z"),
    });
    journal.appendEnvelope({
      ...envelope,
      retention: {
        kind: "expires",
        expiresAt: envelope.retention.kind === "expires"
          ? envelope.retention.expiresAt
          : "2026-06-05T10:00:00.010Z",
        expiredBehavior: "exclude-from-query",
      },
    });

    expect(journal.query({ id: envelope.id })).toEqual([]);
    expect(journal.queryPrunedReferences({ id: envelope.id })).toEqual([]);
  });
});
