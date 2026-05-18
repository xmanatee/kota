import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type AgentHarness,
  buildHarnessCapabilityArtifact,
  buildHarnessCapabilitySnapshot,
} from "#core/agent-harness/index.js";
import type { WorkflowRunMetadata } from "../run-types.js";

export function writeHarnessCapabilityArtifact(
  stepId: string,
  metadata: WorkflowRunMetadata,
  projectDir: string,
  harness: AgentHarness,
): void {
  const snapshot = buildHarnessCapabilitySnapshot(harness);
  const filePath = join(
    resolve(projectDir, metadata.runDir),
    "steps",
    `${stepId}.harness-capability.json`,
  );
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    JSON.stringify(buildHarnessCapabilityArtifact(snapshot), null, 2),
    "utf-8",
  );
}
