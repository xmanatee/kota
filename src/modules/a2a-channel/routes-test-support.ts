import { createServer, type Server } from "node:http";
import type { ModuleContext, RouteRegistration } from "#core/modules/module-types.js";
import { findRouteMatch } from "#core/modules/route-matcher.js";
import type { A2ABackend } from "./daemon-session-client.js";
import { makeTask } from "./daemon-session-client.js";
import {
  A2A_PROTOCOL_VERSION,
  A2A_RPC_PATH,
  type A2ATask,
  type A2ATaskUpdate,
  type JsonObject,
  type SendMessageInput,
  type TaskListFilter,
  type TaskSelector,
  taskNotFound,
  terminalTaskSubscription,
  unauthorized,
} from "./protocol.js";

export const NOW = "2026-05-27T05:44:30.913Z";

const noop = () => {};
const unsubscribe = () => {};
const emitEvent = noop as ModuleContext["events"]["emit"];
const subscribeEvent = (() => unsubscribe) as ModuleContext["events"]["subscribe"];
const unavailableCallTool: ModuleContext["callTool"] = async () => {
  throw new Error("test context does not provide tools");
};
const unavailableCreateSession: ModuleContext["createSession"] = () => {
  throw new Error("test context does not provide sessions");
};

export class FakeBackend implements A2ABackend {
  sentInputs: SendMessageInput[] = [];
  getSelectors: TaskSelector[] = [];
  listFilters: TaskListFilter[] = [];
  cancelSelectors: TaskSelector[] = [];
  subscribeSelectors: TaskSelector[] = [];
  failUnauthorized = false;

  async sendMessage(
    input: SendMessageInput,
    options?: {
      signal?: AbortSignal;
      onUpdate?: (update: A2ATaskUpdate) => void;
    },
  ): Promise<A2ATask> {
    this.sentInputs.push(input);
    const taskId = input.taskId ?? "task-1";
    const contextId = input.contextId ?? input.scopeId ?? taskId;
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
      },
    });
    const final = task(taskId, contextId, "TASK_STATE_COMPLETED", "done");
    options?.onUpdate?.({ task: final });
    return final;
  }

  async getTask(selector: TaskSelector): Promise<A2ATask> {
    this.getSelectors.push(selector);
    if (selector.taskId !== "task-1") throw taskNotFound(selector.taskId);
    return task("task-1", "proj-1", "TASK_STATE_COMPLETED", "done");
  }

  async listTasks(filter: TaskListFilter): Promise<A2ATask[]> {
    if (this.failUnauthorized) throw unauthorized();
    this.listFilters.push(filter);
    return [task("task-1", filter.contextId ?? filter.scopeId ?? "proj-1", "TASK_STATE_COMPLETED", "done")];
  }

  async cancelTask(selector: TaskSelector): Promise<A2ATask> {
    this.cancelSelectors.push(selector);
    return task(selector.taskId, "proj-1", "TASK_STATE_CANCELED", "canceled");
  }

  async subscribeToTask(selector: TaskSelector): Promise<A2ATask> {
    this.subscribeSelectors.push(selector);
    throw terminalTaskSubscription(selector.taskId);
  }
}

export function makeContext(): ModuleContext {
  return {
    cwd: process.cwd(),
    verbose: false,
    config: {},
    storage: { getJSON: () => undefined } as never,
    log: {
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
    },
    getSecret: () => null,
    getModuleConfig: () => undefined,
    getRegisteredConfigKeys: () => new Set(),
    getRoutes: () => [],
    getContributedControlRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getContributedUiSurfaces: () => [],
    getModuleSummaries: () => [
      {
        name: "example",
        source: "bundled",
        dependencies: [],
        toolNames: [],
        workflowNames: [],
        channelNames: [],
        skillNames: ["builder"],
        agentNames: [],
        agents: [],
        skills: [],
        commandNames: [],
        routeSummaries: [],
      },
    ],
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    probeHealthChecks: async () => ({}),
    callTool: unavailableCallTool,
    listTools: () => [],
    events: {
      emit: emitEvent,
      subscribe: subscribeEvent,
      emitExternal: noop,
      subscribeExternal: () => unsubscribe,
      listenerCount: () => 0,
    },
    getProvider: () => null,
    createSession: unavailableCreateSession,
    client: {} as never,
  };
}

export async function startRouteServer(
  routes: RouteRegistration[],
  options: { authToken?: string } = {},
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
    if (options.authToken && !match.route.bypassAuth) {
      const header = req.headers.authorization;
      const queryToken = url.searchParams.get("token");
      if (header !== `Bearer ${options.authToken}` && queryToken !== options.authToken) {
        if (match.route.authFailureHandler) {
          Promise.resolve(match.route.authFailureHandler(req, res, match.params)).catch((err: Error) => {
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
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

export async function postRpc(
  baseUrl: string,
  body: object,
  options: {
    headers?: Record<string, string>;
    includeDefaultVersion?: boolean;
    query?: string;
  } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.includeDefaultVersion !== false) {
    headers["A2A-Version"] = A2A_PROTOCOL_VERSION;
  }
  Object.assign(headers, options.headers);
  const res = await fetch(`${baseUrl}${A2A_RPC_PATH}${options.query ?? ""}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (res.status !== 200) {
    throw new Error(`expected HTTP 200, got ${res.status}: ${await res.text()}`);
  }
  return await res.json();
}

export function parseSseJsonRpcResponses(text: string) {
  return text
    .split("\n\n")
    .filter((frame) => frame.trim().length > 0)
    .map((frame) => {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n");
      return JSON.parse(data);
    });
}

export function sendMessageParams(configuration: object) {
  return {
    configuration,
    message: {
      role: "ROLE_USER",
      parts: [{ text: "ship the slice", mediaType: "text/plain" }],
    },
  };
}

export function errorReason(response: { error?: { data?: Array<{ reason?: string }> } }): string | undefined {
  return response.error?.data?.[0]?.reason;
}

export function errorMetadata(response: {
  error?: { data?: Array<{ metadata?: JsonObject }> };
}): JsonObject | undefined {
  return response.error?.data?.[0]?.metadata;
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
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
    metadata: { kotaSessionId: id },
    now: () => NOW,
  });
}
