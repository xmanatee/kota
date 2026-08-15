import { resolveAgentHarness } from "#core/agent-harness/index.js";
import type { ChannelUserIdentity } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import type { ProjectRuntime } from "#core/daemon/project-runtime.js";
import { AgentSession, type LoopOptions } from "#core/loop/loop.js";
import { NullTransport, ProxyTransport } from "#core/loop/transport.js";
import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import { resolveTelegramInteractiveBackend } from "./backend.js";
import type {
  TelegramBotOptions,
  TelegramProjectTarget,
  TelegramProjectTargetResolution,
  TelegramSession,
  TelegramSessionAgent,
} from "./bot-runtime-types.js";
import { callTelegramApi, TelegramTransport } from "./client.js";
import { TelegramHarnessSessionAgent } from "./harness-session-agent.js";

export class TelegramSessionRuntime {
  protected readonly token: string;
  protected readonly options: TelegramBotOptions;
  protected readonly sessions = new Map<string, TelegramSession>();
  protected readonly busyChats = new Set<string>();

  constructor(options: TelegramBotOptions) {
    this.token = options.token;
    this.options = options;
  }

  protected async processMessage(
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

  private getOrCreateSession(
    target: TelegramProjectTarget,
    firstName?: string,
  ): TelegramSession {
    let session = this.sessions.get(target.sessionKey);
    if (session) return session;

    const admittedTarget = this.admitProjectTarget(target);
    const identity: ChannelUserIdentity = {
      channelUserId: String(admittedTarget.chatId),
      displayName: firstName,
      channel: "telegram",
      meta: { projectId: admittedTarget.projectId },
    };
    const proxy = new ProxyTransport();
    session = {
      agent: this.createSessionAgent(admittedTarget, identity, proxy),
      proxy,
      lastActive: Date.now(),
      identity,
    };
    this.sessions.set(target.sessionKey, session);
    return session;
  }

  protected admitProjectTarget(target: TelegramProjectTarget): TelegramProjectTarget {
    const projectRuntime = this.options.getProjectRuntime(target.projectId);
    return {
      ...target,
      projectDir: projectRuntime.project.projectDir,
      projectRuntime,
    };
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
        scopeId: target.projectId,
        config,
        autonomyMode: this.options.autonomyMode,
        verbose: this.options.verbose ?? config.verbose,
        proxy,
      });
    }
    const loopOptions: LoopOptions = {
      autonomyMode: this.options.autonomyMode,
      model: backend.modelSpec,
      verbose: this.options.verbose ?? config.verbose,
      transport: proxy,
      config,
      channelIdentity: identity,
      projectDir: target.projectDir,
      projectRuntime: target.projectRuntime,
      moduleLoader: this.options.moduleLoader,
    };
    return new AgentSession(loopOptions);
  }

  protected async resolveProjectTarget(chatId: number): Promise<TelegramProjectTargetResolution> {
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

  protected async handleProjectCommand(chatId: number, text: string): Promise<void> {
    if (!this.options.projectSelection) return;
    const before = await this.resolveProjectTarget(chatId);
    const requested = text === "/project" ? "" : text.slice("/project ".length);
    const result = await this.options.projectSelection.switchChat(chatId, requested);
    this.sendText(chatId, result.message);
    if (result.ok && result.changed && before.ok) this.closeSessionsForChat(chatId);
  }

  protected closeSessionsForChat(chatId: number): void {
    const prefix = `${chatId}:`;
    for (const [key, session] of this.sessions) {
      if (!key.startsWith(prefix)) continue;
      session.agent.close();
      this.sessions.delete(key);
      this.busyChats.delete(key);
    }
  }

  protected sendText(chatId: number, text: string): void {
    callTelegramApi(this.token, "sendMessage", { chat_id: chatId, text }).catch((err) => {
      printTerminalDiagnostic(
        `[kota-telegram] Failed to send to ${chatId}:`,
        "error",
        (err as Error).message,
      );
    });
  }
}
