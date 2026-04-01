import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowDefinition, WorkflowRunTrigger, WorkflowTrigger } from "./types.js";
import { WatchTriggerManager } from "./watch-triggers.js";

type FileChangedPayload = {
  watchId: string;
  path: string;
  changes: { path: string; type: "create" | "change" | "delete" }[];
};

function makeDefinition(
  name: string,
  watch: string | string[],
  debounceMs = 50,
): WorkflowDefinition {
  const patterns = Array.isArray(watch) ? watch : [watch];
  return {
    name,
    enabled: true,
    definitionPath: `test/${name}.ts`,
    triggers: [
      {
        event: "files.changed",
        cooldownMs: 0,
        watch: patterns,
        debounceMs,
      },
    ],
    steps: [],
  } as unknown as WorkflowDefinition;
}

describe("WatchTriggerManager", () => {
  let tmpDir: string;
  let mgr: WatchTriggerManager;
  const enqueuedRuns: WorkflowRunTrigger[] = [];
  let startNextCount = 0;
  let lastHandler: ((payload: FileChangedPayload) => void) | null = null;
  let isStopping = false;

  const subscribe = (handler: (payload: FileChangedPayload) => void) => {
    lastHandler = handler;
    return () => { lastHandler = null; };
  };

  function emitFileChanged(watchId: string, changes: FileChangedPayload["changes"]): void {
    lastHandler?.({ watchId, path: tmpDir, changes });
  }

  function getWatcherId(): string {
    const entries = (mgr as unknown as { entries: Map<string, { watcherId: string }> }).entries;
    return [...entries.values()][0]?.watcherId ?? "w1";
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kota-watch-triggers-"));
    enqueuedRuns.length = 0;
    startNextCount = 0;
    lastHandler = null;
    isStopping = false;
    mgr = new WatchTriggerManager(
      tmpDir,
      () => isStopping,
      (_def: WorkflowDefinition, _trigger: WorkflowTrigger, run: WorkflowRunTrigger) => {
        enqueuedRuns.push(run);
      },
      () => { startNextCount++; },
    );
  });

  afterEach(async () => {
    mgr.clearAll();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("fires trigger when a matching file changes", async () => {
    const def = makeDefinition("watcher", "src/**/*.ts", 50);
    mgr.setup([def], subscribe as Parameters<typeof mgr.setup>[1]);

    // Allow watcher to fully start
    await new Promise((r) => setTimeout(r, 100));

    const watcherId = getWatcherId();
    emitFileChanged(watcherId, [{ path: "src/foo.ts", type: "change" }]);

    await new Promise((r) => setTimeout(r, 150));

    expect(enqueuedRuns).toHaveLength(1);
    expect(enqueuedRuns[0].event).toBe("files.changed");
    expect((enqueuedRuns[0].payload as { files: string[] }).files).toContain("src/foo.ts");
    expect(startNextCount).toBeGreaterThan(0);
  });

  it("does not fire when no file matches the pattern", async () => {
    const def = makeDefinition("watcher", "src/**/*.ts", 50);
    mgr.setup([def], subscribe as Parameters<typeof mgr.setup>[1]);

    await new Promise((r) => setTimeout(r, 100));
    const watcherId = getWatcherId();

    emitFileChanged(watcherId, [{ path: "README.md", type: "change" }]);

    await new Promise((r) => setTimeout(r, 150));

    expect(enqueuedRuns).toHaveLength(0);
  });

  it("batches multiple changes within the debounce window", async () => {
    const def = makeDefinition("watcher", "src/**/*.ts", 100);
    mgr.setup([def], subscribe as Parameters<typeof mgr.setup>[1]);

    await new Promise((r) => setTimeout(r, 100));
    const watcherId = getWatcherId();

    emitFileChanged(watcherId, [{ path: "src/a.ts", type: "change" }]);
    await new Promise((r) => setTimeout(r, 30));
    emitFileChanged(watcherId, [{ path: "src/b.ts", type: "create" }]);

    await new Promise((r) => setTimeout(r, 200));

    expect(enqueuedRuns).toHaveLength(1);
    const files = (enqueuedRuns[0].payload as { files: string[] }).files;
    expect(files).toContain("src/a.ts");
    expect(files).toContain("src/b.ts");
  });

  it("does not fire when isStopping is true", async () => {
    const def = makeDefinition("watcher", "src/**/*.ts", 50);
    mgr.setup([def], subscribe as Parameters<typeof mgr.setup>[1]);

    await new Promise((r) => setTimeout(r, 100));

    isStopping = true;
    const watcherId = getWatcherId();
    emitFileChanged(watcherId, [{ path: "src/foo.ts", type: "change" }]);

    await new Promise((r) => setTimeout(r, 150));

    expect(enqueuedRuns).toHaveLength(0);
  });

  it("supports an array of glob patterns", async () => {
    const def = makeDefinition("watcher", ["src/**/*.ts", "test/**/*.ts"], 50);
    mgr.setup([def], subscribe as Parameters<typeof mgr.setup>[1]);

    await new Promise((r) => setTimeout(r, 100));
    const watcherId = getWatcherId();

    emitFileChanged(watcherId, [{ path: "test/foo.test.ts", type: "change" }]);

    await new Promise((r) => setTimeout(r, 150));

    expect(enqueuedRuns).toHaveLength(1);
    expect((enqueuedRuns[0].payload as { files: string[] }).files).toContain("test/foo.test.ts");
  });

  it("skips definitions with no watch triggers", async () => {
    const def: WorkflowDefinition = {
      name: "no-watch",
      enabled: true,
      definitionPath: "test/no-watch.ts",
      triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
      steps: [],
    } as unknown as WorkflowDefinition;

    mgr.setup([def], subscribe as Parameters<typeof mgr.setup>[1]);

    await new Promise((r) => setTimeout(r, 50));

    expect(lastHandler).toBeNull();
    const entries = (mgr as unknown as { entries: Map<string, unknown> }).entries;
    expect(entries.size).toBe(0);
  });

  it("clearAll stops watchers and unsubscribes", async () => {
    const def = makeDefinition("watcher", "src/**/*.ts", 50);
    mgr.setup([def], subscribe as Parameters<typeof mgr.setup>[1]);

    await new Promise((r) => setTimeout(r, 100));
    expect(lastHandler).not.toBeNull();

    mgr.clearAll();
    expect(lastHandler).toBeNull();
    const entries = (mgr as unknown as { entries: Map<string, unknown> }).entries;
    expect(entries.size).toBe(0);
  });
});
