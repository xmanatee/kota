import { join } from "node:path";
import { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { writeJson, writeStdoutLine } from "#modules/rendering/transport.js";
import { collectAstArchitectureObservations } from "./ast-provider.js";
import { buildArchitectureGardenerStatus, formatGardenerStatusTerminal } from "./status.js";
import { ARCHITECTURE_REVIEW_REQUESTED_EVENT } from "./workflow.js";

export function buildArchitectureGardenerCommand(ctx: ModuleContext): Command {
  const cmd = new Command("architecture")
    .alias("gardener")
    .description("Continuous architectural simplification, fitness functions, and generated work");

  cmd
    .command("status")
    .description("Show operator-readable status of architecture observations and candidates")
    .option("--json", "Output machine-readable JSON format")
    .action(async (opts: { json?: boolean }) => {
      const repoRoot = ctx.cwd;
      const stateDir = join(ctx.cwd, ".kota");
      const observations = collectAstArchitectureObservations(repoRoot);
      const status = buildArchitectureGardenerStatus({
        repoRoot,
        stateDir,
        currentObservations: observations,
      });

      if (opts.json) {
        writeJson(status, { pretty: true });
      } else {
        writeStdoutLine(formatGardenerStatusTerminal(status));
      }
    });

  cmd
    .command("scan")
    .description("Run deterministic AST architecture observations scan")
    .option("--json", "Output machine-readable JSON format")
    .action(async (opts: { json?: boolean }) => {
      const repoRoot = ctx.cwd;
      const observations = collectAstArchitectureObservations(repoRoot);

      if (opts.json) {
        writeJson({ observations }, { pretty: true });
      } else {
        writeStdoutLine("Scanned repository for architectural observations.");
        writeStdoutLine(`Total observations: ${observations.length}`);
        writeStdoutLine("");
        for (const obs of observations) {
          writeStdoutLine(`* [${obs.kind}] ${obs.targetScope}: ${obs.summary}`);
        }
      }
    });

  cmd
    .command("review [target]")
    .description("Request an architectural simplification review for a target scope")
    .option("-r, --reason <reason>", "Reason for requesting architectural review")
    .option("--json", "Output machine-readable JSON format")
    .action(async (target: string | undefined, opts: { reason?: string; json?: boolean }) => {
      const targetScope = target ?? "repo";
      const reason = opts.reason ?? "Manual operator request";

      ctx.events.emitExternal(ARCHITECTURE_REVIEW_REQUESTED_EVENT, {
        targetScope,
        reason,
        requestedAt: new Date().toISOString(),
      });

      const response = {
        ok: true,
        message: `Architectural simplification review requested for "${targetScope}".`,
        targetScope,
        reason,
      };

      if (opts.json) {
        writeJson(response, { pretty: true });
      } else {
        writeStdoutLine(response.message);
      }
    });

  return cmd;
}
