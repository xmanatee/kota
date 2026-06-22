import {
  type A2ATask,
  type A2ATaskArtifactUpdateEvent,
  type A2ATaskStatusUpdateEvent,
  type A2ATaskUpdate,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "./protocol.js";
import type { StoredPushNotificationConfig } from "./push-notification-storage.js";

export type PushDeliveryPayload =
  | (JsonObject & { statusUpdate: A2ATaskStatusUpdateEvent })
  | (JsonObject & { artifactUpdate: A2ATaskArtifactUpdateEvent });

export function buildPushDeliveryHeaders(
  config: StoredPushNotificationConfig,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/a2a+json",
  };
  if (config.authentication?.credentials) {
    headers.Authorization = `${config.authentication.scheme} ${config.authentication.credentials}`;
  }
  return headers;
}

export function redactedCallbackUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.username = "";
  url.password = "";
  if (url.search) url.search = "?...";
  url.hash = "";
  return url.toString();
}

export function pushDeliveryScope(
  update: PushDeliveryPayload,
): { taskId: string; contextId: string } | null {
  const statusUpdate = update.statusUpdate;
  if (
    isJsonObject(statusUpdate) &&
    typeof statusUpdate.taskId === "string" &&
    typeof statusUpdate.contextId === "string"
  ) {
    return {
      taskId: statusUpdate.taskId,
      contextId: statusUpdate.contextId,
    };
  }
  const artifactUpdate = update.artifactUpdate;
  if (
    isJsonObject(artifactUpdate) &&
    typeof artifactUpdate.taskId === "string" &&
    typeof artifactUpdate.contextId === "string"
  ) {
    return {
      taskId: artifactUpdate.taskId,
      contextId: artifactUpdate.contextId,
    };
  }
  return null;
}

export function pushDeliveryPayload(update: A2ATaskUpdate): PushDeliveryPayload | null {
  const statusUpdate = update.statusUpdate;
  if (isTaskStatusUpdate(statusUpdate)) {
    return {
      statusUpdate: {
        taskId: statusUpdate.taskId,
        contextId: statusUpdate.contextId,
        status: statusUpdate.status,
        ...(isJsonObject(statusUpdate.metadata) ? { metadata: statusUpdate.metadata } : {}),
      },
    };
  }

  const artifactUpdate = update.artifactUpdate;
  if (isTaskArtifactUpdate(artifactUpdate)) {
    return {
      artifactUpdate: {
        taskId: artifactUpdate.taskId,
        contextId: artifactUpdate.contextId,
        artifact: artifactUpdate.artifact,
        ...(typeof artifactUpdate.append === "boolean" ? { append: artifactUpdate.append } : {}),
        ...(typeof artifactUpdate.lastChunk === "boolean"
          ? { lastChunk: artifactUpdate.lastChunk }
          : {}),
        ...(isJsonObject(artifactUpdate.metadata) ? { metadata: artifactUpdate.metadata } : {}),
      },
    };
  }

  const task = update.task;
  if (isTask(task)) {
    return {
      statusUpdate: {
        taskId: task.id,
        contextId: task.contextId,
        status: task.status,
        metadata: task.metadata,
      },
    };
  }

  return null;
}

function isTaskStatusUpdate(value: JsonValue | undefined): value is A2ATaskStatusUpdateEvent {
  if (!isJsonObject(value)) return false;
  return typeof value.taskId === "string" &&
    typeof value.contextId === "string" &&
    isJsonObject(value.status);
}

function isTaskArtifactUpdate(value: JsonValue | undefined): value is A2ATaskArtifactUpdateEvent {
  if (!isJsonObject(value)) return false;
  return typeof value.taskId === "string" &&
    typeof value.contextId === "string" &&
    isJsonObject(value.artifact);
}

function isTask(value: JsonValue | undefined): value is A2ATask {
  if (!isJsonObject(value)) return false;
  return typeof value.id === "string" &&
    typeof value.contextId === "string" &&
    isJsonObject(value.status) &&
    isJsonObject(value.metadata);
}
