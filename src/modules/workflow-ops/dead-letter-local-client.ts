import { deadLetterStoreForProject } from "#core/daemon/dead-letter-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { WorkflowClient } from "./client.js";

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
      if (item.redrive.kind === "none") {
        dlq.recordRedriveAttempt(id, {
          target: options.target,
          reason: options.reason,
          result: {
            status: "failed",
            message: item.redrive.reason,
          },
        });
        return { ok: false, reason: "not_redrivable" };
      }
      return { ok: false, reason: "daemon_required" };
    },
    async exportDeadLetterDiagnostics(id) {
      return deadLetterStoreForProject(ctx.cwd).diagnostics(id);
    },
  };
}
