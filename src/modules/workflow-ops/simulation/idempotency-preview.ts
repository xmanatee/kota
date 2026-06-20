import { existsSync } from "node:fs";
import { join } from "node:path";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { workflowDispatchIdempotency } from "#core/workflow/workflow-idempotency.js";
import type {
  AutomationBlocker,
  AutomationExplainReason,
  AutomationExplainResult,
} from "../graph/index.js";
import {
  defaultScopeIdForEvent,
  type SimulationEvent,
  workflowRunTriggerForEvent,
} from "./events.js";

export type DispatchIdempotencyPreview = {
  blocker?: AutomationBlocker;
  reason?: AutomationExplainReason;
};

function idempotencyStoreForProject(
  projectDir: string,
  event: SimulationEvent,
): IdempotencyStore | null {
  const dir = join(projectDir, ".kota", "idempotency");
  if (!existsSync(dir)) return null;
  return new IdempotencyStore(dir, defaultScopeIdForEvent(event));
}

function expiredAt(expiresAt: string | undefined): boolean {
  return expiresAt !== undefined && Date.parse(expiresAt) <= Date.now();
}

function dispatchIdempotencyPreview(
  store: IdempotencyStore,
  workflow: string,
  event: SimulationEvent,
): DispatchIdempotencyPreview | null {
  const identity = workflowDispatchIdempotency(
    store,
    workflow,
    workflowRunTriggerForEvent(event),
  );
  if (!identity) return null;

  const entry = store.get(identity.scopeId, "workflow-dispatch", identity.key);
  if (!entry || entry.status === "expired") return null;

  const messagePrefix = `workflow dispatch idempotency key ${identity.key}`;
  if (expiredAt(entry.expiresAt)) {
    return {
      blocker: {
        kind: "idempotency",
        workflow,
        event: event.event,
        reason: `${messagePrefix} is expired`,
      },
      reason: {
        code: "idempotency-expired",
        severity: "blocker",
        workflow,
        event: event.event,
        message: `${messagePrefix} is expired`,
      },
    };
  }

  if (entry.parameterFingerprint !== identity.parameterFingerprint) {
    return {
      blocker: {
        kind: "idempotency",
        workflow,
        event: event.event,
        reason: `${messagePrefix} was reused with different dispatch parameters`,
      },
      reason: {
        code: "idempotency-rejected",
        severity: "blocker",
        workflow,
        event: event.event,
        message: `${messagePrefix} was reused with different dispatch parameters`,
      },
    };
  }

  if (entry.firstResult !== undefined) {
    return {
      reason: {
        code: "idempotency-duplicate",
        severity: "info",
        workflow,
        event: event.event,
        message: `${messagePrefix} would replay the first workflow dispatch`,
      },
    };
  }

  return {
    reason: {
      code: "idempotency-duplicate",
      severity: "info",
      workflow,
      event: event.event,
      message: `${messagePrefix} is already in progress`,
    },
  };
}

export function idempotencyPreviews(
  projectDir: string,
  event: SimulationEvent,
  explain: AutomationExplainResult,
): DispatchIdempotencyPreview[] {
  const store = idempotencyStoreForProject(projectDir, event);
  if (!store) return [];
  return explain.matches.flatMap((match) => {
    const preview = dispatchIdempotencyPreview(store, match.workflow, event);
    return preview ? [preview] : [];
  });
}

export function idempotencyDuplicatePresent(
  previews: readonly DispatchIdempotencyPreview[],
): boolean {
  return previews.some((preview) =>
    preview.reason?.code === "idempotency-duplicate" && preview.blocker === undefined
  );
}
