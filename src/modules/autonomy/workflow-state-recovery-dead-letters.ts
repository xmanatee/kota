import { join } from "node:path";
import { deadLetterStoreForProject } from "#core/daemon/dead-letter-queue.js";
import {
  EventedDeadLetterQueueStore,
  moduleDeadLetterChangedPublisher,
} from "#core/daemon/dead-letter-queue-events.js";
import type { ModuleEventProxy } from "#core/modules/module-types.js";
import type { WorkflowStateRecoveryClaim } from "#modules/workflow-ops/state-recovery-provider.js";

export function dismissWorkflowStateRecoveryDeadLetters(
  projectDir: string,
  before: WorkflowStateRecoveryClaim,
  rationale: string,
  events?: ModuleEventProxy,
): string[] {
  const store = events
    ? new EventedDeadLetterQueueStore(
        join(projectDir, ".kota", "dead-letter-queue"),
        undefined,
        moduleDeadLetterChangedPublisher(projectDir, events),
      )
    : deadLetterStoreForProject(projectDir);
  const dismissed: string[] = [];
  for (const item of before.relatedDeadLetters) {
    if (item.status !== "open") continue;
    const result = store.dismiss(
      item.id,
      `workflow state recovery for ${before.claim.taskId}/${before.claim.runId}: ${rationale}`,
    );
    if (result) dismissed.push(item.id);
  }
  return dismissed;
}
