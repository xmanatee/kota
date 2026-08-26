import { createHash } from "node:crypto";
import type { EventJsonObject } from "#core/events/event-journal.js";
import {
  evidenceRetentionScopeForScopeId,
  projectEvidenceJsonObject,
  redactSensitiveText,
  resolveEvidenceRetention,
} from "#core/evidence/policy.js";
import type {
  DeadLetterBatchRedrivePayload,
  DeadLetterItem,
  DeadLetterQueueRecordInput,
  DeadLetterRedriveAttempt,
  DeadLetterRedriveSource,
  DeadLetterRetentionPolicy,
  DeadLetterSource,
  DeadLetterWorkflowRedriveSource,
} from "./dead-letter-queue.js";

export function toEventJsonObject(value: object): EventJsonObject {
  return JSON.parse(JSON.stringify(value)) as EventJsonObject;
}

export function resolveDeadLetterRetention(
  retention: DeadLetterQueueRecordInput["retention"],
  now: Date,
  scopeId: string,
  state: "open" | "closed",
): DeadLetterRetentionPolicy {
  if (retention?.kind === "retain") return retention;
  const policy = retention ?? resolveDeadLetterPolicyRetention(scopeId, state, now);
  if (policy.kind === "retain") return policy;
  return {
    ...policy,
    expiresAt: new Date(now.getTime() + policy.durationMs).toISOString(),
  };
}

export function resolveClosedDeadLetterRetention(
  item: DeadLetterItem,
  now: Date,
): DeadLetterRetentionPolicy {
  if (item.retention.kind === "retain") return item.retention;
  return resolveDeadLetterRetention(undefined, now, item.scopeId, "closed");
}

function resolveDeadLetterPolicyRetention(
  scopeId: string,
  state: "open" | "closed",
  now: Date,
): { kind: "retain" } | { kind: "expire-after-ms"; durationMs: number } {
  const resolved = resolveEvidenceRetention({
    artifactType: "dead-letter-item",
    state,
    scope: evidenceRetentionScopeForScopeId(scopeId),
    retainedFrom: now,
  });
  if (resolved.kind === "retain") return { kind: "retain" };
  return { kind: "expire-after-ms", durationMs: resolved.durationMs };
}

export function redactDeadLetterJson(value: EventJsonObject): EventJsonObject {
  return projectEvidenceJsonObject(value, "internal-storage");
}

export function sanitizeDeadLetterSource(source: DeadLetterSource): DeadLetterSource {
  switch (source.kind) {
    case "workflow-dispatch":
      return {
        ...source,
        ...(source.runDir !== undefined
          ? { runDir: redactSensitiveText(source.runDir) }
          : {}),
      };
    case "batch-envelope":
      return {
        ...source,
        sourceEventName: redactSensitiveText(source.sourceEventName),
        groupingKey: redactSensitiveText(source.groupingKey),
      };
    case "event-envelope":
      return {
        ...source,
        eventName: redactSensitiveText(source.eventName),
      };
    case "confirmed-action-dispatch":
      return source;
  }
}

export function sanitizeDeadLetterRedriveSource(
  redrive: DeadLetterRedriveSource,
): DeadLetterRedriveSource {
  switch (redrive.kind) {
    case "workflow":
      return {
        ...redrive,
        source: sanitizeDeadLetterWorkflowRedriveSource(redrive.source),
      };
    case "event":
      return redrive;
    case "none":
      return {
        ...redrive,
        reason: redactSensitiveText(redrive.reason),
      };
  }
}

function sanitizeDeadLetterWorkflowRedriveSource(
  source: DeadLetterWorkflowRedriveSource,
): DeadLetterWorkflowRedriveSource {
  switch (source.kind) {
    case "run-trigger":
    case "event-journal":
    case "resume-step":
      return source;
    case "batch-event-journal":
      return {
        ...source,
        triggerEvent: redactSensitiveText(source.triggerEvent),
        payload: sanitizeDeadLetterBatchRedrivePayload(source.payload),
      };
  }
}

function sanitizeDeadLetterBatchRedrivePayload(
  payload: DeadLetterBatchRedrivePayload,
): DeadLetterBatchRedrivePayload {
  return {
    ...payload,
    sourceEventName: redactSensitiveText(payload.sourceEventName),
    groupingKey: redactSensitiveText(payload.groupingKey),
    inputEvents: payload.inputEvents.map((event) => ({
      ...event,
      event: redactSensitiveText(event.event),
    })),
  };
}

export function sanitizeDeadLetterRedriveAttempt(
  attempt: DeadLetterRedriveAttempt,
): DeadLetterRedriveAttempt {
  const reason = redactSensitiveText(attempt.reason);
  switch (attempt.result.status) {
    case "queued":
      return {
        target: attempt.target,
        reason,
        attemptedAt: attempt.attemptedAt,
        result: {
          status: "queued",
          runId: attempt.result.runId,
          workflowName: attempt.result.workflowName,
        },
      };
    case "emitted":
      return {
        target: attempt.target,
        reason,
        attemptedAt: attempt.attemptedAt,
        result: { status: "emitted", event: attempt.result.event },
      };
    case "simulated":
      return {
        target: attempt.target,
        reason,
        attemptedAt: attempt.attemptedAt,
        result: { status: "simulated" },
      };
    case "failed":
      return {
        target: attempt.target,
        reason,
        attemptedAt: attempt.attemptedAt,
        result: {
          status: "failed",
          message: redactSensitiveText(attempt.result.message),
        },
      };
  }
}

export function deadLetterDigest(value: EventJsonObject): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
