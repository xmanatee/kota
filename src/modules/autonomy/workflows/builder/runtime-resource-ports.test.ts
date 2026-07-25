import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assignBuilderRuntimeResources,
  deterministicBuilderPortRange,
} from "./runtime-resources.js";
import {
  installRuntimeResourceTestHooks,
  markPortPreflightRestricted,
  markPortUnavailable,
  tempProject,
  withEvalHarnessReplayRoot,
} from "./runtime-resources.test-helpers.js";

installRuntimeResourceTestHooks();

describe("builder runtime resource port preflight", () => {
  it("falls forward when the deterministic port range is unavailable", async () => {
    const projectDir = tempProject("preflight");
    const range = deterministicBuilderPortRange("task-alpha", "run-a");
    markPortUnavailable(range.start);

    const profile = await assignBuilderRuntimeResources({
      projectDir,
      taskId: "task-alpha",
      runId: "run-a",
      workspaceDir: join(projectDir, "worktree"),
      runDirPath: join(projectDir, ".kota", "runs", "run-a"),
    });

    expect(profile.ports.start).toBe(
      range.end < 49_999 ? range.end + 1 : 30_000,
    );
    expect(profile.preflight.portAvailability).toBe("checked");
    expect(profile.preflight.ports).toHaveLength(profile.ports.size);
  });

  it("skips port listen preflight for eval-harness replay subprocesses", async () => {
    const projectDir = tempProject("replay-port-preflight");
    const range = deterministicBuilderPortRange("task-replay", "run-replay");
    markPortUnavailable(range.start);
    const profile = await withEvalHarnessReplayRoot(projectDir, () =>
      assignBuilderRuntimeResources({
        projectDir,
        taskId: "task-replay",
        runId: "run-replay",
        workspaceDir: join(projectDir, "worktree"),
        runDirPath: join(projectDir, ".kota", "runs", "run-replay"),
      }),
    );

    expect(profile.ports).toEqual(range);
    expect(profile.preflight.ports).toHaveLength(range.size);
    expect(profile.preflight.portAvailability).toBe(
      "skipped-eval-harness-replay",
    );
  });

  it("records a skipped preflight when the host forbids loopback probes", async () => {
    const projectDir = tempProject("restricted-port-preflight");
    const range = deterministicBuilderPortRange(
      "task-restricted",
      "run-restricted",
    );
    markPortPreflightRestricted();

    const profile = await assignBuilderRuntimeResources({
      projectDir,
      taskId: "task-restricted",
      runId: "run-restricted",
      workspaceDir: join(projectDir, "worktree"),
      runDirPath: join(projectDir, ".kota", "runs", "run-restricted"),
    });

    expect(profile.ports).toEqual(range);
    expect(profile.preflight.ports).toEqual([]);
    expect(profile.preflight.portAvailability).toBe("skipped-host-restricted");
  });

  it("rejects unavailable ports when reusing an existing profile lease", async () => {
    const projectDir = tempProject("reused-lease-preflight");
    const input = {
      projectDir,
      taskId: "task-reused-lease",
      runId: "run-reused-lease",
      workspaceDir: join(projectDir, "worktree"),
      runDirPath: join(projectDir, ".kota", "runs", "run-reused-lease"),
    };
    const first = await assignBuilderRuntimeResources(input);
    markPortUnavailable(first.ports.start);

    await expect(assignBuilderRuntimeResources(input)).rejects.toThrow(
      `port ${first.ports.start} is unavailable`,
    );
  });
});
