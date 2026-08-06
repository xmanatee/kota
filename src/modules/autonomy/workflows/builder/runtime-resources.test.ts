import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assignBuilderRuntimeResources,
  cleanupBuilderRuntimeResources,
  deterministicBuilderPortRange,
} from "./runtime-resources.js";
import {
  installRuntimeResourceTestHooks,
  rangesOverlap,
  tempProject,
} from "./runtime-resources.test-helpers.js";

installRuntimeResourceTestHooks();

describe("builder runtime resource assignment", () => {
  it("keeps serial-mode builder evidence separate from the canonical workflow run store", async () => {
    const projectDir = tempProject("root-workspace");
    const runDirPath = join(projectDir, ".kota", "runs", "run-root");

    const profile = await assignBuilderRuntimeResources({
      projectDir,
      taskId: "task-root",
      runId: "run-root",
      workspaceDir: projectDir,
      runDirPath,
    });

    const metadata = profile;
    expect(metadata.agentRunDir).toBe(
      join(projectDir, ".kota", "builder-evidence", "run-root"),
    );
    expect(metadata.agentRunDir).not.toBe(runDirPath);
    expect(metadata.artifactRoot).toBe(
      join(metadata.agentRunDir, "artifacts"),
    );
    expect(metadata.env.KOTA_RUN_DIR).toBe(metadata.agentRunDir);
    expect(metadata.env.KOTA_RUN_ARTIFACT_DIR).toBe(metadata.artifactRoot);
    expect(metadata.env.KOTA_REPO_TASK_STAGING_OWNER).toBe("workflow-host");
  });

  it("keeps a preserved worktree on its existing evidence lineage", async () => {
    const projectDir = tempProject("continued-evidence");
    const workspaceDir = join(projectDir, "worktrees", "continued");
    const profile = await assignBuilderRuntimeResources({
      projectDir,
      taskId: "task-continued",
      runId: "run-recovery",
      evidenceRunId: "run-original",
      workspaceDir,
      runDirPath: join(projectDir, ".kota", "runs", "run-recovery"),
    });

    expect(profile.runId).toBe("run-recovery");
    expect(profile.agentRunDir).toBe(
      join(workspaceDir, ".kota", "builder-evidence", "run-original"),
    );
    expect(profile.env.KOTA_RUN_DIR).toBe(profile.agentRunDir);
  });

  it("assigns deterministic non-overlapping profiles for concurrent task runs", async () => {
    const projectDir = tempProject("profiles");
    const alphaWorkspace = join(projectDir, "worktrees", "alpha");
    const betaWorkspace = join(projectDir, "worktrees", "beta");
    const alphaRunDir = join(projectDir, ".kota", "runs", "run-a");
    const betaRunDir = join(projectDir, ".kota", "runs", "run-b");

    const [alpha, beta] = await Promise.all([
      assignBuilderRuntimeResources({
        projectDir,
        taskId: "task-alpha",
        runId: "run-a",
        workspaceDir: alphaWorkspace,
        runDirPath: alphaRunDir,
      }),
      assignBuilderRuntimeResources({
        projectDir,
        taskId: "task-beta",
        runId: "run-b",
        workspaceDir: betaWorkspace,
        runDirPath: betaRunDir,
      }),
    ]);

    expect(alpha.profileId).toBe("task-alpha:run-a");
    expect(beta.profileId).toBe("task-beta:run-b");
    expect(alpha.ports).toEqual({
      ...deterministicBuilderPortRange("task-alpha", "run-a"),
    });
    expect(beta.ports).toEqual({
      ...deterministicBuilderPortRange("task-beta", "run-b"),
    });
    expect(rangesOverlap(alpha.ports, beta.ports)).toBe(false);
    expect(alpha.tempRoot).toBe(join(alphaWorkspace, ".kota", "tmp", "run-a"));
    expect(beta.tempRoot).toBe(join(betaWorkspace, ".kota", "tmp", "run-b"));
    expect(alpha.agentRunDir).toBe(join(alphaWorkspace, ".kota", "builder-evidence", "run-a"));
    expect(beta.agentRunDir).toBe(join(betaWorkspace, ".kota", "builder-evidence", "run-b"));
    expect(alpha.artifactRoot).toBe(
      join(alpha.agentRunDir, "artifacts"),
    );
    expect(beta.artifactRoot).toBe(
      join(beta.agentRunDir, "artifacts"),
    );
    expect(alpha.env.KOTA_RUN_DIR).toBe(alpha.agentRunDir);
    expect(beta.env.KOTA_RUN_ARTIFACT_DIR).toBe(beta.artifactRoot);
    expect(alpha.env.KOTA_PORT_BASE).toBe(String(alpha.ports.start));
    expect(beta.env.KOTA_PORT_BASE).toBe(String(beta.ports.start));
    expect(alpha.env.TMPDIR).toBe(alpha.tempRoot);
    expect(beta.env.TEMP).toBe(beta.tempRoot);
    expect(alpha.preflight.setup).toContain("dependencySetup");
    expect(alpha.preflight.dependencies).toMatchObject({
      status: "skipped",
      reason: "no-package-json",
    });
    expect(existsSync(alpha.artifactPath)).toBe(true);
    expect(existsSync(beta.artifactPath)).toBe(true);
    expect(JSON.parse(readFileSync(alpha.artifactPath, "utf8"))).toMatchObject({
      profileId: "task-alpha:run-a",
      projectDir,
      agentRunDir: alpha.agentRunDir,
      ports: { start: alpha.ports.start, end: alpha.ports.end },
    });
  });

  it("cleans successful run temp roots and releases the port lease", async () => {
    const projectDir = tempProject("cleanup");
    const profile = await assignBuilderRuntimeResources({
      projectDir,
      taskId: "task-cleanup",
      runId: "run-cleanup",
      workspaceDir: join(projectDir, "worktree"),
      runDirPath: join(projectDir, ".kota", "runs", "run-cleanup"),
    });
    const leasePath = profile.preflight.portLeasePath;

    expect(existsSync(profile.tempRoot)).toBe(true);
    expect(JSON.parse(readFileSync(leasePath, "utf8"))).toMatchObject({
      leases: [expect.objectContaining({ profileId: profile.profileId })],
    });

    const cleanup = await cleanupBuilderRuntimeResources(profile);

    expect(cleanup).toMatchObject({
      profileId: profile.profileId,
      tempRemoved: true,
      blockers: [],
      portLease: {
        released: true,
        releasedProfileIds: [profile.profileId],
        remainingLeaseCount: 0,
      },
    });
    expect(existsSync(profile.tempRoot)).toBe(false);
    expect(JSON.parse(readFileSync(leasePath, "utf8"))).toMatchObject({
      leases: [],
    });
    expect(existsSync(cleanup.artifactPath)).toBe(true);
  });

  it("refuses to remove temp roots outside the generated run directory", async () => {
    const projectDir = tempProject("cleanup-safety");
    const profile = await assignBuilderRuntimeResources({
      projectDir,
      taskId: "task-cleanup-safety",
      runId: "run-cleanup-safety",
      workspaceDir: join(projectDir, "worktree"),
      runDirPath: join(projectDir, ".kota", "runs", "run-cleanup-safety"),
    });
    const unsafeTempRoot = join(projectDir, ".kota", "tmp", "wrong-run");
    mkdirSync(unsafeTempRoot, { recursive: true });

    const cleanup = await cleanupBuilderRuntimeResources({
      ...profile,
      tempRoot: unsafeTempRoot,
    });

    expect(cleanup.tempRemoved).toBe(false);
    expect(cleanup.blockers[0]).toContain("does not match expected");
    expect(existsSync(unsafeTempRoot)).toBe(true);
    expect(cleanup.portLease.released).toBe(true);
  });

  it("resolves deterministic port bucket collisions with a shared lease", async () => {
    const projectDir = tempProject("lease-collision");
    const firstPreferred = deterministicBuilderPortRange("task-15", "run-15");
    const secondPreferred = deterministicBuilderPortRange("task-21", "run-21");
    expect(firstPreferred).toEqual(secondPreferred);

    const [first, second] = await Promise.all([
      assignBuilderRuntimeResources({
        projectDir,
        taskId: "task-15",
        runId: "run-15",
        workspaceDir: join(projectDir, "worktrees", "task-15"),
        runDirPath: join(projectDir, ".kota", "runs", "run-15"),
      }),
      assignBuilderRuntimeResources({
        projectDir,
        taskId: "task-21",
        runId: "run-21",
        workspaceDir: join(projectDir, "worktrees", "task-21"),
        runDirPath: join(projectDir, ".kota", "runs", "run-21"),
      }),
    ]);

    expect(rangesOverlap(first.ports, second.ports)).toBe(false);
    expect([first.ports.start, second.ports.start]).toContain(
      firstPreferred.start,
    );
    expect(first.preflight.portLeasePath).toBe(second.preflight.portLeasePath);
  });

  it("preflights dependency setup by linking prepared project dependencies", async () => {
    const projectDir = tempProject("dependency-setup");
    const workspaceDir = join(projectDir, "worktrees", "task-deps");
    mkdirSync(join(projectDir, "node_modules"), { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
      join(workspaceDir, "package.json"),
      `${JSON.stringify({ dependencies: { zod: "^4.0.0" } }, null, 2)}\n`,
      "utf8",
    );

    const profile = await assignBuilderRuntimeResources({
      projectDir,
      taskId: "task-deps",
      runId: "run-deps",
      workspaceDir,
      runDirPath: join(projectDir, ".kota", "runs", "run-deps"),
    });

    expect(existsSync(join(workspaceDir, "node_modules"))).toBe(true);
    expect(profile.packageCacheRoot).toBe(
      join(workspaceDir, ".kota", "tmp", "run-deps", "package-cache"),
    );
    expect(profile.env.KOTA_PACKAGE_CACHE_DIR).toBe(profile.packageCacheRoot);
    expect(profile.preflight.dependencies).toMatchObject({
      status: "passed",
      action: "linked-project-node-modules",
      path: join(workspaceDir, "node_modules"),
      source: join(projectDir, "node_modules"),
    });
  });

  it("rejects dependency setup failures before returning a profile", async () => {
    const projectDir = tempProject("dependency-failure");
    const workspaceDir = join(projectDir, "worktrees", "task-deps-fail");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
      join(workspaceDir, "package.json"),
      `${JSON.stringify({ dependencies: { zod: "^4.0.0" } }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(join(workspaceDir, "node_modules"), "not a directory\n");

    await expect(
      assignBuilderRuntimeResources({
        projectDir,
        taskId: "task-deps-fail",
        runId: "run-deps-fail",
        workspaceDir,
        runDirPath: join(projectDir, ".kota", "runs", "run-deps-fail"),
      }),
    ).rejects.toThrow("dependency setup preflight failed");
  });
});
