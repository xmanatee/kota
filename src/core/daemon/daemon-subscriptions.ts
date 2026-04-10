import { getApprovalQueue } from "../../modules/approval-queue/queue.js";
import { type ModuleCrashAlertOptions, subscribeModuleCrashAlert } from "../../modules/notifications/module-crash-alert.js";
import type { BusEvents, EventBus } from "../events/event-bus.js";
import { subscribeWorkflowFailureAlert } from "../workflow/failure-alert.js";
import type { WorkflowNotifyConfig } from "../workflow/types.js";
import type { ScheduledItem } from "./scheduler.js";
import { getScheduler } from "./scheduler.js";

export type DaemonSubscriptionsOptions = {
  bus: EventBus;
  projectDir: string;
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
    projectDir,
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

  const stopFailureAlert = subscribeWorkflowFailureAlert(bus, projectDir, onLog, { alertCooldownMs, getWorkflowNotify });
  const stopCrashAlert = subscribeModuleCrashAlert(bus, moduleCrashAlertOpts);

  const approvalSweepTimer = setInterval(() => {
    getApprovalQueue().expireStale(approvalTtlMs);
  }, pollIntervalMs);
  approvalSweepTimer.unref();

  return () => {
    stopBus();
    stopSchedulerTimer();
    stopWorkflowListener();
    stopRestartListener();
    stopFailureAlert();
    stopCrashAlert();
    clearInterval(approvalSweepTimer);
  };
}
