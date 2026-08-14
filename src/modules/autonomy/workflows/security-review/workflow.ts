import type { AgentDef } from "#core/agents/agent-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { workflowCommitOperation } from "#modules/autonomy/workflow-commit-operations.js";
import {
  captureMutationBaseline,
  recordEmptyScan,
  scanCandidates,
  securityReviewCommitPolicy,
} from "./candidate-steps.js";
import { SECURITY_REVIEW_DUE_EVENT } from "./due-check.js";
import {
  createFollowUpTasks,
  recordInvestigationFindings,
  recordNoFindings,
  recordRevalidation,
  writeCommitMessage,
} from "./finding-steps.js";
import {
  securityInvestigationOutputSchema,
  securityRevalidationOutputSchema,
} from "./output-schemas.js";
import { validateBeforeCommit } from "./preflight-step.js";
import {
  decodeSecurityInvestigationOutput,
  decodeSecurityRevalidationVerdictOutput,
} from "./security-review.js";

export const agent: AgentDef = {
  name: "security-reviewer",
  role: "Investigate bounded security-sensitive code candidates and revalidate findings.",
  promptPath: "src/modules/autonomy/workflows/security-review/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: [".kota/runs/"],
};

const securityReviewWorkflow: WorkflowDefinitionInput = {
  name: "security-review",
  description:
    "Scan KOTA for security-sensitive candidates, investigate a bounded batch, revalidate findings, and create normal follow-up tasks for confirmed vulnerabilities.",
  tags: ["monitored"],
  recoveryCapable: true,
  defaultAutonomyMode: "autonomous",
  triggers: [
    {
      event: "autonomy.security-review.requested",
      cooldownMs: 60 * 60 * 1000,
    },
    {
      event: SECURITY_REVIEW_DUE_EVENT,
      cooldownMs: 60 * 60 * 1000,
    },
    { event: "runtime.recovered" },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: (ctx) =>
        ctx.runBlocking(resetWorktreeForRecoveryOperation, {
          projectDir: ctx.projectDir,
          workflowName: "security-review",
        }),
    },
    captureMutationBaseline,
    scanCandidates,
    recordEmptyScan,
    {
      id: "investigate-candidates",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: Math.min(AUTONOMY_AGENT_HANG_TIMEOUT_MS, 45 * 60 * 1000),
      maxTurns: 8,
      outputFormat: "json",
      outputSchema: securityInvestigationOutputSchema,
      validate: decodeSecurityInvestigationOutput,
      when: (ctx) => (scanCandidates.output(ctx)?.candidateCount ?? 0) > 0,
    },
    recordInvestigationFindings,
    recordNoFindings,
    {
      id: "revalidate-findings",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: Math.min(AUTONOMY_AGENT_HANG_TIMEOUT_MS, 30 * 60 * 1000),
      maxTurns: 4,
      outputFormat: "json",
      outputSchema: securityRevalidationOutputSchema,
      validate: decodeSecurityRevalidationVerdictOutput,
      when: (ctx) =>
        (recordInvestigationFindings.output(ctx)?.findings.length ?? 0) > 0,
    },
    recordRevalidation,
    createFollowUpTasks,
    writeCommitMessage,
    validateBeforeCommit,
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("validate-before-commit"),
      run: (ctx) =>
        ctx.runBlocking(workflowCommitOperation, {
          projectDir: ctx.projectDir,
          runDirPath: ctx.workflow.runDirPath,
          policy: securityReviewCommitPolicy(ctx),
        }),
    },
  ],
};

export default securityReviewWorkflow;
