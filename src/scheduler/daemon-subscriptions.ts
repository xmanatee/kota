import type { BusEvents, EventBus } from "../event-bus.js";
import { subscribeApprovalNotification } from "../workflow/approval-notification.js";
import { subscribeWorkflowFailureAlert } from "../workflow/failure-alert.js";
import type { StatusInfo } from "../workflow/telegram-status-poll.js";
import { startTelegramStatusPoll } from "../workflow/telegram-status-poll.js";
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
  getTelegramState?: () => StatusInfo;
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
    getTelegramState,
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

  const stopFailureAlert = subscribeWorkflowFailureAlert(bus, projectDir, onLog);
  const stopApprovalNotification = subscribeApprovalNotification(bus, onLog);

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  const stopTelegramStatusPoll =
    telegramToken && telegramChatId && getTelegramState
      ? startTelegramStatusPoll(telegramToken, telegramChatId, getTelegramState, onLog)
      : null;

  return () => {
    stopBus();
    stopSchedulerTimer();
    stopWorkflowListener();
    stopRestartListener();
    stopFailureAlert();
    stopApprovalNotification();
    stopTelegramStatusPoll?.();
  };
}
