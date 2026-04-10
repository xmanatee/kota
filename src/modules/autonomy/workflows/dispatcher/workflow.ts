import { getRepoTaskQueueSnapshot } from "../../../../repo-tasks.js";
import type { WorkflowDefinitionInput } from "../../../../workflow/types.js";

const dispatcherWorkflow: WorkflowDefinitionInput = {
  name: "dispatcher",
  description:
    "Assess repo state on idle and emit condition-based events for other autonomy workflows.",
  triggers: [
    {
      event: "runtime.idle",
      cooldownMs: 30_000,
    },
  ],
  steps: [
    {
      id: "assess-and-dispatch",
      type: "code",
      run: ({ projectDir, emit }) => {
        const queue = getRepoTaskQueueSnapshot(projectDir);

        if (queue.inboxCount > 0) {
          emit("autonomy.inbox.available", { inboxCount: queue.inboxCount });
        }
        if (queue.actionableCount > 0) {
          emit("autonomy.queue.available", { actionableCount: queue.actionableCount });
        }
        if (queue.inboxCount === 0 && queue.counts.ready === 0 && queue.counts.backlog === 0) {
          emit("autonomy.queue.empty", { counts: queue.counts });
        }

        return {
          inboxCount: queue.inboxCount,
          actionableCount: queue.actionableCount,
          emitted: [
            queue.inboxCount > 0 && "autonomy.inbox.available",
            queue.actionableCount > 0 && "autonomy.queue.available",
            queue.inboxCount === 0 &&
              queue.counts.ready === 0 &&
              queue.counts.backlog === 0 &&
              "autonomy.queue.empty",
          ].filter(Boolean),
        };
      },
    },
  ],
};

export default dispatcherWorkflow;
