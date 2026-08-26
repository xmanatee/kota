import { existsSync } from "node:fs";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  type AutonomyHealthSignal,
  autonomyHealthSignal,
} from "#modules/autonomy/health-signal.js";
import {
  collectRuntimeHealthAuditOperation,
  type RuntimeHealthAudit,
} from "./runtime-health-audit.js";

export const AUTONOMY_HEALTH_AUDIT_SCHEDULE_EVENT =
  "autonomy.runtime-health.audit.scheduled";

export type RuntimeAuditStepOutput = {
  signals: AutonomyHealthSignal[];
  generatedAt: string;
  windowStart: string;
  inspected: RuntimeHealthAudit["inspected"];
  patternCount: number;
  evidenceGapCount: number;
  artifactPath: string;
};

export function runtimeHealthAuditStepOutput(
  audit: RuntimeHealthAudit,
  artifactPath: string,
): RuntimeAuditStepOutput {
  return {
    signals: audit.signals,
    generatedAt: audit.generatedAt,
    windowStart: audit.windowStart,
    inspected: audit.inspected,
    patternCount: audit.patterns.length,
    evidenceGapCount: audit.evidenceGaps.length,
    artifactPath,
  };
}

const buildRuntimeAudit = typedCodeStep<RuntimeAuditStepOutput>({
  id: "build-runtime-audit",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<RuntimeAuditStepOutput>(raw, [
      "signals",
      "artifactPath",
      "patternCount",
      "evidenceGapCount",
    ]),
  run: async ({ projectDir, stateDir, scopeDir, workflow, runBlocking }) => {
    const { audit, artifactPath } = await runBlocking(
      collectRuntimeHealthAuditOperation,
      {
        projectDir,
        stateDir,
        scopeDir,
        runDirPath: workflow.runDirPath,
        nowIso: new Date().toISOString(),
      },
    );
    return runtimeHealthAuditStepOutput(audit, artifactPath);
  },
});

const verifyRuntimeAuditArtifact = typedCodeStep<{ verified: boolean }>({
  id: "verify-runtime-audit-artifact",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<{ verified: boolean }>(raw, ["verified"]),
  run: (ctx) => {
    const path = buildRuntimeAudit.outputRequired(ctx).artifactPath;
    if (!existsSync(path)) {
      throw new Error(`runtime health audit artifact was not written: ${path}`);
    }
    return { verified: true };
  },
});

const publishRuntimeHealthSignals = typedCodeStep<{ published: number }>({
  id: "publish-runtime-health-signals",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<{ published: number }>(raw, ["published"]),
  run: (ctx) => {
    const signals = buildRuntimeAudit.outputRequired(ctx).signals;
    for (const signal of signals) {
      ctx.emit(autonomyHealthSignal.name, signal);
    }
    return { published: signals.length };
  },
});

const runtimeHealthAuditorWorkflow: WorkflowDefinitionInput = {
  name: "runtime-health-auditor",
  repository: "none",
  description:
    "Inspect durable runtime evidence without repository mutation and publish typed findings to the health reviewer.",
  triggers: [{
    event: AUTONOMY_HEALTH_AUDIT_SCHEDULE_EVENT,
    intervalMs: 6 * 60 * 60 * 1000,
    cooldownMs: 60 * 60 * 1000,
  }],
  steps: [
    buildRuntimeAudit,
    verifyRuntimeAuditArtifact,
    publishRuntimeHealthSignals,
  ],
};

export default runtimeHealthAuditorWorkflow;
