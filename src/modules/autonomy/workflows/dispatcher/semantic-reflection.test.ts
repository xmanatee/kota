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
import { createWorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import {
  inspectProgressSemanticBoundary,
  type ProgressBoundaryState,
} from "./semantic-reflection.js";

const boundaryStates = new Map<string, ProgressBoundaryState>();

function git(workspaceRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: workspaceRoot,
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

function write(workspaceRoot: string, path: string, content: string): void {
  const absolute = join(workspaceRoot, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function writeTask(
  workspaceRoot: string,
  state: "backlog" | "ready" | "blocked" | "done" | "dropped",
  id: string,
  options: Omit<Parameters<typeof taskFixture>[0], "id" | "state"> = {},
): void {
  write(
    workspaceRoot,
    `data/tasks/${state}/${id}.md`,
    taskFixture({ id, state, ...options }),
  );
}

function moveTask(
  workspaceRoot: string,
  id: string,
  from: "backlog" | "ready" | "blocked" | "done" | "dropped",
  to: "backlog" | "ready" | "blocked" | "done" | "dropped",
  options: Omit<Parameters<typeof taskFixture>[0], "id" | "state"> = {},
): void {
  const fromPath = join(workspaceRoot, "data", "tasks", from, `${id}.md`);
  const toPath = join(workspaceRoot, "data", "tasks", to, `${id}.md`);
  renameSync(fromPath, toPath);
  writeFileSync(toPath, taskFixture({ id, state: to, ...options }), "utf8");
}

function makeProject(label: string): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), `kota-semantic-reflection-${label}-`));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(workspaceRoot, "data", "tasks", state), { recursive: true });
  }
  mkdirSync(join(workspaceRoot, "data", "inbox"), { recursive: true });
  write(workspaceRoot, ".gitignore", ".kota/\n");
  git(workspaceRoot, ["init", "--quiet"]);
  return workspaceRoot;
}

function commit(workspaceRoot: string, message: string): void {
  git(workspaceRoot, ["add", "."]);
  git(workspaceRoot, [
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

async function inspect(workspaceRoot: string, scopeRoot = workspaceRoot) {
  const result = await inspectProgressSemanticBoundary({
    workspaceRoot,
    scopeRoot,
    stateDir: join(scopeRoot, ".kota"),
    progressBoundaryState: boundaryStates.get(workspaceRoot) ?? null,
    runCommand: createWorkflowCommandRunner({ cwd: workspaceRoot }),
  });
  if (result.nextState !== null) boundaryStates.set(workspaceRoot, result.nextState);
  return result;
}

describe("semantic progress reflection", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    boundaryStates.clear();
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  function track(label: string): string {
    const workspaceRoot = makeProject(label);
    scopeRoots.push(workspaceRoot);
    return workspaceRoot;
  }

  it("parks a clean isolated snapshot while the canonical scope is dirty", async () => {
    const scopeRoot = track("dirty-canonical");
    write(scopeRoot, "README.md", "# Canonical\n");
    commit(scopeRoot, "seed canonical scope");
    write(scopeRoot, "owner-draft.txt", "not committed\n");

    const workspaceRoot = track("clean-snapshot");
    write(workspaceRoot, "README.md", "# Snapshot\n");
    commit(workspaceRoot, "seed isolated snapshot");

    await expect(inspect(workspaceRoot, scopeRoot)).resolves.toMatchObject({
      shouldEmit: false,
      reason: expect.stringContaining("canonical worktree is clean"),
    });
  });

  it("emits one parked-queue review and ignores five later build commits", async () => {
    const workspaceRoot = track("parked-build-restraint");
    writeTask(workspaceRoot, "ready", "task-delivery");
    writeTask(workspaceRoot, "backlog", "task-strategic-anchor", { anchor: true });
    commit(workspaceRoot, "seed actionable queue");
    expect((await inspect(workspaceRoot)).shouldEmit).toBe(false);

    moveTask(workspaceRoot, "task-delivery", "ready", "done");
    commit(workspaceRoot, "complete delivery task");
    const parked = await inspect(workspaceRoot);
    expect(parked).toMatchObject({
      shouldEmit: true,
      payload: { boundary: "parked-queue", inputRevision: 1 },
    });

    for (let index = 1; index <= 5; index += 1) {
      write(workspaceRoot, `src/build-${index}.ts`, `export const build${index} = ${index};\n`);
      commit(workspaceRoot, `successful build ${index}`);
      expect(await inspect(workspaceRoot)).toMatchObject({
        shouldEmit: false,
        reason: "no accepted semantic progress boundary",
      });
    }
  });

  it("emits a task-disposition boundary when a task becomes blocked", async () => {
    const workspaceRoot = track("blocked");
    writeTask(workspaceRoot, "ready", "task-needs-input");
    commit(workspaceRoot, "seed ready task");
    await inspect(workspaceRoot);

    moveTask(workspaceRoot, "task-needs-input", "ready", "blocked");
    commit(workspaceRoot, "block task");
    expect(await inspect(workspaceRoot)).toMatchObject({
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

  it("emits once when an owner decision resolves without a Git commit", async () => {
    const workspaceRoot = track("owner-decision");
    write(workspaceRoot, "README.md", "# Fixture\n");
    commit(workspaceRoot, "seed fixture");
    await inspect(workspaceRoot);

    write(
      workspaceRoot,
      ".kota/owner-decisions/a1b2c3d4.json",
      `${JSON.stringify({
        id: "a1b2c3d4",
        // The dispatcher may observe after an authorized action already
        // consumed the answer; that is still a resolved owner decision.
        status: "consumed",
        updatedAt: "2026-08-15T12:00:00.000Z",
      })}\n`,
    );
    const resolved = await inspect(workspaceRoot);
    expect(resolved).toMatchObject({
      shouldEmit: true,
      payload: {
        boundary: "owner-decision-resolution",
        inputRevision: 1,
        evidenceRefs: [".kota/owner-decisions/a1b2c3d4.json"],
      },
    });
    expect((await inspect(workspaceRoot)).shouldEmit).toBe(false);
  });

  it("emits a strategic-completion boundary for a completed P1 initiative", async () => {
    const workspaceRoot = track("strategic-completion");
    writeTask(workspaceRoot, "ready", "task-milestone", {
      priority: "p1",
      strategic: true,
    });
    commit(workspaceRoot, "seed strategic task");
    await inspect(workspaceRoot);

    moveTask(workspaceRoot, "task-milestone", "ready", "done", {
      priority: "p1",
      strategic: true,
    });
    commit(workspaceRoot, "complete strategic milestone");
    expect(await inspect(workspaceRoot)).toMatchObject({
      shouldEmit: true,
      payload: { boundary: "strategic-completion", inputRevision: 1 },
    });
  });
});
