import type { WorkflowDefinitionInput } from "../../../../workflow/types.js";
import {
  getRepoTaskQueueSnapshot,
  isThinPullQueue,
} from "../../../repo-tasks/repo-tasks.js";

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
        const queueEmpty = queue.inboxCount === 0 && queue.pullableCount === 0;
        const queueThin = isThinPullQueue(queue);

        if (queue.inboxCount > 0) {
          emit("autonomy.inbox.available", { inboxCount: queue.inboxCount });
        }
        if (queue.pullableCount > 0) {
          emit("autonomy.queue.available", {
            pullableCount: queue.pullableCount,
            actionableCount: queue.actionableCount,
            counts: queue.counts,
          });
        }
        if (queueEmpty) {
          emit("autonomy.queue.empty", { counts: queue.counts });
        }
        if (queueThin) {
          emit("autonomy.queue.thin", {
            pullableCount: queue.pullableCount,
            counts: queue.counts,
          });
        }

        return {
          inboxCount: queue.inboxCount,
          pullableCount: queue.pullableCount,
          actionableCount: queue.actionableCount,
          emitted: [
            queue.inboxCount > 0 && "autonomy.inbox.available",
            queue.pullableCount > 0 && "autonomy.queue.available",
            queueEmpty && "autonomy.queue.empty",
            queueThin && "autonomy.queue.thin",
          ].filter(Boolean),
        };
      },
    },
  ],
};

export default dispatcherWorkflow;
