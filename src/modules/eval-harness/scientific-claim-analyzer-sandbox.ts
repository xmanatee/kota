import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  forceRemoveContainer,
  type IsolatedContainerProcessResult,
  runIsolatedContainerProcess,
} from "./isolated-container-process.js";
import {
  type AvailableScientificClaimAnalyzerSandbox,
  type PreparedAnalyzerFilesystem,
  prepareAnalyzerFilesystem,
  type ScientificClaimAnalyzerInvocation,
  scientificClaimAnalyzerContainerArgs,
} from "./scientific-claim-analyzer-container.js";
import type { SubprocessIsolationBackend } from "./subprocess-executor-types.js";

export type { ScientificClaimAnalyzerInvocation } from "./scientific-claim-analyzer-container.js";

export type ScientificClaimAnalyzerSandbox =
  | AvailableScientificClaimAnalyzerSandbox
  | {
      kind: "unavailable";
      evidence: string;
      issue: string;
    };

export type ScientificClaimAnalyzerExecution =
  | {
      started: true;
      isolation: AvailableScientificClaimAnalyzerSandbox;
      result: ScientificClaimAnalyzerProcessResult;
    }
  | {
      started: false;
      issue: string;
    };

export type ScientificClaimAnalyzerProcessResult = IsolatedContainerProcessResult;

/** Agent-produced analyzers require the same configured OCI backend as gated evals. */
export function resolveScientificClaimAnalyzerSandbox(
  backend: SubprocessIsolationBackend,
): ScientificClaimAnalyzerSandbox {
  if (backend.kind !== "container") {
    return {
      kind: "unavailable",
      evidence: "analyzer resource isolation unavailable",
      issue:
        "scientific-claim analyzer verification requires --isolation container; " +
        "refusing to execute agent-produced JavaScript in the evaluator host process",
    };
  }
  return {
    kind: "oci-container",
    command: backend.executable,
    image: backend.image,
    evidence:
      "disposable offline OCI container with hard memory, CPU, PID, and file-descriptor limits",
  };
}

export async function spawnScientificClaimAnalyzer(
  isolation: ScientificClaimAnalyzerSandbox,
  invocation: ScientificClaimAnalyzerInvocation,
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    maxBuffer: number;
    readOnlyPaths: readonly string[];
    timeout: number;
    writablePaths: readonly string[];
  },
): Promise<ScientificClaimAnalyzerExecution> {
  if (isolation.kind === "unavailable") {
    return { started: false, issue: isolation.issue };
  }
  let filesystem: PreparedAnalyzerFilesystem;
  try {
    filesystem = prepareAnalyzerFilesystem(options);
  } catch (error) {
    return {
      started: false,
      issue: error instanceof Error ? error.message : String(error),
    };
  }

  const controlDir = mkdtempSync(join(tmpdir(), "kota-analyzer-container-"));
  const cidFile = join(controlDir, "cid");
  try {
    const result = await runIsolatedContainerProcess(
      isolation.command,
      scientificClaimAnalyzerContainerArgs({
        isolation,
        invocation,
        filesystem,
        env: options.env,
        cidFile,
      }),
      {
        cwd: filesystem.workingDir,
        env: { ...process.env },
        label: "analyzer container",
        maxBuffer: options.maxBuffer,
        timeout: options.timeout,
      },
    );
    if (result.error !== undefined || result.status !== 0) {
      await forceRemoveContainer(isolation.command, cidFile, { ...process.env });
    }
    return { started: true, isolation, result };
  } finally {
    rmSync(controlDir, { recursive: true, force: true });
  }
}
