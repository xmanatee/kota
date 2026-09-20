import { appendFileSync, closeSync, constants, fstatSync, lstatSync, openSync, readSync, renameSync, rmSync, unlinkSync, writeSync } from "node:fs";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { enumerateWorkflowRunMetadata, type StoredWorkflowRunMetadata, WorkflowRunMetadataAuthorityError, type WorkflowRunMetadataDiagnostic, type WorkflowRunMetadataEnumeration } from "#core/workflow/run-metadata.js";

type MetadataInput = {
  runsDir: string;
  authorityCriticalRunIds: string[];
  operationallyActiveRunIds: string[];
  terminalRunIds: string[];
};
export type LifecycleRunMetadata = Pick<StoredWorkflowRunMetadata, "id" | "workflow" | "startedAt" | "completedAt" | "status" | "durationMs"> & {
  trigger: Pick<StoredWorkflowRunMetadata["trigger"], "eventId">;
};
type MetadataOutput = { kind: "ok"; enumeration: { runs: LifecycleRunMetadata[]; diagnostics: WorkflowRunMetadataEnumeration["diagnostics"] } } |
  { kind: "invalid-authority"; diagnostic: WorkflowRunMetadataDiagnostic };

export const inspectRunMetadataOperation = defineWorkflowBlockingOperation<MetadataInput, MetadataOutput>(
  import.meta.url, "inspectRunMetadata",
);

/** Reuse the metadata owner's decoder and authority rules outside the control thread. */
export function inspectRunMetadata(input: MetadataInput): MetadataOutput {
  try {
    const enumeration = enumerateWorkflowRunMetadata(input.runsDir, {
      authorityCriticalRunIds: new Set(input.authorityCriticalRunIds),
      operationallyActiveRunIds: new Set(input.operationallyActiveRunIds),
      terminalRunIds: new Set(input.terminalRunIds),
    });
    return { kind: "ok", enumeration: { diagnostics: enumeration.diagnostics,
      runs: enumeration.runs.map(({ id, workflow, startedAt, completedAt, status, durationMs, trigger }) => ({
        id, workflow, startedAt, completedAt, status, durationMs, trigger: { eventId: trigger.eventId },
      })),
    } };
  } catch (error) {
    if (error instanceof WorkflowRunMetadataAuthorityError) {
      return { kind: "invalid-authority", diagnostic: error.diagnostic };
    }
    throw error;
  }
}

type JournalInput = { journalPath: string; nowMs: number; dryRun: boolean };
type PreparedJournal = {
  size: number;
  dev: number;
  ino: number;
  mtimeMs: number;
  expiredCount: number;
  reclaimedBytes: number;
  tempPath?: string;
};
export const prepareJournalOperation = defineWorkflowBlockingOperation<JournalInput, PreparedJournal | null>(
  import.meta.url, "prepareJournal",
);

/** Preparation cannot replace the live append-only journal. Commit belongs to the daemon. */
export function prepareJournal(input: JournalInput): PreparedJournal | null {
  const source = openSync(input.journalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output: number | undefined;
  let tempPath: string | undefined;
  let retainTemp = false;
  try {
    const stat = fstatSync(source);
    if (!stat.isFile()) return null;
    // Sweeps are serialized. Reuse one disposable preparation path so a daemon
    // crash cannot accumulate rewritten journal copies across restarts.
    if (!input.dryRun) rmSync(`${input.journalPath}.lifecycle.tmp`, { force: true });
    let expiredCount = 0;
    let reclaimedBytes = 0;
    let processedBytes = 0;
    const consume = (line: Buffer): void => {
      let expired = false;
      try {
        const event: { retention?: { kind?: string; durationMs?: number }; timestamps?: { journaledAt?: string } } = JSON.parse(line.toString("utf8"));
        if (event.retention?.kind === "expire-after-ms" && typeof event.retention.durationMs === "number" &&
            event.timestamps?.journaledAt && Date.parse(event.timestamps.journaledAt) + event.retention.durationMs <= input.nowMs) {
          expired = true;
        }
      } catch { /* Malformed evidence stays byte-for-byte inspectable. */ }
      if (expired) {
        // Healthy journals need inspection, but no rewritten copy. Materialize
        // the retained prefix only when there is actually something to expire.
        if (!input.dryRun && output === undefined) {
          tempPath = `${input.journalPath}.lifecycle.tmp`;
          output = openSync(tempPath, "wx", 0o600);
          const prefix = Buffer.alloc(64 * 1024);
          for (let offset = 0; offset < processedBytes;) {
            const bytes = readSync(source, prefix, 0, Math.min(prefix.length, processedBytes - offset), offset);
            if (!bytes) throw new Error("Journal shrank during lifecycle preparation");
            writeSync(output, prefix.subarray(0, bytes));
            offset += bytes;
          }
        }
        expiredCount++;
        reclaimedBytes += line.length;
      } else if (output !== undefined) writeSync(output, line);
      processedBytes += line.length;
    };
    // Bound memory by a journal record rather than the entire history. Pin the
    // source length so appends during preparation remain the commit owner's tail.
    const buffer = Buffer.alloc(64 * 1024);
    let pending: Buffer = Buffer.alloc(0);
    let offset = 0;
    while (offset < stat.size) {
      const bytes = readSync(source, buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
      if (!bytes) return null;
      offset += bytes;
      const chunk = Buffer.concat([pending, buffer.subarray(0, bytes)]);
      let start = 0;
      for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
        consume(chunk.subarray(start, end + 1));
        start = end + 1;
      }
      pending = chunk.subarray(start);
    }
    // An incomplete last append is retained without interpreting it.
    if (pending.length && output !== undefined) writeSync(output, pending);
    const current = lstatSync(input.journalPath, { throwIfNoEntry: false });
    if (!current?.isFile() || current.ino !== stat.ino || current.dev !== stat.dev || current.size < stat.size) return null;
    retainTemp = expiredCount > 0 && tempPath !== undefined;
    return { size: stat.size, dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs,
      expiredCount, reclaimedBytes, ...(retainTemp ? { tempPath } : {}) };
  } finally {
    closeSync(source);
    if (output !== undefined) closeSync(output);
    if (tempPath && !retainTemp) unlinkSync(tempPath);
  }
}

/** Bounded, synchronous handoff: preserve concurrent appends without yielding before rename. */
export function commitJournal(path: string, prepared: PreparedJournal): boolean {
  if (!prepared.tempPath) return false;
  const current = lstatSync(path, { throwIfNoEntry: false });
  if (!current?.isFile() || current.ino !== prepared.ino || current.dev !== prepared.dev || current.size < prepared.size) return false;
  const tailSize = current.size - prepared.size;
  // A busy journal can wait for the next normal sweep instead of blocking control.
  if (tailSize > 64 * 1024 || (tailSize === 0 && current.mtimeMs !== prepared.mtimeMs)) return false;
  if (tailSize > 0) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (fstatSync(fd).ino !== prepared.ino) return false;
      const tail = Buffer.alloc(tailSize);
      if (readSync(fd, tail, 0, tailSize, prepared.size) !== tailSize) return false;
      appendFileSync(prepared.tempPath, tail);
    } finally { closeSync(fd); }
  }
  renameSync(prepared.tempPath, path);
  return true;
}
