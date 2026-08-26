import {
  invalidParams,
  isJsonObject,
  type JsonObject,
  objectField,
  routingScopeMismatch,
} from "./protocol.js";
import { isPrivateCallbackHost } from "./push-notification-callback-hosts.js";

export type A2APushNotificationAuthentication = JsonObject & {
  scheme: string;
  credentials?: string;
};

export type A2ATaskPushNotificationConfig = JsonObject & {
  id: string;
  taskId: string;
  url: string;
  token?: string;
  authentication?: A2APushNotificationAuthentication;
};

export type PushNotificationConfigInput = {
  id: string | null;
  taskId: string;
  scopeId: string | null;
  contextId: string | null;
  url: string;
  token: string | null;
  authentication: A2APushNotificationAuthentication | null;
};

export type PushNotificationConfigSelector = {
  taskId: string;
  configId: string;
  scopeId: string | null;
  contextId: string | null;
};

export type PushNotificationConfigListFilter = {
  taskId: string;
  scopeId: string | null;
  contextId: string | null;
  pageSize: number | null;
  pageToken: string | null;
};

export type PushNotificationConfigListResponse = JsonObject & {
  configs: A2ATaskPushNotificationConfig[];
  nextPageToken: string;
};

type RoutingScopeInput = {
  params: JsonObject;
  message?: JsonObject;
};

export function decodeCreatePushNotificationConfigParams(
  params: JsonObject,
): PushNotificationConfigInput {
  const config = pushNotificationConfigSource(params);
  const taskId = optionalStringField(config, "taskId") ?? optionalStringField(params, "taskId");
  if (!taskId) throw invalidParams("taskId must be a non-empty string");
  const url = optionalStringField(config, "url") ?? optionalStringField(params, "url");
  if (!url) throw invalidParams("url must be a non-empty string");
  const parsedUrl = assertAllowedCallbackUrl(url);
  const token = decodeSecretString(config, params, "token");
  const authentication = decodePushAuthentication(config);
  assertCredentialedCallbackUsesHttps(parsedUrl, token, authentication);
  return {
    id: optionalStringField(config, "id") ?? optionalStringField(params, "id"),
    taskId,
    scopeId: decodeRoutingScopeId({ params, message: config }),
    contextId: optionalStringField(config, "contextId") ?? optionalStringField(params, "contextId"),
    url,
    token,
    authentication,
  };
}

export function decodePushNotificationConfigSelector(
  params: JsonObject,
): PushNotificationConfigSelector {
  const taskId = optionalStringField(params, "taskId");
  if (!taskId) throw invalidParams("taskId must be a non-empty string");
  const configId = optionalStringField(params, "id");
  if (!configId) throw invalidParams("id must be a non-empty string");
  return {
    taskId,
    configId,
    scopeId: decodeRoutingScopeId({ params }),
    contextId: optionalStringField(params, "contextId"),
  };
}

export function decodePushNotificationConfigListFilter(
  params: JsonObject,
): PushNotificationConfigListFilter {
  const taskId = optionalStringField(params, "taskId");
  if (!taskId) throw invalidParams("taskId must be a non-empty string");
  return {
    taskId,
    scopeId: decodeRoutingScopeId({ params }),
    contextId: optionalStringField(params, "contextId"),
    pageSize: decodePositiveInteger(params, "pageSize"),
    pageToken: decodePageToken(params),
  };
}

function pushNotificationConfigSource(params: JsonObject): JsonObject {
  return optionalObjectField(params, "taskPushNotificationConfig") ??
    optionalObjectField(params, "pushNotificationConfig") ??
    params;
}

function decodePushAuthentication(config: JsonObject): A2APushNotificationAuthentication | null {
  const authentication = optionalObjectField(config, "authentication");
  if (!authentication) return null;
  const scheme = optionalStringField(authentication, "scheme");
  if (!scheme) throw invalidParams("authentication.scheme must be a non-empty string");
  if (!/^[A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]*$/.test(scheme)) {
    throw invalidParams("authentication.scheme must be an HTTP authentication scheme");
  }
  const credentials = optionalStringField(authentication, "credentials");
  if (credentials !== null && hasHeaderControlCharacters(credentials)) {
    throw invalidParams("authentication.credentials must not contain header control characters");
  }
  return credentials === null ? { scheme } : { scheme, credentials };
}

function decodeSecretString(
  config: JsonObject,
  params: JsonObject,
  key: "token",
): string | null {
  const value = optionalStringField(config, key) ?? optionalStringField(params, key);
  if (value !== null && hasHeaderControlCharacters(value)) {
    throw invalidParams(`${key} must not contain header control characters`);
  }
  return value;
}

function decodePageToken(params: JsonObject): string | null {
  const pageToken = optionalStringField(params, "pageToken");
  if (pageToken === null) return null;
  const parsed = Number(pageToken);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw invalidParams("pageToken must be a non-negative integer offset");
  }
  return pageToken;
}

function decodePositiveInteger(params: JsonObject, key: string): number | null {
  const value = params[key];
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw invalidParams(`${key} must be a positive integer`);
  }
  return value;
}

function assertAllowedCallbackUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw invalidParams("url must be a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw invalidParams("url must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw invalidParams("url must not contain embedded credentials");
  }
  if (isPrivateCallbackHost(parsed.hostname)) {
    throw invalidParams("url must use a non-local callback host");
  }
  return parsed;
}

function assertCredentialedCallbackUsesHttps(
  parsed: URL,
  token: string | null,
  authentication: A2APushNotificationAuthentication | null,
): void {
  if (parsed.protocol === "https:") return;
  if (token === null && !authentication?.credentials) return;
  throw invalidParams("url must use https when callback credentials are configured");
}

function hasHeaderControlCharacters(value: string): boolean {
  return value.includes("\r") || value.includes("\n");
}

function optionalObjectField(obj: JsonObject, key: string): JsonObject | null {
  const value = obj[key];
  if (value === undefined) return null;
  if (!isJsonObject(value)) {
    throw invalidParams(`${key} must be an object`);
  }
  return value;
}

function optionalStringField(obj: JsonObject, key: string): string | null {
  const value = obj[key];
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw invalidParams(`${key} must be a non-empty string`);
  }
  return value;
}

function decodeRoutingScopeId(input: RoutingScopeInput): string | null {
  const scopes = [
    input.params,
    objectField(input.params, "metadata"),
    input.message ?? null,
    input.message ? objectField(input.message, "metadata") : null,
  ].filter((obj): obj is JsonObject => obj !== null);
  const tenant = firstMatchingScopeValue(scopes, "tenant");
  const scopeId = firstMatchingScopeValue(scopes, "scopeId");
  if (tenant !== null && scopeId !== null && tenant !== scopeId) {
    throw routingScopeMismatch(tenant, scopeId);
  }
  return tenant ?? scopeId;
}

function firstMatchingScopeValue(scopes: JsonObject[], key: "tenant" | "scopeId"): string | null {
  let selected: string | null = null;
  for (const scope of scopes) {
    const value = optionalStringField(scope, key);
    if (value === null) continue;
    if (selected !== null && selected !== value) {
      throw invalidParams(`${key} must use one consistent value`);
    }
    selected = value;
  }
  return selected;
}
