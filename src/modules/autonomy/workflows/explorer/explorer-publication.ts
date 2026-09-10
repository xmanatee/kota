import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowFinalizationContext } from "#core/workflow/types.js";
import { decodeExplorerState, EXPLORER_STATE_KEY, type ExplorerState } from "./explorer-state.js";

export const EXPLORER_PUBLICATION_ARTIFACT = "explorer-publication.json";
export function finalizeExplorer(ctx: WorkflowFinalizationContext): void {
  const artifact = readOptionalJsonFile<ExplorerState>(
    join(ctx.stateDir, "runs", ctx.runId, EXPLORER_PUBLICATION_ARTIFACT),
  );
  if (artifact === null) return;
  const next = decodeExplorerState(artifact);
  const snapshot = ctx.state.read<ExplorerState>(EXPLORER_STATE_KEY);
  const current = decodeExplorerState(snapshot.value);
  if (current.observedAt && (!next.observedAt || current.observedAt >= next.observedAt)) return;
  ctx.state.compareAndSet(EXPLORER_STATE_KEY, snapshot.revision, next);
}
