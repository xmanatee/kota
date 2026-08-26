import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type AgentEffort,
  type AgentHarness,
  buildHarnessCapabilityArtifact,
  buildHarnessCapabilitySnapshot,
  type HarnessCapabilitySnapshot,
} from "#core/agent-harness/index.js";
import type { WorkflowRunMetadata } from "../run-types.js";

export function writeHarnessCapabilityArtifact(
  stepId: string,
  metadata: WorkflowRunMetadata,
  workspaceRoot: string,
  harness: AgentHarness,
  model: string,
  effort: AgentEffort,
): HarnessCapabilitySnapshot {
  const snapshot = buildHarnessCapabilitySnapshot(harness, { model, effort });
  const filePath = join(
    resolve(workspaceRoot, metadata.runDir),
    "steps",
    `${stepId}.harness-capability.json`,
  );
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    JSON.stringify(buildHarnessCapabilityArtifact(snapshot), null, 2),
    "utf-8",
  );
  return snapshot;
}
