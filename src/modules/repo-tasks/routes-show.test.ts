import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRouteMatch } from "#core/modules/route-matcher.js";
import { handleTaskShow, taskRoutes } from "./routes.js";
import { makeProjectDir, mockResponse, writeTaskFile } from "./routes-test-helpers.js";

describe("task show route", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns 200 with state and content for an existing task", async () => {
    writeTaskFile(projectDir, "ready", "showme", { id: "task-showme", title: "Show me" });
    const { res, result } = mockResponse();
    await handleTaskShow(res, "task-showme", projectDir);
    expect(result.status).toBe(200);
    const body = result.body as { state: string; content: string };
    expect(body.state).toBe("ready");
    expect(body.content).toContain("id: task-showme");
  });

  it("returns 404 when task does not exist", async () => {
    const { res, result } = mockResponse();
    await handleTaskShow(res, "task-missing", projectDir);
    expect(result.status).toBe(404);
  });

  it("returns 400 for encoded slash traversal route ids", async () => {
    writeFileSync(join(projectDir, "AGENTS.md"), "# outside task queue\n");
    const match = findRouteMatch(taskRoutes(), "GET", "/api/tasks/%2E%2E%2FAGENTS");
    expect(match?.params).toEqual({ id: "../AGENTS" });

    const { res, result } = mockResponse();
    await handleTaskShow(res, match?.params.id ?? "", projectDir);
    expect(result.status).toBe(400);
  });
});
