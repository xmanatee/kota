import { describe, expect, it, vi } from "vitest";
import type { LinearTeamContext } from "./linear-tools.js";
import { makeLinearTools, resolveTeamContext } from "./linear-tools.js";
import type { LinearFetchFn } from "./task-provider.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_TEAM_CONTEXT: LinearTeamContext = {
  teamId: "team-1",
  stateIds: new Map([
    ["Backlog", "state-backlog"],
    ["Todo", "state-todo"],
    ["In Progress", "state-inprogress"],
    ["Done", "state-done"],
  ]),
};

function makeTools(fetchFn: LinearFetchFn, ctx = DEFAULT_TEAM_CONTEXT) {
  const getCtx = () => Promise.resolve(ctx);
  return makeLinearTools(fetchFn, getCtx);
}

function findTool(tools: ReturnType<typeof makeTools>, name: string) {
  const tool = tools.find((t) => t.tool.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

// ─── resolveTeamContext ──────────────────────────────────────────────────────

describe("resolveTeamContext", () => {
  it("resolves team ID and state map from API response", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      data: {
        teams: {
          nodes: [
            {
              id: "team-abc",
              states: {
                nodes: [
                  { id: "s1", name: "Backlog", type: "backlog" },
                  { id: "s2", name: "In Progress", type: "started" },
                ],
              },
            },
          ],
        },
      },
    });

    const ctx = await resolveTeamContext(fetch, "ENG");
    expect(ctx.teamId).toBe("team-abc");
    expect(ctx.stateIds.get("Backlog")).toBe("s1");
    expect(ctx.stateIds.get("In Progress")).toBe("s2");
  });

  it("throws when team is not found", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      data: { teams: { nodes: [] } },
    });
    await expect(resolveTeamContext(fetch, "NOPE")).rejects.toThrow('team "NOPE" not found');
  });

  it("throws when API returns errors", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      data: {},
      errors: [{ message: "Unauthorized" }],
    });
    await expect(resolveTeamContext(fetch, "ENG")).rejects.toThrow("Unauthorized");
  });
});

// ─── linear_create_issue ─────────────────────────────────────────────────────

describe("linear_create_issue", () => {
  it("creates an issue and returns identifier and URL", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      data: {
        issueCreate: {
          success: true,
          issue: { id: "uuid-1", identifier: "ENG-42", url: "https://linear.app/eng/issue/ENG-42" },
        },
      },
    });

    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_create_issue").runner({
      title: "Fix the widget",
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("ENG-42");
    expect(result.content).toContain("https://linear.app/eng/issue/ENG-42");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [query, vars] = fetch.mock.calls[0];
    expect(query).toContain("issueCreate");
    expect(vars.teamId).toBe("team-1");
    expect(vars.title).toBe("Fix the widget");
  });

  it("passes description and priority when provided", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      data: {
        issueCreate: {
          success: true,
          issue: { id: "uuid-2", identifier: "ENG-43", url: "https://linear.app/eng/issue/ENG-43" },
        },
      },
    });

    const tools = makeTools(fetch);
    await findTool(tools, "linear_create_issue").runner({
      title: "Add feature",
      description: "Detailed description here",
      priority: 2,
    });

    const [, vars] = fetch.mock.calls[0];
    expect(vars.description).toBe("Detailed description here");
    expect(vars.priority).toBe(2);
  });

  it("resolves label name to ID before creating", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        data: {
          team: { labels: { nodes: [{ id: "label-id-1" }] } },
        },
      })
      .mockResolvedValueOnce({
        data: {
          issueCreate: {
            success: true,
            issue: { id: "uuid-3", identifier: "ENG-44", url: "https://linear.app/eng/issue/ENG-44" },
          },
        },
      });

    const tools = makeTools(fetch);
    await findTool(tools, "linear_create_issue").runner({
      title: "Labeled issue",
      labelName: "bug",
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    const [labelQuery] = fetch.mock.calls[0];
    expect(labelQuery).toContain("FindLabel");
    const [, createVars] = fetch.mock.calls[1];
    expect(createVars.labelIds).toEqual(["label-id-1"]);
  });

  it("returns error when title is missing", async () => {
    const fetch = vi.fn();
    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_create_issue").runner({});

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("title is required");
  });

  it("returns error on GraphQL failure", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      data: {},
      errors: [{ message: "Rate limited" }],
    });

    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_create_issue").runner({
      title: "Will fail",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Rate limited");
  });

  it("returns error when issueCreate reports failure", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      data: { issueCreate: { success: false } },
    });

    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_create_issue").runner({
      title: "Will fail",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("creation failed");
  });
});

// ─── linear_update_issue_state ───────────────────────────────────────────────

describe("linear_update_issue_state", () => {
  it("transitions an issue to the named state", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      data: {
        issueUpdate: {
          success: true,
          issue: { id: "uuid-1", identifier: "ENG-42", state: { name: "In Progress" } },
        },
      },
    });

    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_update_issue_state").runner({
      issueId: "uuid-1",
      stateName: "In Progress",
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("ENG-42");
    expect(result.content).toContain("In Progress");

    const [, vars] = fetch.mock.calls[0];
    expect(vars.id).toBe("uuid-1");
    expect(vars.stateId).toBe("state-inprogress");
  });

  it("returns error for unknown state name", async () => {
    const fetch = vi.fn();
    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_update_issue_state").runner({
      issueId: "uuid-1",
      stateName: "Nonexistent",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("unknown state");
    expect(result.content).toContain("Backlog");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns error when issueId is missing", async () => {
    const fetch = vi.fn();
    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_update_issue_state").runner({
      stateName: "Done",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("issueId is required");
  });

  it("returns error when stateName is missing", async () => {
    const fetch = vi.fn();
    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_update_issue_state").runner({
      issueId: "uuid-1",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("stateName is required");
  });

  it("returns error on GraphQL failure", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      data: {},
      errors: [{ message: "Not found" }],
    });

    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_update_issue_state").runner({
      issueId: "uuid-1",
      stateName: "Done",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Not found");
  });

  it("returns error when issueUpdate reports failure", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      data: { issueUpdate: { success: false } },
    });

    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_update_issue_state").runner({
      issueId: "uuid-1",
      stateName: "Done",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("update failed");
  });
});

// ─── linear_add_comment ──────────────────────────────────────────────────────

describe("linear_add_comment", () => {
  it("posts a comment and returns the URL", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      data: {
        commentCreate: {
          success: true,
          comment: { id: "comment-1", url: "https://linear.app/eng/issue/ENG-42#comment-1" },
        },
      },
    });

    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_add_comment").runner({
      issueId: "uuid-1",
      body: "This is a comment",
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Comment posted");
    expect(result.content).toContain("https://linear.app/eng/issue/ENG-42#comment-1");

    const [query, vars] = fetch.mock.calls[0];
    expect(query).toContain("commentCreate");
    expect(vars.issueId).toBe("uuid-1");
    expect(vars.body).toBe("This is a comment");
  });

  it("returns error when issueId is missing", async () => {
    const fetch = vi.fn();
    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_add_comment").runner({
      body: "orphan comment",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("issueId is required");
  });

  it("returns error when body is missing", async () => {
    const fetch = vi.fn();
    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_add_comment").runner({
      issueId: "uuid-1",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("body is required");
  });

  it("returns error on GraphQL failure", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      data: {},
      errors: [{ message: "Forbidden" }],
    });

    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_add_comment").runner({
      issueId: "uuid-1",
      body: "Will fail",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Forbidden");
  });

  it("returns error when commentCreate reports failure", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      data: { commentCreate: { success: false } },
    });

    const tools = makeTools(fetch);
    const result = await findTool(tools, "linear_add_comment").runner({
      issueId: "uuid-1",
      body: "Will fail",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("comment creation failed");
  });
});

// ─── Module integration ──────────────────────────────────────────────────────

describe("Linear module tools() integration", () => {
  it("returns tools when apiKey and teamKey are configured", async () => {
    const { default: linearModule } = await import("./index.js");

    const ctx = {
      getModuleConfig: vi.fn(() => ({
        apiKey: "lin_test_key",
        teamKey: "ENG",
      })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    const tools = typeof linearModule.tools === "function"
      ? linearModule.tools(ctx as never)
      : linearModule.tools ?? [];

    const names = tools.map((t: { tool: { name: string } }) => t.tool.name);
    expect(names).toContain("linear_create_issue");
    expect(names).toContain("linear_update_issue_state");
    expect(names).toContain("linear_add_comment");
  });

  it("returns empty tools when apiKey is missing", async () => {
    const { default: linearModule } = await import("./index.js");

    const ctx = {
      getModuleConfig: vi.fn(() => ({ teamKey: "ENG" })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    const tools = typeof linearModule.tools === "function"
      ? linearModule.tools(ctx as never)
      : linearModule.tools ?? [];

    expect(tools).toHaveLength(0);
  });

  it("returns empty tools when teamKey is missing", async () => {
    const { default: linearModule } = await import("./index.js");

    const ctx = {
      getModuleConfig: vi.fn(() => ({ apiKey: "lin_test_key" })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    const tools = typeof linearModule.tools === "function"
      ? linearModule.tools(ctx as never)
      : linearModule.tools ?? [];

    expect(tools).toHaveLength(0);
  });

  it("uses taskProvider.teamKey when top-level teamKey is absent", async () => {
    const { default: linearModule } = await import("./index.js");

    const ctx = {
      getModuleConfig: vi.fn(() => ({
        apiKey: "lin_test_key",
        taskProvider: { enabled: false, teamKey: "TEAM" },
      })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    const tools = typeof linearModule.tools === "function"
      ? linearModule.tools(ctx as never)
      : linearModule.tools ?? [];

    expect(tools).toHaveLength(3);
  });
});
