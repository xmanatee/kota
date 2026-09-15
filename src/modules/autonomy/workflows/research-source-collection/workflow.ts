import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";
import { inspectResearchRetryCandidatesOperation } from "../research-retry/blocking-operations.js";
import { researchHandoffSchema } from "../research-retry/handoff.js";
import { availableResearchSourceTools, researchSourceToolAccess } from "../research-retry/precondition.js";
import type { InspectResult } from "../research-retry/shadow-review.js";
import { collectResearchHttpReadings, collectResearchSourceEvidence, type HttpReadings, httpReadingsSchema, type SourceEvidence, sourceEvidenceSchema } from "../research-retry/source-evidence.js";
import { assertResearchRetryTrigger, RESEARCH_RETRY_EVENT } from "../research-retry/trigger.js";

const inspectCandidates = typedCodeStep<InspectResult>({
  id: "inspect-candidates",
  type: "code",
  // Selection must survive recovery: changing it would rebind durable tool identities.
  validate: (raw) => expectStructuredOutput<InspectResult>(raw, [
    "dirty", "candidateCount", "capability", "candidate", "fingerprint", "marker", "examined",
  ]),
  run: ({ scopeRoot, trigger, runBlocking, scopePolicySnapshot }) => {
    assertResearchRetryTrigger(trigger);
    return runBlocking(inspectResearchRetryCandidatesOperation, {
      workspaceRoot: scopeRoot,
      scopeRoot,
      availableTools: availableResearchSourceTools(scopePolicySnapshot?.policy),
    });
  },
});

const collectHttp = typedCodeStep<HttpReadings>({
  id: "collect-http-sources",
  type: "code",
  validate: (raw) => httpReadingsSchema.parse(raw),
  when: (ctx) => {
    const inspection = inspectCandidates.outputRequired(ctx);
    return !inspection.dirty && inspection.candidate !== null;
  },
  run: (ctx) => collectResearchHttpReadings({
    urls: inspectCandidates.outputRequired(ctx).candidate!.attemptableUrls,
    runTool: ctx.runTool,
  }),
});

const collectSources = typedCodeStep<SourceEvidence>({
  id: "collect-sources",
  type: "code",
  validate: (raw) => sourceEvidenceSchema.parse(raw),
  when: (ctx) => {
    const inspection = inspectCandidates.outputRequired(ctx);
    return !inspection.dirty && inspection.candidate !== null;
  },
  run: (ctx) => {
    const inspection = inspectCandidates.outputRequired(ctx);
    return collectResearchSourceEvidence({
      urls: inspection.candidate!.attemptableUrls,
      capability: inspection.capability,
      httpReadings: collectHttp.outputRequired(ctx),
      runTool: ctx.runTool,
    });
  },
});

const workflow: WorkflowDefinitionInput = {
  name: "research-source-collection",
  repository: "none",
  // Hold through child publication, so another collection cannot race its marker.
  resources: () => ["autonomy:research-collection"],
  description: "Collect authorized research sources outside repository writers and hand durable evidence to research-retry.",
  triggers: [{ event: RESEARCH_RETRY_EVENT, cooldownMs: 60_000, queueMode: "latest" }],
  steps: [
    {
      id: "source-authority",
      type: "code",
      run: (ctx) => researchSourceToolAccess(ctx.scopePolicySnapshot?.policy),
    },
    inspectCandidates,
    collectHttp,
    collectSources,
    {
      id: "publish-research",
      type: "code",
      when: stepSucceeded("collect-sources"),
      run: async (ctx) => {
        const inspection = inspectCandidates.outputRequired(ctx);
        const handoff = researchHandoffSchema.parse({
          scopeId: ctx.scopeId,
          sourceRunId: ctx.workflow.runId,
          candidate: inspection.candidate,
          capability: inspection.capability,
          evidence: collectSources.outputRequired(ctx),
        });
        const result = await ctx.triggerWorkflow("research-retry", handoff, "completed", ctx.signal, "publish-research");
        if (result.status !== "completed") throw new Error("Research evidence publication did not complete; collected evidence is retained");
        return result;
      },
    },
  ],
};
export default workflow;
