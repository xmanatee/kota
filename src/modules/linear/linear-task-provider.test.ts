/**
 * LinearTaskProvider — unit tests with mocked fetch.
 *
 * Covers:
 *   - init() loads issues with label filter
 *   - init() throws when team not found
 *   - init() throws when Linear API returns errors
 *   - list() returns cached tasks mapped from issues
 *   - priority mapping from Linear priority field (0–4)
 *   - update() in_progress → transitions issue state on Linear
 *   - update() done → transitions issue to done state and adds comment
 *   - add() creates a Linear issue and updates cache with real ID
 *   - archiveCompleted() removes done tasks from cache
 *   - getActiveSummary() returns correct summary
 *   - not-found task throws
 *   - clear() is a no-op
 *   - onLoad integration: provider registered when enabled
 *   - onLoad integration: provider not registered when disabled
 */

import { describe, expect, it, vi } from "vitest";
import type { LinearFetchFn } from "./task-provider.js";
import { LinearTaskProvider } from "./task-provider.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIssue(
  id: string,
  title: string,
  priority = 0,
  labels: string[] = [],
  description: string | null = null,
  stateType = "backlog",
) {
  return {
    id,
    title,
    description,
    priority,
    state: { id: `state-${stateType}`, name: stateType, type: stateType },
    labels: { nodes: labels.map((name) => ({ name })) },
  };
}

const DEFAULT_TEAM_RESPONSE = {
  data: {
    teams: {
      nodes: [
        {
          id: "team-1",
          states: {
            nodes: [
              { id: "state-backlog", name: "Backlog", type: "backlog" },
              { id: "state-todo", name: "Todo", type: "unstarted" },
              { id: "state-inprogress", name: "In Progress", type: "started" },
              { id: "state-done", name: "Done", type: "completed" },
            ],
          },
        },
      ],
    },
  },
};

function makeProvider(
  fetchFn: LinearFetchFn,
  {
    teamKey = "ENG",
    labelFilter = "kota-task",
    inProgressState = "In Progress",
    doneState = "Done",
  } = {},
) {
  return new LinearTaskProvider(
    { enabled: true, teamKey, labelFilter, inProgressState, doneState },
    fetchFn,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LinearTaskProvider", () => {
  describe("init()", () => {
    it("fetches team and issues, filters by label, and populates cache", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({
          data: {
            issues: {
              nodes: [
                makeIssue("lin-1", "Fix bug", 0, ["kota-task"]),
                makeIssue("lin-2", "Add feature", 2, ["kota-task", "other"]),
                makeIssue("lin-3", "Untagged issue", 0, []),
              ],
            },
          },
        });

      const provider = makeProvider(fetch);
      await provider.init();

      // lin-3 has no "kota-task" label, so filtered out
      expect(provider.count()).toBe(2);
      const tasks = provider.list();
      expect(tasks[0]).toMatchObject({ task: "Fix bug", status: "pending" });
      expect(tasks[1]).toMatchObject({ task: "Add feature", status: "pending", priority: "high" });
    });

    it("fetches all issues when no labelFilter is configured", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({
          data: {
            issues: {
              nodes: [
                makeIssue("lin-1", "Task A", 0, []),
                makeIssue("lin-2", "Task B", 0, []),
              ],
            },
          },
        });

      const provider = new LinearTaskProvider(
        { enabled: true, teamKey: "ENG" },
        fetch,
      );
      await provider.init();

      expect(provider.count()).toBe(2);
    });

    it("throws when team not found", async () => {
      const fetch = vi.fn().mockResolvedValueOnce({
        data: { teams: { nodes: [] } },
      });

      const provider = makeProvider(fetch);
      await expect(provider.init()).rejects.toThrow('team "ENG" not found');
    });

    it("throws when GraphQL errors are returned for team query", async () => {
      const fetch = vi.fn().mockResolvedValueOnce({
        data: {},
        errors: [{ message: "Unauthorized" }],
      });

      const provider = makeProvider(fetch);
      await expect(provider.init()).rejects.toThrow("Unauthorized");
    });

    it("throws when GraphQL errors are returned for issues query", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({
          data: {},
          errors: [{ message: "Rate limited" }],
        });

      const provider = makeProvider(fetch);
      await expect(provider.init()).rejects.toThrow("Rate limited");
    });

    it("sets task notes from issue description", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({
          data: {
            issues: {
              nodes: [makeIssue("lin-1", "Task", 0, ["kota-task"], "Some details here")],
            },
          },
        });

      const provider = makeProvider(fetch);
      await provider.init();

      expect(provider.get(1)?.notes).toBe("Some details here");
    });
  });

  describe("priority mapping", () => {
    it.each([
      [0, undefined],
      [1, "high"],
      [2, "high"],
      [3, "medium"],
      [4, "low"],
    ])("Linear priority %i maps to KOTA priority %s", async (linearPriority, kotaPriority) => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({
          data: {
            issues: {
              nodes: [makeIssue("lin-1", "Task", linearPriority, ["kota-task"])],
            },
          },
        });

      const provider = makeProvider(fetch);
      await provider.init();

      expect(provider.get(1)?.priority).toBe(kotaPriority);
    });
  });

  describe("list() / active() / isEmpty() / count()", () => {
    it("active() excludes done tasks", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({
          data: {
            issues: {
              nodes: [
                makeIssue("lin-1", "Task A", 0, ["kota-task"]),
                makeIssue("lin-2", "Task B", 0, ["kota-task"]),
              ],
            },
          },
        })
        .mockResolvedValue({ data: {} });

      const provider = makeProvider(fetch);
      await provider.init();

      provider.update(1, { status: "done" });
      expect(provider.active()).toHaveLength(1);
      expect(provider.active()[0].id).toBe(2);
    });

    it("isEmpty() returns true when no issues loaded", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({ data: { issues: { nodes: [] } } });

      const provider = makeProvider(fetch);
      await provider.init();

      expect(provider.isEmpty()).toBe(true);
      expect(provider.count()).toBe(0);
    });
  });

  describe("update() — claim (in_progress)", () => {
    it("transitions issue to In Progress state on Linear when claimed", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({
          data: {
            issues: { nodes: [makeIssue("lin-10", "A task", 0, ["kota-task"])] },
          },
        })
        .mockResolvedValue({ data: { issueUpdate: { success: true } } });

      const provider = makeProvider(fetch);
      await provider.init();

      const task = provider.update(1, { status: "in_progress" });
      expect(task.status).toBe("in_progress");

      await new Promise((r) => setTimeout(r, 0));

      const mutationCall = fetch.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("issueUpdate") &&
          c[1]?.id === "lin-10" &&
          c[1]?.stateId === "state-inprogress",
      );
      expect(mutationCall).toBeDefined();
    });
  });

  describe("update() — complete (done)", () => {
    it("transitions issue to Done state and adds comment when completed", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({
          data: {
            issues: { nodes: [makeIssue("lin-20", "Finish me", 0, ["kota-task"])] },
          },
        })
        .mockResolvedValue({ data: {} });

      const provider = makeProvider(fetch);
      await provider.init();

      const task = provider.update(1, { status: "done" });
      expect(task.status).toBe("done");
      expect(task.completed).toBeDefined();

      await new Promise((r) => setTimeout(r, 0));

      const stateCall = fetch.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("issueUpdate") &&
          c[1]?.id === "lin-20" &&
          c[1]?.stateId === "state-done",
      );
      expect(stateCall).toBeDefined();

      const commentCall = fetch.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("commentCreate") &&
          c[1]?.issueId === "lin-20",
      );
      expect(commentCall).toBeDefined();
    });
  });

  describe("add()", () => {
    it("creates a Linear issue and updates cache with the real ID", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({ data: { issues: { nodes: [] } } })
        .mockResolvedValueOnce({
          data: {
            issueCreate: { success: true, issue: { id: "lin-new-42" } },
          },
        });

      const provider = makeProvider(fetch);
      await provider.init();

      const task = provider.add("New task");
      expect(task.id).toBeLessThan(0); // temp ID

      await new Promise((r) => setTimeout(r, 0));

      const createCall = fetch.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("issueCreate") &&
          c[1]?.title === "New task",
      );
      expect(createCall).toBeDefined();

      // Cache should now have the real ID
      expect(provider.get(1)?.task).toBe("New task");
    });
  });

  describe("archiveCompleted()", () => {
    it("removes done tasks from cache", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({
          data: {
            issues: {
              nodes: [
                makeIssue("lin-1", "Task A", 0, ["kota-task"]),
                makeIssue("lin-2", "Task B", 0, ["kota-task"]),
              ],
            },
          },
        })
        .mockResolvedValue({ data: {} });

      const provider = makeProvider(fetch);
      await provider.init();

      provider.update(1, { status: "done" });
      const removed = provider.archiveCompleted();

      expect(removed).toBe(1);
      expect(provider.count()).toBe(1);
      expect(provider.get(1)).toBeUndefined();
    });
  });

  describe("getActiveSummary()", () => {
    it("returns null when no active tasks", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({ data: { issues: { nodes: [] } } });

      const provider = makeProvider(fetch);
      await provider.init();

      expect(provider.getActiveSummary()).toBeNull();
    });

    it("returns summary with in-progress and pending counts", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({
          data: {
            issues: {
              nodes: [
                makeIssue("lin-1", "Task A", 0, ["kota-task"]),
                makeIssue("lin-2", "Task B", 0, ["kota-task"]),
                makeIssue("lin-3", "Task C", 0, ["kota-task"]),
              ],
            },
          },
        })
        .mockResolvedValue({ data: {} });

      const provider = makeProvider(fetch);
      await provider.init();

      provider.update(1, { status: "in_progress" });

      const summary = provider.getActiveSummary();
      expect(summary).toContain("1 in progress");
      expect(summary).toContain("2 pending");
    });
  });

  describe("update() — not found", () => {
    it("throws when task ID not in cache", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({ data: { issues: { nodes: [] } } });

      const provider = makeProvider(fetch);
      await provider.init();

      expect(() => provider.update(999, { status: "done" })).toThrow("Task #999 not found");
    });
  });

  describe("clear()", () => {
    it("is a no-op and does not remove issues from cache", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(DEFAULT_TEAM_RESPONSE)
        .mockResolvedValueOnce({
          data: {
            issues: { nodes: [makeIssue("lin-1", "Task", 0, ["kota-task"])] },
          },
        });

      const provider = makeProvider(fetch);
      await provider.init();

      provider.clear();

      expect(provider.count()).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(2); // no extra calls
    });
  });
});

describe("LinearTaskProvider — onLoad integration in linear module", () => {
  it("provider is registered when taskProvider.enabled is true", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => DEFAULT_TEAM_RESPONSE })
      .mockResolvedValueOnce({ json: async () => ({ data: { issues: { nodes: [] } } }) });
    vi.stubGlobal("fetch", fetchMock);

    const { default: linearModule } = await import("./index.js");

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
        apiKey: "lin_api_test_key",
        taskProvider: { enabled: true, teamKey: "ENG", labelFilter: "kota-task" },
      })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getSecret: vi.fn(() => null),
      listTools: vi.fn(() => []),
      events: { emit: vi.fn(), subscribe: vi.fn(() => () => {}) },
      createSession: vi.fn(),
      registerProvider: vi.fn(),
      getProvider: vi.fn(() => null),
      callTool: vi.fn(),
      registerMiddleware: vi.fn(),
      getModuleSummaries: vi.fn(() => []),
    };

    if (typeof linearModule.onLoad === "function") {
      await linearModule.onLoad(ctx as never);
    }

    expect(ctx.registerProvider).toHaveBeenCalledWith("task", expect.any(Object));

    vi.unstubAllGlobals();
  });

  it("provider is not registered when taskProvider is absent", async () => {
    const { default: linearModule } = await import("./index.js");

    const ctx = {
      getModuleConfig: vi.fn(() => ({ apiKey: "lin_api_test_key" })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerProvider: vi.fn(),
    };

    if (typeof linearModule.onLoad === "function") {
      await linearModule.onLoad(ctx as never);
    }

    expect(ctx.registerProvider).not.toHaveBeenCalled();
  });

  it("provider is not registered when apiKey is missing", async () => {
    const { default: linearModule } = await import("./index.js");

    const ctx = {
      getModuleConfig: vi.fn(() => ({
        taskProvider: { enabled: true, teamKey: "ENG" },
      })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerProvider: vi.fn(),
    };

    if (typeof linearModule.onLoad === "function") {
      await linearModule.onLoad(ctx as never);
    }

    expect(ctx.registerProvider).not.toHaveBeenCalled();
  });
});
