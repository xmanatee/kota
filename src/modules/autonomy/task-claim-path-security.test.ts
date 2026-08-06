import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  archiveClaim,
  archiveClaimIfUnchanged,
  buildClaim,
  claimNextQueueTask,
  claimTask,
  listTaskClaimInspections,
  readActiveTaskClaim,
  releaseTaskClaim,
  taskClaimPath,
  writeClaim,
} from "#modules/autonomy/task-claims.js";
import {
  claimInput,
  makeProject,
  queueInput,
  writeTask,
} from "#modules/autonomy/task-claims-test-support.js";

describe("task claim queue path security", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked queue-state parent before creating a claim", () => {
    const projectDir = makeProject();
    const siblingProjectDir = makeProject();
    roots.push(projectDir, siblingProjectDir);
    const taskId = "task-sibling-parent-disclosure";
    writeTask(
      siblingProjectDir,
      "ready",
      taskId,
      "2026-08-06T00:00:00.000Z",
      "source_marker: SIBLING_PARENT_SECRET must not cross the project boundary.",
    );
    const readyDir = join(projectDir, "data", "tasks", "ready");
    rmSync(readyDir, { recursive: true });
    symlinkSync(join(siblingProjectDir, "data", "tasks", "ready"), readyDir);

    expect(() =>
      claimNextQueueTask(
        queueInput(projectDir, "run-linked-parent", new Date("2026-08-06T01:00:00Z")),
      ),
    ).toThrow(/symbolic-link directory components are forbidden/);
    expect(existsSync(taskClaimPath(projectDir, taskId))).toBe(false);
  });

  it("rejects a symlinked queue entry before creating a claim", () => {
    const projectDir = makeProject();
    const siblingProjectDir = makeProject();
    roots.push(projectDir, siblingProjectDir);
    const taskId = "task-sibling-entry-disclosure";
    writeTask(
      siblingProjectDir,
      "ready",
      taskId,
      "2026-08-06T00:00:00.000Z",
      "source_marker: SIBLING_ENTRY_SECRET must not cross the project boundary.",
    );
    symlinkSync(
      join(siblingProjectDir, "data", "tasks", "ready", `${taskId}.md`),
      join(projectDir, "data", "tasks", "ready", `${taskId}.md`),
    );

    expect(() =>
      claimNextQueueTask(
        queueInput(projectDir, "run-linked-entry", new Date("2026-08-06T01:00:00Z")),
      ),
    ).toThrow(/symbolic-link markdown entries are forbidden/);
    expect(existsSync(taskClaimPath(projectDir, taskId))).toBe(false);
  });

  it("resolves a legacy claim through the verified current task path", () => {
    const projectDir = makeProject();
    roots.push(projectDir);
    const taskId = "task-legacy-verified-claim";
    writeTask(
      projectDir,
      "ready",
      taskId,
      "2026-08-06T00:00:00.000Z",
    );
    const claimPath = taskClaimPath(projectDir, taskId);
    mkdirSync(join(claimPath, ".."), { recursive: true });
    writeFileSync(
      claimPath,
      `${JSON.stringify({
        schemaVersion: 1,
        taskId,
        taskState: "ready",
        runId: "run-legacy-claim",
        workflowId: "builder",
        owner: "workflow:builder",
        workspaceDir: join(projectDir, ".worktrees", "run-legacy-claim"),
        branch: `kota/task/${taskId}/run-legacy-claim`,
        baseCommit: "abc1234",
        leaseMs: 60_000,
        leaseAcquiredAt: "2026-08-06T00:00:00.000Z",
        leaseExpiresAt: "2026-08-06T01:00:00.000Z",
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
        status: "active",
        evidence: null,
      }, null, 2)}\n`,
      "utf8",
    );

    expect(readActiveTaskClaim(projectDir, taskId)).toMatchObject({
      schemaVersion: 2,
      taskId,
      taskState: "ready",
      taskFile: {
        path: `data/tasks/ready/${taskId}.md`,
      },
    });
  });

  it("rejects a sibling-project active redirect before any read, write, replacement, or removal", () => {
    const projectDir = makeProject();
    const siblingProjectDir = makeProject();
    roots.push(projectDir, siblingProjectDir);
    const taskId = "task-active-claim-boundary";
    writeTask(projectDir, "ready", taskId, "2026-08-06T00:00:00.000Z");
    writeTask(siblingProjectDir, "ready", taskId, "2026-08-06T00:00:00.000Z");
    const siblingClaim = claimTask(
      claimInput(
        siblingProjectDir,
        taskId,
        "run-sibling",
        new Date("2026-08-06T01:00:00.000Z"),
      ),
    ).claim;
    if (siblingClaim === null) throw new Error("sibling claim fixture was not created");
    const siblingPath = taskClaimPath(siblingProjectDir, taskId);
    const siblingBefore = readFileSync(siblingPath, "utf8");
    const localClaim = buildClaim(
      claimInput(projectDir, taskId, "run-local", new Date("2026-08-06T01:01:00.000Z")),
      new Date("2026-08-06T01:01:00.000Z"),
    );
    const claimsRoot = join(projectDir, ".kota", "task-claims");
    mkdirSync(claimsRoot, { recursive: true });
    symlinkSync(join(siblingProjectDir, ".kota", "task-claims", "active"), join(claimsRoot, "active"));

    expect(() => readActiveTaskClaim(projectDir, taskId)).toThrow(/real directories/);
    expect(() => listTaskClaimInspections(projectDir)).toThrow(/real directories/);
    expect(() => writeClaim(projectDir, localClaim, "w")).toThrow(/real directories/);
    expect(() =>
      archiveClaim(projectDir, siblingClaim, new Date("2026-08-06T01:02:00.000Z")),
    ).toThrow(/real directories/);
    expect(readFileSync(siblingPath, "utf8")).toBe(siblingBefore);
    expect(existsSync(siblingPath)).toBe(true);
  });

  it("rejects a symlinked active claim entry without reading or replacing its sibling target", () => {
    const projectDir = makeProject();
    const siblingProjectDir = makeProject();
    roots.push(projectDir, siblingProjectDir);
    const taskId = "task-linked-claim-entry";
    writeTask(projectDir, "ready", taskId, "2026-08-06T00:00:00.000Z");
    writeTask(siblingProjectDir, "ready", taskId, "2026-08-06T00:00:00.000Z");
    const siblingClaim = claimTask(
      claimInput(siblingProjectDir, taskId, "run-sibling", new Date("2026-08-06T01:00:00.000Z")),
    ).claim;
    if (siblingClaim === null) throw new Error("sibling claim fixture was not created");
    const siblingPath = taskClaimPath(siblingProjectDir, taskId);
    const siblingBefore = readFileSync(siblingPath, "utf8");
    const localClaim = buildClaim(
      claimInput(projectDir, taskId, "run-local", new Date("2026-08-06T01:01:00.000Z")),
      new Date("2026-08-06T01:01:00.000Z"),
    );
    const activeDir = join(projectDir, ".kota", "task-claims", "active");
    mkdirSync(activeDir, { recursive: true });
    symlinkSync(siblingPath, taskClaimPath(projectDir, taskId));

    expect(() => readActiveTaskClaim(projectDir, taskId)).toThrow(/private regular files/);
    expect(() => writeClaim(projectDir, localClaim, "w")).toThrow(/private regular files/);
    expect(readFileSync(siblingPath, "utf8")).toBe(siblingBefore);
  });

  it("rejects a sibling-project history redirect without replacing history or removing the active claim", () => {
    const projectDir = makeProject();
    const siblingProjectDir = makeProject();
    roots.push(projectDir, siblingProjectDir);
    const taskId = "task-history-claim-boundary";
    writeTask(projectDir, "ready", taskId, "2026-08-06T00:00:00.000Z");
    const claim = claimTask(
      claimInput(projectDir, taskId, "run-local", new Date("2026-08-06T01:00:00.000Z")),
    ).claim;
    if (claim === null) throw new Error("local claim fixture was not created");
    const siblingHistory = join(siblingProjectDir, ".kota", "task-claims", "history");
    mkdirSync(siblingHistory, { recursive: true });
    const sentinelPath = join(siblingHistory, "sibling-history.json");
    writeFileSync(sentinelPath, "SIBLING_HISTORY_MUST_REMAIN\n", "utf8");
    symlinkSync(siblingHistory, join(projectDir, ".kota", "task-claims", "history"));

    expect(() =>
      releaseTaskClaim({
        projectDir,
        taskId,
        runId: claim.runId,
        workflowId: claim.workflowId,
        evidence: "security boundary regression",
        now: new Date("2026-08-06T01:01:00.000Z"),
      }),
    ).toThrow(/real directories/);
    expect(readFileSync(sentinelPath, "utf8")).toBe("SIBLING_HISTORY_MUST_REMAIN\n");
    expect(readdirSync(siblingHistory)).toEqual(["sibling-history.json"]);
    expect(existsSync(taskClaimPath(projectDir, taskId))).toBe(true);
  });

  it("rejects a sibling-project locks redirect without creating or removing a sibling lock", () => {
    const projectDir = makeProject();
    const siblingProjectDir = makeProject();
    roots.push(projectDir, siblingProjectDir);
    const taskId = "task-lock-claim-boundary";
    writeTask(projectDir, "ready", taskId, "2026-08-06T00:00:00.000Z");
    const claim = claimTask(
      claimInput(projectDir, taskId, "run-local", new Date("2026-08-06T01:00:00.000Z")),
    ).claim;
    if (claim === null) throw new Error("local claim fixture was not created");
    const siblingLocks = join(siblingProjectDir, ".kota", "task-claims", "locks");
    mkdirSync(siblingLocks, { recursive: true });
    const sentinelPath = join(siblingLocks, "sibling.lock");
    writeFileSync(sentinelPath, "SIBLING_LOCK_MUST_REMAIN\n", "utf8");
    symlinkSync(siblingLocks, join(projectDir, ".kota", "task-claims", "locks"));

    expect(() =>
      archiveClaimIfUnchanged(
        projectDir,
        claim,
        new Date("2026-08-06T01:01:00.000Z"),
      ),
    ).toThrow(/real directories/);
    expect(readFileSync(sentinelPath, "utf8")).toBe("SIBLING_LOCK_MUST_REMAIN\n");
    expect(readdirSync(siblingLocks)).toEqual(["sibling.lock"]);
    expect(existsSync(taskClaimPath(projectDir, taskId))).toBe(true);
  });

  it("rejects a claim whose stored task id does not match the requested filename", () => {
    const projectDir = makeProject();
    roots.push(projectDir);
    writeTask(projectDir, "ready", "task-alpha", "2026-08-06T00:00:00.000Z");
    const alpha = claimTask(
      claimInput(projectDir, "task-alpha", "run-alpha", new Date("2026-08-06T01:00:00.000Z")),
    ).claim;
    if (alpha === null) throw new Error("claim fixture was not created");
    const mismatchedPath = taskClaimPath(projectDir, "task-beta");
    writeFileSync(mismatchedPath, readFileSync(taskClaimPath(projectDir, "task-alpha"), "utf8"), "utf8");

    expect(() => readActiveTaskClaim(projectDir, "task-beta")).toThrow(
      /stored task claim id does not match its requested filename/,
    );
    expect(() => listTaskClaimInspections(projectDir)).toThrow(
      /stored task claim id does not match its requested filename/,
    );
  });
});
