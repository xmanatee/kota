import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  discoverRepoAiChecks,
  RepoAiCheckDiscoveryError,
} from "#modules/repo-ai-checks/discovery.js";
import type {
  DiscoveredCheckRun,
  RepoAiCheckAssessment,
} from "./workflow-contracts.js";

type EligibleRepoAiCheckAssessment = Extract<
  RepoAiCheckAssessment,
  { skip: false }
>;

type DiscoverRepoAiChecksInput = {
  workspaceRoot: string;
  artifactDir: string;
  artifactDirPath: string;
  assessment: EligibleRepoAiCheckAssessment;
};

function writeDiscoveryArtifact(
  artifactDirPath: string,
  value: DiscoveredCheckRun,
): void {
  const filePath = join(artifactDirPath, "discovery.json");
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function discoverRepoAiChecksInWorker(
  input: DiscoverRepoAiChecksInput,
): DiscoveredCheckRun {
  mkdirSync(input.artifactDirPath, { recursive: true });

  if (!existsSync(input.workspaceRoot)) {
    const skipped: DiscoveredCheckRun = {
      ...input.assessment,
      skip: true,
      skipReason: "trusted base project checkout is unavailable",
      artifactDir: input.artifactDir,
      checks: [],
      diagnostics: [],
    };
    writeDiscoveryArtifact(input.artifactDirPath, skipped);
    return skipped;
  }

  let discovery: ReturnType<typeof discoverRepoAiChecks>;
  try {
    discovery = discoverRepoAiChecks(input.workspaceRoot);
  } catch (error) {
    if (error instanceof RepoAiCheckDiscoveryError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const skipped: DiscoveredCheckRun = {
      ...input.assessment,
      skip: true,
      skipReason: `trusted base check discovery is unavailable: ${message}`,
      artifactDir: input.artifactDir,
      checks: [],
      diagnostics: [],
    };
    writeDiscoveryArtifact(input.artifactDirPath, skipped);
    return skipped;
  }

  const output: DiscoveredCheckRun = {
    ...input.assessment,
    skip: discovery.checks.length === 0,
    ...(discovery.checks.length === 0
      ? { skipReason: "no repo-local AI check files discovered" }
      : {}),
    artifactDir: input.artifactDir,
    checks: discovery.checks,
    diagnostics: discovery.diagnostics,
  };
  writeDiscoveryArtifact(input.artifactDirPath, output);
  return output;
}

export const discoverRepoAiChecksOperation = defineWorkflowBlockingOperation<
  DiscoverRepoAiChecksInput,
  DiscoveredCheckRun
>(import.meta.url, "discoverRepoAiChecksInWorker");
