/**
 * Slack module — routes KOTA notification events to a Slack Incoming Webhook.
 *
 * Subscribes to the same bus events as the Telegram and webhook modules and
 * POSTs Block Kit messages to a configured Slack Incoming Webhook URL.
 * No OAuth app or bot token required — only a webhook URL.
 *
 * Config (kota.config under the "slack" key):
 *   { webhookUrl: string, events?: string[], retries?: number, retryDelayMs?: number }
 *
 * If `events` is omitted, all notification events are active.
 * `approval.requested` is always forwarded when the module is configured.
 * `retries` defaults to 3; `retryDelayMs` defaults to 1000.
 */

import type { KotaModule } from "../../module-types.js";
import { postWithRetry } from "../notify-retry.js";

const NOTIFICATION_EVENTS = [
  "workflow.failure.alert",
  "workflow.budget.exceeded",
  "workflow.budget.warning",
  "workflow.attention.digest",
  "workflow.cost.limit.reached",
  "workflow.cost.anomaly",
  "workflow.approval.expired",
  "module.crash.alert",
] as const;

/** Events that are off by default; subscribed only when explicitly listed in config `events`. */
const OPT_IN_EVENTS = ["workflow.build.committed"] as const;

type SlackConfig = {
  /** Slack Incoming Webhook URL. Required. */
  webhookUrl: string;
  /** Subset of notification events to forward. Defaults to all. */
  events?: string[];
  /** Number of retry attempts after the initial try. Default: 3. */
  retries?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 1000. */
  retryDelayMs?: number;
};

type Block =
  | { type: "header"; text: { type: "plain_text"; text: string } }
  | { type: "section"; text: { type: "mrkdwn"; text: string } }
  | { type: "divider" };

function header(text: string): Block {
  return { type: "header", text: { type: "plain_text", text } };
}

function section(text: string): Block {
  return { type: "section", text: { type: "mrkdwn", text } };
}

const divider: Block = { type: "divider" };

function buildBlocks(event: string, payload: Record<string, unknown>): Block[] {
  switch (event) {
    case "workflow.failure.alert": {
      const workflow = payload.workflow as string | undefined;
      const runId = payload.runId as string | undefined;
      const status = payload.status as string | undefined;
      const errorSummary = payload.errorSummary as string | undefined;
      const blocks: Block[] = [header(`Workflow ${status ?? "failed"}: ${workflow ?? "unknown"}`), divider];
      if (runId) blocks.push(section(`*Run:* \`${runId}\``));
      if (errorSummary) blocks.push(section(`*Error:* ${errorSummary}`));
      return blocks;
    }
    case "workflow.budget.exceeded": {
      const dailySpend = payload.dailySpend as number | undefined;
      const budget = payload.budget as number | undefined;
      return [
        header("Budget Exceeded"),
        divider,
        section(
          [
            budget !== undefined ? `*Budget:* $${budget.toFixed(2)}` : null,
            dailySpend !== undefined ? `*Daily spend:* $${dailySpend.toFixed(2)}` : null,
          ]
            .filter(Boolean)
            .join("  ·  ") || (payload.text as string) || "",
        ),
      ];
    }
    case "workflow.budget.warning": {
      const dailySpend = payload.dailySpend as number | undefined;
      const budget = payload.budget as number | undefined;
      const warnAt = payload.warnAt as number | undefined;
      const pct = warnAt !== undefined ? `${Math.round(warnAt * 100)}%` : undefined;
      return [
        header("Budget Soft-Limit Warning"),
        divider,
        section(
          [
            pct !== undefined ? `*Threshold:* ${pct}` : null,
            budget !== undefined ? `*Budget:* $${budget.toFixed(2)}` : null,
            dailySpend !== undefined ? `*Daily spend:* $${dailySpend.toFixed(2)}` : null,
          ]
            .filter(Boolean)
            .join("  ·  ") || (payload.text as string) || "",
        ),
      ];
    }
    case "workflow.attention.digest": {
      const text = payload.text as string | undefined;
      return [header("Attention Digest"), divider, section(text ?? "Digest available.")];
    }
    case "workflow.cost.limit.reached": {
      const text = payload.text as string | undefined;
      return [header("Cost Limit Reached"), divider, section(text ?? "Hard cost limit tripped.")];
    }
    case "workflow.cost.anomaly": {
      const workflow = payload.workflow as string | undefined;
      const runCostUsd = payload.runCostUsd as number | undefined;
      const baselineCostUsd = payload.baselineCostUsd as number | undefined;
      const threshold = payload.threshold as number | undefined;
      return [
        header(`Cost Anomaly: ${workflow ?? "unknown"}`),
        divider,
        section(
          [
            runCostUsd !== undefined ? `*Run cost:* $${runCostUsd.toFixed(4)}` : null,
            baselineCostUsd !== undefined ? `*Baseline:* $${baselineCostUsd.toFixed(4)}` : null,
            threshold !== undefined ? `*Threshold:* ${threshold}×` : null,
          ]
            .filter(Boolean)
            .join("  ·  ") || (payload.text as string) || "",
        ),
      ];
    }
    case "workflow.build.committed": {
      const commitMessage = payload.commitMessage as string | undefined;
      const taskId = payload.taskId as string | null | undefined;
      const costUsd = payload.costUsd as number | undefined | null;
      const durationMs = payload.durationMs as number | undefined | null;
      const meta = [
        taskId ? `*Task:* ${taskId}` : null,
        costUsd != null ? `*Cost:* $${costUsd.toFixed(2)}` : null,
        durationMs != null ? `*Duration:* ${Math.round(durationMs / 60000)}m` : null,
      ]
        .filter(Boolean)
        .join("  ·  ");
      return [
        header(`Builder committed: ${commitMessage ?? "—"}`),
        divider,
        ...(meta ? [section(meta)] : []),
      ];
    }
    case "workflow.approval.expired": {
      const workflowName = payload.workflowName as string | undefined;
      const runId = payload.runId as string | undefined;
      const stepId = payload.stepId as string | undefined;
      const resolution = payload.resolution as string | undefined;
      const reason = payload.reason as string | undefined;
      const resolutionLabel = resolution === "approve" ? "Auto-approved" : "Auto-denied";
      return [
        header(`Approval ${resolutionLabel}: ${workflowName ?? "unknown"}`),
        divider,
        section(
          [
            stepId ? `*Step:* \`${stepId}\`` : null,
            runId ? `*Run:* \`${runId}\`` : null,
            reason ? `*Reason:* ${reason}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      ];
    }
    case "module.crash.alert": {
      const name = payload.name as string | undefined;
      const restartCount = payload.restartCount as number | undefined;
      const windowMs = payload.windowMs as number | undefined;
      const durationMin = windowMs !== undefined ? Math.round(windowMs / 60_000) : undefined;
      return [
        header(`Module Crash Loop: ${name ?? "unknown"}`),
        divider,
        section(
          [
            restartCount !== undefined ? `*Restarts:* ${restartCount}` : null,
            durationMin !== undefined ? `*Window:* ${durationMin}m` : null,
          ]
            .filter(Boolean)
            .join("  ·  ") || (payload.text as string) || "",
        ),
      ];
    }
    case "approval.requested": {
      const tool = payload.tool as string | undefined;
      const risk = payload.risk as string | undefined;
      const reason = payload.reason as string | undefined;
      const id = payload.id as string | undefined;
      return [
        header("Approval Required"),
        divider,
        section(
          [
            tool ? `*Tool:* \`${tool}\`` : null,
            risk ? `*Risk:* ${risk}` : null,
            reason ? `*Reason:* ${reason}` : null,
            id
              ? `*Approve:* \`kota approval approve ${id}\`\n*Reject:* \`kota approval reject ${id}\``
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      ];
    }
    default: {
      const text = payload.text as string | undefined;
      return [header(event), divider, section(text ?? JSON.stringify(payload))];
    }
  }
}

let unsubs: (() => void)[] = [];

const slackModule: KotaModule = {
  name: "slack",
  version: "1.0.0",
  description: "Slack Incoming Webhook notification channel for KOTA workflow events",

  onLoad: (ctx) => {
    const config = ctx.getModuleConfig<SlackConfig>();
    if (!config?.webhookUrl) {
      if (config && !config.webhookUrl) {
        ctx.log.warn("Slack module: webhookUrl is required but missing — module inactive");
      }
      return;
    }

    const { webhookUrl } = config;
    const enabledEvents = new Set(config.events ?? NOTIFICATION_EVENTS);
    const retryOptions = { retries: config.retries, baseDelayMs: config.retryDelayMs };

    const subscribe = (event: string) => {
      const unsub = ctx.events.subscribe(event, (payload) => {
        const blocks = buildBlocks(event, payload as Record<string, unknown>);
        void postWithRetry(webhookUrl, JSON.stringify({ blocks }), ctx.log, retryOptions);
      });
      unsubs.push(unsub);
    };

    for (const event of NOTIFICATION_EVENTS) {
      if (enabledEvents.has(event)) subscribe(event);
    }

    // approval.requested is always subscribed when the module is configured,
    // independent of the events filter (same as Telegram).
    subscribe("approval.requested");

    // opt-in events — only subscribed when explicitly listed in config.events
    for (const event of OPT_IN_EVENTS) {
      if (enabledEvents.has(event)) subscribe(event);
    }
  },

  onUnload: () => {
    for (const unsub of unsubs) unsub();
    unsubs = [];
  },
};

export default slackModule;
