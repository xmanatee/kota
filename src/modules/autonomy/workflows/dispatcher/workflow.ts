import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  countRepoPromotableBacklogTasks,
  getRepoTaskQueueSnapshot,
  isThinPullQueue,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { inspectResearchRetryAvailability } from "../research-retry/precondition.js";

// Not recovery-capable: dispatcher only reads repo state and emits events — it
// never mutates tracked files, so it cannot leave dirt to heal and cannot help
// clean dirt left by others. Recovery dispatch is handled by the worktree-
// mutating workflows (builder, inbox-sorter, decomposer, explorer, improver).
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
        const promotableBacklogCount = countRepoPromotableBacklogTasks(projectDir);
        const researchRetryAvailability = inspectResearchRetryAvailability(projectDir);
        const queueEmpty = queue.inboxCount === 0 && queue.pullableCount === 0;
        const queueThin = isThinPullQueue(queue);
        // Builder runs only on actionable (ready+doing) work; backlog-only
        // queues route through `autonomy.queue.needs-promotion` only when at
        // least one backlog task can actually be promoted. Strategic anchors
        // stay in backlog as tracking records and must not keep waking the
        // promoter forever.
        const queueActionable = queue.actionableCount > 0;
        const queueNeedsPromotion =
          queue.actionableCount === 0 && promotableBacklogCount > 0;
        const blockedResearchAttemptable =
          researchRetryAvailability.attemptableCount > 0;

        if (queue.inboxCount > 0) {
          emit("autonomy.inbox.available", { inboxCount: queue.inboxCount });
        }
        if (queueActionable) {
          emit("autonomy.queue.available", {
            pullableCount: queue.pullableCount,
            actionableCount: queue.actionableCount,
            counts: queue.counts,
            dependencyBlockedTasks: queue.dependencyBlockedTasks,
          });
        }
        if (queueNeedsPromotion) {
          emit("autonomy.queue.needs-promotion", {
            backlogCount: queue.counts.backlog,
            promotableBacklogCount,
            counts: queue.counts,
            dependencyBlockedTasks: queue.dependencyBlockedTasks,
          });
        }
        if (queueEmpty) {
          emit("autonomy.queue.empty", {
            counts: queue.counts,
            dependencyBlockedTasks: queue.dependencyBlockedTasks,
          });
        }
        if (blockedResearchAttemptable) {
          emit("autonomy.blocked-research.attemptable", {
            candidateCount: researchRetryAvailability.candidateCount,
            attemptableCount: researchRetryAvailability.attemptableCount,
            counts: queue.counts,
          });
        }
        if (queueThin) {
          emit("autonomy.queue.thin", {
            pullableCount: queue.pullableCount,
            dependencyBlockedTasks: queue.dependencyBlockedTasks,
            counts: queue.counts,
          });
        }

        return {
          inboxCount: queue.inboxCount,
          pullableCount: queue.pullableCount,
          actionableCount: queue.actionableCount,
          dependencyBlockedTasks: queue.dependencyBlockedTasks,
          promotableBacklogCount,
          researchRetryCandidateCount: researchRetryAvailability.candidateCount,
          researchRetryAttemptableCount: researchRetryAvailability.attemptableCount,
          emitted: [
            queue.inboxCount > 0 && "autonomy.inbox.available",
            queueActionable && "autonomy.queue.available",
            queueNeedsPromotion && "autonomy.queue.needs-promotion",
            queueEmpty && "autonomy.queue.empty",
            blockedResearchAttemptable && "autonomy.blocked-research.attemptable",
            queueThin && "autonomy.queue.thin",
          ].filter(Boolean),
        };
      },
    },
  ],
};

export default dispatcherWorkflow;
