import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import { projectEvidenceObject } from "#core/evidence/policy.js";
import { readAnchoredTextFiles } from "#core/util/filesystem/anchored-files.js";
import { resolveAgentRunDirFromContext } from "#core/workflow/agent-run-dir.js";
import { defineWorkflowBlockingOperation, type WorkflowBlockingOperationContext } from "#core/workflow/blocking-operation.js";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { WorkflowCodeStepContext } from "#core/workflow/step-input-code.js";
import type { AutonomyHealthEvidenceRef } from "./health-signal.js";
import { collectIssueEvidenceFiles } from "./issue-evidence-files.js";
import { getWorkflowChangeEvidence } from "./workflow-diff.js";

/** Export only authority-selected, same-scope diagnostics into the agent sandbox. */
export async function writeIssueEvidence(
  ctx: Pick<WorkflowCodeStepContext, "scopeRoot" | "stateDir" | "scopeId" | "runtimeStateDir" | "runtimeResources" | "workflow" | "runBlocking">,
  references: readonly AutonomyHealthEvidenceRef[],
  namedReferences: readonly string[] = [],
): Promise<string | null> {
  return ctx.runBlocking(issueEvidenceOperation, {
    scopeRoot: ctx.scopeRoot, stateDir: ctx.stateDir, scopeId: ctx.scopeId, runtimeStateDir: ctx.runtimeStateDir,
    agentDir: resolveAgentRunDirFromContext(ctx), runDir: ctx.workflow.runDirPath,
    references, namedReferences,
  });
}

type IssueEvidenceInput = {
  scopeRoot: string; stateDir: string; scopeId: string; runtimeStateDir: string; agentDir: string; runDir: string;
  references: readonly AutonomyHealthEvidenceRef[]; namedReferences: readonly string[];
};

export async function collectIssueEvidence(input: IssueEvidenceInput, context: WorkflowBlockingOperationContext): Promise<string | null> {
  if (input.references.length === 0 && input.namedReferences.length === 0) return null;
  const authority = RunStateDatabase.openReadOnly(input.runtimeStateDir);
  try {
    const references = [...input.references];
    for (const id of authority.listRunIds(input.scopeId, undefined, { references: input.namedReferences })) {
      references.push({ kind: "run", ref: `.kota/runs/${id}/metadata.json` });
    }
    return await exportIssueEvidence(input, references, authority, context);
  } finally { authority.close(); }
}

const issueEvidenceOperation = defineWorkflowBlockingOperation<IssueEvidenceInput, string | null>(import.meta.url, "collectIssueEvidence");

async function exportIssueEvidence(ctx: IssueEvidenceInput, references: readonly AutonomyHealthEvidenceRef[], authority: RunStateDatabase, context: WorkflowBlockingOperationContext): Promise<string | null> {
  const refs = [...new Set(references
    .filter((ref) => ref.kind === "dead-letter")
    .map(({ ref }) => ref))];
  const runRefs = [...new Set(references.filter((ref) => ref.kind === "run").map(({ ref }) => ref))];

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

      for (const ref of runRefs) {
        context.signal.throwIfAborted();
        context.reportProgress(`Exporting selected run ${runRefs.indexOf(ref) + 1} of ${runRefs.length}`);
        const match = /^\.kota\/runs\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:\/metadata\.json)?$/.exec(ref);
        if (!match || match[1] === "." || match[1] === "..") {
          evidence.push({ ref, unavailable: "Unsupported run reference" });
          continue;
        }
        const run = authority.getRun(match[1]!);
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
              const [review] = await readAnchoredTextFiles([{
                rootPath: dirname(run.sandbox.rootDir), boundaryDir: run.sandbox.rootDir,
                filePath: join(run.sandbox.rootDir, "agent", "critic-review.json"), maxBytes: 128 * 1024,
              }], context.signal);
              if (!review?.ok || !review.file) throw new Error("Critic review unavailable from anchored evidence");
              const raw: unknown = JSON.parse(review.file.content);
              if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Critic review must be an object");
              writerEvidence.push({ criticReview: raw });
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
  evidence.push(...await collectIssueEvidenceFiles(ctx, references, authority, context));
  for (const reference of references) {
    if (!["run", "dead-letter", "artifact", "module-log"].includes(reference.kind)) {
      evidence.push({ ...reference, unavailable: "Reference has no scoped diagnostic content exporter" });
    }
  }
  context.signal.throwIfAborted();
  const agentDir = ctx.agentDir;
  const evidencePath = join(agentDir, "issue-evidence.json");
  const content = `${JSON.stringify(projectEvidenceObject({ capturedAt: new Date().toISOString(), evidence }, "agent-context"), null, 2)}\n`;
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(evidencePath, content, { mode: 0o600 });
  mkdirSync(ctx.runDir, { recursive: true });
  writeFileSync(join(ctx.runDir, "issue-evidence.json"), content, { mode: 0o600 });
  return evidencePath;
}
