import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, vi } from "vitest";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext, RouteRegistration } from "#core/modules/module-types.js";
import { findRouteMatch } from "#core/modules/route-matcher.js";
import type { A2ABackend } from "./daemon-session-client.js";
import { makeTask } from "./daemon-session-client.js";
import {
  A2A_PROTOCOL_VERSION,
  A2A_RPC_PATH,
  type A2ATask,
  type A2ATaskUpdate,
  type SendMessageInput,
  type TaskListFilter,
  type TaskSelector,
  taskNotFound,
} from "./protocol.js";

const NOW = "2026-06-22T03:12:00.000Z";

export type PushNotificationTestState = {
  servers: Server[];
  tempDirs: string[];
};

type FakeSubscription = {
  selector: TaskSelector;
  options: {
    signal?: AbortSignal;
    onUpdate: (update: A2ATaskUpdate) => void;
  };
  resolve: (task: A2ATask) => void;
};

export class FakeBackend implements A2ABackend {
  readonly sentInputs: SendMessageInput[] = [];
  readonly missingTasks = new Set<string>();
  readonly subscriptions: FakeSubscription[] = [];

  async sendMessage(
    input: SendMessageInput,
    options?: {
      signal?: AbortSignal;
      onUpdate?: (update: A2ATaskUpdate) => void;
    },
  ): Promise<A2ATask> {
    this.sentInputs.push(input);
    const taskId = input.taskId ?? "task-1";
    const contextId = input.contextId ?? input.projectId ?? "proj-1";
    const working = task(taskId, contextId, "TASK_STATE_WORKING", "working");
    options?.onUpdate?.({
      statusUpdate: {
        taskId,
        contextId,
        status: working.status,
        metadata: working.metadata,
      },
    });
    options?.onUpdate?.({
      artifactUpdate: {
        taskId,
        contextId,
        artifact: {
          artifactId: `${taskId}-response`,
          name: "KOTA response",
          parts: [{ text: "partial", mediaType: "text/plain" }],
        },
        append: false,
        lastChunk: false,
      },
    });
    const final = task(taskId, contextId, "TASK_STATE_COMPLETED", "done");
    options?.onUpdate?.({ task: final });
    return final;
  }

  async getTask(selector: TaskSelector): Promise<A2ATask> {
    if (
      this.missingTasks.has(selector.taskId) ||
      selector.taskId !== "task-1" ||
      (selector.projectId !== null && selector.projectId !== "proj-1") ||
      (selector.contextId !== null && selector.contextId !== "proj-1")
    ) {
      throw taskNotFound(selector.taskId);
    }
    return task("task-1", "proj-1", "TASK_STATE_WORKING", "working");
  }

  async listTasks(filter: TaskListFilter): Promise<A2ATask[]> {
    if (filter.projectId !== null && filter.projectId !== "proj-1") return [];
    return [task("task-1", "proj-1", "TASK_STATE_WORKING", "working")];
  }

  async cancelTask(selector: TaskSelector): Promise<A2ATask> {
    return task(selector.taskId, "proj-1", "TASK_STATE_CANCELED", "canceled");
  }

  async subscribeToTask(
    selector: TaskSelector,
    options: {
      signal?: AbortSignal;
      onUpdate: (update: A2ATaskUpdate) => void;
    },
  ): Promise<A2ATask> {
    const initial = await this.getTask(selector);
    return await new Promise<A2ATask>((resolve) => {
      const subscription: FakeSubscription = { selector, options, resolve };
      const remove = () => {
        const index = this.subscriptions.indexOf(subscription);
        if (index >= 0) this.subscriptions.splice(index, 1);
      };
      const finish = () => {
        remove();
        resolve(initial);
      };
      if (options.signal?.aborted) {
        finish();
        return;
      }
      options.signal?.addEventListener("abort", finish, { once: true });
      this.subscriptions.push(subscription);
    });
  }

  emitSubscribed(update: A2ATaskUpdate): void {
    for (const subscription of [...this.subscriptions]) {
      subscription.options.onUpdate(update);
    }
  }
}

export function pushConfigParams(overrides: {
  id?: string;
  tenant?: string;
  projectId?: string;
  url?: string;
  token?: string;
  authentication?: { scheme: string; credentials?: string };
} = {}) {
  return {
    tenant: overrides.tenant ?? "proj-1",
    ...(overrides.projectId ? { projectId: overrides.projectId } : {}),
    id: overrides.id ?? "config-1",
    taskId: "task-1",
    url: overrides.url ?? "https://callback.example.test/a2a",
    ...(overrides.token ? { token: overrides.token } : {}),
    ...(overrides.authentication ? { authentication: overrides.authentication } : {}),
  };
}

export function makeStorage(tempDirs: string[]): ModuleStorage {
  const dir = mkdtempSync(join(tmpdir(), "kota-a2a-push-"));
  tempDirs.push(dir);
  return new ModuleStorage(dir, "a2a-channel");
}

export function makeContext(storage: ModuleStorage): ModuleContext {
  return {
    cwd: process.cwd(),
    verbose: false,
    config: {},
    storage,
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getSecret: vi.fn(),
    getModuleConfig: vi.fn(),
    getRegisteredConfigKeys: () => new Set(),
    getRoutes: () => [],
    getContributedControlRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getContributedUiSurfaces: () => [],
    getModuleSummaries: () => [],
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    probeHealthChecks: async () => ({}),
    callTool: vi.fn(),
    listTools: () => [],
    events: {
      emit: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      emitExternal: vi.fn(),
      subscribeExternal: vi.fn(() => () => {}),
      listenerCount: () => 0,
    },
    getProvider: () => null,
    createSession: vi.fn(),
    client: {} as never,
  };
}

export async function startRouteServer(
  routes: RouteRegistration[],
): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const match = findRouteMatch(routes, req.method ?? "GET", url.pathname);
    if (!match) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    Promise.resolve(match.route.handler(req, res, match.params)).catch((err: Error) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("test server did not bind to a TCP port");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

export async function postRpc(baseUrl: string, body: object) {
  const res = await fetch(`${baseUrl}${A2A_RPC_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "A2A-Version": A2A_PROTOCOL_VERSION,
    },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return await res.json();
}

export function errorReason(response: {
  error?: { data?: Array<{ reason?: string }> };
}): string | undefined {
  return response.error?.data?.[0]?.reason;
}

export async function cleanupPushNotificationTestState(
  state: PushNotificationTestState,
): Promise<void> {
  await Promise.all(state.servers.map(closeServer));
  state.servers.length = 0;
  for (const dir of state.tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function task(
  id: string,
  contextId: string,
  state: A2ATask["status"]["state"],
  message: string,
): A2ATask {
  return makeTask({
    id,
    contextId,
    state,
    messageText: message,
    metadata: { kotaSessionId: id, projectId: "proj-1" },
    now: () => NOW,
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
