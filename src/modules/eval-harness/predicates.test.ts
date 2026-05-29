import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  evaluatePredicate,
  evaluatePredicateExpectations,
  evaluatePredicates,
} from "./predicates.js";

describe("evaluatePredicate", () => {
  let workDir: string;

  function runGit(args: string[]): void {
    const result = spawnSync("git", args, {
      cwd: workDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(
      result.status,
      `git ${args.join(" ")} failed: ${result.stdout}\n${result.stderr}`,
    ).toBe(0);
  }

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

  it("evaluatePredicateExpectations accepts both initially true invariants and initially false outcome predicates", () => {
    writeFileSync(join(workDir, "seed.txt"), "seed");
    const { passed, results } = evaluatePredicateExpectations(workDir, [
      { predicate: { kind: "file-exists", path: "seed.txt" }, expected: "pass" },
      { predicate: { kind: "file-exists", path: "output.txt" }, expected: "fail" },
    ]);
    expect(passed).toBe(true);
    expect(results.map((r) => r.actual)).toEqual(["pass", "fail"]);
    expect(results.every((r) => r.passed)).toBe(true);

    const mismatch = evaluatePredicateExpectations(workDir, [
      { predicate: { kind: "file-exists", path: "seed.txt" }, expected: "fail" },
    ]);
    expect(mismatch.passed).toBe(false);
    expect(mismatch.results[0].detail).toContain("did not match expected");
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

  it("git-changes-within fails when committed or working-tree paths leave the allowed set", () => {
    runGit(["init", "--quiet", "--initial-branch=main"]);
    runGit(["config", "user.email", "eval-harness@kota.local"]);
    runGit(["config", "user.name", "KOTA Eval Harness"]);
    runGit(["config", "commit.gpgsign", "false"]);
    mkdirSync(join(workDir, "data"), { recursive: true });
    writeFileSync(join(workDir, "data", "seed.txt"), "seed\n");
    runGit(["add", "-A"]);
    runGit(["commit", "-m", "initial", "--quiet"]);

    writeFileSync(join(workDir, "data", "allowed.txt"), "allowed\n");
    runGit(["add", "data/allowed.txt"]);
    runGit(["commit", "-m", "allowed change", "--quiet"]);
    mkdirSync(join(workDir, ".kota", "runs", "run-1"), { recursive: true });
    writeFileSync(join(workDir, ".kota", "runs", "run-1", "metadata.json"), "{}");

    const allowed = evaluatePredicate(workDir, {
      kind: "git-changes-within",
      allowedPaths: ["data/allowed.txt"],
    });
    expect(allowed.passed).toBe(true);

    writeFileSync(join(workDir, "data", "forbidden.txt"), "forbidden\n");
    const forbidden = evaluatePredicate(workDir, {
      kind: "git-changes-within",
      allowedPaths: ["data/allowed.txt"],
    });
    expect(forbidden.passed).toBe(false);
    expect(forbidden.detail).toContain("data/forbidden.txt");
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

describe("evaluatePredicate — external-call-log predicate", () => {
  let workDir: string;

  function seedExternalCallLog(
    binary: string,
    entries: Array<{ binary?: string; argv: string[]; exitCode?: number }>,
  ): void {
    const dir = join(workDir, ".kota", "external-calls");
    mkdirSync(dir, { recursive: true });
    const lines = entries.map((e) =>
      JSON.stringify({
        binary: e.binary ?? binary,
        argv: e.argv,
        exitCode: e.exitCode ?? 0,
        timestamp: "2026-04-25T00:00:00.000Z",
      }),
    );
    writeFileSync(
      join(dir, `${binary}.jsonl`),
      lines.length > 0 ? `${lines.join("\n")}\n` : "",
    );
  }

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "kota-eval-harness-extcall-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("argv-equals matches the exact recorded argv", () => {
    seedExternalCallLog("gh", [
      { argv: ["pr", "review", "42", "--approve", "--body", "LGTM"] },
    ]);
    const ok = evaluatePredicate(workDir, {
      kind: "external-call-log",
      binary: "gh",
      match: {
        kind: "argv-equals",
        argv: ["pr", "review", "42", "--approve", "--body", "LGTM"],
      },
    });
    expect(ok.passed).toBe(true);
  });

  it("argv-prefix matches when invocation starts with the expected tokens", () => {
    seedExternalCallLog("gh", [
      { argv: ["pr", "review", "42", "--approve"] },
    ]);
    const ok = evaluatePredicate(workDir, {
      kind: "external-call-log",
      binary: "gh",
      match: { kind: "argv-prefix", argv: ["pr", "review"] },
    });
    expect(ok.passed).toBe(true);
  });

  it("argv-includes matches when a specific token appears anywhere in argv", () => {
    seedExternalCallLog("gh", [
      { argv: ["pr", "review", "42", "--body", "Looks good"] },
    ]);
    const ok = evaluatePredicate(workDir, {
      kind: "external-call-log",
      binary: "gh",
      match: { kind: "argv-includes", arg: "--body" },
    });
    expect(ok.passed).toBe(true);
  });

  it("fails when the binary was never invoked (log file missing)", () => {
    const result = evaluatePredicate(workDir, {
      kind: "external-call-log",
      binary: "gh",
      match: { kind: "argv-prefix", argv: ["pr", "review"] },
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("never invoked");
  });

  it("fails when the binary was invoked but argv shape mismatches", () => {
    seedExternalCallLog("gh", [
      { argv: ["repo", "view", "owner/repo"] },
    ]);
    const result = evaluatePredicate(workDir, {
      kind: "external-call-log",
      binary: "gh",
      match: { kind: "argv-prefix", argv: ["pr", "review"] },
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("none match");
    expect(result.detail).toContain("repo");
  });

  it("fails when argv matches but exit-code class does not", () => {
    seedExternalCallLog("gh", [
      { argv: ["pr", "review", "42", "--approve"], exitCode: 0 },
    ]);
    const result = evaluatePredicate(workDir, {
      kind: "external-call-log",
      binary: "gh",
      match: { kind: "argv-prefix", argv: ["pr", "review"] },
      exitClass: "non-zero",
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("exitClass=non-zero");
  });

  it("passes when argv matches and exit-code class matches", () => {
    seedExternalCallLog("gh", [
      { argv: ["pr", "review", "42"], exitCode: 0 },
    ]);
    const result = evaluatePredicate(workDir, {
      kind: "external-call-log",
      binary: "gh",
      match: { kind: "argv-prefix", argv: ["pr", "review"] },
      exitClass: "zero",
    });
    expect(result.passed).toBe(true);
  });

  it("ignores entries from other binaries even if the log was tampered with", () => {
    seedExternalCallLog("gh", [
      { binary: "git", argv: ["status"] },
    ]);
    const result = evaluatePredicate(workDir, {
      kind: "external-call-log",
      binary: "gh",
      match: { kind: "argv-prefix", argv: ["pr", "review"] },
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("never invoked");
  });

  it("fails loudly when the log is malformed", () => {
    const dir = join(workDir, ".kota", "external-calls");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "gh.jsonl"), "{not json}\n");
    expect(() =>
      evaluatePredicate(workDir, {
        kind: "external-call-log",
        binary: "gh",
        match: { kind: "argv-prefix", argv: ["pr"] },
      }),
    ).toThrow();
  });
});

describe("evaluatePredicate — environment-state-audit predicate", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "kota-eval-harness-state-audit-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("passes when expected local effects match exact counts and forbidden effects are absent", () => {
    mkdirSync(join(workDir, "state"), { recursive: true });
    writeFileSync(
      join(workDir, "state", "messages.json"),
      JSON.stringify([
        {
          kind: "message",
          id: "msg-1",
          account: "fixture",
          payload: { subject: "hello", unread: true },
        },
      ]),
    );
    writeFileSync(
      join(workDir, "state", "ledger.jsonl"),
      [
        JSON.stringify({
          kind: "task-ledger",
          taskId: "task-1",
          status: "done",
          metadata: { actor: "workflow" },
        }),
        "",
      ].join("\n"),
    );

    const result = evaluatePredicate(workDir, {
      kind: "environment-state-audit",
      files: [
        {
          path: "state/messages.json",
          format: "json-array",
          expectedEffects: [
            {
              match: { kind: "message", payload: { subject: "hello" } },
              count: 1,
            },
          ],
          forbiddenEffects: [
            { match: { kind: "message", account: "operator-real-account" } },
          ],
        },
        {
          path: "state/ledger.jsonl",
          format: "jsonl",
          expectedEffects: [
            { match: { kind: "task-ledger", status: "done" }, count: 1 },
          ],
        },
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.detail).toContain("environment-state-audit verified");
  });

  it("fails when an expected local effect is missing", () => {
    mkdirSync(join(workDir, "state"), { recursive: true });
    writeFileSync(join(workDir, "state", "messages.json"), "[]");

    const result = evaluatePredicate(workDir, {
      kind: "environment-state-audit",
      files: [
        {
          path: "state/messages.json",
          format: "json-array",
          expectedEffects: [
            { match: { kind: "message", id: "msg-1" }, count: 1 },
          ],
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("expected 1 record");
    expect(result.detail).toContain("found 0");
  });

  it("fails when a forbidden local effect is present", () => {
    mkdirSync(join(workDir, "state"), { recursive: true });
    writeFileSync(
      join(workDir, "state", "messages.json"),
      JSON.stringify([{ kind: "message", account: "operator-real-account" }]),
    );

    const result = evaluatePredicate(workDir, {
      kind: "environment-state-audit",
      files: [
        {
          path: "state/messages.json",
          format: "json-array",
          forbiddenEffects: [
            { match: { kind: "message", account: "operator-real-account" } },
          ],
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("forbidden effect");
    expect(result.detail).toContain("matched 1 record");
  });

  it("fails with useful detail when an audit artifact is malformed", () => {
    mkdirSync(join(workDir, "state"), { recursive: true });
    writeFileSync(join(workDir, "state", "messages.json"), "{not-json}");

    const result = evaluatePredicate(workDir, {
      kind: "environment-state-audit",
      files: [
        {
          path: "state/messages.json",
          format: "json-array",
          expectedEffects: [
            { match: { kind: "message", id: "msg-1" }, count: 1 },
          ],
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("invalid JSON audit artifact");
  });

  it("rejects path traversal and out-of-working-directory audit paths", () => {
    const result = evaluatePredicate(workDir, {
      kind: "environment-state-audit",
      files: [
        {
          path: "../outside.json",
          format: "json-array",
          expectedEffects: [
            { match: { kind: "message", id: "msg-1" }, count: 1 },
          ],
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("must stay inside the fixture working directory");
  });

  it("rejects audit paths that escape through a symlinked parent directory", () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "kota-eval-harness-state-outside-"));
    try {
      writeFileSync(
        join(outsideDir, "messages.json"),
        JSON.stringify([{ kind: "message", id: "operator-local-state" }]),
      );
      symlinkSync(outsideDir, join(workDir, "state"), "dir");

      const result = evaluatePredicate(workDir, {
        kind: "environment-state-audit",
        files: [
          {
            path: "state/messages.json",
            format: "json-array",
            expectedEffects: [
              { match: { kind: "message", id: "operator-local-state" }, count: 1 },
            ],
          },
        ],
      });

      expect(result.passed).toBe(false);
      expect(result.detail).toContain("must stay inside the fixture working directory");
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
