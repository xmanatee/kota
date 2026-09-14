import { once } from "node:events";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { EventBus } from "#core/events/event-bus.js";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { buildRequestHandler } from "#core/server/server-routes.js";
import { SessionPool } from "#core/server/session-pool.js";
import type { A2AContext } from "./context.js";
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

export function makeContext(): A2AContext {
  return {
    cwd: process.cwd(),
    storage: { getJSON: () => undefined } as never,
    log: {
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
    },
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

  };
}

export function createRouteClient(
  routes: RouteRegistration[],
  options: { authToken?: string } = {},
) {
  const handle = buildRequestHandler({
    port: 0,
    pool: new SessionPool(),
    bus: new EventBus(),
    moduleRoutes: routes,
    authToken: options.authToken,
    makeAgent: () => { throw new Error("A2A must use its daemon backend port"); },
    resolveDefaultAutonomyMode: () => "supervised",
  });
  return {
    baseUrl: "http://127.0.0.1",
    async request(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
      // Control only the byte transport; production routing, auth and Node HTTP
      // serialization run without requiring a listening socket.
      const wire: Buffer[] = [];
      const socket = new Socket();
      socket._write = (chunk, _encoding, callback) => { wire.push(Buffer.from(chunk)); callback(); };
      socket._writev = (entries, callback) => {
        wire.push(...entries.map(({ chunk }) => Buffer.from(chunk))); callback();
      };
      const request = new IncomingMessage(socket);
      request.method = init.method ?? "GET";
      request.url = path;
      request.headers = Object.fromEntries(
        Object.entries({ host: "127.0.0.1", ...init.headers }).map(([key, value]) => [key.toLowerCase(), value]),
      );
      request.complete = true;
      request.httpVersionMajor = 1;
      request.httpVersionMinor = 0;
      const response = new ServerResponse(request);
      response.assignSocket(socket);
      const finished = once(response, "finish");
      try {
        handle(request, response);
        if (init.body !== undefined) request.push(Buffer.from(init.body));
        request.push(null);
        await finished;
        const output = Buffer.concat(wire).toString();
        const boundary = output.indexOf("\r\n\r\n");
        const headers = new Headers();
        for (const line of output.slice(0, boundary).split("\r\n").slice(1)) {
          const colon = line.indexOf(":");
          headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
        }
        return new Response(output.slice(boundary + 4), { status: response.statusCode, headers });
      } finally {
        socket.destroy();
      }
    },
  };
}

export async function postRpc(
  client: ReturnType<typeof createRouteClient>,
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
  const res = await client.request(`${A2A_RPC_PATH}${options.query ?? ""}`, {
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
