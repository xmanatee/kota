import { getApprovalQueue } from "../approval-queue.js";
import type { BusEvents, EventBus } from "../event-bus.js";
import { type ExtensionCrashAlertOptions, subscribeExtensionCrashAlert } from "../extension-crash-alert.js";
import { subscribeWorkflowFailureAlert } from "../workflow/failure-alert.js";
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
  extensionCrashAlertOpts?: ExtensionCrashAlertOptions;
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
    extensionCrashAlertOpts,
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

  const stopFailureAlert = subscribeWorkflowFailureAlert(bus, projectDir, onLog, { alertCooldownMs });
  const stopCrashAlert = subscribeExtensionCrashAlert(bus, extensionCrashAlertOpts);

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
