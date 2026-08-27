import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleTaskBodyUpdate } from "./routes.js";
import {
  makeScopeRoot,
  mockRequest,
  mockResponse,
  mutationTarget,
  resetRouteTestAuthority,
  writeTaskFile,
} from "./routes-test-helpers.js";

describe("task maintenance routes", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    resetRouteTestAuthority();
  });

  it("updates the body of an open task while preserving frontmatter", async () => {
    writeTaskFile(repoRoot, "open", "task-edit", {
      id: "task-edit",
      title: "Edit Me",
      priority: "p2",
      status: "open",
    });

    const { res, result } = mockResponse();
    await handleTaskBodyUpdate(mockRequest({ body: "# Edit Me\n\n## New body\n\nUpdated content." }), res, "task-edit", mutationTarget(repoRoot));
    expect(result.status).toBe(200);
    expect((result.body as Record<string, string>).body).toContain("Updated content.");

    const content = readFileSync(join(repoRoot, "data", "tasks", "task-edit.md"), "utf-8");
    expect(content).toContain("# Edit Me");
    expect(content).toContain("status: open");
    expect(content).toContain("priority: p2");
    expect(content).not.toContain("id:");
    expect(content).not.toContain("title:");
    expect(content).toContain("Updated content.");
    expect(content).not.toContain("2026-01-01T00:00:00Z");
  });

  it("returns body update errors for missing, terminal, and malformed requests", async () => {
    const missing = mockResponse();
    await handleTaskBodyUpdate(mockRequest({ body: "some content" }), missing.res, "task-nonexistent", mutationTarget(repoRoot));
    expect(missing.result.status).toBe(404);

    writeTaskFile(repoRoot, "done", "task-done", {
      id: "task-done",
      title: "Done",
      priority: "p3",
      status: "done",
    });
    const terminal = mockResponse();
    await handleTaskBodyUpdate(mockRequest({ body: "## Should fail" }), terminal.res, "task-done", mutationTarget(repoRoot));
    expect(terminal.result.status).toBe(409);

    writeTaskFile(repoRoot, "open", "task-nob", {
      id: "task-nob",
      title: "No Body",
      priority: "p3",
      status: "open",
    });
    const noBody = mockResponse();
    await handleTaskBodyUpdate(mockRequest({ notbody: "wrong field" }), noBody.res, "task-nob", mutationTarget(repoRoot));
    expect(noBody.result.status).toBe(400);
  });
});
