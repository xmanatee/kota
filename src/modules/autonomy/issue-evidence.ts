import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import { resolveAgentRunDirFromContext } from "#core/workflow/agent-run-dir.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import type { AutonomyHealthEvidenceRef } from "./health-signal.js";

/** Export only authority-selected, same-scope diagnostics into the agent sandbox. */
export function writeIssueEvidence(
  ctx: Pick<WorkflowStepContext, "stateDir" | "scopeId" | "scopeRoot" | "runtimeResources" | "workflow">,
  references: readonly AutonomyHealthEvidenceRef[],
): string | null {
  const refs = [...new Set(references
    .filter((ref) => ref.kind === "dead-letter")
    .map(({ ref }) => ref))];
  if (refs.length === 0) return null;
  const store = new DeadLetterQueueStore(join(ctx.stateDir, "dead-letter-queue"));
  const evidence = refs.map((ref) => {
    const match = /^\.kota\/dead-letter-queue\/items\.json#(dlq-[a-f0-9-]+)$/.exec(ref);
    if (!match) throw new Error(`Invalid dead-letter evidence reference: ${ref}`);
    const item = store.get(match[1]!);
    if (item && item.scopeId !== ctx.scopeId) {
      throw new Error("Issue evidence belongs to another scope");
    }
    return { ref, item };
  });
  const agentDir = resolveAgentRunDirFromContext(ctx);
  const evidencePath = join(agentDir, "issue-evidence.json");
  const content = `${JSON.stringify({ capturedAt: new Date().toISOString(), evidence }, null, 2)}\n`;
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(evidencePath, content, { mode: 0o600 });
  mkdirSync(ctx.workflow.runDirPath, { recursive: true });
  writeFileSync(join(ctx.workflow.runDirPath, "issue-evidence.json"), content, { mode: 0o600 });
  return evidencePath;
}
