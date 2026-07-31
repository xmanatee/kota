import type { BusEvents, EventBus } from "#core/events/event-bus.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { subscribeWorkflowFailureAlert } from "#core/workflow/failure-alert.js";
import type { WorkflowNotifyConfig } from "#core/workflow/step-input-base.js";
import type { ApprovalQueue } from "./approval-queue.js";
import { type ModuleCrashAlertOptions, subscribeModuleCrashAlert } from "./module-crash-alert.js";
import { getOwnerQuestionQueue } from "./owner-question-queue.js";
import type { ScheduledItem } from "./scheduler.js";
import { getScheduler } from "./scheduler.js";

export type DaemonSubscriptionsOptions = {
  bus: EventBus;
  failureAlertScopes: readonly {
    pbus: ProjectScopedEventBus;
    projectDir: string;
  }[];
  approvalQueues: readonly ApprovalQueue[];
  pollIntervalMs: number;
  onDueItems: (items: ScheduledItem[]) => void;
  onWorkflowCompleted: (payload: BusEvents["workflow.completed"]) => void;
  onRestartRequested: (reason: string) => void;
  onLog: (message: string) => void;
  approvalTtlMs?: number;
  alertCooldownMs?: number;
  moduleCrashAlertOpts?: ModuleCrashAlertOptions;
  /** Returns the notify config for a workflow by name, if defined. */
  getWorkflowNotify?: (workflowName: string) => WorkflowNotifyConfig | undefined;
};

export function subscribeDaemon(opts: DaemonSubscriptionsOptions): () => void {
  const {
    bus,
    failureAlertScopes,
    approvalQueues,
    pollIntervalMs,
    onDueItems,
    onWorkflowCompleted,
    onRestartRequested,
    onLog,
    approvalTtlMs,
    alertCooldownMs,
    moduleCrashAlertOpts,
    getWorkflowNotify,
  } = opts;

  const scheduler = getScheduler();

  const stopBus = scheduler.connectBus(bus, onDueItems);
  const stopSchedulerTimer = scheduler.startTimer(pollIntervalMs, onDueItems);

  const stopWorkflowListener = bus.on("workflow.completed", (payload) => {
    onWorkflowCompleted(payload);
  });

  const stopRestartListener = bus.on("runtime.restart_requested", (payload) => {
    onRestartRequested(payload.reason ?? "workflow requested restart");
  });

  const stopFailureAlerts = failureAlertScopes.map(({ pbus, projectDir }) =>
    subscribeWorkflowFailureAlert(pbus, projectDir, onLog, {
      alertCooldownMs,
      getWorkflowNotify,
    }),
  );
  const stopCrashAlert = subscribeModuleCrashAlert(bus, moduleCrashAlertOpts);
  const reportedBlockedApprovalIds = new Map<string, Set<string>>();

  const approvalSweepTimer = setInterval(() => {
    for (const approvalQueue of approvalQueues) {
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
    stopBus();
    stopSchedulerTimer();
    stopWorkflowListener();
    stopRestartListener();
    for (const stopFailureAlert of stopFailureAlerts) {
      stopFailureAlert();
    }
    stopCrashAlert();
    clearInterval(approvalSweepTimer);
    clearInterval(ownerQuestionSweepTimer);
  };
}
