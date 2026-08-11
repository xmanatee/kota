import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  buildHarnessCapabilityArtifact,
  buildHarnessCapabilitySnapshot,
  findRequiredHarnessReadinessFailures,
  formatRequiredHarnessReadinessFailures,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
import type { AgentRuntimeSelection } from "#core/model/preset.js";
import { AgentStepRuntimeError } from "#core/workflow/steps/step-executor-retry.js";

export type BuilderHarnessPreflightResult = {
  harness: string;
  model: string;
  effort: AgentRuntimeSelection["effort"];
  ready: true;
  artifactPath: string;
};

export function runBuilderHarnessPreflight(input: {
  agentRuntime: AgentRuntimeSelection;
  runDirPath: string;
}): BuilderHarnessPreflightResult {
  const harness = resolveAgentHarness(input.agentRuntime.harness);
  const model = input.agentRuntime.tiers.capable;
  const effort = input.agentRuntime.effort;
  const snapshot = buildHarnessCapabilitySnapshot(harness, {
    model,
    effort,
    unattended: true,
  });
  const artifactPath = join(
    input.runDirPath,
    "steps",
    "builder-preclaim.harness-capability.json",
  );
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    `${JSON.stringify(buildHarnessCapabilityArtifact(snapshot), null, 2)}\n`,
    "utf8",
  );
  const failures = findRequiredHarnessReadinessFailures(snapshot);
  if (failures.length > 0) {
    throw new AgentStepRuntimeError(
      `Builder stopped before claiming work (harness_readiness): ${formatRequiredHarnessReadinessFailures(
        harness.name,
        failures,
      )}`,
      "auth",
      false,
    );
  }
  return {
    harness: harness.name,
    model,
    effort,
    ready: true,
    artifactPath,
  };
}
