import { join } from "node:path";
import {
  readOptionalJsonFile,
  writeJsonFileAtomic,
} from "#core/util/json-file.js";

export const WRITER_INTEGRATION_EVIDENCE = "writer-integration.json";

export type WriterIntegrationEvidence = Readonly<{
  version: 1;
  runId: string;
  workflow: string;
  projectId: string;
  targetBranch: string;
  baseHead: string;
  integratedFromHead: string;
  publishedHead: string;
  commitSubject: string | null;
  commitMessage: string | null;
  changedPaths: readonly string[];
  completedAt: string;
}>;

export function writerIntegrationEvidencePath(
  projectRoot: string,
  runId: string,
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) {
    throw new Error(`Invalid run id "${runId}"`);
  }
  return join(projectRoot, ".kota", "runs", runId, WRITER_INTEGRATION_EVIDENCE);
}

export function readWriterIntegrationEvidence(
  runsDir: string,
  runId: string,
): WriterIntegrationEvidence | null {
  return readOptionalJsonFile<WriterIntegrationEvidence>(
    join(runsDir, runId, WRITER_INTEGRATION_EVIDENCE),
  );
}

export function writeWriterIntegrationEvidence(
  projectRoot: string,
  evidence: WriterIntegrationEvidence,
): void {
  const path = writerIntegrationEvidencePath(projectRoot, evidence.runId);
  const existing = readOptionalJsonFile<WriterIntegrationEvidence>(path);
  if (existing !== null) {
    if (JSON.stringify(existing) !== JSON.stringify(evidence)) {
      throw new Error(
        `Writer integration evidence for run "${evidence.runId}" conflicts with durable integration state`,
      );
    }
    return;
  }
  writeJsonFileAtomic(path, evidence);
}
