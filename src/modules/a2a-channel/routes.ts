import type { IncomingMessage, ServerResponse } from "node:http";
import type { ModuleContext, RouteRegistration } from "#core/modules/module-types.js";
import { readSelectedScopeSelectorIdQueryOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse, readBody, setCors } from "#core/server/session-pool.js";
import { buildAgentCard } from "./agent-card.js";
import type { A2ABackend } from "./daemon-session-client.js";
import {
  A2A_EXTENDED_CARD_PATH,
  A2A_PROTOCOL_VERSION,
  A2A_RPC_PATH,
  A2A_WELL_KNOWN_CARD_PATH,
  A2AProtocolError,
  type A2ATaskListResponse,
  agentExecutionFailed,
  daemonUnavailable,
  decodeJsonRpcRequest,
  decodeSendMessageParams,
  decodeTaskListFilter,
  decodeTaskSelector,
  invalidRequest,
  type JsonObject,
  type JsonRpcId,
  makeJsonRpcError,
  makeJsonRpcResponse,
  unauthorized,
  versionNotSupported,
} from "./protocol.js";
import {
  handlePushNotificationRpc,
  isPushNotificationRpcMethod,
} from "./push-notification-rpc.js";
import {
  type A2ARouteOptions,
  backendFactoryFor,
  pushNotificationManagerFor,
} from "./push-notification-runtime.js";
import type { A2APushNotificationManager } from "./push-notifications.js";
import {
  canonicalMethod,
  isStreamingMethod,
  requestedA2AProtocolVersion,
} from "./rpc-methods.js";

export type { A2ARouteOptions } from "./push-notification-runtime.js";
export {
  resumeStoredA2APushNotificationSubscriptions,
  stopSharedA2APushNotificationManagers,
} from "./push-notification-runtime.js";

export function a2aRoutes(ctx: ModuleContext, options: A2ARouteOptions = {}): RouteRegistration[] {
  const backendFactory = backendFactoryFor(ctx, options);
  const pushNotifications = pushNotificationManagerFor(ctx, options);
  return [
    {
      method: "GET",
      path: A2A_WELL_KNOWN_CARD_PATH,
      bypassAuth: true,
      handler: (req, res) => handleAgentCard(ctx, req, res, false),
    },
    {
      method: "GET",
      path: A2A_EXTENDED_CARD_PATH,
      handler: (req, res) => handleAgentCard(ctx, req, res, true),
    },
    {
      method: "POST",
      path: A2A_RPC_PATH,
      authFailureHandler: handleRpcAuthFailure,
      handler: (req, res) => handleRpc(req, res, backendFactory, pushNotifications),
    },
  ];
}

function handleAgentCard(
  ctx: ModuleContext,
  req: IncomingMessage,
  res: ServerResponse,
  extended: boolean,
): void {
  setCors(res);
  res.setHeader("Cache-Control", extended ? "no-store" : "public, max-age=300");
  const tenant = extended
    ? readSelectedScopeSelectorIdQueryOrErrorResponse(req, res, "http://127.0.0.1")
    : undefined;
  if (tenant === null) return;
  jsonResponse(res, 200, buildAgentCard(ctx, req, extended, tenant));
}

async function handleRpc(
  req: IncomingMessage,
  res: ServerResponse,
  backendFactory: () => A2ABackend | null,
  pushNotifications: A2APushNotificationManager,
): Promise<void> {
  let id: JsonRpcId = null;
  try {
    const raw = await readBody(req);
    const request = decodeJsonRpcRequest(raw as JsonObject);
    id = request.id;
    const streaming = isStreamingMethod(request.method);
    const requestedVersion = requestedA2AProtocolVersion(req);
    if (requestedVersion !== A2A_PROTOCOL_VERSION) {
      const err = versionNotSupported(requestedVersion);
      if (streaming) {
        sendSingleSseError(res, id, err);
        return;
      }
      throw err;
    }
    const method = canonicalMethod(request.method);
    if (method === "SendStreamingMessage" || method === "SubscribeToTask") {
      await handleStreamingRpc(
        res,
        req,
        id,
        method,
        request.params,
        backendFactory,
        pushNotifications,
      );
      return;
    }
    if (method === "SendMessage") {
      const input = decodeSendMessageParams(request.params);
      const backend = requireBackend(backendFactory);
      const task = await backend.sendMessage(input, {
        onUpdate: (update) => {
          void pushNotifications.dispatch(update);
        },
      });
      jsonResponse(res, 200, makeJsonRpcResponse(id, { task }));
      return;
    }
    if (method === "GetTask") {
      const selector = decodeTaskSelector(request.params);
      const backend = requireBackend(backendFactory);
      const task = await backend.getTask(selector);
      jsonResponse(res, 200, makeJsonRpcResponse(id, task));
      return;
    }
    if (method === "ListTasks") {
      const filter = decodeTaskListFilter(request.params);
      const backend = requireBackend(backendFactory);
      const tasks = await backend.listTasks(filter);
      jsonResponse(res, 200, makeJsonRpcResponse(id, taskListResponse(tasks)));
      return;
    }
    if (isPushNotificationRpcMethod(method)) {
      await handlePushNotificationRpc(
        res,
        id,
        method,
        request.params,
        () => requireBackend(backendFactory),
        pushNotifications,
      );
      return;
    }
    const selector = decodeTaskSelector(request.params);
    const backend = requireBackend(backendFactory);
    const task = await backend.cancelTask(selector);
    jsonResponse(res, 200, makeJsonRpcResponse(id, task));
  } catch (err) {
    const normalized = normalizeA2AError(err instanceof Error ? err : String(err));
    jsonResponse(res, 200, makeJsonRpcError(id, normalized));
  }
}

function sendSingleSseError(res: ServerResponse, id: JsonRpcId, err: A2AProtocolError): void {
  setCors(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "close",
  });
  res.write(`data: ${JSON.stringify(makeJsonRpcError(id, err))}\n\n`);
  res.end();
}

async function handleRpcAuthFailure(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let id: JsonRpcId = null;
  try {
    const raw = await readBody(req);
    id = decodeJsonRpcRequest(raw as JsonObject).id;
  } catch {
    id = null;
  }
  jsonResponse(res, 200, makeJsonRpcError(id, unauthorized()));
}

async function handleStreamingRpc(
  res: ServerResponse,
  req: IncomingMessage,
  id: JsonRpcId,
  method: "SendStreamingMessage" | "SubscribeToTask",
  params: JsonObject,
  backendFactory: () => A2ABackend | null,
  pushNotifications: A2APushNotificationManager,
): Promise<void> {
  setCors(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const controller = new AbortController();
  req.on("close", () => controller.abort());
  const send = (payload: JsonObject): void => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  try {
    if (method === "SendStreamingMessage") {
      const input = decodeSendMessageParams(params);
      const backend = requireBackend(backendFactory);
      await backend.sendMessage(input, {
        signal: controller.signal,
        onUpdate: (update) => {
          send(makeJsonRpcResponse(id, update));
          void pushNotifications.dispatch(update);
        },
      });
    } else {
      const selector = decodeTaskSelector(params);
      const backend = requireBackend(backendFactory);
      await backend.subscribeToTask(selector, {
        signal: controller.signal,
        onUpdate: (update) => {
          send(makeJsonRpcResponse(id, update));
          void pushNotifications.dispatch(update);
        },
      });
    }
  } catch (err) {
    send(makeJsonRpcError(id, normalizeA2AError(err instanceof Error ? err : String(err))));
  } finally {
    if (!res.writableEnded) res.end();
  }
}

function taskListResponse(tasks: A2ATaskListResponse["tasks"]): A2ATaskListResponse {
  return {
    tasks,
    nextPageToken: "",
    pageSize: tasks.length,
    totalSize: tasks.length,
  };
}

function requireBackend(backendFactory: () => A2ABackend | null): A2ABackend {
  const backend = backendFactory();
  if (!backend) throw daemonUnavailable();
  return backend;
}

function normalizeA2AError(err: Error | string): A2AProtocolError {
  if (err instanceof A2AProtocolError) return err;
  if (err instanceof Error && err.message === "Invalid JSON") {
    return invalidRequest("Invalid JSON payload");
  }
  if (err instanceof Error) return agentExecutionFailed(err.message);
  return agentExecutionFailed(String(err));
}
