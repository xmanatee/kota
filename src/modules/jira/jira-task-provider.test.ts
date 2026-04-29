/**
 * JiraTaskProvider — unit tests with mocked fetch.
 *
 * Covers:
 *   - init() loads issues and populates cache
 *   - init() applies jqlFilter when configured
 *   - init() throws on Jira API error
 *   - list() returns cached tasks mapped from issues
 *   - priority mapping from Jira priority names
 *   - description text extracted from Jira ADF format
 *   - update() in_progress → transitions issue and assigns user
 *   - update() done → transitions issue to done state
 *   - add() creates a Jira issue and updates cache with real key
 *   - archiveCompleted() removes done tasks from cache
 *   - getActiveSummary() returns correct summary
 *   - not-found task throws
 *   - clear() is a no-op
 *   - onLoad integration: provider registered when enabled
 *   - onLoad integration: provider not registered when disabled
 */

import { describe, expect, it, vi } from "vitest";
import type { JiraFetchFn } from "./task-provider.js";
import { JiraTaskProvider } from "./task-provider.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIssue(
  key: string,
  summary: string,
  priorityName: string | null = null,
  descriptionText: string | null = null,
) {
  return {
    id: `jira-${key}`,
    key,
    fields: {
      summary,
      description: descriptionText
        ? {
            content: [
              {
                content: [{ text: descriptionText }],
              },
            ],
          }
        : null,
      priority: priorityName ? { name: priorityName } : null,
      status: { name: "To Do" },
      components: [],
    },
  };
}

const MYSELF_RESPONSE = { accountId: "user-abc-123" };

const TRANSITIONS_RESPONSE = {
  transitions: [
    { id: "11", name: "To Do" },
    { id: "21", name: "In Progress" },
    { id: "31", name: "Done" },
  ],
};

const EMPTY_ISSUES = { issues: [] };

function makeProvider(
  fetchFn: JiraFetchFn,
  {
    projectKey = "ENG",
    jqlFilter,
    inProgressTransition = "In Progress",
    doneTransition = "Done",
    claimOnStart = true,
  }: {
    projectKey?: string;
    jqlFilter?: string;
    inProgressTransition?: string;
    doneTransition?: string;
    claimOnStart?: boolean;
  } = {},
) {
  return new JiraTaskProvider(
    { enabled: true, projectKey, jqlFilter, inProgressTransition, doneTransition, claimOnStart },
    fetchFn,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("JiraTaskProvider", () => {
  describe("init()", () => {
    it("fetches myself, issues, and transitions and populates cache", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce({
          issues: [
            makeIssue("ENG-1", "Fix bug"),
            makeIssue("ENG-2", "Add feature", "High"),
          ],
        })
        .mockResolvedValueOnce(TRANSITIONS_RESPONSE);

      const provider = makeProvider(fetch);
      await provider.init();

      expect(provider.count()).toBe(2);
      const tasks = provider.list();
      expect(tasks[0]).toMatchObject({ task: "Fix bug", status: "pending" });
      expect(tasks[1]).toMatchObject({ task: "Add feature", status: "pending", priority: "high" });
    });

    it("applies jqlFilter in JQL query", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce(EMPTY_ISSUES);

      const provider = makeProvider(fetch, { jqlFilter: 'assignee = currentUser()' });
      await provider.init();

      const searchCall = fetch.mock.calls[1];
      expect(searchCall[0]).toContain(encodeURIComponent('assignee = currentUser()'));
    });

    it("throws on Jira errorMessages", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce({ issues: [], errorMessages: ["Project 'XYZ' not found"] });

      const provider = makeProvider(fetch);
      await expect(provider.init()).rejects.toThrow("Project 'XYZ' not found");
    });

    it("sets task notes from description", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce({
          issues: [makeIssue("ENG-1", "Task", null, "Some details here")],
        })
        .mockResolvedValueOnce(TRANSITIONS_RESPONSE);

      const provider = makeProvider(fetch);
      await provider.init();

      expect(provider.get(1)?.notes).toBe("Some details here");
    });

    it("skips transition pre-cache when no issues returned", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce(EMPTY_ISSUES);

      const provider = makeProvider(fetch);
      await provider.init();

      expect(fetch).toHaveBeenCalledTimes(2); // no transitions call
    });
  });

  describe("priority mapping", () => {
    it.each([
      ["Highest", "high"],
      ["High", "high"],
      ["Medium", "medium"],
      ["Low", "low"],
      ["Lowest", "low"],
      [null, undefined],
    ])("Jira priority %s maps to KOTA priority %s", async (jiraPriority, kotaPriority) => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce({ issues: [makeIssue("ENG-1", "Task", jiraPriority)] })
        .mockResolvedValue(TRANSITIONS_RESPONSE);

      const provider = makeProvider(fetch);
      await provider.init();

      expect(provider.get(1)?.priority).toBe(kotaPriority);
    });
  });

  describe("list() / active() / isEmpty() / count()", () => {
    it("active() excludes done tasks", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce({
          issues: [makeIssue("ENG-1", "Task A"), makeIssue("ENG-2", "Task B")],
        })
        .mockResolvedValue(TRANSITIONS_RESPONSE);

      const provider = makeProvider(fetch);
      await provider.init();

      provider.update(1, { status: "done" });
      expect(provider.active()).toHaveLength(1);
      expect(provider.active()[0].id).toBe(2);
    });

    it("isEmpty() returns true when no issues loaded", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce(EMPTY_ISSUES);

      const provider = makeProvider(fetch);
      await provider.init();

      expect(provider.isEmpty()).toBe(true);
      expect(provider.count()).toBe(0);
    });
  });

  describe("update() — claim (in_progress)", () => {
    it("transitions issue to In Progress and assigns user", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce({ issues: [makeIssue("ENG-10", "A task")] })
        .mockResolvedValueOnce(TRANSITIONS_RESPONSE)
        .mockResolvedValue({});

      const provider = makeProvider(fetch);
      await provider.init();

      const task = provider.update(1, { status: "in_progress" });
      expect(task.status).toBe("in_progress");

      await new Promise((r) => setTimeout(r, 0));

      const transitionCall = fetch.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("ENG-10/transitions") &&
          c[1]?.method === "POST",
      );
      expect(transitionCall).toBeDefined();

      const assignCall = fetch.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("ENG-10/assignee") &&
          c[1]?.method === "PUT",
      );
      expect(assignCall).toBeDefined();
      expect((assignCall![1]?.body as { accountId: string })?.accountId).toBe("user-abc-123");
    });

    it("skips assignee call when claimOnStart is false", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce({ issues: [makeIssue("ENG-10", "A task")] })
        .mockResolvedValueOnce(TRANSITIONS_RESPONSE)
        .mockResolvedValue({});

      const provider = makeProvider(fetch, { claimOnStart: false });
      await provider.init();

      provider.update(1, { status: "in_progress" });
      await new Promise((r) => setTimeout(r, 0));

      const assignCall = fetch.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("/assignee"),
      );
      expect(assignCall).toBeUndefined();
    });
  });

  describe("update() — complete (done)", () => {
    it("transitions issue to Done when completed", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce({ issues: [makeIssue("ENG-20", "Finish me")] })
        .mockResolvedValueOnce(TRANSITIONS_RESPONSE)
        .mockResolvedValue({});

      const provider = makeProvider(fetch);
      await provider.init();

      const task = provider.update(1, { status: "done" });
      expect(task.status).toBe("done");
      expect(task.completed).toBeDefined();

      await new Promise((r) => setTimeout(r, 0));

      const transitionCall = fetch.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("ENG-20/transitions") &&
          c[1]?.method === "POST" &&
          (c[1]?.body as { transition: { id: string } })?.transition?.id === "31",
      );
      expect(transitionCall).toBeDefined();
    });
  });

  describe("add()", () => {
    it("creates a Jira issue and updates cache with the real key", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce(EMPTY_ISSUES)
        .mockResolvedValueOnce({ id: "jira-100", key: "ENG-100" });

      const provider = makeProvider(fetch);
      await provider.init();

      const task = provider.add("New task");
      expect(task.id).toBeLessThan(0); // temp ID

      await new Promise((r) => setTimeout(r, 0));

      const createCall = fetch.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("/rest/api/3/issue") &&
          c[1]?.method === "POST",
      );
      expect(createCall).toBeDefined();

      // Cache should now have the real ID
      expect(provider.get(1)?.task).toBe("New task");
    });
  });

  describe("archiveCompleted()", () => {
    it("removes done tasks from cache", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce({
          issues: [makeIssue("ENG-1", "Task A"), makeIssue("ENG-2", "Task B")],
        })
        .mockResolvedValue(TRANSITIONS_RESPONSE);

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
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce(EMPTY_ISSUES);

      const provider = makeProvider(fetch);
      await provider.init();

      expect(provider.getActiveSummary()).toBeNull();
    });

    it("returns summary with in-progress and pending counts", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce({
          issues: [
            makeIssue("ENG-1", "Task A"),
            makeIssue("ENG-2", "Task B"),
            makeIssue("ENG-3", "Task C"),
          ],
        })
        .mockResolvedValue(TRANSITIONS_RESPONSE);

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
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce(EMPTY_ISSUES);

      const provider = makeProvider(fetch);
      await provider.init();

      expect(() => provider.update(999, { status: "done" })).toThrow("Task #999 not found");
    });
  });

  describe("clear()", () => {
    it("is a no-op and does not remove issues from cache", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce({ issues: [makeIssue("ENG-1", "Task")] })
        .mockResolvedValueOnce(TRANSITIONS_RESPONSE);

      const provider = makeProvider(fetch);
      await provider.init();

      provider.clear();

      expect(provider.count()).toBe(1);
    });
  });
});

describe("JiraTaskProvider — onLoad integration in jira module", () => {
  it("provider is registered when taskProvider.enabled is true", async () => {
    // We use the real module but stub the JiraTaskProvider init
    const { JiraTaskProvider: TP } = await import("./task-provider.js");
    const initSpy = vi.spyOn(TP.prototype, "init").mockResolvedValue();

    const { default: jiraModule } = await import("./index.js");

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
        apiToken: "jira_token",
        userEmail: "user@example.com",
        baseUrl: "https://myorg.atlassian.net",
        taskProvider: { enabled: true, projectKey: "ENG" },
      })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getSecret: vi.fn(() => null),
      listTools: vi.fn(() => []),
      events: { emit: vi.fn(), subscribe: vi.fn(() => () => {}), emitExternal: vi.fn(), subscribeExternal: vi.fn(() => () => {}), listenerCount: vi.fn(() => 0) },
      createSession: vi.fn(),
      registerProvider: vi.fn(),
      getProvider: vi.fn(() => null),
      callTool: vi.fn(),
      registerMiddleware: vi.fn(),
      getModuleSummaries: vi.fn(() => []),
    };

    if (typeof jiraModule.onLoad === "function") {
      await jiraModule.onLoad(ctx as never);
    }

    expect(ctx.registerProvider).toHaveBeenCalledWith("task", expect.any(Object));

    initSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("provider is not registered when taskProvider is absent", async () => {
    const { default: jiraModule } = await import("./index.js");

    const ctx = {
      getModuleConfig: vi.fn(() => ({
        apiToken: "jira_token",
        userEmail: "user@example.com",
        baseUrl: "https://myorg.atlassian.net",
      })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerProvider: vi.fn(),
    };

    if (typeof jiraModule.onLoad === "function") {
      await jiraModule.onLoad(ctx as never);
    }

    expect(ctx.registerProvider).not.toHaveBeenCalled();
  });

  it("provider is not registered when apiToken is missing", async () => {
    const { default: jiraModule } = await import("./index.js");

    const ctx = {
      getModuleConfig: vi.fn(() => ({
        userEmail: "user@example.com",
        baseUrl: "https://myorg.atlassian.net",
        taskProvider: { enabled: true, projectKey: "ENG" },
      })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerProvider: vi.fn(),
    };

    if (typeof jiraModule.onLoad === "function") {
      await jiraModule.onLoad(ctx as never);
    }

    expect(ctx.registerProvider).not.toHaveBeenCalled();
  });
});
