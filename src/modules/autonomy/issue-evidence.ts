import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import { projectEvidenceObject } from "#core/evidence/policy.js";
import { resolveAgentRunDirFromContext } from "#core/workflow/agent-run-dir.js";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { readConfinedEvidenceJson } from "./evidence-reader.js";
import type { AutonomyHealthEvidenceRef } from "./health-signal.js";
import { getWorkflowChangeEvidence } from "./workflow-diff.js";

/** Export only authority-selected, same-scope diagnostics into the agent sandbox. */
export function writeIssueEvidence(
  ctx: Pick<WorkflowStepContext, "stateDir" | "scopeId" | "scopeRoot" | "runtimeResources" | "workflow" | "runEvidence">,
  references: readonly AutonomyHealthEvidenceRef[],
): string | null {
  const refs = [...new Set(references
    .filter((ref) => ref.kind === "dead-letter")
    .map(({ ref }) => ref))];
  const runRefs = [...new Set(references.filter((ref) => ref.kind === "run").map(({ ref }) => ref))];
  if (refs.length === 0 && runRefs.length === 0) return null;
  const store = new DeadLetterQueueStore(join(ctx.stateDir, "dead-letter-queue"));
  const evidence: object[] = refs.map((ref) => {
    const match = /^\.kota\/dead-letter-queue\/items\.json#(dlq-[a-f0-9-]+)$/.exec(ref);
    if (!match) throw new Error(`Invalid dead-letter evidence reference: ${ref}`);
    const item = store.get(match[1]!);
    if (item && item.scopeId !== ctx.scopeId) {
      throw new Error("Issue evidence belongs to another scope");
    }
    return { ref, item };
  });
  if (runRefs.length > 0) {
    const authority = ctx.runEvidence;
      for (const ref of runRefs) {
        const match = /^\.kota\/runs\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:\/metadata\.json)?$/.exec(ref);
        if (!match || match[1] === "." || match[1] === "..") {
          evidence.push({ ref, unavailable: "Unsupported run reference" });
          continue;
        }
        const run = authority?.getRun(match[1]!);
        if (!run || run.scopeId !== ctx.scopeId) {
          evidence.push({ ref, unavailable: "Run is unavailable from this scope's runtime evidence" });
          continue;
        }
        try {
          const metadata = readWorkflowRunMetadataFile(join(ctx.stateDir, "runs", run.id, "metadata.json"));
          const writerEvidence: object[] = [];
          if (run.sandbox?.repository === "write" && run.state === "needs_attention") {
            try {
              writerEvidence.push({ changes: getWorkflowChangeEvidence(run.sandbox.workspaceDir) });
            } catch (error) {
              writerEvidence.push({ unavailable: error instanceof Error ? error.message : String(error) });
            }
            try {
              writerEvidence.push({ criticReview: readConfinedEvidenceJson(dirname(run.sandbox.rootDir), join(basename(run.sandbox.rootDir), "agent", "critic-review.json")) });
            } catch (error) {
              writerEvidence.push({ unavailable: error instanceof Error ? error.message : String(error) });
            }
          }
          evidence.push({ ref, run: {
            id: run.id, scopeId: run.scopeId, state: run.state, attempt: run.attempt,
            resources: run.resources, trigger: run.trigger,
            wait: run.wait, integration: run.integration,
            sandbox: run.sandbox, lastError: run.lastError,
          }, metadata, writerEvidence, ...(metadata === null ? { unavailable: "Run metadata is unavailable" } : {}) });
        } catch (error) {
          evidence.push({ ref, unavailable: error instanceof Error ? error.message : String(error) });
        }
      }
  }
  const agentDir = resolveAgentRunDirFromContext(ctx);
  const evidencePath = join(agentDir, "issue-evidence.json");
  const content = `${JSON.stringify(projectEvidenceObject({ capturedAt: new Date().toISOString(), evidence }, "agent-context"), null, 2)}\n`;
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(evidencePath, content, { mode: 0o600 });
  mkdirSync(ctx.workflow.runDirPath, { recursive: true });
  writeFileSync(join(ctx.workflow.runDirPath, "issue-evidence.json"), content, { mode: 0o600 });
  return evidencePath;
}
