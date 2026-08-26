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

  it("creates a new inbox task file", async () => {
    const { res, result } = mockResponse();
    await handleTaskCreate(mockRequest({ title: "My new task", summary: "A quick summary" }), res, mutationTarget(repoRoot));
    expect(result.status).toBe(201);
    expect((result.body as Record<string, string>).id).toMatch(/^task-my-new-task-/);

    const inboxDir = join(repoRoot, "data", "inbox");
    const files = readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(1);
    const content = readFileSync(join(inboxDir, files[0]), "utf-8");
    expect(content).toContain("# My new task");
    expect(content).toContain("A quick summary");
  });

  it("returns 400 when inbox title is missing", async () => {
    const { res, result } = mockResponse();
    await handleTaskCreate(mockRequest({ summary: "No title here" }), res, mutationTarget(repoRoot));
    expect(result.status).toBe(400);
  });

  it("rejects a symlinked inbox directory in the daemon create route", async () => {
    const outsideDir = join(repoRoot, "outside-inbox");
    mkdirSync(outsideDir, { recursive: true });
    mkdirSync(join(repoRoot, "data"), { recursive: true });
    symlinkSync(outsideDir, join(repoRoot, "data", "inbox"), "dir");

    const { res, result } = mockResponse();
    await handleTaskCreate(
      mockRequest({ title: "Escaping inbox", summary: "Must not be written" }),
      res,
      mutationTarget(repoRoot),
    );

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      error: expect.stringMatching(/symbolic-link directory components are forbidden/),
    });
    expect(existsSync(join(outsideDir, "task-escaping-inbox.md"))).toBe(false);
    expect(readdirSync(outsideDir)).toEqual([]);
  });

  it("creates a normalized task with full template", async () => {
    const req = mockRequest({ title: "Add dashboard", priority: "p2", area: "ui", state: "backlog", summary: "summary" });
    const { res, result } = mockResponse();
    await handleTaskCreateNormalized(req, res, mutationTarget(repoRoot));
    expect(result.status).toBe(201);
    const body = result.body as { id: string; path: string };
    expect(body.id).toBe("task-add-dashboard");
    expect(readFileSync(join(repoRoot, body.path), "utf-8")).toContain(
      "## How We Will Know",
    );
  });

  it("rejects invalid normalized task fields and duplicate ids", async () => {
    const badPriority = mockResponse();
    await handleTaskCreateNormalized(mockRequest({ title: "Bad", priority: "p9", area: "ui", state: "backlog" }), badPriority.res, mutationTarget(repoRoot));
    expect(badPriority.result.status).toBe(400);

    const badState = mockResponse();
    await handleTaskCreateNormalized(mockRequest({ title: "Bad", priority: "p2", area: "ui", state: "nope" }), badState.res, mutationTarget(repoRoot));
    expect(badState.result.status).toBe(400);

    const first = mockResponse();
    await handleTaskCreateNormalized(mockRequest({ title: "Dup", priority: "p2", area: "ui", state: "backlog" }), first.res, mutationTarget(repoRoot));
    const second = mockResponse();
    await handleTaskCreateNormalized(mockRequest({ title: "Dup", priority: "p2", area: "ui", state: "backlog" }), second.res, mutationTarget(repoRoot));
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
