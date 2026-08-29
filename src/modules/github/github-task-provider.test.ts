/**
 * GitHubTaskProvider — unit tests with mocked fetch.
 *
 * Covers:
 *   - init() loads issues with label filter and populates collection
 *   - init() filters out pull requests from the issue list
 *   - init() throws when GitHub API returns an error
 *   - init() sets task status, notes, and priority
 *   - update() in_progress → adds in-progress label on GitHub
 *   - update() done → closes issue and adds done label on GitHub
 *   - update() pending (from in_progress) → removes in-progress label
 *   - update() preserves collection on mutation failure
 *   - add() creates a GitHub issue and adds to collection with real ID
 *   - add() includes priority label when adding task with priority
 *   - priority resolved from label mapping
 *   - update() throws when task ID not found
 *   - onLoad integration: provider registered when enabled
 *   - onLoad integration: provider not registered when disabled
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
    it("fetches open issues with label filter and populates collection", async () => {
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

      const tasks = provider.collection.list();
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

      expect(provider.collection.count()).toBe(1);
      expect(provider.collection.list()[0].id).toBe(1);
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

      const task = provider.collection.get(5);
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

      const task = provider.collection.get(3);
      expect(task?.notes).toBe("Some description here");
    });
  });

  describe("update() — claim (in_progress)", () => {
    it("adds in-progress label on GitHub when claiming a task", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, data: [makeIssue(10, "A task")] })
        .mockResolvedValue({ ok: true, status: 200, data: [] });

      const provider = makeProvider(fetch);
      await provider.init();

      const task = await provider.update(10, { status: "in_progress" });

      expect(task.status).toBe("in_progress");

      const labelCall = fetch.mock.calls.find(
        (c) =>
          c[0] === "POST" &&
          typeof c[1] === "string" &&
          c[1].includes("/issues/10/labels"),
      );
      expect(labelCall).toBeDefined();
      expect(labelCall![2]).toEqual({ labels: ["in-progress"] });
    });

    it("keeps the collection status unchanged when GitHub rejects the mutation", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, data: [makeIssue(10, "A task")] })
        .mockResolvedValueOnce({ ok: false, status: 503, data: { message: "unavailable" } });
      const provider = makeProvider(fetch);
      await provider.init();

      await expect(provider.update(10, { status: "in_progress" })).rejects.toThrow(
        "HTTP 503",
      );
      expect(provider.collection.get(10)?.status).toBe("pending");
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

      await provider.update(11, { status: "pending" });

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

      const task = await provider.update(20, { status: "done" });

      expect(task.status).toBe("done");
      expect(task.completed).toBeDefined();

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
    it("creates an issue on GitHub and updates collection with the real issue number", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          data: makeIssue(42, "New task"),
        });

      const provider = makeProvider(fetch);
      await provider.init();

      const task = await provider.add("New task");
      expect(task.id).toBe(42);

      const postCall = fetch.mock.calls.find(
        (c) =>
          c[0] === "POST" &&
          typeof c[1] === "string" &&
          c[1].endsWith("/issues"),
      );
      expect(postCall).toBeDefined();
      expect(postCall![2]).toMatchObject({ title: "New task", labels: ["kota-task"] });

      const updated = provider.collection.get(42);
      expect(updated).toBeDefined();
      expect(updated!.task).toBe("New task");
    });

    it("includes priority label when adding task with priority", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
        .mockResolvedValueOnce({ ok: true, status: 201, data: makeIssue(99, "Priority task") });

      const provider = makeProvider(fetch);
      await provider.init();

      await provider.add("Priority task", { priority: "high" });

      const postCall = fetch.mock.calls.find(
        (c) => c[0] === "POST" && typeof c[1] === "string" && c[1].endsWith("/issues"),
      );
      expect(postCall![2]).toMatchObject({
        labels: expect.arrayContaining(["priority:high"]),
      });
    });
  });

  describe("update() — not found", () => {
    it("throws when task ID not in collection", async () => {
      const fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, data: [] });
      const provider = makeProvider(fetch);
      await provider.init();

      await expect(provider.update(999, { status: "done" })).rejects.toThrow(
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

      expect(provider.collection.get(1)?.priority).toBe("high");
      expect(provider.collection.get(2)?.priority).toBe("medium");
      expect(provider.collection.get(3)?.priority).toBeUndefined();
    });
  });
});

describe("GitHubTaskProvider — onLoad integration in github module", () => {
  it("provider is registered when taskProvider.enabled is true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
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
      getContributedUiSurfaces: () => [],
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
