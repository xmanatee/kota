/**
 * Telegram Bot adapter — makes KOTA accessible via Telegram messaging.
 *
 * Uses the Telegram Bot API via HTTP (no external dependencies).
 * One session per chat, ProxyTransport pattern (same as HTTP server).
 * Provider-backed chats use AgentSession; native presets use harness sessions.
 * Long polling for receiving messages, typing indicators while processing.
 *
 * The bot does not own a scheduler. Callers that host the bot (the telegram
 * channel inside the daemon) subscribe to scheduler events on the bus and
 * invoke `broadcastToChats` to deliver reminders to active sessions.
 */

import {
  type AgentEffort,
  type AgentHarness,
  resolveAgentHarness,
  runAgentHarness,
} from "#core/agent-harness/index.js";
import {
  type AgentHarnessTranscriptTurn,
  composeAgentHarnessTranscriptPrompt,
} from "#core/agent-harness/transcript.js";
import type { ChannelUserIdentity } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import type { ProjectRuntime } from "#core/daemon/project-runtime.js";
import { CostTracker } from "#core/loop/cost.js";
import { AgentSession, type LoopOptions } from "#core/loop/loop.js";
import { buildKotaSystemPrompt } from "#core/loop/system-prompt.js";
import { NullTransport, ProxyTransport } from "#core/loop/transport.js";
import type { ModelProviderSelection } from "#core/model/model-client.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import {
  TranscriptionProviderUnavailableError,
  transcribeAudio,
} from "#modules/transcription/index.js";
import { resolveTelegramInteractiveBackend } from "./backend.js";
import {
  callTelegramApi,
  downloadTelegramFile,
  ERROR_BACKOFF_MS,
  isTelegramGetUpdatesConflict,
  POLL_TIMEOUT_S,
  splitMessage,
  type TelegramAudio,
  type TelegramCallbackQuery,
  type TelegramMessage,
  TelegramTransport,
  type TelegramUpdate,
  type TelegramUser,
  type TelegramVoice,
} from "./client.js";
import {
  emitTelegramMessageInboundSignal,
  emitTelegramUpdateInboundSignal,
  emitTelegramVoiceTranscriptInboundSignal,
  TELEGRAM_SIGNAL_ALLOWED_UPDATES,
  type TelegramInboundSignalConfig,
} from "./inbound-signal.js";
import {
  acquireTelegramPollingOwner,
  type TelegramPollingOwner,
} from "./polling-ownership.js";
import type { TelegramProjectSelection } from "./project-selection.js";

export { callTelegramApi, splitMessage, TelegramTransport };

// --- Chat session management ---

export type TelegramBotOptions = {
  token: string;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  autonomyMode: AutonomyMode;
  /** Default daemon-owned runtime bundle used for single-project Telegram sessions. */
  defaultProjectRuntime: ProjectRuntime;
  /** Resolve the daemon-owned runtime bundle for a selected project id. */
  getProjectRuntime: (projectId: string) => ProjectRuntime;
  /** Whitelist of allowed chat IDs. Empty/undefined = allow all. */
  allowedChatIds?: number[];
  projectSelection?: TelegramProjectSelection;
  /**
   * Hook invoked when a text message is a Telegram chat reply. If the hook
   * returns true, the message is considered consumed (e.g. it resolved a
   * pending owner question) and is not routed to the interactive session.
   * Returning false falls through to normal message handling.
   */
  onChatReply?: (
    chatId: number,
    replyToMessageId: number,
    text: string,
  ) => Promise<boolean>;
  onCallbackQuery?: (callback: TelegramCallbackQuery) => Promise<boolean>;
  onStatusCommand?: (chatId: number, text: string) => Promise<boolean>;
  /** Optional prefix-configured chat automation signal bridge. */
  inboundSignals?: {
    config: TelegramInboundSignalConfig;
    events: Pick<ModuleContext["events"], "emit">;
  };
  pollOwner?: TelegramPollingOwner;
};

export class TelegramGetUpdatesConflictError extends Error {
  constructor() {
    super(
      "Telegram getUpdates conflict: another Telegram Bot API getUpdates consumer is already using this bot token. Stop the other KOTA or Telegram process before enabling telegram-interactive.",
    );
    this.name = "TelegramGetUpdatesConflictError";
  }
}

type TelegramProjectTarget = {
  chatId: number;
  projectId: string;
  projectDir: string;
  projectRuntime: ProjectRuntime;
  sessionKey: string;
};

type TelegramProjectTargetResolution =
  | { ok: true; target: TelegramProjectTarget }
  | { ok: false; message: string };

type TelegramSessionAgent = {
  send(text: string): Promise<string | void>;
  close(): void;
  getCostSummary(): string;
};

type TelegramSession = {
  agent: TelegramSessionAgent;
  proxy: ProxyTransport;
  lastActive: number;
  identity: ChannelUserIdentity;
};

type TelegramHarnessSessionAgentOptions = {
  harness: AgentHarness;
  model: string;
  modelProvider?: ModelProviderSelection;
  modelOutputTokenLimits?: KotaConfig["modelOutputTokenLimits"];
  effort: AgentEffort;
  cwd: string;
  config: KotaConfig;
  autonomyMode: AutonomyMode;
  verbose?: boolean;
  proxy: ProxyTransport;
};

class TelegramHarnessSessionAgent implements TelegramSessionAgent {
  private readonly transcript: AgentHarnessTranscriptTurn[] = [];
  private readonly costTracker = new CostTracker();
  private abortController: AbortController | null = null;

  constructor(private readonly options: TelegramHarnessSessionAgentOptions) {}

  async send(text: string): Promise<void> {
    const abortController = new AbortController();
    this.abortController = abortController;
    const prompt = composeAgentHarnessTranscriptPrompt(this.transcript, text);
    let streamedText = "";
    const writer = {
      write: (chunk: string): boolean => {
        streamedText += chunk;
        this.options.proxy.emit({ type: "text", content: chunk });
        return true;
      },
    };

    try {
      const result = await runAgentHarness(
        this.options.harness,
        {
          prompt,
          model: this.options.model,
          cwd: this.options.cwd,
          effort: this.options.effort,
          autonomyMode: this.options.autonomyMode,
          verbose: this.options.verbose ?? this.options.config.verbose,
          systemPrompt: buildKotaSystemPrompt(
            this.options.config,
            undefined,
            this.options.cwd,
            this.options.cwd,
          ),
          modelOutputTokenLimits: this.options.modelOutputTokenLimits,
          abortController,
          ...(this.options.modelProvider !== undefined
            ? { modelProvider: this.options.modelProvider }
            : {}),
        },
        writer,
      );
      if (!streamedText && result.text) {
        this.options.proxy.emit({ type: "text", content: result.text });
      }
      this.recordCost(result);
      this.transcript.push({
        user: text,
        assistant: result.text || streamedText,
      });
    } finally {
      if (this.abortController === abortController) {
        this.abortController = null;
      }
    }
  }

  close(): void {
    this.abortController?.abort(new Error("Telegram harness session closed."));
    this.abortController = null;
  }

  getCostSummary(): string {
    return this.costTracker.getSummary();
  }

  private recordCost(result: {
    totalCostUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
  }): void {
    if (result.totalCostUsd !== undefined) {
      this.costTracker.addRawCost(result.totalCostUsd);
      return;
    }
    if (result.inputTokens === undefined && result.outputTokens === undefined) {
      return;
    }
    this.costTracker.addUsage(this.options.model, {
      input_tokens: result.inputTokens ?? 0,
      output_tokens: result.outputTokens ?? 0,
    });
  }
}

// --- TelegramBot ---

export class TelegramBot {
  private token: string;
  private sessions = new Map<string, TelegramSession>();
  private busyChats = new Set<string>();
  private running = false;
  private offset = 0;
  private options: TelegramBotOptions;
  private pollController: AbortController | null = null;
  private releasePollingOwner: (() => void) | null = null;

  constructor(options: TelegramBotOptions) {
    this.token = options.token;
    this.options = options;
  }

  async start(): Promise<void> {
    const releasePollingOwner = acquireTelegramPollingOwner(
      this.token,
      this.options.pollOwner ?? {
        owner: "telegram-interactive",
        source: "TelegramBot.start",
      },
    );
    this.releasePollingOwner = releasePollingOwner;
    this.running = true;
    try {
      const me = await callTelegramApi<TelegramUser>(this.token, "getMe");
      printTerminalDiagnostic(`[kota-telegram] Bot: @${me.username ?? me.first_name}`);
      printTerminalDiagnostic("[kota-telegram] Listening for messages...");

      while (this.running) {
        try {
          await this.poll();
        } catch (err) {
          if (!this.running) break;
          if (isTelegramGetUpdatesConflict(err)) {
            this.running = false;
            throw new TelegramGetUpdatesConflictError();
          }
          printTerminalDiagnostic(
            "[kota-telegram] Poll error:",
            "error",
            (err as Error).message,
          );
          await sleep(ERROR_BACKOFF_MS);
        }
      }
    } finally {
      if (this.releasePollingOwner === releasePollingOwner) {
        this.releasePollingOwner = null;
      }
      releasePollingOwner();
    }
  }

  stop(): void {
    this.running = false;
    this.pollController?.abort();
    this.pollController = null;
    for (const session of this.sessions.values()) {
      session.agent.close();
    }
    this.sessions.clear();
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Send a message to active chat sessions, optionally scoped to one project. */
  broadcastToChats(text: string, projectId?: string): void {
    for (const [key, session] of this.sessions) {
      const meta = session.identity?.meta;
      const sessionProjectId = typeof meta?.projectId === "string" ? meta.projectId : "";
      if (projectId !== undefined && sessionProjectId !== projectId) continue;
      const chatId = Number.parseInt(key.split(":")[0]!, 10);
      if (Number.isFinite(chatId)) this.sendText(chatId, text);
    }
  }

  private async poll(): Promise<void> {
    const controller = new AbortController();
    this.pollController = controller;
    const updates = await callTelegramApi<TelegramUpdate[]>(this.token, "getUpdates", {
      offset: this.offset,
      timeout: POLL_TIMEOUT_S,
      allowed_updates: [...TELEGRAM_SIGNAL_ALLOWED_UPDATES],
    }, {
      signal: controller.signal,
    }).finally(() => {
      if (this.pollController === controller) {
        this.pollController = null;
      }
    });

    for (const update of updates) {
      this.offset = update.update_id + 1;
      if (update.callback_query) {
        let handled = false;
        if (this.options.onCallbackQuery) {
          try {
            handled = await this.options.onCallbackQuery(update.callback_query);
          } catch (err) {
            printTerminalDiagnostic(
              "[kota-telegram] Callback handler error:",
              "error",
              (err as Error).message,
            );
          }
        }
        if (!handled) await this.emitInboundSignalUpdate(update);
        continue;
      }
      if (
        update.edited_message ||
        update.message_reaction ||
        update.my_chat_member ||
        update.chat_member
      ) {
        await this.emitInboundSignalUpdate(update);
        continue;
      }
      const message = update.message;
      if (!message) continue;
      const text = message.text ?? message.caption;
      if (text !== undefined) {
        const chatId = message.chat.id;
        const firstName = message.chat.first_name;
        if (this.options.onStatusCommand) {
          const handled = await this.options.onStatusCommand(chatId, text);
          if (handled) continue;
        }
        const replyToId = message.reply_to_message?.message_id;
        if (replyToId !== undefined && this.options.onChatReply) {
          try {
            const handled = await this.options.onChatReply(chatId, replyToId, text);
            if (!handled) await this.handleMessage(chatId, text, firstName, undefined, message);
          } catch (err) {
            printTerminalDiagnostic(
              `[kota-telegram] Chat-reply handler error in chat ${chatId}:`,
              "error",
              (err as Error).message,
            );
            await this.handleMessage(chatId, text, firstName, undefined, message);
          }
          continue;
        }
        await this.handleMessage(chatId, text, firstName, undefined, message);
        continue;
      }
      if (message.voice || message.audio) {
        void this.handleVoiceMessage(message).catch((err) => {
          printTerminalDiagnostic(
            `[kota-telegram] Voice handling error in chat ${message.chat.id}:`,
            "error",
            (err as Error).message,
          );
        });
      }
    }
  }

  private isInteractiveChatAllowed(chatId: number): boolean {
    return !(
      this.options.allowedChatIds?.length &&
      !this.options.allowedChatIds.includes(chatId)
    );
  }

  private sendUnauthorizedChatMessage(chatId: number): void {
    this.sendText(chatId, "Sorry, I'm not authorized to chat with you.");
  }

  private async handleVoiceMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id;
    const interactiveAllowed = this.isInteractiveChatAllowed(chatId);
    if (!interactiveAllowed && !this.options.inboundSignals) {
      this.sendUnauthorizedChatMessage(chatId);
      return;
    }
    const resolved = await this.resolveProjectTarget(chatId);
    if (!resolved.ok) {
      if (interactiveAllowed) {
        this.sendText(chatId, resolved.message);
      } else {
        this.sendUnauthorizedChatMessage(chatId);
      }
      return;
    }

    const media: TelegramVoice | TelegramAudio | undefined = message.voice ?? message.audio;
    if (!media) return;
    const defaultMime = message.voice ? "audio/ogg" : "audio/mpeg";
    const mimeType = media.mime_type ?? defaultMime;
    const filename = "file_name" in media && media.file_name ? media.file_name : undefined;

    let download: Awaited<ReturnType<typeof downloadTelegramFile>>;
    try {
      download = await downloadTelegramFile(this.token, media.file_id);
    } catch (err) {
      if (interactiveAllowed) {
        this.sendText(
          chatId,
          `Couldn't download your voice message: ${(err as Error).message}`,
        );
      } else {
        this.sendUnauthorizedChatMessage(chatId);
      }
      return;
    }

    let transcript: string;
    try {
      const result = await transcribeAudio({
        audio: download.bytes,
        mimeType: download.mimeType ?? mimeType,
        filename,
      });
      transcript = result.text.trim();
    } catch (err) {
      if (err instanceof TranscriptionProviderUnavailableError) {
        if (interactiveAllowed) {
          this.sendText(
            chatId,
            "Voice transcription isn't configured on this KOTA deployment. Please send your message as text.",
          );
        } else {
          this.sendUnauthorizedChatMessage(chatId);
        }
        return;
      }
      if (interactiveAllowed) {
        this.sendText(chatId, `Voice transcription failed: ${(err as Error).message}`);
      } else {
        this.sendUnauthorizedChatMessage(chatId);
      }
      return;
    }

    if (!transcript) {
      if (interactiveAllowed) {
        this.sendText(chatId, "I couldn't hear anything in that voice message. Please try again.");
      } else {
        this.sendUnauthorizedChatMessage(chatId);
      }
      return;
    }

    if (interactiveAllowed) {
      this.sendText(chatId, `\u{1F3A4} Transcribed: ${transcript}`);
    }
    if (this.emitVoiceTranscriptInboundSignal(resolved.target, message, transcript)) {
      return;
    }
    if (!interactiveAllowed) {
      this.sendUnauthorizedChatMessage(chatId);
      return;
    }
    await this.handleMessage(chatId, transcript, message.chat.first_name, resolved.target);
  }

  private async handleMessage(
    chatId: number,
    text: string,
    firstName?: string,
    resolvedTarget?: TelegramProjectTarget,
    sourceMessage?: TelegramMessage,
  ): Promise<void> {
    const interactiveAllowed = this.isInteractiveChatAllowed(chatId);

    if (text === "/project" || text.startsWith("/project ")) {
      if (!interactiveAllowed) {
        this.sendUnauthorizedChatMessage(chatId);
        return;
      }
      try {
        await this.handleProjectCommand(chatId, text);
      } catch (err) {
        printTerminalDiagnostic(
          `[kota-telegram] Project switch error in chat ${chatId}:`,
          "error",
          (err as Error).message,
        );
        this.sendText(chatId, "Project selection failed.");
      }
      return;
    }

    if (!interactiveAllowed && (!this.options.inboundSignals || !sourceMessage)) {
      this.sendUnauthorizedChatMessage(chatId);
      return;
    }

    let resolved: TelegramProjectTargetResolution;
    try {
      resolved = resolvedTarget
        ? { ok: true, target: resolvedTarget }
        : await this.resolveProjectTarget(chatId);
    } catch (err) {
      printTerminalDiagnostic(
        `[kota-telegram] Project resolution error in chat ${chatId}:`,
        "error",
        (err as Error).message,
      );
      if (interactiveAllowed) {
        this.sendText(chatId, "Project selection failed.");
      } else {
        this.sendUnauthorizedChatMessage(chatId);
      }
      return;
    }

    if (text === "/start") {
      if (!interactiveAllowed) {
        this.sendUnauthorizedChatMessage(chatId);
        return;
      }
      if (!resolved.ok) {
        this.sendText(chatId, resolved.message);
        return;
      }
      this.sendText(
        chatId,
        `Hi ${firstName ?? "there"}! I'm KOTA, your AI assistant. Send me any message.\n\n` +
          `/clear — New conversation\n/status — Session info`,
      );
      return;
    }

    if (text === "/clear") {
      if (!interactiveAllowed) {
        this.sendUnauthorizedChatMessage(chatId);
        return;
      }
      if (!resolved.ok) {
        this.sendText(chatId, resolved.message);
        return;
      }
      const session = this.sessions.get(resolved.target.sessionKey);
      if (session) {
        session.agent.close();
        this.sessions.delete(resolved.target.sessionKey);
      }
      this.sendText(chatId, "Conversation cleared.");
      return;
    }

    if (text === "/status") {
      if (!interactiveAllowed) {
        this.sendUnauthorizedChatMessage(chatId);
        return;
      }
      if (!resolved.ok) {
        this.sendText(chatId, resolved.message);
        return;
      }
      const session = this.sessions.get(resolved.target.sessionKey);
      const busy = this.busyChats.has(resolved.target.sessionKey);
      const pendingCount = resolved.target.projectRuntime.scheduler.count();
      const statusParts = [
        session
          ? `Active session (${busy ? "processing" : "idle"}). Cost: ${session.agent.getCostSummary()}`
          : "No active session. Send a message to start one.",
      ];
      if (pendingCount > 0) {
        statusParts.push(`${pendingCount} pending reminder(s)`);
      }
      this.sendText(chatId, statusParts.join("\n"));
      return;
    }

    if (!resolved.ok) {
      if (interactiveAllowed) {
        this.sendText(chatId, resolved.message);
      } else {
        this.sendUnauthorizedChatMessage(chatId);
      }
      return;
    }
    if (this.emitInboundSignal(resolved.target, sourceMessage)) return;
    if (!interactiveAllowed) {
      this.sendUnauthorizedChatMessage(chatId);
      return;
    }
    // Skip bot commands we don't handle after configured automation prefixes
    // have had a chance to claim them.
    if (text.startsWith("/")) return;
    try {
      await this.processMessage(resolved.target, text, firstName);
    } catch (err) {
      printTerminalDiagnostic(
        `[kota-telegram] Error in chat ${chatId}:`,
        "error",
        (err as Error).message,
      );
      this.sendText(chatId, "Something went wrong. Try again or /clear to start over.");
    }
  }

  private emitInboundSignal(
    target: TelegramProjectTarget,
    sourceMessage: TelegramMessage | undefined,
  ): boolean {
    const inboundSignals = this.options.inboundSignals;
    if (!inboundSignals || !sourceMessage) return false;
    const result = emitTelegramMessageInboundSignal(
      inboundSignals.events,
      sourceMessage,
      this.inboundSignalContext(target, inboundSignals.config),
    );
    if (result.emitted) return result.consumed;
    if ("error" in result) {
      throw new Error(`Telegram inbound signal is invalid: ${result.error}`);
    }
    return false;
  }

  private emitVoiceTranscriptInboundSignal(
    target: TelegramProjectTarget,
    sourceMessage: TelegramMessage,
    transcript: string,
  ): boolean {
    const inboundSignals = this.options.inboundSignals;
    if (!inboundSignals) return false;
    const result = emitTelegramVoiceTranscriptInboundSignal(
      inboundSignals.events,
      sourceMessage,
      transcript,
      this.inboundSignalContext(target, inboundSignals.config),
    );
    if (result.emitted) return result.consumed;
    if ("error" in result) {
      throw new Error(`Telegram inbound signal is invalid: ${result.error}`);
    }
    return false;
  }

  private async emitInboundSignalUpdate(update: TelegramUpdate): Promise<boolean> {
    const inboundSignals = this.options.inboundSignals;
    if (!inboundSignals) return false;
    const chatId = telegramUpdateChatId(update);
    if (chatId === null) return false;
    const resolved = await this.resolveProjectTarget(chatId);
    if (!resolved.ok) return false;
    const result = emitTelegramUpdateInboundSignal(
      inboundSignals.events,
      update,
      this.inboundSignalContext(resolved.target, inboundSignals.config),
    );
    if (result.emitted) return result.consumed;
    if ("error" in result) {
      throw new Error(`Telegram inbound signal is invalid: ${result.error}`);
    }
    return false;
  }

  private inboundSignalContext(
    target: TelegramProjectTarget,
    config: TelegramInboundSignalConfig,
  ): {
    projectId: string;
    receivedAt: string;
    config: TelegramInboundSignalConfig;
    allowedChatIds?: readonly number[];
  } {
    return {
      projectId: target.projectId,
      receivedAt: new Date().toISOString(),
      config,
      allowedChatIds: this.options.allowedChatIds,
    };
  }

  private async processMessage(
    target: TelegramProjectTarget,
    text: string,
    firstName?: string,
  ): Promise<void> {
    if (this.busyChats.has(target.sessionKey)) {
      this.sendText(target.chatId, "Still working on your previous message. Please wait.");
      return;
    }

    this.busyChats.add(target.sessionKey);
    const transport = new TelegramTransport(target.chatId, this.token);

    try {
      const session = this.getOrCreateSession(target, firstName);
      session.proxy.target = transport;
      session.lastActive = Date.now();

      transport.startTyping();
      await session.agent.send(text);
      await transport.flush();
    } catch (err) {
      // Flush any partial output the agent produced before the error
      try {
        await transport.flush();
      } catch (flushErr) {
        printTerminalDiagnostic(
          "[kota-telegram] Failed to flush partial output after error:",
          "error",
          (flushErr as Error).message,
        );
      }
      throw err;
    } finally {
      const session = this.sessions.get(target.sessionKey);
      if (session) session.proxy.target = new NullTransport();
      transport.stopTyping();
      this.busyChats.delete(target.sessionKey);
    }
  }

  private getOrCreateSession(target: TelegramProjectTarget, firstName?: string): TelegramSession {
    let session = this.sessions.get(target.sessionKey);
    if (session) return session;

    const identity: ChannelUserIdentity = {
      channelUserId: String(target.chatId),
      displayName: firstName,
      channel: "telegram",
      meta: { projectId: target.projectId },
    };
    const proxy = new ProxyTransport();
    const agent = this.createSessionAgent(target, identity, proxy);
    session = {
      agent,
      proxy,
      lastActive: Date.now(),
      identity,
    };
    this.sessions.set(target.sessionKey, session);
    return session;
  }

  private createSessionAgent(
    target: TelegramProjectTarget,
    identity: ChannelUserIdentity,
    proxy: ProxyTransport,
  ): TelegramSessionAgent {
    const config: KotaConfig = this.options.config ?? {};
    const backend = resolveTelegramInteractiveBackend(config, this.options.model);
    if (backend.kind === "harness") {
      return new TelegramHarnessSessionAgent({
        harness: resolveAgentHarness(backend.harnessName),
        model: backend.model,
        ...(backend.modelProvider !== undefined
          ? { modelProvider: backend.modelProvider }
          : {}),
        modelOutputTokenLimits: config.modelOutputTokenLimits,
        effort: backend.preset.defaultEffort,
        cwd: target.projectDir,
        config,
        autonomyMode: this.options.autonomyMode,
        verbose: this.options.verbose ?? config.verbose,
        proxy,
      });
    }
    const loopOpts: LoopOptions = {
      autonomyMode: this.options.autonomyMode,
      model: backend.modelSpec,
      verbose: this.options.verbose ?? config.verbose,
      transport: proxy,
      config,
      channelIdentity: identity,
      projectDir: target.projectDir,
      projectRuntime: target.projectRuntime,
    };
    return new AgentSession(loopOpts);
  }

  private async resolveProjectTarget(chatId: number): Promise<TelegramProjectTargetResolution> {
    if (!this.options.projectSelection) {
      const runtime = this.options.defaultProjectRuntime;
      return {
        ok: true,
        target: {
          chatId,
          projectId: runtime.project.projectId,
          projectDir: runtime.project.projectDir,
          projectRuntime: runtime,
          sessionKey: `${chatId}:${runtime.project.projectId}`,
        },
      };
    }
    const resolved = await this.options.projectSelection.resolveChat(chatId);
    if (!resolved.ok) return resolved;
    let projectRuntime: ProjectRuntime;
    try {
      projectRuntime = this.options.getProjectRuntime(resolved.project.projectId);
    } catch (err) {
      return {
        ok: false,
        message: `Telegram project "${resolved.project.projectId}" is not available in this daemon runtime: ${(err as Error).message}`,
      };
    }
    return {
      ok: true,
      target: {
        chatId,
        projectId: resolved.project.projectId,
        projectDir: resolved.project.projectDir,
        projectRuntime,
        sessionKey: `${chatId}:${resolved.project.projectId}`,
      },
    };
  }

  private async handleProjectCommand(chatId: number, text: string): Promise<void> {
    if (!this.options.projectSelection) return;
    const before = await this.resolveProjectTarget(chatId);
    const requested = text === "/project" ? "" : text.slice("/project ".length);
    const result = await this.options.projectSelection.switchChat(chatId, requested);
    this.sendText(chatId, result.message);
    if (!result.ok || !result.changed) return;
    if (before.ok) this.closeSessionsForChat(chatId);
  }

  private closeSessionsForChat(chatId: number): void {
    const prefix = `${chatId}:`;
    for (const [key, session] of this.sessions) {
      if (!key.startsWith(prefix)) continue;
      session.agent.close();
      this.sessions.delete(key);
      this.busyChats.delete(key);
    }
  }

  private sendText(chatId: number, text: string): void {
    callTelegramApi(this.token, "sendMessage", {
      chat_id: chatId,
      text,
    }).catch((err) => {
      printTerminalDiagnostic(
        `[kota-telegram] Failed to send to ${chatId}:`,
        "error",
        (err as Error).message,
      );
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function telegramUpdateChatId(update: TelegramUpdate): number | null {
  if (update.message) return update.message.chat.id;
  if (update.edited_message) return update.edited_message.chat.id;
  if (update.callback_query?.message) return update.callback_query.message.chat.id;
  if (update.message_reaction) return update.message_reaction.chat.id;
  if (update.my_chat_member) return update.my_chat_member.chat.id;
  if (update.chat_member) return update.chat_member.chat.id;
  return null;
}
