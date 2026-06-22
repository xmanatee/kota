import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleTaskCapture,
  handleTaskCreate,
  handleTaskCreateNormalized,
} from "./routes.js";
import { makeProjectDir, mockRequest, mockResponse } from "./routes-test-helpers.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => {
    throw new Error("not a git repo");
  }),
  execFileSync: vi.fn(() => {
    throw new Error("not a git repo");
  }),
}));

describe("task create routes", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("creates a new inbox task file", async () => {
    const { res, result } = mockResponse();
    await handleTaskCreate(mockRequest({ title: "My new task", summary: "A quick summary" }), res, projectDir);
    expect(result.status).toBe(201);
    expect((result.body as Record<string, string>).id).toMatch(/^task-my-new-task-/);

    const inboxDir = join(projectDir, "data", "inbox");
    const files = readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(1);
    const content = readFileSync(join(inboxDir, files[0]), "utf-8");
    expect(content).toContain("# My new task");
    expect(content).toContain("A quick summary");
  });

  it("returns 400 when inbox title is missing", async () => {
    const { res, result } = mockResponse();
    await handleTaskCreate(mockRequest({ summary: "No title here" }), res, projectDir);
    expect(result.status).toBe(400);
  });

  it("creates a normalized task with full template", async () => {
    const req = mockRequest({ title: "Add dashboard", priority: "p2", area: "ui", state: "backlog", summary: "summary" });
    const { res, result } = mockResponse();
    await handleTaskCreateNormalized(req, res, projectDir);
    expect(result.status).toBe(201);
    const body = result.body as { id: string; path: string };
    expect(body.id).toBe("task-add-dashboard");
    expect(readFileSync(body.path, "utf-8")).toContain("## Done When");
  });

  it("rejects invalid normalized task fields and duplicate ids", async () => {
    const badPriority = mockResponse();
    await handleTaskCreateNormalized(mockRequest({ title: "Bad", priority: "p9", area: "ui", state: "backlog" }), badPriority.res, projectDir);
    expect(badPriority.result.status).toBe(400);

    const badState = mockResponse();
    await handleTaskCreateNormalized(mockRequest({ title: "Bad", priority: "p2", area: "ui", state: "nope" }), badState.res, projectDir);
    expect(badState.result.status).toBe(400);

    const first = mockResponse();
    await handleTaskCreateNormalized(mockRequest({ title: "Dup", priority: "p2", area: "ui", state: "backlog" }), first.res, projectDir);
    const second = mockResponse();
    await handleTaskCreateNormalized(mockRequest({ title: "Dup", priority: "p2", area: "ui", state: "backlog" }), second.res, projectDir);
    expect(second.result.status).toBe(409);
  });

  it("captures deterministic inbox files and rejects duplicates", async () => {
    const first = mockResponse();
    await handleTaskCapture(mockRequest({ title: "Quick note" }), first.res, projectDir);
    expect(first.result.status).toBe(201);
    expect((first.result.body as { id: string }).id).toBe("task-quick-note");

    const dupA = mockResponse();
    await handleTaskCapture(mockRequest({ title: "Dup" }), dupA.res, projectDir);
    const dupB = mockResponse();
    await handleTaskCapture(mockRequest({ title: "Dup" }), dupB.res, projectDir);
    expect(dupB.result.status).toBe(409);
  });
});
