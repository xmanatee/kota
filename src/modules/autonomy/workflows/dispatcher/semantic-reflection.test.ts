import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deferProgressReviewSemanticInput,
  recordProgressReviewInputQueued,
} from "../progress-reviewer/semantic-input.js";
import { inspectProgressSemanticBoundary } from "./semantic-reflection.js";

function git(projectDir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function taskFixture(args: {
  id: string;
  state: "backlog" | "ready" | "blocked" | "done" | "dropped";
  priority?: "p0" | "p1" | "p2";
  anchor?: boolean;
  strategic?: boolean;
}): string {
  return [
    "---",
    `id: ${args.id}`,
    `title: ${args.id}`,
    `status: ${args.state}`,
    `priority: ${args.priority ?? "p2"}`,
    "area: autonomy",
    `summary: ${args.id} fixture`,
    "created_at: 2026-08-15T00:00:00.000Z",
    "updated_at: 2026-08-15T00:00:00.000Z",
    ...(args.anchor ? ["anchor: true"] : []),
    "---",
    "",
    "## Problem",
    "",
    "Fixture task.",
    ...(args.strategic ? ["", "## Initiative", "", "Semantic reflection."] : []),
    "",
  ].join("\n");
}

function write(projectDir: string, path: string, content: string): void {
  const absolute = join(projectDir, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function writeTask(
  projectDir: string,
  state: "backlog" | "ready" | "blocked" | "done" | "dropped",
  id: string,
  options: Omit<Parameters<typeof taskFixture>[0], "id" | "state"> = {},
): void {
  write(
    projectDir,
    `data/tasks/${state}/${id}.md`,
    taskFixture({ id, state, ...options }),
  );
}

function moveTask(
  projectDir: string,
  id: string,
  from: "backlog" | "ready" | "blocked" | "done" | "dropped",
  to: "backlog" | "ready" | "blocked" | "done" | "dropped",
  options: Omit<Parameters<typeof taskFixture>[0], "id" | "state"> = {},
): void {
  const fromPath = join(projectDir, "data", "tasks", from, `${id}.md`);
  const toPath = join(projectDir, "data", "tasks", to, `${id}.md`);
  renameSync(fromPath, toPath);
  writeFileSync(toPath, taskFixture({ id, state: to, ...options }), "utf8");
}

function makeProject(label: string): string {
  const projectDir = mkdtempSync(join(tmpdir(), `kota-semantic-reflection-${label}-`));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
  }
  mkdirSync(join(projectDir, "data", "inbox"), { recursive: true });
  write(projectDir, ".gitignore", ".kota/\n");
  git(projectDir, ["init", "--quiet"]);
  return projectDir;
}

function commit(projectDir: string, message: string): void {
  git(projectDir, ["add", "."]);
  git(projectDir, [
    "-c",
    "user.email=kota@example.test",
    "-c",
    "user.name=KOTA Test",
    "commit",
    "--quiet",
    "--no-gpg-sign",
    "-m",
    message,
  ]);
}

describe("semantic progress reflection", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  function track(label: string): string {
    const projectDir = makeProject(label);
    projectDirs.push(projectDir);
    return projectDir;
  }

  it("emits one parked-queue review and ignores five later build commits", () => {
    const projectDir = track("parked-build-restraint");
    writeTask(projectDir, "ready", "task-delivery");
    writeTask(projectDir, "backlog", "task-strategic-anchor", { anchor: true });
    commit(projectDir, "seed actionable queue");
    expect(inspectProgressSemanticBoundary({ projectDir }).shouldEmit).toBe(false);

    moveTask(projectDir, "task-delivery", "ready", "done");
    commit(projectDir, "complete delivery task");
    const parked = inspectProgressSemanticBoundary({ projectDir });
    expect(parked).toMatchObject({
      shouldEmit: true,
      payload: { boundary: "parked-queue", inputRevision: 1 },
    });

    for (let index = 1; index <= 5; index += 1) {
      write(projectDir, `src/build-${index}.ts`, `export const build${index} = ${index};\n`);
      commit(projectDir, `successful build ${index}`);
      expect(inspectProgressSemanticBoundary({ projectDir })).toMatchObject({
        shouldEmit: false,
        reason: "no accepted semantic progress boundary",
      });
    }
  });

  it("redelivers a deferred progress boundary only after canonical cleanup", () => {
    const projectDir = track("parked-cleanup-redelivery");
    writeTask(projectDir, "ready", "task-delivery");
    writeTask(projectDir, "backlog", "task-strategic-anchor", { anchor: true });
    commit(projectDir, "seed actionable queue");
    inspectProgressSemanticBoundary({ projectDir });

    moveTask(projectDir, "task-delivery", "ready", "done");
    commit(projectDir, "complete delivery task");
    const boundary = inspectProgressSemanticBoundary({ projectDir });
    recordProgressReviewInputQueued({
      projectDir,
      payload: boundary.payload!,
    });
    deferProgressReviewSemanticInput({
      projectDir,
      input: {
        automatic: true,
        shouldReview: true,
        boundary: "parked-queue",
        inputRevision: 1,
        evidenceRefs: boundary.payload?.evidenceRefs ?? [],
        reason: boundary.payload?.reason ?? "parked queue",
        deliveryAttempt: 0,
      },
    });

    write(projectDir, "scratch.txt", "uncommitted work\n");
    expect(inspectProgressSemanticBoundary({ projectDir })).toMatchObject({
      shouldEmit: false,
      reason: expect.stringContaining("parked until"),
    });
    rmSync(join(projectDir, "scratch.txt"));
    expect(inspectProgressSemanticBoundary({ projectDir })).toMatchObject({
      shouldEmit: true,
      reason: expect.stringContaining("resumed after cleanup"),
      payload: {
        automatic: true,
        boundary: "parked-queue",
        inputRevision: 1,
      },
    });
  });

  it("emits a task-disposition boundary when a task becomes blocked", () => {
    const projectDir = track("blocked");
    writeTask(projectDir, "ready", "task-needs-input");
    commit(projectDir, "seed ready task");
    inspectProgressSemanticBoundary({ projectDir });

    moveTask(projectDir, "task-needs-input", "ready", "blocked");
    commit(projectDir, "block task");
    expect(inspectProgressSemanticBoundary({ projectDir })).toMatchObject({
      shouldEmit: true,
      payload: {
        boundary: "task-disposition",
        inputRevision: 1,
        evidenceRefs: expect.arrayContaining([
          "data/tasks/blocked/task-needs-input.md",
        ]),
      },
    });
  });

  it("emits once when an owner decision resolves without a Git commit", () => {
    const projectDir = track("owner-decision");
    write(projectDir, "README.md", "# Fixture\n");
    commit(projectDir, "seed fixture");
    inspectProgressSemanticBoundary({ projectDir });

    write(
      projectDir,
      ".kota/owner-decisions/a1b2c3d4.json",
      `${JSON.stringify({
        id: "a1b2c3d4",
        // The dispatcher may observe after an authorized action already
        // consumed the answer; that is still a resolved owner decision.
        status: "consumed",
        updatedAt: "2026-08-15T12:00:00.000Z",
      })}\n`,
    );
    const resolved = inspectProgressSemanticBoundary({ projectDir });
    expect(resolved).toMatchObject({
      shouldEmit: true,
      payload: {
        boundary: "owner-decision-resolution",
        inputRevision: 1,
        evidenceRefs: [".kota/owner-decisions/a1b2c3d4.json"],
      },
    });
    expect(inspectProgressSemanticBoundary({ projectDir }).shouldEmit).toBe(false);
  });

  it("emits a strategic-completion boundary for a completed P1 initiative", () => {
    const projectDir = track("strategic-completion");
    writeTask(projectDir, "ready", "task-milestone", {
      priority: "p1",
      strategic: true,
    });
    commit(projectDir, "seed strategic task");
    inspectProgressSemanticBoundary({ projectDir });

    moveTask(projectDir, "task-milestone", "ready", "done", {
      priority: "p1",
      strategic: true,
    });
    commit(projectDir, "complete strategic milestone");
    expect(inspectProgressSemanticBoundary({ projectDir })).toMatchObject({
      shouldEmit: true,
      payload: { boundary: "strategic-completion", inputRevision: 1 },
    });
  });
});
