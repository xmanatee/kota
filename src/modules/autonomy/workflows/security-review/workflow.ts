import type { AgentDef } from "#core/agents/agent-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_AGENT_TIER,
} from "#modules/autonomy/shared.js";
import { taskQueueIntegrationPolicy } from "#modules/repo-tasks/task-integration-policy.js";
import {
  recordEmptyScan,
  refreshReviewInput,
  retainReviewInput,
  scanCandidates,
} from "./candidate-steps.js";
import { SECURITY_REVIEW_DUE_EVENT } from "./due-check.js";
import {
  finalizeSecurityReview,
  recordedInvestigation,
  recordInvestigationFindings,
  recordRevalidation,
} from "./finding-steps.js";
import {
  securityInvestigationOutputSchema,
  securityRevalidationOutputSchema,
} from "./output-schemas.js";
import { SECURITY_REVIEW_RESOURCE } from "./review-state.js";
import {
  decodeSecurityInvestigationOutput,
  decodeSecurityRevalidationVerdictOutput,
} from "./security-review.js";

export const agent: AgentDef = {
  name: "security-reviewer",
  role: "Investigate bounded security-sensitive code candidates and revalidate findings.",
  promptPath: "src/modules/autonomy/workflows/security-review/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: "deny-all",
};

const securityReviewWorkflow: WorkflowDefinitionInput = {
  name: "security-review",
  finalize: finalizeSecurityReview,
  // Keep the existing native writer isolation contract while non-writer
  // database confinement remains separately tracked. Agents still deny all writes.
  repository: "write",
  integration: taskQueueIntegrationPolicy(),
  resources: () => [SECURITY_REVIEW_RESOURCE],
  description:
    "Scan KOTA for security-sensitive candidates, investigate a bounded batch, revalidate findings, and stage confirmed repair families for resource-aware task publication.",
  tags: ["monitored"],
  defaultAutonomyMode: "autonomous",
  triggers: [
    {
      event: "autonomy.security-review.requested",
      queueMode: "all",
    },
    {
      event: SECURITY_REVIEW_DUE_EVENT,
    },
  ],
  steps: [
    retainReviewInput,
    refreshReviewInput,
    scanCandidates,
    recordEmptyScan,
    {
      id: "investigate-candidates",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_TIER,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: Math.min(AUTONOMY_AGENT_HANG_TIMEOUT_MS, 45 * 60 * 1000),
      outputFormat: "json",
      outputSchema: securityInvestigationOutputSchema,
      validate: decodeSecurityInvestigationOutput,
      when: (ctx) => (scanCandidates.output(ctx)?.candidateCount ?? 0) > 0,
    },
    recordInvestigationFindings,
    {
      id: "revalidate-findings",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_TIER,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: Math.min(AUTONOMY_AGENT_HANG_TIMEOUT_MS, 30 * 60 * 1000),
      outputFormat: "json",
      outputSchema: securityRevalidationOutputSchema,
      validate: decodeSecurityRevalidationVerdictOutput,
      when: (ctx) =>
        (recordedInvestigation(ctx)?.findings.length ?? 0) > 0,
    },
    recordRevalidation,
  ],
};

export default securityReviewWorkflow;
