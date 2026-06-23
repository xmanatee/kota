import { localWriteEffect } from "#core/tools/effect.js";
import { assertNotMcpManagedToolName } from "#core/tools/tool-name-policy.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import type {
  KempInbound,
  KempInit,
  KempInvoke,
  KempManifest,
  KempOutbound,
  KempTransport,
} from "./foreign-module.js";
import type { HealthCheckResult, ToolDef } from "./module-types.js";
import { printTerminalDiagnostic } from "./terminal-renderer.js";

const MANIFEST_TIMEOUT_MS = 10_000;
const INVOKE_TIMEOUT_MS = 60_000;

export const HEALTH_CHECK_TIMEOUT_MS = 1_000;

type PendingInvoke = {
  resolve: (msg: KempInbound) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type RawForeignModule = {
  name: string;
  version?: string;
  description?: string;
  session: ForeignModuleSession;
  toolDefs: KempManifest["tools"];
};

export class ForeignModuleSession {
  private pending = new Map<string, PendingInvoke>();
  private receiveLoop: Promise<void>;
  private closed = false;
  private label: string;

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
        printTerminalDiagnostic(`${prefix} ${msg.message}`, msg.level);
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
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Transport closed"));
      this.pending.delete(id);
    }
  }

  async request(id: string, outbound: KempOutbound, timeoutMs: number): Promise<KempInbound> {
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

  async ping(timeoutMs: number): Promise<void> {
    const id = newForeignModuleRequestId();
    await this.request(id, { id, type: "ping" }, timeoutMs);
  }

  async healthCheck(timeoutMs: number): Promise<HealthCheckResult> {
    const id = newForeignModuleRequestId();
    try {
      const msg = await this.request(id, { id, type: "health_check" }, timeoutMs);
      if (msg.type === "health_status") {
        return { status: msg.status, message: msg.message };
      }
      return { status: "healthy" };
    } catch {
      return { status: "healthy" };
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.transport.send({ id: "shutdown", type: "shutdown" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printTerminalDiagnostic(`${this.label}[warn] Failed to send shutdown: ${msg}`, "warn");
    }
    await this.transport.close();
    await this.receiveLoop;
  }
}

let nextId = 1;

function newForeignModuleRequestId(): string {
  return String(nextId++);
}

export async function createRawForeignModule(
  transport: KempTransport,
  label: string,
  projectCwd: string,
  moduleConfig?: KempInit["config"],
): Promise<RawForeignModule> {
  const initId = newForeignModuleRequestId();
  const session = new ForeignModuleSession(transport, label);
  const manifestMsg = await session.request(
    initId,
    { id: initId, type: "init", cwd: projectCwd, config: moduleConfig },
    MANIFEST_TIMEOUT_MS,
  );
  if (manifestMsg.type !== "manifest") {
    await session.close();
    throw new Error(`Expected manifest, got: ${manifestMsg.type}`);
  }
  try {
    assertAllowedForeignToolNames(manifestMsg);
  } catch (err) {
    await session.close();
    throw err;
  }
  return {
    name: manifestMsg.name,
    version: manifestMsg.version,
    description: manifestMsg.description,
    session,
    toolDefs: manifestMsg.tools,
  };
}

export function buildForeignToolDefs(
  toolDefs: KempManifest["tools"],
  getSession: () => ForeignModuleSession,
): ToolDef[] {
  return toolDefs.map((def) => ({
    tool: {
      name: def.name,
      description: def.description,
      input_schema: def.input_schema,
    },
    effect: localWriteEffect(),
    runner: async (input: KempInvoke["input"]): Promise<ToolResult> => {
      try {
        const id = newForeignModuleRequestId();
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

function assertAllowedForeignToolNames(manifest: KempManifest): void {
  for (const tool of manifest.tools) {
    try {
      assertNotMcpManagedToolName(tool.name);
    } catch (err) {
      throw new Error(`Foreign module "${manifest.name}" declared invalid tool: ${(err as Error).message}`);
    }
  }
}
