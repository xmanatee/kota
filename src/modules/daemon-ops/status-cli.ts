import { Command } from "commander";
import { resolveScopeRoot } from "#core/config/scope-root.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { print } from "#modules/rendering/transport.js";
import { gatherStatus } from "./status-cli-gather.js";
import { buildStatusNode } from "./status-cli-render.js";

export {
  classifyDaemonControlFile,
  gatherStatus,
} from "./status-cli-gather.js";
export {
  buildStatusNode,
  formatStatusOutput,
  resolveDashboardForStatus,
} from "./status-cli-render.js";
export type {
  DaemonControlIdentity,
  StatusDashboard,
  StatusOperationalRun,
  StatusRunProjection,
  StatusRunSandbox,
  StatusSnapshot,
  StatusWorkspaceEvidence,
} from "./status-cli-types.js";

export function buildStatusCommand(_ctx: ModuleContext): Command {
  return new Command("status")
    .description("Show a concise operational snapshot: daemon, active runs, approvals, and cost")
    .option(
      "--scope <id>",
      "Scope the snapshot to one configured scope (default: daemon's active scope)",
    )
    .option(
      "--explain",
      "Show where each runtime verdict came from, including offline/stale state",
    )
    .action(async (opts: { scope?: string; explain?: boolean }) => {
      const scopeRoot = resolveScopeRoot();
      const snap = await gatherStatus(scopeRoot, {
        ...(opts.scope ? { scopeId: opts.scope } : {}),
      });
      print(buildStatusNode(snap, { explain: opts.explain === true }));
      if (snap.pendingApprovals > 0) process.exit(1);
    });
}
