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
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { emptyScopeImprovementState } from "../scope-improver/scope-improvement-state.js";
import { scopePolicySnapshotForTest } from "../scope-improver/scope-policy-test-support.js";
import {
  inspectProgressSemanticBoundary,
  type ProgressBoundaryState,
} from "./semantic-reflection.js";
import { inspectScopeSemanticBoundary } from "./semantic-scope-reflection.js";

const boundaryStates = new Map<string, ProgressBoundaryState>();

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

async function inspect(projectDir: string, scopeDir = projectDir) {
  const result = await inspectProgressSemanticBoundary({
    projectDir,
    scopeDir,
    stateDir: join(scopeDir, ".kota"),
    progressBoundaryState: boundaryStates.get(projectDir) ?? null,
    runCommand: createWorkflowCommandRunner({ cwd: projectDir }),
  });
  if (result.nextState !== null) boundaryStates.set(projectDir, result.nextState);
  return result;
}

describe("semantic progress reflection", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    boundaryStates.clear();
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  function track(label: string): string {
    const projectDir = makeProject(label);
    projectDirs.push(projectDir);
    return projectDir;
  }

  it("parks a clean isolated snapshot while the canonical scope is dirty", async () => {
    const scopeDir = track("dirty-canonical");
    write(scopeDir, "README.md", "# Canonical\n");
    commit(scopeDir, "seed canonical scope");
    write(scopeDir, "owner-draft.txt", "not committed\n");

    const projectDir = track("clean-snapshot");
    write(projectDir, "README.md", "# Snapshot\n");
    commit(projectDir, "seed isolated snapshot");

    await expect(inspect(projectDir, scopeDir)).resolves.toMatchObject({
      shouldEmit: false,
      reason: expect.stringContaining("canonical worktree is clean"),
    });
  });

  it("emits one parked-queue review and ignores five later build commits", async () => {
    const projectDir = track("parked-build-restraint");
    writeTask(projectDir, "ready", "task-delivery");
    writeTask(projectDir, "backlog", "task-strategic-anchor", { anchor: true });
    commit(projectDir, "seed actionable queue");
    expect((await inspect(projectDir)).shouldEmit).toBe(false);

    moveTask(projectDir, "task-delivery", "ready", "done");
    commit(projectDir, "complete delivery task");
    const parked = await inspect(projectDir);
    expect(parked).toMatchObject({
      shouldEmit: true,
      payload: { boundary: "parked-queue", inputRevision: 1 },
    });

    for (let index = 1; index <= 5; index += 1) {
      write(projectDir, `src/build-${index}.ts`, `export const build${index} = ${index};\n`);
      commit(projectDir, `successful build ${index}`);
      expect(await inspect(projectDir)).toMatchObject({
        shouldEmit: false,
        reason: "no accepted semantic progress boundary",
      });
    }
  });

  it("emits a task-disposition boundary when a task becomes blocked", async () => {
    const projectDir = track("blocked");
    writeTask(projectDir, "ready", "task-needs-input");
    commit(projectDir, "seed ready task");
    await inspect(projectDir);

    moveTask(projectDir, "task-needs-input", "ready", "blocked");
    commit(projectDir, "block task");
    expect(await inspect(projectDir)).toMatchObject({
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
    const projectDir = track("owner-decision");
    write(projectDir, "README.md", "# Fixture\n");
    commit(projectDir, "seed fixture");
    await inspect(projectDir);

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
    const resolved = await inspect(projectDir);
    expect(resolved).toMatchObject({
      shouldEmit: true,
      payload: {
        boundary: "owner-decision-resolution",
        inputRevision: 1,
        evidenceRefs: [".kota/owner-decisions/a1b2c3d4.json"],
      },
    });
    expect((await inspect(projectDir)).shouldEmit).toBe(false);
  });

  it("emits a strategic-completion boundary for a completed P1 initiative", async () => {
    const projectDir = track("strategic-completion");
    writeTask(projectDir, "ready", "task-milestone", {
      priority: "p1",
      strategic: true,
    });
    commit(projectDir, "seed strategic task");
    await inspect(projectDir);

    moveTask(projectDir, "task-milestone", "ready", "done", {
      priority: "p1",
      strategic: true,
    });
    commit(projectDir, "complete strategic milestone");
    expect(await inspect(projectDir)).toMatchObject({
      shouldEmit: true,
      payload: { boundary: "strategic-completion", inputRevision: 1 },
    });
  });
});

describe("semantic scope reflection", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("uses canonical scope identity while inspecting an isolated repository checkout", () => {
    const canonicalDir = makeProject("canonical-scope");
    const isolatedDir = makeProject("isolated-checkout");
    projectDirs.push(canonicalDir, isolatedDir);
    write(isolatedDir, "README.md", "# Isolated repository view\n");
    commit(isolatedDir, "seed isolated checkout");
    const scopeId = deriveDirectoryScopeId(canonicalDir);

    expect(() => inspectScopeSemanticBoundary({
      projectDir: isolatedDir,
      scopeId,
      stateDir: join(canonicalDir, ".kota"),
      scopePolicySnapshot: scopePolicySnapshotForTest(canonicalDir),
      state: emptyScopeImprovementState(scopeId),
    })).not.toThrow();
  });
});
