import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { WorkflowRuntimeResources } from "#core/workflow/run-types.js";
import {
  REPO_TASK_STAGING_OWNER_ENV,
  REPO_TASK_WORKFLOW_HOST_STAGING_OWNER,
} from "#modules/repo-tasks/repo-file-mutations.js";
import { initializeBuilderEvidenceManifest } from "./agent-run-evidence-manifest.js";
import {
  type BuilderRuntimeDependencyPreflight,
  preflightDependencySetup,
} from "./runtime-resource-dependencies.js";
import {
  assignBuilderPortRange,
  type BuilderRuntimeResourcePortRange,
  deterministicBuilderPortRange,
  type ReleaseBuilderPortRangeResult,
  releaseBuilderPortRange,
} from "./runtime-resource-ports.js";

export type {
  BuilderRuntimeDependencyPreflight,
  BuilderRuntimeResourcePortRange,
};
export { deterministicBuilderPortRange };

export type BuilderRuntimeResourcePreflight = {
  checkedAt: string;
  ports: number[];
  portAvailability:
    | "checked"
    | "skipped-eval-harness-replay"
    | "skipped-host-restricted";
  setup: string[];
  dependencies: BuilderRuntimeDependencyPreflight;
  portLeasePath: string;
};

export type BuilderRuntimeResourceProfile = Omit<
  WorkflowRuntimeResources,
  "ports"
> & {
  schemaVersion: 1;
  projectDir: string;
  taskId: string;
  runId: string;
  workspaceDir: string;
  agentRunDir: string;
  tempRoot: string;
  artifactRoot: string;
  ports: BuilderRuntimeResourcePortRange;
  packageCacheRoot: string;
  preflight: BuilderRuntimeResourcePreflight;
  artifactPath: string;
};

export type AssignBuilderRuntimeResourcesInput = {
  projectDir: string;
  taskId: string;
  runId: string;
  workspaceDir: string;
  runDirPath: string;
  evidenceRunId?: string;
};

export type BuilderRuntimeResourceCleanupResult = {
  schemaVersion: 1;
  profileId: string;
  taskId: string;
  runId: string;
  workspaceDir: string;
  tempRoot: string;
  tempRemoved: boolean;
  blockers: string[];
  portLease: ReleaseBuilderPortRangeResult;
  artifactPath: string;
};

function writeProfileArtifact(
  artifactPath: string,
  profile: BuilderRuntimeResourceProfile | BuilderRuntimeResourceCleanupResult,
): void {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
}

function builderAgentRunDir(input: AssignBuilderRuntimeResourcesInput): string {
  return join(
    input.workspaceDir,
    ".kota",
    "builder-evidence",
    input.evidenceRunId ?? input.runId,
  );
}

export async function assignBuilderRuntimeResources(
  input: AssignBuilderRuntimeResourcesInput,
): Promise<BuilderRuntimeResourceProfile> {
  const tempRoot = join(input.workspaceDir, ".kota", "tmp", input.runId);
  const agentRunDir = builderAgentRunDir(input);
  const artifactRoot = join(agentRunDir, "artifacts");
  const packageCacheRoot = join(tempRoot, "package-cache");
  mkdirSync(tempRoot, { recursive: true });
  mkdirSync(agentRunDir, { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });
  initializeBuilderEvidenceManifest(agentRunDir);
  mkdirSync(packageCacheRoot, { recursive: true });

  const profileId = `${input.taskId}:${input.runId}`;
  const dependencySetup = preflightDependencySetup({
    projectDir: input.projectDir,
    workspaceDir: input.workspaceDir,
  });
  const portAssignment = await assignBuilderPortRange(input, profileId);
  const ports = portAssignment.ports;
  const artifactPath = join(input.runDirPath, "builder-runtime-resources.json");
  const env = {
    [REPO_TASK_STAGING_OWNER_ENV]: REPO_TASK_WORKFLOW_HOST_STAGING_OWNER,
    KOTA_RUNTIME_PROFILE_ID: profileId,
    KOTA_WORKSPACE_DIR: input.workspaceDir,
    KOTA_RUN_DIR: agentRunDir,
    KOTA_RUN_TEMP_DIR: tempRoot,
    KOTA_RUN_ARTIFACT_DIR: artifactRoot,
    KOTA_PACKAGE_CACHE_DIR: packageCacheRoot,
    KOTA_PORT_RANGE_START: String(ports.start),
    KOTA_PORT_RANGE_END: String(ports.end),
    KOTA_PORT_BASE: String(ports.start),
    npm_config_cache: join(packageCacheRoot, "npm"),
    npm_config_store_dir: join(packageCacheRoot, "pnpm-store"),
    YARN_CACHE_FOLDER: join(packageCacheRoot, "yarn"),
    TMPDIR: tempRoot,
    TMP: tempRoot,
    TEMP: tempRoot,
  };
  const profile: BuilderRuntimeResourceProfile = {
    schemaVersion: 1,
    profileId,
    projectDir: input.projectDir,
    taskId: input.taskId,
    runId: input.runId,
    workspaceDir: input.workspaceDir,
    agentRunDir,
    tempRoot,
    artifactRoot,
    ports,
    packageCacheRoot,
    env,
    preflight: {
      checkedAt: new Date().toISOString(),
      ports: portAssignment.checkedPorts,
      portAvailability: portAssignment.portAvailability,
      setup: [
        "tempRoot",
        "agentRunDir",
        "artifactRoot",
        "packageCacheRoot",
        "dependencySetup",
        "portLease",
        "ports",
      ],
      dependencies: dependencySetup,
      portLeasePath: portAssignment.leasePath,
    },
    artifactPath,
  };
  writeProfileArtifact(artifactPath, profile);
  return profile;
}

function safeToRemoveTempRoot(profile: BuilderRuntimeResourceProfile): string[] {
  const expectedTempRoot = resolve(
    profile.workspaceDir,
    ".kota",
    "tmp",
    profile.runId,
  );
  const actualTempRoot = resolve(profile.tempRoot);
  if (actualTempRoot !== expectedTempRoot) {
    return [
      `tempRoot ${profile.tempRoot} does not match expected ${expectedTempRoot}`,
    ];
  }
  return [];
}

export async function cleanupBuilderRuntimeResources(
  profile: BuilderRuntimeResourceProfile,
  artifactPath = join(
    dirname(profile.artifactPath),
    "builder-runtime-resource-cleanup.json",
  ),
): Promise<BuilderRuntimeResourceCleanupResult> {
  const blockers = safeToRemoveTempRoot(profile);
  const tempRemoved = blockers.length === 0 && existsSync(profile.tempRoot);
  if (tempRemoved) {
    rmSync(profile.tempRoot, { recursive: true });
  }

  const portLease = await releaseBuilderPortRange({
    projectDir: profile.projectDir,
    runId: profile.runId,
    profileId: profile.profileId,
  });
  const result: BuilderRuntimeResourceCleanupResult = {
    schemaVersion: 1,
    profileId: profile.profileId,
    taskId: profile.taskId,
    runId: profile.runId,
    workspaceDir: profile.workspaceDir,
    tempRoot: profile.tempRoot,
    tempRemoved,
    blockers,
    portLease,
    artifactPath,
  };
  writeProfileArtifact(artifactPath, result);
  return result;
}
