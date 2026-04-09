/**
 * Foreign extension loader — wraps out-of-process extensions as KotaExtension.
 *
 * Each configured foreign extension is started, handed the init/manifest
 * handshake, then presented to the rest of KOTA as a normal KotaExtension
 * with tool runners that proxy invocations over the transport.
 *
 * Stdio extensions support automatic restart via `maxRestarts` (default: 3)
 * and optional periodic health-check pings.
 */

import { resolve } from "node:path";
import { tryEmit } from "./event-bus.js";
import type { ExtensionHealth, KotaExtension, ToolDef } from "./extension-types.js";
import type {
  ForeignExtensionConfig,
  KempInbound,
  KempManifest,
  KempTransport,
  StdioForeignExtensionConfig,
} from "./foreign-extension.js";
import { HttpTransport } from "./foreign-extension-http.js";
import { StdioTransport } from "./foreign-extension-stdio.js";
import type { ToolResult } from "./tools/tool-result.js";

// How long to wait for the manifest after sending init.
const MANIFEST_TIMEOUT_MS = 10_000;
// How long to wait for a tool result.
const INVOKE_TIMEOUT_MS = 60_000;

const DEFAULT_MAX_RESTARTS = 3;
const DEFAULT_PING_TIMEOUT_MS = 5_000;
const DEFAULT_PING_INTERVAL_MS = 30_000;
const DEFAULT_BACKOFF_BASE_MS = 2_000;

type PendingInvoke = {
  resolve: (msg: KempInbound) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type RawExtension = {
  name: string;
  version?: string;
  description?: string;
  session: ForeignExtensionSession;
  toolDefs: KempManifest["tools"];
};

/**
 * Wraps a KempTransport in request/response semantics, dispatching inbound
 * messages by correlation id and logging inbound log messages.
 */
class ForeignExtensionSession {
  private pending = new Map<string, PendingInvoke>();
  private receiveLoop: Promise<void>;
  private closed = false;
  private label: string;

  /** Resolves when the transport's receive loop ends (session died or was closed). */
  readonly died: Promise<void>;

  constructor(
    private transport: KempTransport,
    name: string,
  ) {
    this.label = `[foreign:${name}]`;
    this.receiveLoop = this.runReceiveLoop();
    this.died = this.receiveLoop.then(() => {}, () => {});
  }

  private async runReceiveLoop(): Promise<void> {
    for await (const msg of this.transport.receive()) {
      if (msg.type === "log") {
        const prefix = `${this.label}[${msg.level}]`;
        process.stderr.write(`${prefix} ${msg.message}\n`);
        continue;
      }
      if (msg.id) {
        const pending = this.pending.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(msg.id);
          pending.resolve(msg);
        }
      }
    }
    // Transport closed — reject all outstanding requests
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Transport closed"));
      this.pending.delete(id);
    }
  }

  async request(id: string, outbound: Parameters<KempTransport["send"]>[0], timeoutMs: number): Promise<KempInbound> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send(outbound).catch((err) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  /** Send a ping and wait for pong. Throws if no pong arrives within timeoutMs. */
  async ping(timeoutMs: number): Promise<void> {
    const id = newId();
    await this.request(id, { id, type: "ping" }, timeoutMs);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.transport.send({ id: "shutdown", type: "shutdown" });
    } catch {
      // ignore send errors on shutdown
    }
    await this.transport.close();
    await this.receiveLoop;
  }
}

let nextId = 1;
function newId(): string {
  return String(nextId++);
}

/** Complete the KEMP handshake on a transport and return a raw session + tool defs. */
async function createRawExtension(
  transport: KempTransport,
  label: string,
  projectCwd: string,
  extensionConfig?: Record<string, unknown>,
): Promise<RawExtension> {
  const initId = newId();
  const session = new ForeignExtensionSession(transport, label);
  const manifestMsg = await session.request(
    initId,
    { id: initId, type: "init", cwd: projectCwd, config: extensionConfig },
    MANIFEST_TIMEOUT_MS,
  );
  if (manifestMsg.type !== "manifest") {
    await session.close();
    throw new Error(`Expected manifest, got: ${manifestMsg.type}`);
  }
  return {
    name: manifestMsg.name,
    version: manifestMsg.version,
    description: manifestMsg.description,
    session,
    toolDefs: manifestMsg.tools,
  };
}

/** Build ToolDef runners that delegate to the mutable `getSession` reference. */
function buildToolDefs(
  toolDefs: KempManifest["tools"],
  getSession: () => ForeignExtensionSession,
): ToolDef[] {
  return toolDefs.map((def) => ({
    tool: {
      name: def.name,
      description: def.description,
      input_schema: def.input_schema,
    },
    runner: async (input: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const id = newId();
        const msg = await getSession().request(
          id,
          { id, type: "invoke", name: def.name, input },
          INVOKE_TIMEOUT_MS,
        );
        if (msg.type === "result") return { content: msg.content, is_error: msg.is_error };
        if (msg.type === "error") return { content: msg.message, is_error: true };
        return { content: `Unexpected response type: ${msg.type}`, is_error: true };
      } catch (err) {
        const content = err instanceof Error ? err.message : String(err);
        return { content, is_error: true };
      }
    },
  }));
}

/**
 * Create a stdio extension with automatic restart on crash and optional ping
 * health checks. Tool runners close over a mutable session reference that is
 * swapped on each successful restart.
 */
async function startResilientStdioExtension(
  config: StdioForeignExtensionConfig,
  projectCwd: string,
  extensionConfig?: Record<string, unknown>,
): Promise<KotaExtension> {
  const maxRestarts = config.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  const pingTimeoutMs = config.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
  const pingIntervalMs = config.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const backoffBase = config.restartBackoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const resolvedCwd = resolve(projectCwd);

  const raw = await createRawExtension(
    new StdioTransport(config, resolvedCwd),
    config.command,
    resolvedCwd,
    extensionConfig,
  );
  let session = raw.session;
  let restarts = 0;
  let restarting = false;
  let stopped = false;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let healthStatus: ExtensionHealth["status"] = "ok";
  let totalRestarts = 0;
  let lastRestartAt: string | undefined;

  function clearPingTimer() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  }

  async function doRestart(reason: string): Promise<void> {
    if (restarting || stopped) return;
    restarting = true;
    healthStatus = "restarting";
    clearPingTimer();
    try {
      await session.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[foreign:${config.command}] Failed to close stale session before restart: ${msg}\n`);
    }

    while (restarts < maxRestarts) {
      restarts++;
      totalRestarts++;
      lastRestartAt = new Date().toISOString();
      tryEmit("extension.restarted", { name: raw.name, reason, totalRestarts });
      const backoffMs = backoffBase * 2 ** (restarts - 1);
      process.stderr.write(`[foreign:${config.command}] Restart ${restarts}/${maxRestarts} in ${backoffMs}ms (${reason}).\n`);
      await new Promise<void>((r) => setTimeout(r, backoffMs));
      if (stopped) { restarting = false; return; }

      try {
        const fresh = await createRawExtension(
          new StdioTransport(config, resolvedCwd),
          config.command,
          resolvedCwd,
          extensionConfig,
        );
        session = fresh.session;
        restarts = 0;
        healthStatus = "ok";
        process.stderr.write(`[foreign:${config.command}] Restarted successfully.\n`);
        watchDeath();
        startPing();
        restarting = false;
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[foreign:${config.command}] Restart attempt ${restarts} failed: ${msg}\n`);
      }
    }

    process.stderr.write(`[foreign:${config.command}] All ${maxRestarts} restart(s) exhausted. Extension failed.\n`);
    healthStatus = "dead";
    tryEmit("extension.failed", { name: raw.name, reason });
    restarting = false;
  }

  function watchDeath() {
    const watched = session;
    watched.died.then(() => {
      if (!stopped && session === watched) {
        process.stderr.write(`[foreign:${config.command}] Subprocess exited unexpectedly.\n`);
        doRestart("subprocess exited unexpectedly");
      }
    });
  }

  function startPing() {
    if (pingIntervalMs <= 0 || pingTimeoutMs <= 0) return;
    pingTimer = setInterval(async () => {
      const current = session;
      try {
        await current.ping(pingTimeoutMs);
      } catch {
        process.stderr.write(`[foreign:${config.command}] Ping timed out.\n`);
        doRestart("ping timeout");
      }
    }, pingIntervalMs);
  }

  watchDeath();
  startPing();

  const tools = buildToolDefs(raw.toolDefs, () => session);

  return {
    name: raw.name,
    version: raw.version,
    description: raw.description,
    tools,
    getHealth: (): ExtensionHealth => ({
      status: healthStatus,
      restartCount: totalRestarts,
      lastRestartAt,
    }),
    onUnload: async () => {
      stopped = true;
      clearPingTimer();
      await session.close();
    },
  };
}

/**
 * Start a foreign extension subprocess, complete the handshake, and return
 * a KotaExtension that proxies tool invocations to the subprocess.
 */
async function startForeignExtension(
  config: ForeignExtensionConfig,
  projectCwd: string,
  extensionConfig?: Record<string, unknown>,
): Promise<KotaExtension> {
  const resolvedCwd = resolve(projectCwd);

  if (config.transport === "stdio" && (config.maxRestarts ?? DEFAULT_MAX_RESTARTS) > 0) {
    return startResilientStdioExtension(config, resolvedCwd, extensionConfig);
  }

  const transport: KempTransport =
    config.transport === "http"
      ? new HttpTransport(config)
      : new StdioTransport(config, resolvedCwd);
  const label = config.transport === "http" ? config.url : config.command;

  const raw = await createRawExtension(transport, label, resolvedCwd, extensionConfig);
  const tools = buildToolDefs(raw.toolDefs, () => raw.session);

  return {
    name: raw.name,
    version: raw.version,
    description: raw.description,
    tools,
    onUnload: () => raw.session.close(),
  };
}

/**
 * Load all configured foreign extensions and return them as KotaExtensions.
 * Failures for individual extensions are logged and skipped.
 */
export async function loadForeignExtensions(
  configs: ForeignExtensionConfig[],
  projectCwd: string,
  extensionConfigs?: Record<string, Record<string, unknown>>,
): Promise<KotaExtension[]> {
  const results: KotaExtension[] = [];
  for (const config of configs) {
    const label = config.transport === "http" ? config.url : config.command;
    try {
      const extConfig = extensionConfigs?.[label];
      const ext = await startForeignExtension(config, resolve(projectCwd), extConfig);
      results.push(ext);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] Foreign extension "${label}" failed to start: ${msg}`);
    }
  }
  return results;
}
