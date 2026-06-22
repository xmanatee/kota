import type { ModuleStorage } from "#core/modules/module-storage.js";
import {
  invalidParams,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "./protocol.js";
import { redactedCallbackUrl } from "./push-notification-callback-url.js";
import type {
  A2APushNotificationAuthentication,
  A2ATaskPushNotificationConfig,
  PushNotificationConfigListFilter,
  PushNotificationConfigSelector,
} from "./push-notification-protocol.js";

const STORE_KEY = "push-notification-configs";
const REDACTED_SECRET = "<redacted>";

export const DEFAULT_PUSH_NOTIFICATION_PAGE_SIZE = 50;
export const MAX_PUSH_NOTIFICATION_PAGE_SIZE = 100;

export type StoredPushNotificationConfig = {
  id: string;
  taskId: string;
  contextId: string;
  projectId: string | null;
  url: string;
  token: string | null;
  authentication: A2APushNotificationAuthentication | null;
  createdAt: string;
};

export function readStoredPushNotificationConfigs(
  storage: ModuleStorage,
): StoredPushNotificationConfig[] {
  const stored = storage.getJSON<JsonObject>(STORE_KEY);
  const configs = stored?.configs;
  if (!Array.isArray(configs)) return [];
  return configs.filter(isStoredConfig);
}

export function writeStoredPushNotificationConfigs(
  storage: ModuleStorage,
  configs: StoredPushNotificationConfig[],
): void {
  if (configs.length === 0) {
    storage.delete(STORE_KEY);
    return;
  }
  storage.setJSON(STORE_KEY, { configs });
}

export function redactPushNotificationConfig(
  config: StoredPushNotificationConfig,
): A2ATaskPushNotificationConfig {
  return {
    id: config.id,
    taskId: config.taskId,
    url: redactedCallbackUrl(config.url),
    ...(config.token !== null ? { token: REDACTED_SECRET } : {}),
    ...(config.authentication ? { authentication: redactAuthentication(config.authentication) } : {}),
  };
}

export function pushConfigMatchesSelector(
  config: StoredPushNotificationConfig,
  selector: PushNotificationConfigSelector,
): boolean {
  if (config.taskId !== selector.taskId || config.id !== selector.configId) return false;
  if (selector.projectId !== null && config.projectId !== selector.projectId) return false;
  if (selector.contextId !== null && config.contextId !== selector.contextId) return false;
  return true;
}

export function pushConfigMatchesFilter(
  config: StoredPushNotificationConfig,
  filter: PushNotificationConfigListFilter,
): boolean {
  if (config.taskId !== filter.taskId) return false;
  if (filter.projectId !== null && config.projectId !== filter.projectId) return false;
  if (filter.contextId !== null && config.contextId !== filter.contextId) return false;
  return true;
}

export function pushNotificationPageStart(pageToken: string | null): number {
  if (pageToken === null) return 0;
  const parsed = Number(pageToken);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw invalidParams("pageToken must be a non-negative integer offset");
  }
  return parsed;
}

export function projectIdFromTaskMetadata(metadata: JsonObject): string | null {
  const projectId = metadata.projectId;
  return typeof projectId === "string" && projectId.length > 0 ? projectId : null;
}

export function pushSubscriptionKey(taskId: string, contextId: string): string {
  return `${taskId}\0${contextId}`;
}

function redactAuthentication(
  authentication: A2APushNotificationAuthentication,
): A2APushNotificationAuthentication {
  return {
    scheme: authentication.scheme,
    ...(authentication.credentials ? { credentials: REDACTED_SECRET } : {}),
  };
}

function isStoredConfig(value: JsonValue): value is StoredPushNotificationConfig {
  if (!isJsonObject(value)) return false;
  return typeof value.id === "string" &&
    typeof value.taskId === "string" &&
    typeof value.contextId === "string" &&
    (typeof value.projectId === "string" || value.projectId === null) &&
    typeof value.url === "string" &&
    (typeof value.token === "string" || value.token === null) &&
    (value.authentication === null || isAuthentication(value.authentication)) &&
    typeof value.createdAt === "string";
}

function isAuthentication(
  value: JsonValue | undefined,
): value is A2APushNotificationAuthentication {
  if (!isJsonObject(value)) return false;
  return typeof value.scheme === "string" &&
    (value.credentials === undefined || typeof value.credentials === "string");
}
