import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findRouteMatch } from "#core/modules/route-matcher.js";
import { handleTaskMove, handleTaskStateChange, taskRoutes } from "./routes.js";
import { makeProjectDir, mockRequest, mockResponse, writeTaskFile } from "./routes-test-helpers.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => {
    throw new Error("not a git repo");
  }),
  execFileSync: vi.fn(() => {
    throw new Error("not a git repo");
  }),
}));

describe("task state routes", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    vi.mocked(execFileSync).mockImplementation((_file: unknown, args?: unknown) => {
      const argv = Array.isArray(args) ? (args as string[]) : [];
      if (argv[0] === "mv") {
        const [, src, dst] = argv;
        writeFileSync(dst, readFileSync(src, "utf-8"));
        rmSync(src);
      }
      return Buffer.from("");
    });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("moves a task from ready to backlog and updates frontmatter", async () => {
    writeTaskFile(projectDir, "ready", "x", {
      id: "task-x",
      title: "X",
      priority: "p2",
      status: "ready",
    });

    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "backlog" }), res, "task-x", projectDir);
    expect(result.status).toBe(200);
    expect((result.body as Record<string, string>).state).toBe("backlog");

    const newPath = join(projectDir, "data", "tasks", "backlog", "task-x.md");
    expect(existsSync(newPath)).toBe(true);
    expect(readFileSync(newPath, "utf-8")).toContain("status: backlog");
    expect(existsSync(join(projectDir, "data", "tasks", "ready", "task-x.md"))).toBe(false);
  });

  it("moves a task to dropped", async () => {
    writeTaskFile(projectDir, "backlog", "y", {
      id: "task-y",
      title: "Y",
      priority: "p3",
      status: "backlog",
    });

    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "dropped" }), res, "task-y", projectDir);
    expect(result.status).toBe(200);
    expect((result.body as Record<string, string>).state).toBe("dropped");
    expect(existsSync(join(projectDir, "data", "tasks", "dropped", "task-y.md"))).toBe(true);
  });

  it("fails without mutating task state when git cannot stage the move", async () => {
    writeTaskFile(projectDir, "ready", "git-failure", {
      id: "task-git-failure",
      title: "Git failure",
      priority: "p2",
      status: "ready",
    });
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error("git mv failed");
    });

    const { res, result } = mockResponse();
    await handleTaskStateChange(
      mockRequest({ state: "backlog" }),
      res,
      "task-git-failure",
      projectDir,
    );

    expect(result.status).toBe(500);
    expect(
      existsSync(
        join(projectDir, "data", "tasks", "ready", "task-git-failure.md"),
      ),
    ).toBe(true);
  });

  it("returns 200 with no-op when state is same", async () => {
    writeTaskFile(projectDir, "ready", "task-z", {
      id: "task-z",
      title: "Z",
      priority: "p1",
      status: "ready",
    });

    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "ready" }), res, "task-z", projectDir);
    expect(result.status).toBe(200);
    expect(existsSync(join(projectDir, "data", "tasks", "ready", "task-task-z.md"))).toBe(true);
  });

  it("returns 400 for invalid target state", async () => {
    writeTaskFile(projectDir, "ready", "task-q", { id: "task-q", title: "Q", priority: "p2", status: "ready" });
    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "doing" }), res, "task-q", projectDir);
    expect(result.status).toBe(400);
  });

  it("returns 404 when task not found", async () => {
    const { res, result } = mockResponse();
    await handleTaskStateChange(mockRequest({ state: "backlog" }), res, "task-nonexistent", projectDir);
    expect(result.status).toBe(404);
  });

  it("moves a task to doing through the unrestricted move route", async () => {
    writeTaskFile(projectDir, "ready", "mover", { id: "task-mover", status: "ready" });
    mkdirSync(join(projectDir, "data", "tasks", "doing"), { recursive: true });
    vi.mocked(execFileSync).mockImplementation((_file: unknown, args?: unknown) => {
      const argv = Array.isArray(args) ? (args as string[]) : [];
      if (argv[0] === "mv") {
        const [, src, dst] = argv;
        writeFileSync(dst, readFileSync(src, "utf-8"));
        rmSync(src);
      }
      return Buffer.from("");
    });

    const { res, result } = mockResponse();
    await handleTaskMove(mockRequest({ state: "doing" }), res, "task-mover", projectDir);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ fromState: "ready", toState: "doing" });
    expect(existsSync(join(projectDir, "data", "tasks", "doing", "task-mover.md"))).toBe(true);
  });

  it("returns 400 for encoded slash traversal ids on the unrestricted move route", async () => {
    const execFile = vi.mocked(execFileSync);
    execFile.mockClear();
    const match = findRouteMatch(taskRoutes(), "PATCH", "/api/tasks/%2E%2E%2FAGENTS/move");
    expect(match?.params).toEqual({ id: "../AGENTS" });

    const { res, result } = mockResponse();
    await handleTaskMove(mockRequest({ state: "doing" }), res, match?.params.id ?? "", projectDir);
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ reason: "invalid_id" });
    expect(execFile).not.toHaveBeenCalled();
  });

  it("returns move errors for missing, duplicate, and invalid states", async () => {
    const missing = mockResponse();
    await handleTaskMove(mockRequest({ state: "backlog" }), missing.res, "task-missing", projectDir);
    expect(missing.result.status).toBe(404);

    writeTaskFile(projectDir, "ready", "stay", { id: "task-stay", status: "ready" });
    const same = mockResponse();
    await handleTaskMove(mockRequest({ state: "ready" }), same.res, "task-stay", projectDir);
    expect(same.result.status).toBe(409);

    const invalid = mockResponse();
    await handleTaskMove(mockRequest({ state: "bogus" }), invalid.res, "task-stay", projectDir);
    expect(invalid.result.status).toBe(400);
  });
});
