import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { WorkflowRuntimeResources } from "#core/workflow/run-types.js";
import {
  type BuilderRuntimeDependencyPreflight,
  preflightDependencySetup,
} from "./runtime-resource-dependencies.js";
import {
  assignBuilderPortRange,
  type BuilderRuntimeResourcePortRange,
  deterministicBuilderPortRange,
} from "./runtime-resource-ports.js";

export type {
  BuilderRuntimeDependencyPreflight,
  BuilderRuntimeResourcePortRange,
};
export { deterministicBuilderPortRange };

export type BuilderRuntimeResourcePreflight = {
  checkedAt: string;
  ports: number[];
  setup: string[];
  dependencies: BuilderRuntimeDependencyPreflight;
  portLeasePath: string;
};

export type BuilderRuntimeResourceProfile = Omit<
  WorkflowRuntimeResources,
  "ports"
> & {
  schemaVersion: 1;
  taskId: string;
  runId: string;
  workspaceDir: string;
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
};

function writeProfileArtifact(
  artifactPath: string,
  profile: BuilderRuntimeResourceProfile,
): void {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
}

export async function assignBuilderRuntimeResources(
  input: AssignBuilderRuntimeResourcesInput,
): Promise<BuilderRuntimeResourceProfile> {
  const tempRoot = join(input.workspaceDir, ".kota", "tmp", input.runId);
  const artifactRoot = join(input.runDirPath, "artifacts");
  const packageCacheRoot = join(tempRoot, "package-cache");
  mkdirSync(tempRoot, { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });
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
    KOTA_RUNTIME_PROFILE_ID: profileId,
    KOTA_WORKSPACE_DIR: input.workspaceDir,
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
    taskId: input.taskId,
    runId: input.runId,
    workspaceDir: input.workspaceDir,
    tempRoot,
    artifactRoot,
    ports,
    packageCacheRoot,
    env,
    preflight: {
      checkedAt: new Date().toISOString(),
      ports: portAssignment.checkedPorts,
      setup: [
        "tempRoot",
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
