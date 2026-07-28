import { Command } from "commander";
import type { DaemonLiveStatus, InteractiveSession } from "#core/daemon/daemon-control.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowActiveRun } from "#core/workflow/run-types.js";
import { columns, kvBlock, line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print, printToStderr, writeJson } from "#modules/rendering/transport.js";

type SessionEntry =
  | {
      kind: "interactive";
      id: string;
      startedAt: string;
      lastActive: number;
      autonomyMode: AutonomyMode;
      guardrailsSnapshotId: string | null;
    }
  | { kind: "workflow"; id: string; workflow: string; startedAt: string };

function buildSessionList(
  interactive: InteractiveSession[],
  activeRuns: WorkflowActiveRun[],
): SessionEntry[] {
  const entries: SessionEntry[] = [
    ...interactive.map((s) => ({
      kind: "interactive" as const,
      id: s.id,
      startedAt: s.createdAt,
      lastActive: s.lastActive,
      autonomyMode: s.autonomyMode,
      guardrailsSnapshotId: s.guardrailsSnapshot?.id ?? null,
    })),
    ...activeRuns.map((r) => ({
      kind: "workflow" as const,
      id: r.runId,
      workflow: r.workflow,
      startedAt: r.startedAt,
    })),
  ];
  return entries.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function printSessionError(message: string): void {
  printToStderr(line(span(message, "error")));
}

async function readSessionStatus(
  ctx: ModuleContext,
  projectId: string | undefined,
): Promise<DaemonLiveStatus | null> {
  const result = await ctx.client.daemonOps.status(
    projectId ? { projectId } : undefined,
  );
  return result.state === "running" ? result.status : null;
}

export function buildSessionCommand(ctx: ModuleContext): Command {
  const sessionCmd = new Command("session")
    .description("Inspect active sessions tracked by the daemon");

  sessionCmd
    .command("list")
    .description("List all active sessions (interactive and workflow)")
    .option("--json", "Output as JSON")
    .option(
      "--project <id>",
      "Filter to one configured project (default: daemon's active project)",
    )
    .action(async (opts: { json?: boolean; project?: string }) => {
      const status = await readSessionStatus(ctx, opts.project);
      if (!status) {
        if (opts.json) {
          writeJson({ sessions: [], offline: true });
        } else {
          print(line(plain("Daemon is offline. No active sessions.")));
        }
        return;
      }

      const sessions = buildSessionList(
        status.sessions ?? [],
        status.workflow?.activeRuns ?? [],
      );

      if (opts.json) {
        writeJson({ sessions });
        return;
      }

      if (sessions.length === 0) {
        print(line(plain("No active sessions.")));
        return;
      }

      print(columns(
        [
          { header: "ID", role: "accent", maxWidth: 28 },
          { header: "Type", minWidth: 11 },
          { header: "Mode", minWidth: 10 },
          { header: "Agent/Workflow", maxWidth: 24 },
          { header: "Started", role: "muted", maxWidth: 30 },
        ],
        sessions.map((s) => {
          const agent = s.kind === "workflow" ? s.workflow : "(interactive)";
          const mode = s.kind === "interactive" ? s.autonomyMode : "-";
          return {
            cells: [
              { spans: [span(s.id, "accent")] },
              { spans: [plain(s.kind)] },
              { spans: [span(mode, s.kind === "interactive" ? "info" : "muted")] },
              { spans: [span(agent, s.kind === "workflow" ? "tool" : "muted")] },
              { spans: [span(s.startedAt, "muted")] },
            ],
          };
        }),
      ));
    });

  sessionCmd
    .command("inspect <id>")
    .description("Show detail for a single active session")
    .option("--json", "Output as JSON")
    .option(
      "--project <id>",
      "Look up the session in one configured project (default: daemon's active project)",
    )
    .action(async (id: string, opts: { json?: boolean; project?: string }) => {
      const status = await readSessionStatus(ctx, opts.project);
      if (!status) {
        printSessionError("Daemon is offline.");
        process.exit(1);
      }

      const interactive = (status.sessions ?? []).find((s) => s.id === id);
      if (interactive) {
        const detail = {
          id: interactive.id,
          kind: "interactive",
          startedAt: interactive.createdAt,
          lastActive: new Date(interactive.lastActive).toISOString(),
          autonomyMode: interactive.autonomyMode,
          guardrailsSnapshot: interactive.guardrailsSnapshot ?? null,
        };
        if (opts.json) {
          writeJson(detail);
        } else {
          print(kvBlock([
            { label: "ID", value: detail.id, role: "accent" },
            { label: "Type", value: "interactive", role: "info" },
            { label: "Autonomy mode", value: detail.autonomyMode, role: "info" },
            { label: "Guardrails", value: detail.guardrailsSnapshot?.id ?? "(not refreshable)", role: "muted" },
            { label: "Started", value: detail.startedAt, role: "muted" },
            { label: "Last active", value: detail.lastActive, role: "muted" },
          ]));
        }
        return;
      }

      const run = (status.workflow?.activeRuns ?? []).find((r) => r.runId === id);
      if (run) {
        const detail = {
          id: run.runId,
          kind: "workflow",
          workflow: run.workflow,
          startedAt: run.startedAt,
        };
        if (opts.json) {
          writeJson(detail);
        } else {
          print(kvBlock([
            { label: "ID", value: detail.id, role: "accent" },
            { label: "Type", value: "workflow", role: "tool" },
            { label: "Workflow", value: detail.workflow, role: "tool" },
            { label: "Started", value: detail.startedAt, role: "muted" },
          ]));
        }
        return;
      }

      printSessionError(`Session "${id}" not found.`);
      process.exit(1);
    });

  sessionCmd
    .command("set-mode <id> <mode>")
    .description("Change the autonomy mode (passive, supervised, autonomous) of a running session")
    .option("--json", "Output as JSON")
    .action(async (id: string, mode: string, opts: { json?: boolean }) => {
      if (!isAutonomyMode(mode)) {
        printSessionError(`Invalid mode "${mode}". Expected one of: passive, supervised, autonomous.`);
        process.exit(1);
      }
      const result = await ctx.client.sessions.setAutonomyMode(id, mode);
      if (!result.ok && result.reason === "daemon_required") {
        printSessionError("Failed to reach the daemon.");
        process.exit(1);
      }
      if (!result.ok) {
        printSessionError(`Session "${id}" not found.`);
        process.exit(1);
      }
      if (opts.json) {
        writeJson({
          ok: true,
          autonomyMode: result.autonomyMode,
          source: result.source,
          serveOwned: result.serveOwned,
        });
        return;
      }
      print(line(
        plain("Session "),
        span(id, "accent"),
        plain(" autonomy mode → "),
        span(result.autonomyMode, "success"),
      ));
      print(line(plain("source: "), span(result.source, "muted")));
      if (result.serveOwned) {
        print(stack(line(span("note: session is owned by a kota serve process; daemon updated registration metadata only", "muted"))));
      }
    });

  return sessionCmd;
}
