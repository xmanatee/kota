import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRouteMatch } from "#core/modules/route-matcher.js";
import { handleTaskMove, handleTaskStateChange, taskRoutes } from "./routes.js";
import {
  makeScopeRoot,
  mockRequest,
  mockResponse,
  mutationTarget,
  resetRouteTestAuthority,
  writeTaskFile,
} from "./routes-test-helpers.js";

describe("task state routes", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    resetRouteTestAuthority();
  });

  it("moves a task from ready to backlog and updates frontmatter", async () => {
    writeTaskFile(repoRoot, "ready", "x", {
      id: "task-x",
      title: "X",
      priority: "p2",
      status: "ready",
    });

    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "backlog" }), res, "task-x", mutationTarget(repoRoot));
    expect(result.status).toBe(200);
    expect((result.body as Record<string, string>).state).toBe("backlog");

    const newPath = join(repoRoot, "data", "tasks", "backlog", "task-x.md");
    expect(existsSync(newPath)).toBe(true);
    expect(readFileSync(newPath, "utf-8")).toContain("status: backlog");
    expect(existsSync(join(repoRoot, "data", "tasks", "ready", "task-x.md"))).toBe(false);
  });

  it("moves a task to dropped", async () => {
    writeTaskFile(repoRoot, "backlog", "y", {
      id: "task-y",
      title: "Y",
      priority: "p3",
      status: "backlog",
    });

    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "dropped" }), res, "task-y", mutationTarget(repoRoot));
    expect(result.status).toBe(200);
    expect((result.body as Record<string, string>).state).toBe("dropped");
    expect(existsSync(join(repoRoot, "data", "tasks", "dropped", "task-y.md"))).toBe(true);
  });

  it("returns 200 with no-op when state is same", async () => {
    writeTaskFile(repoRoot, "ready", "z", {
      id: "task-z",
      title: "Z",
      priority: "p1",
      status: "ready",
    });

    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "ready" }), res, "task-z", mutationTarget(repoRoot));
    expect(result.status).toBe(200);
    expect(existsSync(join(repoRoot, "data", "tasks", "ready", "task-z.md"))).toBe(true);
  });

  it("returns 400 for invalid target state", async () => {
    writeTaskFile(repoRoot, "ready", "task-q", { id: "task-q", title: "Q", priority: "p2", status: "ready" });
    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "doing" }), res, "task-q", mutationTarget(repoRoot));
    expect(result.status).toBe(400);
  });

  it("returns 404 when task not found", async () => {
    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "backlog" }), res, "task-nonexistent", mutationTarget(repoRoot));
    expect(result.status).toBe(404);
  });

  it("moves a task to doing through the unrestricted move route", async () => {
    writeTaskFile(repoRoot, "ready", "mover", { id: "task-mover", status: "ready" });
    mkdirSync(join(repoRoot, "data", "tasks", "doing"), { recursive: true });

    const { res, result } = mockResponse();
    await handleTaskMove(mockRequest({ state: "doing" }), res, "task-mover", mutationTarget(repoRoot));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ fromState: "ready", toState: "doing" });
    expect(existsSync(join(repoRoot, "data", "tasks", "doing", "task-mover.md"))).toBe(true);
  });

  it("rejects a symlinked task in the daemon move route without changing its target", async () => {
    writeTaskFile(repoRoot, "ready", "linked-route", {
      id: "task-linked-route",
      status: "ready",
    });
    const sourcePath = join(
      repoRoot,
      "data",
      "tasks",
      "ready",
      "task-linked-route.md",
    );
    const outsidePath = join(repoRoot, "outside-route-target.md");
    const outsideContent = readFileSync(sourcePath, "utf-8");
    writeFileSync(outsidePath, outsideContent, "utf-8");
    rmSync(sourcePath);
    symlinkSync(outsidePath, sourcePath);

    const { res, result } = mockResponse();
    await handleTaskMove(
      mockRequest({ state: "doing" }),
      res,
      "task-linked-route",
      mutationTarget(repoRoot),
    );

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      error: expect.stringMatching(/symbolic-link markdown entries are forbidden/),
    });
    expect(readFileSync(outsidePath, "utf-8")).toBe(outsideContent);
    expect(lstatSync(sourcePath).isSymbolicLink()).toBe(true);
    expect(
      existsSync(
        join(repoRoot, "data", "tasks", "doing", "task-linked-route.md"),
      ),
    ).toBe(false);
  });

  it("returns 400 for encoded slash traversal ids on the unrestricted move route", async () => {
    const match = findRouteMatch(taskRoutes(), "PATCH", "/api/tasks/%2E%2E%2FAGENTS/move");
    expect(match?.params).toEqual({ id: "../AGENTS" });

    const { res, result } = mockResponse();
    await handleTaskMove(mockRequest({ state: "doing" }), res, match?.params.id ?? "", mutationTarget(repoRoot));
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ reason: "invalid_id" });
  });

  it("returns move errors for missing, duplicate, and invalid states", async () => {
    const missing = mockResponse();
    await handleTaskMove(mockRequest({ state: "backlog" }), missing.res, "task-missing", mutationTarget(repoRoot));
    expect(missing.result.status).toBe(404);

    writeTaskFile(repoRoot, "ready", "stay", { id: "task-stay", status: "ready" });
    const same = mockResponse();
    await handleTaskMove(mockRequest({ state: "ready" }), same.res, "task-stay", mutationTarget(repoRoot));
    expect(same.result.status).toBe(409);

    const invalid = mockResponse();
    await handleTaskMove(mockRequest({ state: "bogus" }), invalid.res, "task-stay", mutationTarget(repoRoot));
    expect(invalid.result.status).toBe(400);
  });
});
