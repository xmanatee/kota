import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  handleTaskCapture,
  handleTaskCreate,
  handleTaskCreateNormalized,
} from "./routes.js";
import {
  makeScopeRoot,
  mockRequest,
  mockResponse,
  mutationTarget,
  resetRouteTestAuthority,
} from "./routes-test-helpers.js";

describe("task create routes", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    resetRouteTestAuthority();
  });

  it("creates a complete open task file", async () => {
    const { res, result } = mockResponse();
    const body = "Keep the complete owner request.\n\n  Indented detail\nLast line.  \n";
    await handleTaskCreate(mockRequest({ title: "My new task", body, priority: "p2" }), res, mutationTarget(repoRoot));
    expect(result.status).toBe(201);
    expect((result.body as Record<string, string>).id).toBe("task-my-new-task");

    const content = readFileSync(join(repoRoot, "data", "tasks", "task-my-new-task.md"), "utf-8");
    expect(content).toContain("# My new task");
    expect(content).toContain("status: open");
    expect(content).toContain("priority: p2");
    expect(content).toContain(body);
  });

  it.each([undefined, "", " \n\t", "<!-- unfinished -->", "## Problem\n\n<!-- unfinished", "Describe the problem and why it matters."])("rejects absent or unauthored intent (%j) without creating a file", async (body) => {
    const { res, result } = mockResponse();
    await handleTaskCreate(mockRequest({ title: "Incomplete", priority: "p2", ...(body === undefined ? {} : { body }) }), res, mutationTarget(repoRoot));
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ reason: "invalid_body" });
    expect(existsSync(join(repoRoot, "data/tasks/task-incomplete.md"))).toBe(false);
  });

  it("returns 400 when inbox title is missing", async () => {
    const { res, result } = mockResponse();
    await handleTaskCreate(mockRequest({ priority: "p2" }), res, mutationTarget(repoRoot));
    expect(result.status).toBe(400);
  });

  it("rejects a symlinked tasks directory in the daemon create route", async () => {
    const outsideDir = join(repoRoot, "outside-tasks");
    mkdirSync(outsideDir, { recursive: true });
    mkdirSync(join(repoRoot, "data"), { recursive: true });
    rmSync(join(repoRoot, "data", "tasks"), { recursive: true, force: true });
    symlinkSync(outsideDir, join(repoRoot, "data", "tasks"), "dir");

    const { res, result } = mockResponse();
    await handleTaskCreate(
      mockRequest({ title: "Escaping tasks", body: "Stay within the project.", priority: "p2" }),
      res,
      mutationTarget(repoRoot),
    );

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      error: expect.stringMatching(/symbolic-link directory components are forbidden/),
    });
    expect(existsSync(join(outsideDir, "task-escaping-tasks.md"))).toBe(false);
    expect(readdirSync(outsideDir)).toEqual([]);
  });

  it("creates a normalized task with the submitted body", async () => {
    const req = mockRequest({ title: "Add dashboard", body: "Show the current queue in the dashboard.", priority: "p2", state: "open" });
    const { res, result } = mockResponse();
    await handleTaskCreateNormalized(req, res, mutationTarget(repoRoot));
    expect(result.status).toBe(201);
    const body = result.body as { id: string; path: string };
    expect(body.id).toBe("task-add-dashboard");
    expect(readFileSync(join(repoRoot, body.path), "utf-8")).toContain(
      "Show the current queue in the dashboard.",
    );
  });

  it("rejects invalid normalized task fields and duplicate ids", async () => {
    const badPriority = mockResponse();
    await handleTaskCreateNormalized(mockRequest({ title: "Bad", body: "Reject invalid metadata.", priority: "p9", state: "open" }), badPriority.res, mutationTarget(repoRoot));
    expect(badPriority.result.status).toBe(400);

    const badState = mockResponse();
    await handleTaskCreateNormalized(mockRequest({ title: "Bad", body: "Reject invalid metadata.", priority: "p2", state: "nope" }), badState.res, mutationTarget(repoRoot));
    expect(badState.result.status).toBe(400);

    const first = mockResponse();
    await handleTaskCreateNormalized(mockRequest({ title: "Dup", body: "Retain this task.", priority: "p2", state: "open" }), first.res, mutationTarget(repoRoot));
    const second = mockResponse();
    await handleTaskCreateNormalized(mockRequest({ title: "Dup", body: "Retain this task.", priority: "p2", state: "open" }), second.res, mutationTarget(repoRoot));
    expect(second.result.status).toBe(409);
  });

  it("captures deterministic inbox files and rejects duplicates", async () => {
    const first = mockResponse();
    await handleTaskCapture(mockRequest({ title: "Quick note" }), first.res, mutationTarget(repoRoot));
    expect(first.result.status).toBe(201);
    expect((first.result.body as { id: string }).id).toBe("task-quick-note");

    const dupA = mockResponse();
    await handleTaskCapture(mockRequest({ title: "Dup" }), dupA.res, mutationTarget(repoRoot));
    const dupB = mockResponse();
    await handleTaskCapture(mockRequest({ title: "Dup" }), dupB.res, mutationTarget(repoRoot));
    expect(dupB.result.status).toBe(409);
  });
});
