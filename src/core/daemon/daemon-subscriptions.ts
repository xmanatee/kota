import type { BusEvents, EventBus } from "#core/events/event-bus.js";
import type { ApprovalQueue } from "./approval-queue.js";
import { type ModuleCrashAlertOptions, subscribeModuleCrashAlert } from "./module-crash-alert.js";
import { getOwnerQuestionQueue } from "./owner-question-queue.js";

export type DaemonSubscriptionsOptions = {
  bus: EventBus;
  approvalQueues: () => readonly ApprovalQueue[];
  pollIntervalMs: number;
  onWorkflowCompleted: (payload: BusEvents["workflow.completed"]) => void;
  onRestartRequested: (reason: string) => void;
  onLog: (message: string) => void;
  approvalTtlMs?: number;
  moduleCrashAlertOpts?: ModuleCrashAlertOptions;
};

export function subscribeDaemon(opts: DaemonSubscriptionsOptions): () => void {
  const {
    bus,
    approvalQueues,
    pollIntervalMs,
    onWorkflowCompleted,
    onRestartRequested,
    onLog,
    approvalTtlMs,
    moduleCrashAlertOpts,
  } = opts;

  const stopWorkflowListener = bus.on("workflow.completed", (payload) => {
    onWorkflowCompleted(payload);
  });

  const stopRestartListener = bus.on("runtime.restart_requested", (payload) => {
    onRestartRequested(payload.reason ?? "workflow requested restart");
  });

  const stopCrashAlert = subscribeModuleCrashAlert(bus, moduleCrashAlertOpts);
  const reportedBlockedApprovalIds = new Map<string, Set<string>>();

  const approvalSweepTimer = setInterval(() => {
    for (const approvalQueue of approvalQueues()) {
      const scopeId = approvalQueue.getScopeId();
      let blocked: ReturnType<ApprovalQueue["expireStale"]>["blocked"];
      try {
        ({ blocked } = approvalQueue.expireStale(approvalTtlMs));
      } catch (error) {
        onLog(
          `Approval expiration sweep failed for scope ${scopeId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        continue;
      }
      const previouslyBlocked = reportedBlockedApprovalIds.get(scopeId)
        ?? new Set<string>();
      const blockedApprovalIds = new Set(
        blocked.map(({ approvalId }) => approvalId),
      );
      const newlyBlocked = blocked.filter(
        ({ approvalId }) => !previouslyBlocked.has(approvalId),
      );
      if (newlyBlocked.length > 0) {
        onLog(
          `Approval expiration sweep failed closed for scope ${scopeId}: ` +
          `${newlyBlocked.length} unauthenticated ` +
          `pending approval(s): ${newlyBlocked.map(({ approvalId }) => approvalId).join(", ")}`,
        );
      }
      reportedBlockedApprovalIds.set(scopeId, blockedApprovalIds);
    }
  }, pollIntervalMs);
  approvalSweepTimer.unref();

  const ownerQuestionSweepTimer = setInterval(() => {
    getOwnerQuestionQueue().expireStale();
  }, pollIntervalMs);
  ownerQuestionSweepTimer.unref();

  return () => {
    stopWorkflowListener();
    stopRestartListener();
    stopCrashAlert();
    clearInterval(approvalSweepTimer);
    clearInterval(ownerQuestionSweepTimer);
  };
}
