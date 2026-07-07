import type {
  KotaJsonObject,
  KotaJsonValue,
} from "#core/agent-harness/message-protocol.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";

export function taskFromPayload(
  payload: KotaJsonObject,
  taskById: ReadonlyMap<string, RepoTaskFullRecord>,
): RepoTaskFullRecord | null {
  const taskId = stringField(payload.taskId);
  return taskId ? taskById.get(taskId) ?? null : null;
}

export function scopeFromPayload(payload: KotaJsonObject): {
  scopeId: string | null;
  projectId: string | null;
} {
  return {
    scopeId: stringField(payload.scopeId),
    projectId: stringField(payload.projectId),
  };
}

export function taskIdFromText(value: string): string | null {
  return /\b(task-[a-z0-9-]+)/.exec(value)?.[1] ?? null;
}

export function stringField(value: KotaJsonValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function stringArray(value: KotaJsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function isJsonObject(
  value: KotaJsonValue | undefined,
): value is KotaJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireObject(
  value: KotaJsonValue,
  path: string,
): KotaJsonObject {
  if (!isJsonObject(value)) throw new Error(`Malformed JSON record at ${path}`);
  return value;
}

export function requireString(
  value: KotaJsonValue | undefined,
  path: string,
  field: string,
): string {
  const normalized = stringField(value);
  if (normalized === null) {
    throw new Error(`Malformed JSON record at ${path}: missing ${field}`);
  }
  return normalized;
}
