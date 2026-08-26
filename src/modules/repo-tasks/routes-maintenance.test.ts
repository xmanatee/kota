import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleTaskBodyUpdate, handleTaskGc } from "./routes.js";
import {
  makeProjectDir,
  mockRequest,
  mockResponse,
  mutationTarget,
  resetRouteTestAuthority,
  writeTaskFile,
} from "./routes-test-helpers.js";

describe("task maintenance routes", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    resetRouteTestAuthority();
  });

  function writeTerminal(state: "done" | "dropped", id: string, updatedAt: string): void {
    const dir = join(projectDir, "data", "tasks", state);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${id}.md`),
      `---\nid: ${id}\ntitle: T\nstatus: ${state}\nupdated_at: ${updatedAt}\n---\n\n## Done.\n`,
    );
  }

  it("removes terminal tasks older than the threshold", async () => {
    writeTerminal("done", "task-old-gc", "2020-01-01");
    const { res, result } = mockResponse();
    await handleTaskGc(mockRequest({ days: 30 }), res, mutationTarget(projectDir));
    expect(result.status).toBe(200);
    expect((result.body as { removed: string[] }).removed).toContain("task-old-gc.md");
  });

  it("returns 400 when gc days is not positive", async () => {
    const { res, result } = mockResponse();
    await handleTaskGc(mockRequest({ days: 0 }), res, mutationTarget(projectDir));
    expect(result.status).toBe(400);
  });

  it("updates the body of an open task while preserving frontmatter", async () => {
    writeTaskFile(projectDir, "ready", "task-edit", {
      id: "task-edit",
      title: "Edit Me",
      priority: "p2",
      status: "ready",
      updated_at: "2026-01-01T00:00:00Z",
    });

    const { res, result } = mockResponse();
    await handleTaskBodyUpdate(mockRequest({ body: "## New body\n\nUpdated content." }), res, "task-edit", mutationTarget(projectDir));
    expect(result.status).toBe(200);
    expect((result.body as Record<string, string>).body).toContain("Updated content.");

    const content = readFileSync(join(projectDir, "data", "tasks", "ready", "task-task-edit.md"), "utf-8");
    expect(content).toContain("id: task-edit");
    expect(content).toContain("title: Edit Me");
    expect(content).toContain("status: ready");
    expect(content).toContain("Updated content.");
    expect(content).not.toContain("2026-01-01T00:00:00Z");
  });

  it("returns body update errors for missing, terminal, and malformed requests", async () => {
    const missing = mockResponse();
    await handleTaskBodyUpdate(mockRequest({ body: "some content" }), missing.res, "task-nonexistent", mutationTarget(projectDir));
    expect(missing.result.status).toBe(404);

    writeTaskFile(projectDir, "done", "task-done", {
      id: "task-done",
      title: "Done",
      priority: "p3",
      status: "done",
    });
    const terminal = mockResponse();
    await handleTaskBodyUpdate(mockRequest({ body: "## Should fail" }), terminal.res, "task-done", mutationTarget(projectDir));
    expect(terminal.result.status).toBe(409);

    writeTaskFile(projectDir, "ready", "task-nob", {
      id: "task-nob",
      title: "No Body",
      priority: "p3",
      status: "ready",
    });
    const noBody = mockResponse();
    await handleTaskBodyUpdate(mockRequest({ notbody: "wrong field" }), noBody.res, "task-nob", mutationTarget(projectDir));
    expect(noBody.result.status).toBe(400);
  });
});
