import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { getRepoTaskQueueSnapshot } from "#modules/repo-tasks/repo-tasks-domain.js";
import { decodeExplorerState, type ExplorerState } from "./explorer-state.js";
import { refreshExplorerSources } from "./source-evidence.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("reconsiders changed task dependencies and priority, but ignores dependency ordering", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "explorer-intent-"));
  roots.push(workspaceRoot);
  mkdirSync(join(workspaceRoot, "data/tasks"), { recursive: true });
  for (const id of ["task-external", "task-predecessor"]) {
    writeFileSync(join(workspaceRoot, `data/tasks/${id}.md`),
      `---\nstatus: blocked\npriority: p2\n---\n# ${id}\n\n## Blocked on\n\nOperator-controlled evidence.\n`);
  }
  const taskPath = join(workspaceRoot, "data/tasks/task-independent.md");
  const writeTask = (dependencies: string[], priority = "p2") => writeFileSync(taskPath,
    `---\nstatus: open\npriority: ${priority}\ndepends_on: [${dependencies.join(", ")}]\n---\n# Independent work\n`);
  const inspect = (current: ExplorerState) => refreshExplorerSources({
    workspaceRoot, current, capacity: 2, artifactDir: join(workspaceRoot, ".kota/run"),
    runTool: async () => { throw new Error("No watchlist sources"); },
  });
  writeTask([]);
  expect(getRepoTaskQueueSnapshot(workspaceRoot).actionableCount).toBe(1);
  const initial = await inspect(decodeExplorerState(null));
  const reviewed = { ...decodeExplorerState(null), lastReviewedFingerprint: initial.fingerprint };
  expect((await inspect(reviewed)).shouldReview).toBe(false);
  writeTask(["task-external", "task-predecessor"]);
  expect(getRepoTaskQueueSnapshot(workspaceRoot).actionableCount).toBe(0);
  const dependent = await inspect(reviewed);
  expect(dependent.shouldReview).toBe(true);
  expect(dependent.fingerprint).not.toBe(initial.fingerprint);
  const reviewedDependencies = { ...reviewed, lastReviewedFingerprint: dependent.fingerprint };
  writeTask(["task-predecessor", "task-external"]);
  expect((await inspect(reviewedDependencies)).shouldReview).toBe(false);
  writeTask(["task-predecessor", "task-external"], "p0");
  expect((await inspect(reviewedDependencies)).shouldReview).toBe(true);
  writeTask([]);
  expect((await inspect(reviewedDependencies)).shouldReview).toBe(true);
});

it("rechecks due sources without repeating an AI decision on unchanged or inaccessible evidence", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "explorer-evidence-"));
  roots.push(workspaceRoot);
  mkdirSync(join(workspaceRoot, "data"));
  writeFileSync(join(workspaceRoot, "data/watchlist.yaml"), "resources:\n  - url: https://example.com/research\n    added: 2026-09-01\n");
  let content = "A runtime now persists task ownership across restart.";
  let inaccessible = false;
  let fetches = 0;
  const runTool = async () => { fetches++; return { content, is_error: inaccessible }; };
  const inspect = (current: ExplorerState) => refreshExplorerSources({ workspaceRoot, current, runTool, capacity: 2, artifactDir: join(workspaceRoot, ".kota", "run") });
  const initial = await inspect(decodeExplorerState(null));
  expect(initial.shouldReview).toBe(true);
  expect(initial.observations[0]).toMatchObject({ accessible: true, changed: true });
  expect(readFileSync(initial.observations[0].contentPath, "utf8")).toBe(content);
  const elapsed = "2026-09-01T00:00:00.000Z";
  const reviewed: ExplorerState = {
    observedAt: elapsed, lastExplorationAt: elapsed, lastReviewedFingerprint: initial.fingerprint,
    sources: Object.fromEntries(Object.entries(initial.sources).map(([url, entry]) => [url, { ...entry, checkedAt: elapsed }])),
  };
  const unchanged = await inspect(reviewed);
  expect(fetches).toBe(2);
  expect(unchanged.shouldReview).toBe(false);
  expect(unchanged.fingerprint).toBe(initial.fingerprint);
  expect(reviewed.lastExplorationAt).toBe(elapsed);
  inaccessible = true;
  expect(await inspect(reviewed)).toMatchObject({ shouldReview: false, fingerprint: initial.fingerprint });
  inaccessible = false;
  content += " New measured recovery results identify an integration failure.";
  expect(await inspect(reviewed)).toMatchObject({ shouldReview: true });
});
