import {
  existsSync,
  lstatSync,
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

  it("moves a task from open to blocked and updates frontmatter", async () => {
    writeTaskFile(repoRoot, "open", "x", {
      id: "task-x",
      title: "X",
      priority: "p2",
      status: "open",
    });

    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "blocked" }), res, "task-x", mutationTarget(repoRoot));
    expect(result.status).toBe(200);
    expect((result.body as Record<string, string>).state).toBe("blocked");

    const newPath = join(repoRoot, "data", "tasks", "task-x.md");
    expect(existsSync(newPath)).toBe(true);
    expect(readFileSync(newPath, "utf-8")).toContain("status: blocked");
  });

  it("moves a task to dropped", async () => {
    writeTaskFile(repoRoot, "open", "y", {
      id: "task-y",
      title: "Y",
      priority: "p3",
      status: "open",
    });

    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "dropped" }), res, "task-y", mutationTarget(repoRoot));
    expect(result.status).toBe(200);
    expect((result.body as Record<string, string>).state).toBe("dropped");
    expect(existsSync(join(repoRoot, "data", "tasks", "archive", "task-y.md"))).toBe(true);
  });

  it("returns 200 with no-op when state is same", async () => {
    writeTaskFile(repoRoot, "open", "z", {
      id: "task-z",
      title: "Z",
      priority: "p1",
      status: "open",
    });

    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "open" }), res, "task-z", mutationTarget(repoRoot));
    expect(result.status).toBe(200);
    expect(existsSync(join(repoRoot, "data", "tasks", "task-z.md"))).toBe(true);
  });

  it("returns 400 for invalid target state", async () => {
    writeTaskFile(repoRoot, "open", "task-q", { id: "task-q", title: "Q", priority: "p2", status: "open" });
    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "invalid" }), res, "task-q", mutationTarget(repoRoot));
    expect(result.status).toBe(400);
  });

  it("returns 404 when task not found", async () => {
    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "open" }), res, "task-nonexistent", mutationTarget(repoRoot));
    expect(result.status).toBe(404);
  });

  it("moves a task to blocked through the unrestricted move route", async () => {
    writeTaskFile(repoRoot, "open", "mover", { id: "task-mover", status: "open" });

    const { res, result } = mockResponse();
    await handleTaskMove(mockRequest({ state: "blocked" }), res, "task-mover", mutationTarget(repoRoot));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ fromState: "open", toState: "blocked" });
    expect(existsSync(join(repoRoot, "data", "tasks", "task-mover.md"))).toBe(true);
  });

  it("rejects a symlinked task in the daemon move route without changing its target", async () => {
    writeTaskFile(repoRoot, "open", "linked-route", {
      id: "task-linked-route",
      status: "open",
    });
    const sourcePath = join(
      repoRoot,
      "data",
      "tasks",
      "task-linked-route.md",
    );
    const outsidePath = join(repoRoot, "outside-route-target.md");
    const outsideContent = readFileSync(sourcePath, "utf-8");
    writeFileSync(outsidePath, outsideContent, "utf-8");
    rmSync(sourcePath);
    symlinkSync(outsidePath, sourcePath);

    const { res, result } = mockResponse();
    await handleTaskMove(
      mockRequest({ state: "blocked" }),
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
        join(repoRoot, "data", "tasks", "archive", "task-linked-route.md"),
      ),
    ).toBe(false);
  });

  it("returns 400 for encoded slash traversal ids on the unrestricted move route", async () => {
    const match = findRouteMatch(taskRoutes(), "PATCH", "/api/tasks/%2E%2E%2FAGENTS/move");
    expect(match?.params).toEqual({ id: "../AGENTS" });

    const { res, result } = mockResponse();
    await handleTaskMove(mockRequest({ state: "open" }), res, match?.params.id ?? "", mutationTarget(repoRoot));
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ reason: "invalid_id" });
  });

  it("returns move errors for missing, duplicate, and invalid states", async () => {
    const missing = mockResponse();
    await handleTaskMove(mockRequest({ state: "open" }), missing.res, "task-missing", mutationTarget(repoRoot));
    expect(missing.result.status).toBe(404);

    writeTaskFile(repoRoot, "open", "stay", { id: "task-stay", status: "open" });
    const same = mockResponse();
    await handleTaskMove(mockRequest({ state: "open" }), same.res, "task-stay", mutationTarget(repoRoot));
    expect(same.result.status).toBe(409);

    const invalid = mockResponse();
    await handleTaskMove(mockRequest({ state: "bogus" }), invalid.res, "task-stay", mutationTarget(repoRoot));
    expect(invalid.result.status).toBe(400);
  });
});
