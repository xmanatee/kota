import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluatePredicate, evaluatePredicates } from "./predicates.js";

describe("evaluatePredicate", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "kota-eval-harness-predicates-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("file-exists passes when the file is present and fails when it is missing", () => {
    writeFileSync(join(workDir, "present.txt"), "hi");
    const ok = evaluatePredicate(workDir, { kind: "file-exists", path: "present.txt" });
    const missing = evaluatePredicate(workDir, { kind: "file-exists", path: "absent.txt" });
    expect(ok.passed).toBe(true);
    expect(missing.passed).toBe(false);
  });

  it("file-absent inverts file-exists", () => {
    writeFileSync(join(workDir, "present.txt"), "hi");
    const ok = evaluatePredicate(workDir, { kind: "file-absent", path: "absent.txt" });
    const bad = evaluatePredicate(workDir, { kind: "file-absent", path: "present.txt" });
    expect(ok.passed).toBe(true);
    expect(bad.passed).toBe(false);
  });

  it("file-contains checks substring presence and handles missing files as failures", () => {
    writeFileSync(join(workDir, "sample.txt"), "hello world");
    const ok = evaluatePredicate(workDir, {
      kind: "file-contains",
      path: "sample.txt",
      needle: "world",
    });
    const missingNeedle = evaluatePredicate(workDir, {
      kind: "file-contains",
      path: "sample.txt",
      needle: "nope",
    });
    const missingFile = evaluatePredicate(workDir, {
      kind: "file-contains",
      path: "absent.txt",
      needle: "anything",
    });
    expect(ok.passed).toBe(true);
    expect(missingNeedle.passed).toBe(false);
    expect(missingFile.passed).toBe(false);
    expect(missingFile.detail).toContain("file missing");
  });

  it("shell-succeeds passes on exit 0 and fails on non-zero", () => {
    const ok = evaluatePredicate(workDir, {
      kind: "shell-succeeds",
      command: "true",
    });
    const bad = evaluatePredicate(workDir, {
      kind: "shell-succeeds",
      command: "false",
    });
    expect(ok.passed).toBe(true);
    expect(bad.passed).toBe(false);
  });

  it("shell-fails inverts shell-succeeds", () => {
    const ok = evaluatePredicate(workDir, {
      kind: "shell-fails",
      command: "false",
    });
    const bad = evaluatePredicate(workDir, {
      kind: "shell-fails",
      command: "true",
    });
    expect(ok.passed).toBe(true);
    expect(bad.passed).toBe(false);
  });

  it("evaluatePredicates passes only when every predicate passes", () => {
    writeFileSync(join(workDir, "file.txt"), "content");
    const { passed, results } = evaluatePredicates(workDir, [
      { kind: "file-exists", path: "file.txt" },
      { kind: "file-contains", path: "file.txt", needle: "cont" },
    ]);
    expect(passed).toBe(true);
    expect(results).toHaveLength(2);

    const mixed = evaluatePredicates(workDir, [
      { kind: "file-exists", path: "file.txt" },
      { kind: "file-exists", path: "missing.txt" },
    ]);
    expect(mixed.passed).toBe(false);
    expect(mixed.results.find((r) => !r.passed)?.detail).toContain("file missing");
  });

  it("rejects non-positive timeouts rather than silently using a default", () => {
    expect(() =>
      evaluatePredicate(workDir, {
        kind: "shell-succeeds",
        command: "true",
        timeoutMs: 0,
      }),
    ).toThrow(/timeoutMs must be positive/);
  });

  it("file-contains handles nested paths and directories with mkdir", () => {
    mkdirSync(join(workDir, "sub"), { recursive: true });
    writeFileSync(join(workDir, "sub", "nested.txt"), "deep");
    const ok = evaluatePredicate(workDir, {
      kind: "file-contains",
      path: "sub/nested.txt",
      needle: "deep",
    });
    expect(ok.passed).toBe(true);
  });
});

describe("evaluatePredicate — emitted-events predicates", () => {
  let workDir: string;

  function seedRunWithEvents(
    runId: string,
    entries: Array<{ event: string; payload: Record<string, unknown> }>,
  ): void {
    const runDir = join(workDir, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    const lines = entries.map((e) =>
      JSON.stringify({
        event: e.event,
        payload: e.payload,
        emittedAt: "2026-04-24T00:00:00.000Z",
      }),
    );
    writeFileSync(
      join(runDir, "emitted-events.jsonl"),
      lines.length > 0 ? `${lines.join("\n")}\n` : "",
    );
  }

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "kota-eval-harness-emit-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("run-emits-event passes when the event was emitted, fails when absent", () => {
    seedRunWithEvents("2026-04-24T00-00-00-000Z-dispatcher-abcd12", [
      { event: "autonomy.queue.available", payload: { pullableCount: 1 } },
      { event: "autonomy.queue.thin", payload: { pullableCount: 1 } },
    ]);
    const ok = evaluatePredicate(workDir, {
      kind: "run-emits-event",
      event: "autonomy.queue.available",
    });
    const missing = evaluatePredicate(workDir, {
      kind: "run-emits-event",
      event: "autonomy.queue.empty",
    });
    expect(ok.passed).toBe(true);
    expect(missing.passed).toBe(false);
    expect(missing.detail).toContain("no emitted");
  });

  it("run-emits-event honors a workflow filter", () => {
    seedRunWithEvents("2026-04-24T00-00-00-000Z-dispatcher-aaaa11", [
      { event: "autonomy.queue.available", payload: { pullableCount: 1 } },
    ]);
    seedRunWithEvents("2026-04-24T00-00-01-000Z-explorer-bbbb22", [
      { event: "autonomy.queue.available", payload: { pullableCount: 99 } },
    ]);
    const dispatcherOnly = evaluatePredicate(workDir, {
      kind: "run-emits-event",
      event: "autonomy.queue.available",
      workflow: "dispatcher",
      payloadMatch: { pullableCount: 1 },
    });
    const explorerOnly = evaluatePredicate(workDir, {
      kind: "run-emits-event",
      event: "autonomy.queue.available",
      workflow: "explorer",
      payloadMatch: { pullableCount: 99 },
    });
    const explorerWithWrongPayload = evaluatePredicate(workDir, {
      kind: "run-emits-event",
      event: "autonomy.queue.available",
      workflow: "explorer",
      payloadMatch: { pullableCount: 1 },
    });
    expect(dispatcherOnly.passed).toBe(true);
    expect(explorerOnly.passed).toBe(true);
    expect(explorerWithWrongPayload.passed).toBe(false);
  });

  it("run-emits-event payloadMatch walks nested structures", () => {
    seedRunWithEvents("2026-04-24T00-00-00-000Z-dispatcher-cccc33", [
      {
        event: "autonomy.queue.available",
        payload: {
          pullableCount: 1,
          counts: { ready: 1, doing: 0, backlog: 0 },
        },
      },
    ]);
    const deepMatch = evaluatePredicate(workDir, {
      kind: "run-emits-event",
      event: "autonomy.queue.available",
      payloadMatch: { counts: { ready: 1 } },
    });
    const deepMismatch = evaluatePredicate(workDir, {
      kind: "run-emits-event",
      event: "autonomy.queue.available",
      payloadMatch: { counts: { ready: 99 } },
    });
    expect(deepMatch.passed).toBe(true);
    expect(deepMismatch.passed).toBe(false);
  });

  it("run-omits-event passes when the event never fired, fails when it did", () => {
    seedRunWithEvents("2026-04-24T00-00-00-000Z-dispatcher-dddd44", [
      { event: "autonomy.queue.available", payload: { pullableCount: 1 } },
    ]);
    const ok = evaluatePredicate(workDir, {
      kind: "run-omits-event",
      event: "autonomy.queue.empty",
    });
    const bad = evaluatePredicate(workDir, {
      kind: "run-omits-event",
      event: "autonomy.queue.available",
    });
    expect(ok.passed).toBe(true);
    expect(bad.passed).toBe(false);
    expect(bad.detail).toContain("expected");
  });

  it("run-omits-event passes when no runs directory exists yet", () => {
    const result = evaluatePredicate(workDir, {
      kind: "run-omits-event",
      event: "autonomy.queue.empty",
    });
    expect(result.passed).toBe(true);
  });

  it("run-emits-event fails loudly on a malformed event log", () => {
    const runDir = join(workDir, ".kota", "runs", "2026-04-24T00-00-00-000Z-dispatcher-eeee55");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "emitted-events.jsonl"), "{not json}\n");
    expect(() =>
      evaluatePredicate(workDir, {
        kind: "run-emits-event",
        event: "whatever",
      }),
    ).toThrow();
  });
});
