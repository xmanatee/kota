/**
 * SlackBot — bidirectional Slack channel using Socket Mode.
 *
 * - One AgentSession per Slack user (DM conversations).
 * - Handles interactive Block Kit button clicks for approval actions.
 * - Reconnects automatically on WebSocket disconnect.
 */

import type { ChannelSession } from "#core/channels/channel.js";
import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import { AgentSession, type LoopOptions } from "#core/loop/loop.js";
import { NullTransport, ProxyTransport } from "#core/loop/transport.js";
import type { KotaConfig } from "#root/config.js";
import {
  callSlackApi,
  openSocketModeUrl,
  RECONNECT_DELAY_MS,
  type SlackInteractivePayload,
  type SlackMessageEvent,
  SlackTransport,
  type SocketPayload,
} from "./client.js";

export type SlackBotOptions = {
  botToken: string;
  appToken: string;
  notifyChannel?: string;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
};

/** Formats an approval request as Block Kit blocks with Approve/Reject buttons. */
function buildApprovalBlocks(
  id: string,
  tool: string,
  risk: string,
  reason: string,
): Record<string, unknown>[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Approval Required*\n*Tool:* \`${tool}\`\n*Risk:* ${risk}\n*Reason:* ${reason}\n*ID:* \`${id}\``,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve" },
          style: "primary",
          action_id: `approve:${id}`,
          value: `approve:${id}`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Reject" },
          style: "danger",
          action_id: `reject:${id}`,
          value: `reject:${id}`,
        },
      ],
    },
  ];
}

export class SlackBot {
  private running = false;
  private ws: WebSocket | null = null;
  private sessions = new Map<string, ChannelSession>();
  private busyUsers = new Set<string>();

  constructor(private options: SlackBotOptions) {}

  async start(): Promise<void> {
    this.running = true;
    await this.connect();
  }

  stop(): void {
    this.running = false;
    this.ws?.close();
    this.ws = null;
    for (const session of this.sessions.values()) {
      session.agent.close();
    }
    this.sessions.clear();
  }

  /** Post an approval request to the configured notify channel (if set). */
  async postApproval(id: string, tool: string, risk: string, reason: string): Promise<void> {
    const channel = this.options.notifyChannel;
    if (!channel) return;
    await callSlackApi(this.options.botToken, "chat.postMessage", {
      channel,
      blocks: buildApprovalBlocks(id, tool, risk, reason),
      text: `Approval required: ${tool}`,
    });
  }

  private async connect(): Promise<void> {
    while (this.running) {
      try {
        const url = await openSocketModeUrl(this.options.appToken);
        await this.runWebSocket(url);
      } catch (err) {
        if (!this.running) break;
        console.error("[kota-slack] Connection error:", (err as Error).message);
      }
      if (this.running) {
        await sleep(RECONNECT_DELAY_MS);
      }
    }
  }

  private async runWebSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.addEventListener("open", () => {
        console.log("[kota-slack] Socket Mode connected");
      });

      ws.addEventListener("message", (event) => {
        try {
          const raw = JSON.parse(event.data as string) as SocketPayload;
          this.handleSocketPayload(ws, raw);
        } catch (err) {
          console.error("[kota-slack] Failed to parse message:", (err as Error).message);
        }
      });

      ws.addEventListener("close", (event) => {
        this.ws = null;
        if (!this.running) {
          resolve();
        } else {
          console.log(`[kota-slack] Disconnected (code ${event.code}), reconnecting...`);
          resolve(); // outer loop handles reconnect
        }
      });

      ws.addEventListener("error", (event) => {
        this.ws = null;
        reject(new Error(`WebSocket error: ${String(event)}`));
      });
    });
  }

  private handleSocketPayload(ws: WebSocket, payload: SocketPayload): void {
    if (payload.type === "hello") return;
    if (payload.type === "disconnect") {
      console.log("[kota-slack] Server requested disconnect:", payload.reason);
      ws.close();
      return;
    }

    // Acknowledge envelope
    if ("envelope_id" in payload) {
      ws.send(JSON.stringify({ envelope_id: payload.envelope_id }));
    }

    if (payload.type === "events_api") {
      const event = payload.payload.event;
      if (event.type === "message") {
        const msg = event as SlackMessageEvent;
        if (!msg.subtype && !msg.bot_id && msg.text && msg.user && msg.channel) {
          this.handleMessage(msg.user, msg.channel, msg.text).catch((err) => {
            console.error("[kota-slack] Message error:", (err as Error).message);
          });
        }
      }
    } else if (payload.type === "interactive") {
      const interactive =
        typeof payload.payload === "string"
          ? (JSON.parse(payload.payload) as SlackInteractivePayload)
          : payload.payload;
      if (interactive.type === "block_actions") {
        this.handleBlockAction(interactive).catch((err) => {
          console.error("[kota-slack] Action error:", (err as Error).message);
        });
      }
    }
  }

  private async handleMessage(userId: string, channelId: string, text: string): Promise<void> {
    if (this.busyUsers.has(userId)) {
      await callSlackApi(this.options.botToken, "chat.postMessage", {
        channel: channelId,
        text: "Still working on your previous message. Please wait.",
      });
      return;
    }

    this.busyUsers.add(userId);
    const transport = new SlackTransport(this.options.botToken, channelId);

    try {
      const session = this.getOrCreateSession(userId);
      session.proxy.target = transport;
      session.lastActive = Date.now();
      await session.agent.send(text);
      await transport.flush();
    } catch (err) {
      try {
        await transport.flush();
      } catch {
        // best effort
      }
      await callSlackApi(this.options.botToken, "chat.postMessage", {
        channel: channelId,
        text: "Something went wrong processing your message.",
      });
      console.error(`[kota-slack] Error for user ${userId}:`, (err as Error).message);
    } finally {
      const session = this.sessions.get(userId);
      if (session) session.proxy.target = new NullTransport();
      this.busyUsers.delete(userId);
    }
  }

  private async handleBlockAction(payload: SlackInteractivePayload): Promise<void> {
    for (const action of payload.actions) {
      const value = action.value ?? action.action_id;
      const [verb, id] = value.split(":");
      if (!id) continue;

      const queue = getApprovalQueue();
      let resultText: string;
      if (verb === "approve") {
        const result = queue.approve(id);
        resultText = result ? `Approved: \`${result.tool}\`` : `Approval \`${id}\` not found or already resolved.`;
      } else if (verb === "reject") {
        const result = queue.reject(id);
        resultText = result ? `Rejected: \`${result.tool}\`` : `Approval \`${id}\` not found or already resolved.`;
      } else {
        continue;
      }

      // Update the original message to show resolved state
      await callSlackApi(this.options.botToken, "chat.update", {
        channel: payload.channel.id,
        ts: payload.message.ts,
        text: resultText,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: resultText } }],
      }).catch((err) => {
        console.error("[kota-slack] Failed to update approval message:", (err as Error).message);
      });
    }
  }

  private getOrCreateSession(userId: string): ChannelSession {
    let session = this.sessions.get(userId);
    if (session) return session;

    const proxy = new ProxyTransport();
    const loopOpts: LoopOptions = {
      model: this.options.model ?? this.options.config?.model,
      verbose: this.options.verbose ?? this.options.config?.verbose,
      transport: proxy,
      config: this.options.config,
    };
    session = {
      agent: new AgentSession(loopOpts),
      proxy,
      lastActive: Date.now(),
    };
    this.sessions.set(userId, session);
    return session;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
