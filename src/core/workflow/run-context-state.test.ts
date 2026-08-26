import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createRunContext } from "./run-context.js";
import { RunStateDatabase } from "./run-state-database.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("run transactional state", () => {
  test("keeps a staged value invisible until the run succeeds", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-run-context-state-"));
    roots.push(root);
    const scopeRoot = join(root, "project");
    const store = new RunStateDatabase(join(root, "state"));
    try {
      store.registerScope({
        id: "scope-a",
        rootPath: scopeRoot,
        createdAt: "2026-08-25T10:00:00.000Z",
      });
      const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
      store.admitRun({
        id: "run-a",
        scopeId: "scope-a",
        workflow: "counter",
        repository: "none",
        trigger: { event: "manual", schemaRef: null, payload: {} },
        resources: [],
        admittedAt: "2026-08-25T10:00:01.000Z",
      });
      store.startRun("run-a", epoch, "2026-08-25T10:00:02.000Z");
      const runRoot = join(root, "run");
      const context = createRunContext({
        runId: "run-a",
        attempt: 1,
        daemonEpoch: epoch,
        scopeId: "scope-a",
        scopeRoot,
        workflow: "counter",
        trigger: { event: "manual", schemaRef: null, payload: {} },
        sandbox: {
          runId: "run-a",
          repository: "none",
          rootDir: runRoot,
          workspaceDir: scopeRoot,
          tempDir: join(runRoot, "tmp"),
          artifactDir: join(runRoot, "artifacts"),
        },
        resources: {
          runId: "run-a",
          attempt: 1,
          daemonEpoch: epoch,
          workspaceDir: scopeRoot,
          runDir: runRoot,
          tempDir: join(runRoot, "tmp"),
          artifactDir: join(runRoot, "artifacts"),
          agentDir: join(runRoot, "agent"),
          packageCacheDir: join(runRoot, "package-cache"),
          ports: { start: 41_000, end: 41_000, size: 1, values: [41_000] },
          env: {},
        },
        signal: new AbortController().signal,
        store,
        now: () => "2026-08-25T10:00:03.000Z",
      });

      const snapshot = context.state.read<{ count: number }>("counter/value");
      context.state.compareAndSet("counter/value", snapshot.revision, { count: 1 });
      expect(context.state.read("counter/value")).toEqual({
        revision: 0,
        value: null,
      });

      store.finishRun(
        "run-a",
        epoch,
        "succeeded",
        "2026-08-25T10:00:04.000Z",
      );
      expect(context.state.read("counter/value")).toEqual({
        revision: 1,
        value: { count: 1 },
      });
    } finally {
      store.close();
    }
  });
});
