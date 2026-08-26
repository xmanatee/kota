import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRouteMatch } from "#core/modules/route-matcher.js";
import { handleTaskShow, taskRoutes } from "./routes.js";
import { makeScopeRoot, mockResponse, writeTaskFile } from "./routes-test-helpers.js";

describe("task show route", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("returns 200 with state and content for an existing task", async () => {
    writeTaskFile(repoRoot, "ready", "showme", { id: "task-showme", title: "Show me" });
    const { res, result } = mockResponse();
    await handleTaskShow(res, "task-showme", repoRoot);
    expect(result.status).toBe(200);
    const body = result.body as { state: string; content: string };
    expect(body.state).toBe("ready");
    expect(body.content).toContain("id: task-showme");
  });

  it("returns 404 when task does not exist", async () => {
    const { res, result } = mockResponse();
    await handleTaskShow(res, "task-missing", repoRoot);
    expect(result.status).toBe(404);
  });

  it("returns 400 for encoded slash traversal route ids", async () => {
    writeFileSync(join(repoRoot, "AGENTS.md"), "# outside task queue\n");
    const match = findRouteMatch(taskRoutes(), "GET", "/api/tasks/%2E%2E%2FAGENTS");
    expect(match?.params).toEqual({ id: "../AGENTS" });

    const { res, result } = mockResponse();
    await handleTaskShow(res, match?.params.id ?? "", repoRoot);
    expect(result.status).toBe(400);
  });
});
