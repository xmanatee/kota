import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  WRITER_INTEGRATION_EVIDENCE,
  type WriterIntegrationEvidence,
} from "../writer-integration-evidence.js";

type WriterIntegrationFixtureInput = Readonly<{
  runId: string;
  workflow?: string;
  projectId?: string;
  targetBranch?: string;
  baseHead?: string;
  integratedFromHead?: string;
  publishedHead?: string;
  commitSubject?: string | null;
  commitMessage?: string | null;
  changedPaths?: readonly string[];
  completedAt?: string;
}>;

export function writerIntegrationFixture(
  input: WriterIntegrationFixtureInput,
): WriterIntegrationEvidence {
  return {
    version: 1,
    runId: input.runId,
    workflow: input.workflow ?? "builder",
    projectId: input.projectId ?? "test-project",
    targetBranch: input.targetBranch ?? "main",
    baseHead: input.baseHead ?? "base-head",
    integratedFromHead: input.integratedFromHead ?? "base-head",
    publishedHead: input.publishedHead ?? "published-head",
    commitSubject: input.commitSubject ?? "Test integration",
    commitMessage: input.commitMessage ?? "Test integration",
    changedPaths: input.changedPaths ?? [],
    completedAt: input.completedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

export function writeWriterIntegrationFixture(
  runsDir: string,
  input: WriterIntegrationFixtureInput,
): WriterIntegrationEvidence {
  const evidence = writerIntegrationFixture(input);
  const runDir = join(runsDir, input.runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, WRITER_INTEGRATION_EVIDENCE),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf-8",
  );
  return evidence;
}
