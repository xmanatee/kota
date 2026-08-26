import { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { print, writeJson } from "#modules/rendering/transport.js";
import { buildOperatorInboxSnapshot } from "./operator-inbox.js";
import { buildOperatorInboxNode } from "./operator-inbox-render.js";

function parseLimit(value: string | undefined): number {
  if (!value) return 20;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20;
}

export function buildInboxCommand(ctx: ModuleContext): Command {
  return new Command("inbox")
    .description("Show one operator inbox for approvals, owner questions, blocked tasks, setup gaps, failed runs, and runtime warnings")
    .option(
      "--scope <id>",
      "Scope the inbox to one configured scope (default: daemon's active scope)",
    )
    .option("-n, --limit <n>", "Maximum items to read from each source", "20")
    .option("--json", "Emit the structured inbox projection as JSON")
    .action(async (opts: { scope?: string; limit?: string; json?: boolean }) => {
      const snapshot = await buildOperatorInboxSnapshot({
        client: ctx.client,
        scopeRoot: ctx.cwd,
        scopeId: opts.scope,
        limit: parseLimit(opts.limit),
      });
      if (opts.json === true) {
        writeJson(snapshot, { pretty: true });
        return;
      }
      print(buildOperatorInboxNode(snapshot));
      if (snapshot.items.some((item) => item.kind === "approval" || item.kind === "owner-question")) {
        process.exitCode = 1;
      }
    });
}
