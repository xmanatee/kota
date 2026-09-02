import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexPathFor, SemanticIndexFile } from "#modules/semantic-index/semantic-index.js";
import { FakeEmbeddingProvider } from "#modules/semantic-index/test-support.js";
import { SemanticTasksStore, tasksSidecarDir } from "./semantic-store.js";

const roots: string[] = [];

function createStore() {
  const root = join(tmpdir(), `kota-tasks-mapping-${crypto.randomUUID()}`);
  mkdirSync(join(root, "data", "tasks", "archive"), { recursive: true });
  roots.push(root);
  const provider = new FakeEmbeddingProvider();
  return {
    root,
    provider,
    store: new SemanticTasksStore({
      scopeRoot: root,
      provider,
      onBackgroundError: () => {},
    }),
  };
}

function writeTask(
  root: string,
  id: string,
  state: "open" | "done",
  title: string,
): void {
  const directory = state === "done"
    ? join(root, "data", "tasks", "archive")
    : join(root, "data", "tasks");
  const priority = state === "open" ? "priority: p1\n" : "";
  writeFileSync(
    join(directory, `${id}.md`),
    `---\nstatus: ${state}\n${priority}---\n\n# ${title}\n\n## Problem\nMonitor spend.\n`,
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SemanticTasksStore adapter mapping", () => {
  it("stores the canonical-field fingerprint in the runtime sidecar", async () => {
    const { root, provider, store } = createStore();
    writeTask(root, "task-spend", "open", "Track spend");
    await store.reindex();

    const sidecarPath = indexPathFor(tasksSidecarDir(root));
    expect(existsSync(sidecarPath)).toBe(true);
    const index = new SemanticIndexFile(sidecarPath).load(provider.model);
    expect(index.entries["task-spend"].fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("maps ranked entries to task hits after state filtering", async () => {
    const { root, store } = createStore();
    writeTask(root, "task-open", "open", "Track spend anomaly");
    writeTask(root, "task-done", "done", "Track spend archive");

    const results = await store.searchTasks("cost", { states: ["open"], topK: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "task-open",
      state: "open",
      priority: "p1",
      title: "Track spend anomaly",
    });
    expect(results[0].score).toBeGreaterThan(0);
  });
});
