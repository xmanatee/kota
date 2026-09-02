/**
 * JiraTaskProvider — unit tests with mocked fetch.
 *
 * Covers:
 *   - init() fetches myself, issues, transitions and populates collection
 *   - init() applies jqlFilter in JQL query
 *   - init() throws on Jira errorMessages
 *   - init() sets task notes from description
 *   - init() skips transition pre-cache when no issues returned
 *   - priority mapping: Jira priority → KOTA priority
 *   - update() in_progress → transitions issue to In Progress and assigns user
 *   - update() keeps collection unchanged when Jira rejects transition
 *   - update() skips assignee call when claimOnStart is false
 *   - update() done → transitions issue to Done
 *   - add() creates Jira issue and updates collection with real key
 *   - update() throws when task ID not found
 *   - onLoad integration in jira module
 */

import { describe, expect, it, vi } from "vitest";
import { outboundHttp } from "#core/outbound-http/index.js";
import type { JiraFetchFn, JiraTaskProviderConfig } from "./task-provider.js";
import { JiraTaskProvider } from "./task-provider.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MYSELF_RESPONSE = { accountId: "user-abc-123" };
const TRANSITIONS_RESPONSE = {
  transitions: [
    { id: "21", name: "In Progress" },
    { id: "31", name: "Done" },
  ],
};
const EMPTY_ISSUES = { issues: [] };

function makeIssue(
  key: string,
  summary: string,
  priorityName: string | null = "Medium",
  descriptionText: string | null = null,
) {
  return {
    id: key.replace("ENG-", "100"),
    key,
    fields: {
      summary,
      status: { name: "To Do" },
      priority: priorityName ? { name: priorityName } : null,
      description: descriptionText
        ? {
            content: [
              {
                content: [{ text: descriptionText }],
              },
            ],
          }
        : null,
    },
  };
}

function makeProvider(
  fetchFn: JiraFetchFn,
  configOverrides: Partial<JiraTaskProviderConfig> = {},
) {
  return new JiraTaskProvider(
    {
      enabled: true,
      projectKey: "ENG",
      ...configOverrides,
    },
    fetchFn,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("JiraTaskProvider", () => {
  describe("init()", () => {
    it("fetches myself, issues, and transitions and populates collection", async () => {
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

      expect(provider.collection.count()).toBe(2);
      const tasks = provider.collection.list();
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

      expect(provider.collection.list()[0]?.notes).toBe("Some details here");
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

      expect(provider.collection.list()[0]?.priority).toBe(kotaPriority);
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

      const task = await provider.update(provider.collection.list()[0]!.id, { status: "in_progress" });
      expect(task.status).toBe("in_progress");

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

    it("keeps the collection status unchanged when Jira rejects the transition", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce({ issues: [makeIssue("ENG-10", "A task")] })
        .mockResolvedValueOnce(TRANSITIONS_RESPONSE)
        .mockRejectedValueOnce(new Error("Jira transition failed"));
      const provider = makeProvider(fetch);
      await provider.init();
      const taskId = provider.collection.list()[0]!.id;

      await expect(provider.update(taskId, { status: "in_progress" })).rejects.toThrow(
        "Jira transition failed",
      );
      expect(provider.collection.get(taskId)?.status).toBe("pending");
    });

    it("skips assignee call when claimOnStart is false", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce({ issues: [makeIssue("ENG-10", "A task")] })
        .mockResolvedValueOnce(TRANSITIONS_RESPONSE)
        .mockResolvedValue({});

      const provider = makeProvider(fetch, { claimOnStart: false });
      await provider.init();

      await provider.update(provider.collection.list()[0]!.id, { status: "in_progress" });

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

      const task = await provider.update(provider.collection.list()[0]!.id, { status: "done" });
      expect(task.status).toBe("done");
      expect(task.completed).toBeDefined();

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
    it("creates a Jira issue and updates collection with the real key", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce(EMPTY_ISSUES)
        .mockResolvedValueOnce({ id: "100", key: "ENG-100" });

      const provider = makeProvider(fetch);
      await provider.init();

      const task = await provider.add("New task");
      expect(task.id).toBeGreaterThan(0);

      const createCall = fetch.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("/rest/api/3/issue") &&
          c[1]?.method === "POST",
      );
      expect(createCall).toBeDefined();

      expect(provider.collection.get(task.id)?.task).toBe("New task");
    });
  });

  describe("update() — not found", () => {
    it("throws when task ID not in collection", async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(MYSELF_RESPONSE)
        .mockResolvedValueOnce(EMPTY_ISSUES);

      const provider = makeProvider(fetch);
      await provider.init();

      await expect(provider.update(999, { status: "done" })).rejects.toThrow(
        "Task #999 not found",
      );
    });
  });
});

describe("JiraTaskProvider — onLoad integration in jira module", () => {
  it("provider is registered when taskProvider.enabled is true", async () => {
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
      getContributedUiSurfaces: () => [],
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

  it.each([
    ["plaintext HTTP", "http://myorg.atlassian.net", "must use HTTPS"],
    ["a non-Atlassian destination", "https://jira.example.com", "must be a Jira Cloud"],
    ["URL credentials", "https://user:password@myorg.atlassian.net", "must not contain URL credentials"],
    ["a path", "https://myorg.atlassian.net/jira", "must not contain a path"],
    ["a query", "https://myorg.atlassian.net?redirect=example.com", "must not contain a path"],
    ["a fragment", "https://myorg.atlassian.net#fragment", "must not contain a path"],
  ])("rejects %s before initializing the provider or invoking HTTP", async (_label, baseUrl, message) => {
    const { JiraTaskProvider: TP } = await import("./task-provider.js");
    const initSpy = vi.spyOn(TP.prototype, "init");
    const requestSpy = vi.spyOn(outboundHttp, "request");
    const { default: jiraModule } = await import("./index.js");
    const ctx = {
      getModuleConfig: vi.fn(() => ({
        apiToken: "jira_token",
        userEmail: "user@example.com",
        baseUrl,
        taskProvider: { enabled: true, projectKey: "ENG" },
      })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerProvider: vi.fn(),
    };

    if (typeof jiraModule.onLoad === "function") {
      await expect(jiraModule.onLoad(ctx as never)).rejects.toThrow(message);
    }

    expect(initSpy).not.toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();
    expect(ctx.registerProvider).not.toHaveBeenCalled();
    initSpy.mockRestore();
    requestSpy.mockRestore();
  });
});
