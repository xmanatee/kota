import { appendFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { commitJournal, prepareJournalOperation } from "./lifecycle-collector-io.js";

it("compacts through the worker without losing appends, malformed evidence, or a replacement journal", async () => {
  const root = mkdtempSync(join(tmpdir(), "lifecycle-journal-"));
  const path = join(root, "journal.jsonl");
  const expired = `${JSON.stringify({ retention: { kind: "expire-after-ms", durationMs: 1 }, timestamps: { journaledAt: "2026-01-01" } })}\n`;
  const retained = '{"message":"retained é🦆"}\ninvalid original bytes\n';
  try {
    writeFileSync(path, retained + expired + retained);
    const dryRun = await runWorkflowBlockingOperation(prepareJournalOperation, { journalPath: path, nowMs: Date.now(), dryRun: true });
    expect(dryRun).toMatchObject({ expiredCount: 1, reclaimedBytes: Buffer.byteLength(expired) });
    expect(dryRun?.tempPath).toBeUndefined();
    expect(readFileSync(path, "utf8")).toBe(retained + expired + retained);
    const prepared = await runWorkflowBlockingOperation(prepareJournalOperation, { journalPath: path, nowMs: Date.now(), dryRun: false });
    expect(prepared?.tempPath).toBeDefined();
    const tail = '{"message":"concurrent append"}\n';
    appendFileSync(path, tail);
    expect(commitJournal(path, prepared!)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(retained + retained + tail);
    expect(existsSync(prepared!.tempPath!)).toBe(false);
    const healthy = await runWorkflowBlockingOperation(prepareJournalOperation, { journalPath: path, nowMs: Date.now(), dryRun: false });
    expect(healthy).toMatchObject({ expiredCount: 0 });
    expect(healthy?.tempPath).toBeUndefined();

    writeFileSync(path, expired + retained);
    const stale = await runWorkflowBlockingOperation(prepareJournalOperation, { journalPath: path, nowMs: Date.now(), dryRun: false });
    renameSync(path, join(root, "rotated.jsonl"));
    writeFileSync(path, tail);
    expect(commitJournal(path, stale!)).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(tail);

    // An incomplete append must not be interpreted or rewritten.
    writeFileSync(path, `${expired}{"partial":`);
    const partial = await runWorkflowBlockingOperation(prepareJournalOperation, { journalPath: path, nowMs: Date.now(), dryRun: false });
    appendFileSync(path, 'true}\n');
    expect(commitJournal(path, partial!)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe('{"partial":true}\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
