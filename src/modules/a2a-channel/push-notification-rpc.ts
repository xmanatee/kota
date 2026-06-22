import type { ServerResponse } from "node:http";
import { jsonResponse } from "#core/server/session-pool.js";
import type { A2ABackend } from "./daemon-session-client.js";
import {
  A2AProtocolError,
  type JsonObject,
  type JsonRpcId,
  makeJsonRpcResponse,
  taskNotFound,
} from "./protocol.js";
import {
  decodeCreatePushNotificationConfigParams,
  decodePushNotificationConfigListFilter,
  decodePushNotificationConfigSelector,
  type PushNotificationConfigInput,
  type PushNotificationConfigListFilter,
  type PushNotificationConfigSelector,
} from "./push-notification-protocol.js";
import type { A2APushNotificationManager } from "./push-notifications.js";

export type PushNotificationRpcMethod =
  | "CreateTaskPushNotificationConfig"
  | "GetTaskPushNotificationConfig"
  | "ListTaskPushNotificationConfigs"
  | "DeleteTaskPushNotificationConfig";

export function isPushNotificationRpcMethod(method: string): method is PushNotificationRpcMethod {
  return method === "CreateTaskPushNotificationConfig" ||
    method === "GetTaskPushNotificationConfig" ||
    method === "ListTaskPushNotificationConfigs" ||
    method === "DeleteTaskPushNotificationConfig";
}

export async function handlePushNotificationRpc(
  res: ServerResponse,
  id: JsonRpcId,
  method: PushNotificationRpcMethod,
  params: JsonObject,
  backendFactory: () => A2ABackend,
  pushNotifications: A2APushNotificationManager,
): Promise<void> {
  if (method === "CreateTaskPushNotificationConfig") {
    const input = decodeCreatePushNotificationConfigParams(params);
    const backend = backendFactory();
    const task = await assertPushTaskAccessible(backend, pushNotifications, input);
    const config = pushNotifications.create(input, task);
    pushNotifications.ensureTaskSubscription(backend, task);
    jsonResponse(res, 200, makeJsonRpcResponse(id, config));
    return;
  }
  if (method === "GetTaskPushNotificationConfig") {
    const selector = decodePushNotificationConfigSelector(params);
    const backend = backendFactory();
    await assertPushTaskAccessible(backend, pushNotifications, selector);
    const config = pushNotifications.get(selector);
    if (!config) throw taskNotFound(selector.taskId);
    jsonResponse(res, 200, makeJsonRpcResponse(id, config));
    return;
  }
  if (method === "ListTaskPushNotificationConfigs") {
    const filter = decodePushNotificationConfigListFilter(params);
    const backend = backendFactory();
    await assertPushTaskAccessible(backend, pushNotifications, filter);
    jsonResponse(res, 200, makeJsonRpcResponse(id, pushNotifications.list(filter)));
    return;
  }

  const selector = decodePushNotificationConfigSelector(params);
  const backend = backendFactory();
  await assertPushTaskAccessible(backend, pushNotifications, selector);
  pushNotifications.delete(selector);
  jsonResponse(res, 200, makeJsonRpcResponse(id, {}));
}

async function assertPushTaskAccessible(
  backend: A2ABackend,
  pushNotifications: A2APushNotificationManager,
  selector:
    | PushNotificationConfigInput
    | PushNotificationConfigSelector
    | PushNotificationConfigListFilter,
) {
  try {
    return await backend.getTask({
      taskId: selector.taskId,
      projectId: selector.projectId,
      contextId: selector.contextId,
    });
  } catch (err) {
    if (err instanceof A2AProtocolError && err.rpcCode === -32001) {
      pushNotifications.removeTaskScope(selector);
    }
    throw err;
  }
}
