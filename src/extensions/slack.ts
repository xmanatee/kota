/**
 * Slack extension — routes KOTA notification events to a Slack Incoming Webhook.
 *
 * Subscribes to the same bus events as the Telegram and webhook extensions and
 * POSTs Block Kit messages to a configured Slack Incoming Webhook URL.
 * No OAuth app or bot token required — only a webhook URL.
 *
 * Config (kota.config under the "slack" key):
 *   { webhookUrl: string, events?: string[] }
 *
 * If `events` is omitted, all four notification events are active.
 * `approval.requested` is always forwarded when the extension is configured.
 */

import type { KotaExtension } from "../extension-types.js";

const NOTIFICATION_EVENTS = [
  "workflow.failure.alert",
  "workflow.budget.exceeded",
  "workflow.attention.digest",
  "workflow.cost.limit.reached",
] as const;

type SlackConfig = {
  /** Slack Incoming Webhook URL. Required. */
  webhookUrl: string;
  /** Subset of notification events to forward. Defaults to all four. */
  events?: string[];
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
    case "workflow.attention.digest": {
      const text = payload.text as string | undefined;
      return [header("Attention Digest"), divider, section(text ?? "Digest available.")];
    }
    case "workflow.cost.limit.reached": {
      const text = payload.text as string | undefined;
      return [header("Cost Limit Reached"), divider, section(text ?? "Hard cost limit tripped.")];
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

async function postSlack(
  webhookUrl: string,
  blocks: Block[],
  log: { warn: (msg: string) => void },
): Promise<void> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });
    if (!res.ok) {
      log.warn(`Slack webhook POST returned ${res.status}`);
    }
  } catch (err) {
    log.warn(`Slack webhook POST failed: ${(err as Error).message}`);
  }
}

let unsubs: (() => void)[] = [];

const slackModule: KotaExtension = {
  name: "slack",
  version: "1.0.0",
  description: "Slack Incoming Webhook notification channel for KOTA workflow events",

  onLoad: (ctx) => {
    const config = ctx.getExtensionConfig<SlackConfig>();
    if (!config?.webhookUrl) {
      if (config && !config.webhookUrl) {
        ctx.log.warn("Slack extension: webhookUrl is required but missing — extension inactive");
      }
      return;
    }

    const { webhookUrl } = config;
    const enabledEvents = new Set(config.events ?? NOTIFICATION_EVENTS);

    const subscribe = (event: string) => {
      const unsub = ctx.events.subscribe(event, (payload) => {
        const blocks = buildBlocks(event, payload as Record<string, unknown>);
        void postSlack(webhookUrl, blocks, ctx.log);
      });
      unsubs.push(unsub);
    };

    for (const event of NOTIFICATION_EVENTS) {
      if (enabledEvents.has(event)) subscribe(event);
    }

    // approval.requested is always subscribed when the extension is configured,
    // independent of the events filter (same as Telegram).
    subscribe("approval.requested");
  },

  onUnload: () => {
    for (const unsub of unsubs) unsub();
    unsubs = [];
  },
};

export default slackModule;
