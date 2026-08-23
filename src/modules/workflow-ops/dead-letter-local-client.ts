import { deadLetterStoreForProject } from "#core/daemon/dead-letter-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { buildDeadLetterWorkflowTrigger } from "#core/workflow/dead-letter-redrive.js";
import { formatRunId } from "#core/workflow/run-io.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowClient } from "./client.js";
import { getValidatedWorkflowDefinitions } from "./definitions-source.js";
import { eventJournalForProject } from "./utils.js";

type LocalDeadLetterClient = Pick<
  WorkflowClient,
  | "listDeadLetters"
  | "getDeadLetter"
  | "dismissDeadLetter"
  | "redriveDeadLetter"
  | "exportDeadLetterDiagnostics"
>;

export function buildLocalDeadLetterClient(
  ctx: ModuleContext,
): LocalDeadLetterClient {
  return {
    async listDeadLetters(filter) {
      const store = deadLetterStoreForProject(ctx.cwd);
      return {
        items: store.list({
          status: filter?.status,
          type: filter?.type,
          workflowName: filter?.workflow,
          limit: filter?.limit,
        }),
        counts: store.counts(),
      };
    },
    async getDeadLetter(id) {
      const item = deadLetterStoreForProject(ctx.cwd).get(id);
      return item ? { found: true, item } : { found: false };
    },
    async dismissDeadLetter(id, reason) {
      const item = deadLetterStoreForProject(ctx.cwd).dismiss(id, reason);
      return item ? { ok: true, item } : { ok: false, reason: "not_found" };
    },
    async redriveDeadLetter(id, options) {
      const dlq = deadLetterStoreForProject(ctx.cwd);
      const item = dlq.get(id);
      if (!item) return { ok: false, reason: "not_found" };
      if (item.status !== "open") {
        dlq.recordRedriveAttempt(id, {
          target: options.target,
          reason: options.reason,
          result: {
            status: "failed",
            message: `dead-letter item is ${item.status}`,
          },
        });
        return { ok: false, reason: "not_redrivable" };
      }
      if (options.target === "simulation") {
        const updated = dlq.recordRedriveAttempt(id, {
          target: options.target,
          reason: options.reason,
          result: { status: "simulated" },
        });
        return updated ? { ok: true, item: updated } : { ok: false, reason: "not_found" };
      }
      if (item.redrive.kind !== "workflow") {
        dlq.recordRedriveAttempt(id, {
          target: options.target,
          reason: options.reason,
          result: {
            status: "failed",
            message:
              item.redrive.kind === "none"
                ? item.redrive.reason
                : "event redrive requires a running daemon",
          },
        });
        return { ok: false, reason: "not_redrivable" };
      }
      const definitions = getValidatedWorkflowDefinitions(ctx);
      const redrive = item.redrive;
      const definition = definitions.find((candidate) => candidate.name === redrive.workflowName);
      if (!definition?.enabled) {
        dlq.recordRedriveAttempt(id, {
          target: options.target,
          reason: options.reason,
          result: {
            status: "failed",
            message: `workflow "${redrive.workflowName}" is not available`,
          },
        });
        return { ok: false, reason: "unknown_workflow" };
      }
      const runStore = new WorkflowRunStore(ctx.cwd);
      const eventJournal = eventJournalForProject(ctx.cwd);
      const state = runStore.readState();
      const now = Date.now();
      const runId = formatRunId(redrive.workflowName);
      const resolved = buildDeadLetterWorkflowTrigger(item, redrive, {
        runStore,
        eventJournal,
        runId,
        reason: options.reason,
        nowMs: now,
      });
      if (!resolved.ok) {
        dlq.recordRedriveAttempt(id, {
          target: options.target,
          reason: options.reason,
          result: { status: "failed", message: resolved.message },
        });
        return { ok: false, reason: "not_redrivable" };
      }
      runStore.setPendingRuns([
        ...state.pendingRuns,
        {
          runId,
          workflowName: redrive.workflowName,
          trigger: resolved.value,
          enqueuedAtMs: now,
          notBeforeMs: now,
        },
      ]);
      const updated = dlq.recordRedriveAttempt(id, {
        target: options.target,
        reason: options.reason,
        result: {
          status: "queued",
          runId,
          workflowName: redrive.workflowName,
        },
      });
      return updated
        ? { ok: true, item: updated, runId, workflowName: redrive.workflowName }
        : { ok: false, reason: "not_found" };
    },
    async exportDeadLetterDiagnostics(id) {
      return deadLetterStoreForProject(ctx.cwd).diagnostics(id);
    },
  };
}
