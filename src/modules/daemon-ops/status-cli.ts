import { Command } from "commander";
import { resolveProjectDir } from "#core/config/project-dir.js";
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
  StatusSnapshot,
} from "./status-cli-types.js";

export function buildStatusCommand(_ctx: ModuleContext): Command {
  return new Command("status")
    .description("Show a concise operational snapshot: daemon, active runs, approvals, and cost")
    .option(
      "--project <id>",
      "Scope the snapshot to one configured project (default: daemon's active project)",
    )
    .option(
      "--explain",
      "Show where each runtime verdict came from, including offline/stale state",
    )
    .action(async (opts: { project?: string; explain?: boolean }) => {
      const projectDir = resolveProjectDir();
      const snap = await gatherStatus(
        projectDir,
        opts.project ? { projectId: opts.project } : {},
      );
      print(buildStatusNode(snap, { explain: opts.explain === true }));
      if (snap.pendingApprovals > 0) process.exit(1);
    });
}
