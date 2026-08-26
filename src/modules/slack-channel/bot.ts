/**
 * SlackBot — bidirectional Slack channel using Socket Mode.
 *
 * - One AgentSession per Slack user (DM conversations).
 * - Handles interactive Block Kit button clicks for approval actions.
 * - Reconnects automatically on WebSocket disconnect.
 */

import type { ChannelSession } from "#core/channels/channel.js";
import type { ApprovalClientProjection } from "#core/daemon/approval-queue.js";
import type { ScopeRuntime } from "#core/daemon/scope-runtime.js";
import { NullTransport } from "#core/loop/transport.js";
import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import { admitSlackInteraction, admitSlackMessage, reportSlackAdmission } from "./admission.js";
import { SlackApprovalBindingStore } from "./approval-bindings.js";
import { handleSlackApprovalAction, postSlackApproval } from "./approval-interactions.js";
import { consumeSlackInboundSignal } from "./bot-inbound-signal.js";
import type { SlackBotOptions } from "./bot-options.js";
import { createSlackChannelSession } from "./bot-sessions.js";
import {
  callSlackApi,
  openSocketModeUrl,
  RECONNECT_DELAY_MS,
  type SlackEventsApiPayload,
  type SlackInteractivePayload,
  type SlackMessageEvent,
  SlackTransport,
  type SocketPayload,
} from "./client.js";
import { dispatchSlackSlashCommand, parseSlackSlashCommand, type SlackParsedCommand } from "./commands.js";

export type { SlackBotOptions, SlackInboundSignalRuntime } from "./bot-options.js";

export class SlackBot {
  private running = false;
  private ws: WebSocket | null = null;
  private sessions = new Map<string, ChannelSession>();
  private busyUsers = new Set<string>();

  constructor(
    private options: SlackBotOptions,
    private approvalBindings = new SlackApprovalBindingStore(),
  ) {}

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
  async postApproval(approval: ApprovalClientProjection): Promise<void> {
    const posted = await postSlackApproval(this.options, approval);
    if (!posted || approval.review.status !== "available") return;
    this.approvalBindings.set({
      scopeId: approval.scopeId,
      approvalId: approval.id,
      reviewDigest: approval.review.digest,
      channelId: posted.channelId,
      messageTs: posted.messageTs,
    });
  }

  listScopeSessionIds(scopeId: string): string[] {
    return [...this.sessions.entries()]
      .filter(([, session]) => session.identity?.meta?.scopeId === scopeId)
      .map(([sessionKey]) => `slack:${sessionKey}`);
  }

  closeScopeSessions(scopeId: string): void {
    for (const [key, session] of this.sessions) {
      if (session.identity?.meta?.scopeId !== scopeId) continue;
      session.agent.close();
      this.sessions.delete(key);
    }
  }

  private async connect(): Promise<void> {
    while (this.running) {
      try {
        const url = await openSocketModeUrl(this.options.appToken);
        await this.runWebSocket(url);
      } catch (err) {
        if (!this.running) break;
        printTerminalDiagnostic(
          "[kota-slack] Connection error:",
          "error",
          (err as Error).message,
        );
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
        printTerminalDiagnostic("[kota-slack] Socket Mode connected");
      });

      ws.addEventListener("message", (event) => {
        try {
          const raw = JSON.parse(event.data as string) as SocketPayload;
          this.handleSocketPayload(ws, raw);
        } catch (err) {
          printTerminalDiagnostic(
            "[kota-slack] Failed to parse message:",
            "error",
            (err as Error).message,
          );
        }
      });

      ws.addEventListener("close", (event) => {
        this.ws = null;
        if (!this.running) {
          resolve();
        } else {
          printTerminalDiagnostic(
            `[kota-slack] Disconnected (code ${event.code}), reconnecting...`,
          );
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
      printTerminalDiagnostic(
        "[kota-slack] Server requested disconnect:",
        "warn",
        payload.reason,
      );
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
          this.handleMessage(msg.user, msg.channel, msg.text, msg, payload.payload).catch((err) => {
            printTerminalDiagnostic(
              "[kota-slack] Message error:",
              "error",
              (err as Error).message,
            );
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
          printTerminalDiagnostic(
            "[kota-slack] Action error:",
            "error",
            (err as Error).message,
          );
        });
      }
    }
  }

  private async handleMessage(
    userId: string,
    channelId: string,
    text: string,
    event: SlackMessageEvent,
    envelope: SlackEventsApiPayload,
  ): Promise<void> {
    if (!reportSlackAdmission(admitSlackMessage(this.options, event, envelope), "message")) return;

    const parsed = parseSlackSlashCommand(text);
    if (parsed) {
      await this.handleSlashCommand(channelId, parsed, userId);
      return;
    }

    if (consumeSlackInboundSignal(this.options.inboundSignals, event, envelope)) return;

    if (this.busyUsers.has(userId)) {
      await callSlackApi(this.options.botToken, "chat.postMessage", {
        channel: channelId,
        text: "Still working on your previous message. Please wait.",
      });
      return;
    }

    this.busyUsers.add(userId);
    const transport = new SlackTransport(this.options.botToken, channelId);
    let session: ChannelSession | undefined;

    try {
      session = this.getOrCreateSession(
        userId,
        this.options.getDefaultScopeRuntime(),
      );
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
      printTerminalDiagnostic(
        `[kota-slack] Error for user ${userId}:`,
        "error",
        (err as Error).message,
      );
    } finally {
      if (session) session.proxy.target = new NullTransport();
      this.busyUsers.delete(userId);
    }
  }

  private async handleSlashCommand(
    channelId: string,
    parsed: SlackParsedCommand,
    userId: string,
  ): Promise<void> {
    try {
      await dispatchSlackSlashCommand({
        token: this.options.botToken,
        channelId,
        parsed,
        clients: {
          recall: this.options.recall,
          answer: this.options.answer,
          capture: this.options.capture,
          retract: this.options.retract,
          memory: this.options.memory,
          knowledge: this.options.knowledge,
          history: this.options.history,
          tasks: this.options.tasks,
          attention: this.options.attention,
          digest: this.options.digest,
        },
      });
    } catch (err) {
      const message = (err as Error).message;
      printTerminalDiagnostic(
        `[kota-slack] Slash command error for user ${userId} (${parsed.command}): ${message}`,
        "error",
      );
      await callSlackApi(this.options.botToken, "chat.postMessage", {
        channel: channelId,
        text: `Command failed: ${message}`,
      });
    }
  }

  private async handleBlockAction(payload: SlackInteractivePayload): Promise<void> {
    if (!reportSlackAdmission(admitSlackInteraction(this.options, payload), "callback")) return;
    await handleSlackApprovalAction(this.options, payload, this.approvalBindings);
  }

  private getOrCreateSession(userId: string, runtime: ScopeRuntime): ChannelSession {
    const sessionKey = `${userId}:${runtime.scope.scopeId}`;
    let session = this.sessions.get(sessionKey);
    if (session) return session;
    session = createSlackChannelSession(this.options, userId, runtime);
    this.sessions.set(sessionKey, session);
    return session;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
