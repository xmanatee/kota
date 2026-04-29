/**
 * GitHubTaskProvider — unit tests with mocked fetch.
 *
 * Covers:
 *   - init() loads issues with label filter
 *   - list() returns cached tasks mapped from issues
 *   - update() in_progress → adds in-progress label on GitHub
 *   - update() done → closes issue and adds done label on GitHub
 *   - update() pending (from in_progress) → removes in-progress label
 *   - add() creates a GitHub issue and updates cache with real ID
 *   - archiveCompleted() closes done issues and removes from cache
 *   - getActiveSummary() returns correct summary
 *   - priority resolved from label mapping
 *   - not-found task throws
 */

import { describe, expect, it, vi } from "vitest";
import type { FetchFn } from "./task-provider.js";
import { GitHubTaskProvider } from "./task-provider.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIssue(
  number: number,
  title: string,
  labelNames: string[] = [],
  body: string | null = null,
) {
  return {
    number,
    title,
    created_at: "2026-04-01T00:00:00Z",
    body,
    labels: labelNames.map((name) => ({ name })),
  };
}

function makeProvider(
  fetchFn: FetchFn,
  {
    labelFilter = "kota-task",
    inProgressLabel = "in-progress",
    doneLabel = "kota-done",
    priorityLabels = { high: "priority:high", medium: "priority:medium", low: "priority:low" } as Record<string, string>,
  } = {},
) {
  return new GitHubTaskProvider("owner/repo", {
    enabled: true,
    labelFilter,
    inProgressLabel,
    doneLabel,
    priorityLabels,
  }, fetchFn);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GitHubTaskProvider", () => {
  describe("init()", () => {
    it("fetches open issues with label filter and populates cache", async () => {
      const fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          makeIssue(1, "Fix bug", ["kota-task"]),
          makeIssue(2, "Add feature", ["kota-task", "priority:high"]),
        ],
      });

      const provider = makeProvider(fetch);
      await provider.init();

      expect(fetch).toHaveBeenCalledWith(
        "GET",
        expect.stringContaining("labels=kota-task"),
      );

      const tasks = provider.list();
      expect(tasks).toHaveLength(2);
      expect(tasks[0]).toMatchObject({ id: 1, task: "Fix bug", status: "pending" });
      expect(tasks[1]).toMatchObject({ id: 2, task: "Add feature", priority: "high" });
    });

    it("filters out pull requests from the issue list", async () => {
      const fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          makeIssue(1, "Real issue"),
          { ...makeIssue(2, "A PR"), pull_request: {} },
        ],
      });

      const provider = makeProvider(fetch);
      await provider.init();

      expect(provider.count()).toBe(1);
      expect(provider.list()[0].id).toBe(1);
    });

    it("throws when GitHub API returns an error", async () => {
      const fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        data: { message: "Forbidden" },
      });

      const provider = makeProvider(fetch);
      await expect(provider.init()).rejects.toThrow("HTTP 403");
    });

    it("marks issues with in-progress label as in_progress", async () => {
      const fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [makeIssue(5, "In-flight task", ["kota-task", "in-progress"])],
      });

      const provider = makeProvider(fetch);
      await provider.init();

      const task = provider.get(5);
      expect(task?.status).toBe("in_progress");
    });

    it("sets task notes from issue body", async () => {
      const fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [makeIssue(3, "Task with body", [], "Some description here")],
      });

      const provider = makeProvider(fetch);
      await provider.init();

      const task = provider.get(3);
      expect(task?.notes).toBe("Some description here");
    });
  });

  describe("list() / active() / isEmpty() / count()", () => {
    it("active() excludes done tasks", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          data: [makeIssue(1, "Task A"), makeIssue(2, "Task B")],
        })
        .mockResolvedValue({ ok: true, status: 200, data: {} });

      const provider = makeProvider(fetch);
      await provider.init();

      provider.update(1, { status: "done" });

      expect(provider.active()).toHaveLength(1);
      expect(provider.active()[0].id).toBe(2);
    });

    it("isEmpty() returns true when cache is empty", async () => {
      const fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [],
      });
      const provider = makeProvider(fetch);
      await provider.init();
      expect(provider.isEmpty()).toBe(true);
      expect(provider.count()).toBe(0);
    });
  });

  describe("update() — claim (in_progress)", () => {
    it("adds in-progress label on GitHub when claiming a task", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, data: [makeIssue(10, "A task")] })
        .mockResolvedValue({ ok: true, status: 200, data: [] });

      const provider = makeProvider(fetch);
      await provider.init();

      const task = provider.update(10, { status: "in_progress" });

      expect(task.status).toBe("in_progress");

      // Let the async call fire
      await new Promise((r) => setTimeout(r, 0));

      const labelCall = fetch.mock.calls.find(
        (c) =>
          c[0] === "POST" &&
          typeof c[1] === "string" &&
          c[1].includes("/issues/10/labels"),
      );
      expect(labelCall).toBeDefined();
      expect(labelCall![2]).toEqual({ labels: ["in-progress"] });
    });

    it("removes in-progress label when moving back to pending", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          data: [makeIssue(11, "A task", ["in-progress"])],
        })
        .mockResolvedValue({ ok: true, status: 200, data: [] });

      const provider = makeProvider(fetch);
      await provider.init();

      provider.update(11, { status: "pending" });

      await new Promise((r) => setTimeout(r, 0));

      const deleteCall = fetch.mock.calls.find(
        (c) =>
          c[0] === "DELETE" &&
          typeof c[1] === "string" &&
          c[1].includes("/issues/11/labels/"),
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall![1]).toContain("in-progress");
    });
  });

  describe("update() — complete (done)", () => {
    it("closes the GitHub issue and adds done label when task is completed", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, data: [makeIssue(20, "Finish me")] })
        .mockResolvedValue({ ok: true, status: 200, data: {} });

      const provider = makeProvider(fetch);
      await provider.init();

      const task = provider.update(20, { status: "done" });

      expect(task.status).toBe("done");
      expect(task.completed).toBeDefined();

      await new Promise((r) => setTimeout(r, 0));

      const patchCall = fetch.mock.calls.find(
        (c) =>
          c[0] === "PATCH" &&
          typeof c[1] === "string" &&
          c[1].includes("/issues/20"),
      );
      expect(patchCall).toBeDefined();
      expect(patchCall![2]).toEqual({ state: "closed" });

      const labelCall = fetch.mock.calls.find(
        (c) =>
          c[0] === "POST" &&
          typeof c[1] === "string" &&
          c[1].includes("/issues/20/labels"),
      );
      expect(labelCall).toBeDefined();
      expect(labelCall![2]).toEqual({ labels: ["kota-done"] });
    });
  });

  describe("add()", () => {
    it("creates an issue on GitHub and updates cache ID with the real issue number", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          data: makeIssue(42, "New task"),
        });

      const provider = makeProvider(fetch);
      await provider.init();

      const task = provider.add("New task");
      expect(task.id).toBeLessThan(0); // temp ID

      // Let async issue creation complete
      await new Promise((r) => setTimeout(r, 0));

      const postCall = fetch.mock.calls.find(
        (c) =>
          c[0] === "POST" &&
          typeof c[1] === "string" &&
          c[1].endsWith("/issues"),
      );
      expect(postCall).toBeDefined();
      expect(postCall![2]).toMatchObject({ title: "New task", labels: ["kota-task"] });

      // Cache should now have the real ID
      const updated = provider.get(42);
      expect(updated).toBeDefined();
      expect(updated!.task).toBe("New task");
    });

    it("includes priority label when adding task with priority", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
        .mockResolvedValueOnce({ ok: true, status: 201, data: makeIssue(99, "Priority task") });

      const provider = makeProvider(fetch);
      await provider.init();

      provider.add("Priority task", { priority: "high" });

      await new Promise((r) => setTimeout(r, 0));

      const postCall = fetch.mock.calls.find(
        (c) => c[0] === "POST" && typeof c[1] === "string" && c[1].endsWith("/issues"),
      );
      expect(postCall![2]).toMatchObject({
        labels: expect.arrayContaining(["priority:high"]),
      });
    });
  });

  describe("archiveCompleted()", () => {
    it("removes done tasks from cache and closes them on GitHub", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          data: [makeIssue(1, "Open"), makeIssue(2, "To archive")],
        })
        .mockResolvedValue({ ok: true, status: 200, data: {} });

      const provider = makeProvider(fetch);
      await provider.init();

      provider.update(2, { status: "done" });
      const removed = provider.archiveCompleted();

      expect(removed).toBe(1);
      expect(provider.count()).toBe(1);
      expect(provider.get(2)).toBeUndefined();

      await new Promise((r) => setTimeout(r, 0));

      const closeCall = fetch.mock.calls.find(
        (c) =>
          c[0] === "PATCH" &&
          typeof c[1] === "string" &&
          c[1].includes("/issues/2"),
      );
      expect(closeCall).toBeDefined();
    });
  });

  describe("getActiveSummary()", () => {
    it("returns null when no active tasks", async () => {
      const fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, data: [] });
      const provider = makeProvider(fetch);
      await provider.init();
      expect(provider.getActiveSummary()).toBeNull();
    });

    it("returns summary with in-progress and pending counts", async () => {
      const fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          makeIssue(1, "Task A", ["in-progress"]),
          makeIssue(2, "Task B"),
          makeIssue(3, "Task C"),
        ],
      });
      const provider = makeProvider(fetch);
      await provider.init();

      const summary = provider.getActiveSummary();
      expect(summary).toContain("1 in progress");
      expect(summary).toContain("2 pending");
    });
  });

  describe("update() — not found", () => {
    it("throws when task ID not in cache", async () => {
      const fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, data: [] });
      const provider = makeProvider(fetch);
      await provider.init();

      expect(() => provider.update(999, { status: "done" })).toThrow(
        "Task #999 not found",
      );
    });
  });

  describe("priority resolution", () => {
    it("resolves priority from GitHub labels using the configured mapping", async () => {
      const fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          makeIssue(1, "High pri task", ["priority:high"]),
          makeIssue(2, "Medium pri task", ["priority:medium"]),
          makeIssue(3, "No priority", []),
        ],
      });

      const provider = makeProvider(fetch);
      await provider.init();

      expect(provider.get(1)?.priority).toBe("high");
      expect(provider.get(2)?.priority).toBe("medium");
      expect(provider.get(3)?.priority).toBeUndefined();
    });
  });

  describe("clear()", () => {
    it("is a no-op (does not clear GitHub issues)", async () => {
      const fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [makeIssue(1, "Task")],
      });
      const provider = makeProvider(fetch);
      await provider.init();

      provider.clear();

      // Cache still intact, no extra GitHub API calls
      expect(provider.count()).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe("GitHubTaskProvider — onLoad integration in github module", () => {
  it("provider is registered when taskProvider.enabled is true", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const { default: githubModule } = await import("./index.js");

    const registered: unknown[] = [];
    const ctx = {
      cwd: "/tmp",
      verbose: false,
      config: {},
      storage: { getDir: () => "/tmp" },
      registerGroup: vi.fn(),
      getRoutes: vi.fn(() => []),
      getContributedWorkflows: vi.fn(() => []),
      getContributedChannels: vi.fn(() => []),
      getModuleConfig: vi.fn(() => ({
        token: "ghp_test",
        repo: "owner/repo",
        taskProvider: { enabled: true, labelFilter: "kota-task" },
      })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getSecret: vi.fn(() => null),
      listTools: vi.fn(() => []),
      events: { emit: vi.fn(), subscribe: vi.fn(() => () => {}), emitExternal: vi.fn(), subscribeExternal: vi.fn(() => () => {}), listenerCount: vi.fn(() => 0) },
      createSession: vi.fn(),
      registerProvider: vi.fn((type: string, p: unknown) => registered.push({ type, p })),
      getProvider: vi.fn(() => null),
      callTool: vi.fn(),
      registerMiddleware: vi.fn(),
      getModuleSummaries: vi.fn(() => []),
    };

    if (typeof githubModule.onLoad === "function") {
      await githubModule.onLoad(ctx as never);
    }

    expect(ctx.registerProvider).toHaveBeenCalledWith("task", expect.any(Object));

    vi.unstubAllGlobals();
  });

  it("provider is not registered when taskProvider is absent", async () => {
    const { default: githubModule } = await import("./index.js");

    const ctx = {
      getModuleConfig: vi.fn(() => ({ token: "ghp_test", repo: "owner/repo" })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerProvider: vi.fn(),
    };

    if (typeof githubModule.onLoad === "function") {
      await githubModule.onLoad(ctx as never);
    }

    expect(ctx.registerProvider).not.toHaveBeenCalled();
  });
});
