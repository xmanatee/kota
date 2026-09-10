import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { normalizeGeneratedWorkProposalKey } from "#modules/autonomy/generated-work-proposal.js";
import { findGeneratedWorkTask } from "#modules/autonomy/generated-work-task.js";
import { normalizeObservationTarget } from "./observations.js";
import type { ArchitectureGardenerRunState, GardenerProposalIdentity } from "./types.js";

export const ARCHITECTURE_GARDENER_RUN_ARTIFACT = "architecture-gardener-run.json";

const historicalIdentitySchema = z.discriminatedUnion("schemaVersion", [z.object({
  // Score-based artifacts predate investigated proposal identity. They cannot
  // resolve linked ownership, but must not hide later attributable evidence.
  schemaVersion: z.literal(1),
}), z.object({
  schemaVersion: z.literal(2),
  admission: z.object({ targetScope: z.string() }),
  handoff: z.object({ targetScope: z.string() }).nullable(),
  decision: z.object({ proposal: z.object({ mechanismKey: z.string() }).nullable() }).nullable(),
  staged: z.object({ taskId: z.string().nullable(), proposalKey: z.string().nullable() }).nullable(),
})]);

/** Recover the identity omitted from older state using its retained run evidence. */
export async function readGardenerProposalIdentities(args: {
  state: ArchitectureGardenerRunState;
  runsRoot: string;
  workspaceRoot: string;
}): Promise<GardenerProposalIdentity[]> {
  const identities = Object.values(args.state.dispositions).flatMap((record) => record.proposalIdentities ?? []);
  const missing = new Set([
    ...args.state.linkedTaskIds,
    ...Object.values(args.state.dispositions).flatMap((record) => record.taskId ? [record.taskId] : []),
  ].filter((taskId) => taskId.startsWith("task-generated-") && !identities.some((identity) => identity.taskId === taskId)));
  if (!missing.size) return identities;
  const entries = await readdir(args.runsRoot, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    let text: string;
    try {
      text = await readFile(join(args.runsRoot, entry.name, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    const artifact = historicalIdentitySchema.parse(JSON.parse(text));
    if (artifact.schemaVersion === 1) continue;
    const taskId = artifact.staged?.taskId;
    const key = artifact.staged?.proposalKey;
    const mechanismKey = artifact.decision?.proposal?.mechanismKey;
    if (!taskId || !key || !mechanismKey || !missing.has(taskId)) continue;
    const proposalKey = normalizeGeneratedWorkProposalKey(key);
    if (findGeneratedWorkTask(args.workspaceRoot, proposalKey)?.task.id !== taskId) {
      throw new Error(`Historical gardener proposal identity does not match linked task ${taskId}`);
    }
    identities.push({ taskId, proposalKey, mechanismKey,
      targetScope: normalizeObservationTarget(artifact.handoff?.targetScope ?? artifact.admission.targetScope) });
    missing.delete(taskId);
    if (!missing.size) break;
  }
  return identities;
}
