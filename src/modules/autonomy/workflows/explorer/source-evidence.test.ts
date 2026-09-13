import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { getRepoTaskQueueSnapshot } from "#modules/repo-tasks/repo-tasks-domain.js";
import { decodeExplorerState, type ExplorerState } from "./explorer-state.js";
import { explorationFingerprint, refreshExplorerSources } from "./source-evidence.js";

const roots: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

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
    evidenceDir: join(workspaceRoot, ".kota/evidence"),
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
  const inspect = (current: ExplorerState) => refreshExplorerSources({ workspaceRoot, current, runTool, capacity: 2, artifactDir: join(workspaceRoot, ".kota", "run"), evidenceDir: join(workspaceRoot, ".kota/evidence") });
  const initial = await inspect(decodeExplorerState(null));
  expect(initial.shouldReview).toBe(true);
  expect(initial.observations[0]).toMatchObject({ accessible: true, changed: true });
  expect(readFileSync(initial.observations[0].contentPath, "utf8")).toBe(content);
  const elapsed = "2026-09-01T00:00:00.000Z";
  const reviewed: ExplorerState = {
    observedAt: elapsed, lastExplorationAt: elapsed, lastReviewedFingerprint: initial.fingerprint,
    sources: Object.fromEntries(Object.entries(initial.sources).map(([url, entry]) => [url, { ...entry, checkedAt: elapsed }])),
  };
  writeFileSync(join(workspaceRoot, "data/watchlist.yaml"), `resources:
  - url: https://example.com/research
    added: 2026-09-01
    snapshot:
      fingerprint: ${initial.sources["https://example.com/research"].fingerprint}
      summary: |
        A "quoted" source observation.
        Second line.
      last_seen_at: 2026-09-02T00:00:00.000Z
`);
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

it("reuses retained readable bytes after cleanup and task changes, including failed optional refreshes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-13T01:00:00Z"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "explorer-retained-"));
  roots.push(workspaceRoot);
  mkdirSync(join(workspaceRoot, "data/tasks"), { recursive: true });
  writeFileSync(join(workspaceRoot, "data/watchlist.yaml"),
    "resources:\n  - url: https://example.com/readable\n    added: 2026-09-01\n  - url: https://example.com/optional\n    added: 2026-09-01\n");
  const content = "A maintained runtime stores task ownership across restart.";
  let failed = false;
  const runTool = vi.fn(async (_name: string, args: Record<string, unknown>) =>
    failed || args.url === "https://example.com/optional"
      ? { content: "Unavailable", is_error: true } : { content });
  const inspect = (current: ExplorerState, runId: string) => refreshExplorerSources({
    workspaceRoot, current, runTool, capacity: 2,
    artifactDir: join(workspaceRoot, "working", runId), evidenceDir: join(workspaceRoot, "runs", runId),
  });
  const first = await inspect(decodeExplorerState(null), "first");
  expect(first.shouldReview).toBe(true);
  const reviewed = decodeExplorerState(JSON.parse(JSON.stringify({ ...decodeExplorerState(null),
    sources: first.sources, lastReviewedFingerprint: first.fingerprint })));
  rmSync(join(workspaceRoot, "working"), { recursive: true });
  writeFileSync(join(workspaceRoot, "data/tasks/task-owner.md"),
    "---\nstatus: blocked\npriority: p1\n---\n# Owner direction\n\n## Blocked on\n\nA credential. Investigate independent recovery ideas.\n");
  const reconsidered = await inspect(reviewed, "second");
  expect(runTool).toHaveBeenCalledTimes(2);
  expect(reconsidered.shouldReview).toBe(true);
  expect(reconsidered.observations).toHaveLength(1);
  expect(reconsidered.observations[0]).toMatchObject({ origin: "retained", accessible: true,
    observedAt: "2026-09-13T01:00:00.000Z" });
  expect(readFileSync(reconsidered.observations[0]!.contentPath, "utf8")).toBe(content);
  expect((await inspect({ ...reviewed, lastReviewedFingerprint: reconsidered.fingerprint }, "replay")).shouldReview).toBe(false);
  failed = true;
  vi.setSystemTime(new Date("2026-09-14T01:00:00Z"));
  const unavailable = await inspect(reviewed, "failed-refresh");
  expect(unavailable.shouldReview).toBe(true);
  expect(unavailable.observations.filter((observation) => observation.origin === "fetch").every((observation) => !observation.accessible)).toBe(true);
  expect(unavailable.sources["https://example.com/readable"]?.readable).toEqual(reviewed.sources["https://example.com/readable"]?.readable);
  expect(readFileSync(unavailable.observations.find((observation) => observation.origin === "retained")!.contentPath, "utf8")).toBe(content);
  const retainedPath = reconsidered.observations[0]!.evidencePath;
  writeFileSync(retainedPath, "Different bytes must not inherit the earlier content identity.");
  const refreshed = { ...reviewed, sources: unavailable.sources };
  expect((await inspect(refreshed, "mismatched")).shouldReview).toBe(false);
  rmSync(retainedPath);
  expect((await inspect(refreshed, "missing")).shouldReview).toBe(false);
  expect(() => decodeExplorerState({ ...reviewed, sources: {
    "https://example.com/readable": { ...reviewed.sources["https://example.com/readable"],
      readable: { runId: "../outside", observedAt: "2026-09-13T01:00:00Z" } },
  } })).toThrow("readable source reference");
});


it("applies source cadence without refetching retired citations or rereviewing settled material", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = new Date("2026-09-13T01:00:00Z").getTime();
  vi.setSystemTime(start);
  const workspaceRoot = mkdtempSync(join(tmpdir(), "explorer-cadence-"));
  roots.push(workspaceRoot);
  mkdirSync(join(workspaceRoot, "data/tasks"), { recursive: true });
  const watchlistPath = join(workspaceRoot, "data/watchlist.yaml");
  const weeklyUrl = "https://example.com/research-series";
  const dailyUrl = "https://example.com/releases";
  const paperUrl = "https://example.com/paper";
  const writeSources = (notes: string, includePaper = false) => writeFileSync(watchlistPath,
    `resources:
  - url: ${dailyUrl}
    added: 2026-09-01
  - url: ${weeklyUrl}
    added: 2026-09-01
    refresh: weekly
    status: inaccessible
    notes: ${notes}
${includePaper ? `  - url: ${paperUrl}\n    added: 2026-09-01\n` : ""}`);
  let weeklyAccessible = false;
  const runTool = vi.fn(async (_name: string, args: Record<string, unknown>) =>
    args.url === weeklyUrl && !weeklyAccessible
      ? { content: "HTTP 503", is_error: true }
      : { content: `Readable development from ${args.url}` });
  const inspect = (current: ExplorerState, runId: string) => refreshExplorerSources({
    workspaceRoot, current, runTool, capacity: 2,
    artifactDir: join(workspaceRoot, "working", runId), evidenceDir: join(workspaceRoot, "runs", runId),
  });
  writeSources("Monitor durable agent memory developments.", true);
  const first = await inspect(decodeExplorerState(null), "first");
  expect(runTool).toHaveBeenCalledTimes(3);
  // An actual review retires a citation and publishes its decision in task history.
  writeSources("Monitor durable agent memory developments.");
  mkdirSync(join(workspaceRoot, "data/tasks/archive"));
  writeFileSync(join(workspaceRoot, "data/tasks/archive/task-memory-research.md"),
    `---\nstatus: done\n---\n# Memory research\n\nRead ${paperUrl}; existing memory behavior covers this settled reference.\n`);
  let current = { ...decodeExplorerState(null), sources: first.sources,
    lastReviewedFingerprint: explorationFingerprint(workspaceRoot, first.sources) };
  vi.setSystemTime(start + 30 * 60 * 1000);
  expect((await inspect(current, "half-hour")).shouldReview).toBe(false);
  expect(runTool).toHaveBeenCalledTimes(3);
  vi.setSystemTime(start + 24 * 60 * 60 * 1000);
  const daily = await inspect(current, "daily");
  expect(daily.shouldReview).toBe(false);
  expect(runTool).toHaveBeenCalledTimes(4);
  expect(runTool.mock.calls.at(-1)?.[1].url).toBe(dailyUrl);
  current = { ...current, sources: daily.sources };
  weeklyAccessible = true;
  vi.setSystemTime(start + 7 * 24 * 60 * 60 * 1000);
  const recovered = await inspect(current, "weekly");
  expect(recovered.shouldReview).toBe(true);
  expect(recovered.observations).toContainEqual(expect.objectContaining({ url: weeklyUrl, accessible: true, changed: true }));
  expect(runTool).toHaveBeenCalledTimes(6);
  current = { ...current, sources: recovered.sources, lastReviewedFingerprint: recovered.fingerprint };
  expect((await inspect(current, "settled")).shouldReview).toBe(false);
  writeSources("Investigate recovery after memory revisions, per owner direction.");
  const redirected = await inspect(current, "owner-direction");
  expect(redirected.shouldReview).toBe(true);
  expect(redirected.observations.every((observation) => observation.origin === "retained")).toBe(true);
  expect(runTool).toHaveBeenCalledTimes(6);
  expect(runTool.mock.calls.filter(([, args]) => args.url === paperUrl)).toHaveLength(1);
  expect(readFileSync(join(workspaceRoot, "data/tasks/archive/task-memory-research.md"), "utf8")).toContain(paperUrl);
});
