/**
 * Foreign extension loader — wraps out-of-process extensions as KotaExtension.
 *
 * Each configured foreign extension is started, handed the init/manifest
 * handshake, then presented to the rest of KOTA as a normal KotaExtension
 * with tool runners that proxy invocations over the transport.
 */

import { resolve } from "node:path";
import type { KotaExtension, ToolDef } from "./extension-types.js";
import type { ForeignExtensionConfig, KempInbound, KempTransport } from "./foreign-extension.js";
import { StdioTransport } from "./foreign-extension-stdio.js";
import type { ToolResult } from "./tools/tool-result.js";

// How long to wait for the manifest after sending init.
const MANIFEST_TIMEOUT_MS = 10_000;
// How long to wait for a tool result.
const INVOKE_TIMEOUT_MS = 60_000;

type PendingInvoke = {
  resolve: (msg: KempInbound) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
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

  constructor(
    private transport: KempTransport,
    name: string,
  ) {
    this.label = `[foreign:${name}]`;
    this.receiveLoop = this.runReceiveLoop();
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

/**
 * Start a foreign extension subprocess, complete the handshake, and return
 * a KotaExtension that proxies tool invocations to the subprocess.
 */
async function startForeignExtension(
  config: ForeignExtensionConfig,
  projectCwd: string,
  extensionConfig?: Record<string, unknown>,
): Promise<KotaExtension> {
  const transport = new StdioTransport(config, projectCwd);
  const initId = newId();

  // We need a temporary session to complete the handshake before we know the name.
  const tempSession = new ForeignExtensionSession(transport, config.command);

  const manifestMsg = await tempSession.request(
    initId,
    { id: initId, type: "init", cwd: projectCwd, config: extensionConfig },
    MANIFEST_TIMEOUT_MS,
  );

  if (manifestMsg.type !== "manifest") {
    await tempSession.close();
    throw new Error(`Expected manifest, got: ${manifestMsg.type}`);
  }

  const { name, version, description, tools: toolDefs } = manifestMsg;

  // Re-create session with the proper name for logging.
  // Since tempSession already owns the transport, just reuse it.
  const session = tempSession;

  const tools: ToolDef[] = toolDefs.map((def) => ({
    tool: {
      name: def.name,
      description: def.description,
      input_schema: def.input_schema,
    },
    runner: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const id = newId();
      const msg = await session.request(
        id,
        { id, type: "invoke", name: def.name, input },
        INVOKE_TIMEOUT_MS,
      );
      if (msg.type === "result") {
        return { content: msg.content, is_error: msg.is_error };
      }
      if (msg.type === "error") {
        return { content: msg.message, is_error: true };
      }
      return { content: `Unexpected response type: ${msg.type}`, is_error: true };
    },
  }));

  return {
    name,
    version,
    description,
    tools,
    onUnload: () => session.close(),
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
    try {
      const extConfig = extensionConfigs?.[config.command];
      const ext = await startForeignExtension(config, resolve(projectCwd), extConfig);
      results.push(ext);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] Foreign extension "${config.command}" failed to start: ${msg}`);
    }
  }
  return results;
}
