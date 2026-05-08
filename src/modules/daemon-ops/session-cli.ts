import { Command } from "commander";
import type { DaemonLiveStatus, InteractiveSession } from "#core/daemon/daemon-control.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { getDaemonTransport } from "#core/server/daemon-transport.js";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowActiveRun } from "#core/workflow/run-types.js";

type SessionAutonomyResponse = {
  autonomy_mode?: string;
  source?: string;
  serveOwned?: boolean;
};

type SessionEntry =
  | {
      kind: "interactive";
      id: string;
      startedAt: string;
      lastActive: number;
      autonomyMode: AutonomyMode;
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

function buildStatusPath(projectId: string | undefined): string {
  return projectId ? `/status?projectId=${encodeURIComponent(projectId)}` : "/status";
}

export function buildSessionCommand(_ctx: ModuleContext): Command {
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
      const link = getDaemonTransport();
      if (!link) {
        if (opts.json) {
          console.log(JSON.stringify({ sessions: [], offline: true }));
        } else {
          console.log("Daemon is offline. No active sessions.");
        }
        return;
      }

      const status = await link.request<DaemonLiveStatus>(
        "GET",
        buildStatusPath(opts.project),
      );
      if (!status) {
        if (opts.json) {
          console.log(JSON.stringify({ sessions: [], offline: true }));
        } else {
          console.log("Daemon is offline. No active sessions.");
        }
        return;
      }

      const sessions = buildSessionList(
        status.sessions ?? [],
        status.workflow?.activeRuns ?? [],
      );

      if (opts.json) {
        console.log(JSON.stringify({ sessions }));
        return;
      }

      if (sessions.length === 0) {
        console.log("No active sessions.");
        return;
      }

      const idWidth = Math.max(...sessions.map((s) => s.id.length), 2);
      const typeWidth = 11; // "interactive".length
      const modeWidth = 10; // "supervised".length
      console.log(
        `${"ID".padEnd(idWidth)}  ${"Type".padEnd(typeWidth)}  ${"Mode".padEnd(modeWidth)}  ${"Agent/Workflow".padEnd(20)}  Started`,
      );
      console.log("-".repeat(idWidth + typeWidth + modeWidth + 44));
      for (const s of sessions) {
        const agent = s.kind === "workflow" ? s.workflow : "(interactive)";
        const mode = s.kind === "interactive" ? s.autonomyMode : "-";
        console.log(
          `${s.id.padEnd(idWidth)}  ${s.kind.padEnd(typeWidth)}  ${mode.padEnd(modeWidth)}  ${agent.padEnd(20)}  ${s.startedAt}`,
        );
      }
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
      const link = getDaemonTransport();
      if (!link) {
        console.error("Daemon is offline.");
        process.exit(1);
      }

      const status = await link.request<DaemonLiveStatus>(
        "GET",
        buildStatusPath(opts.project),
      );
      if (!status) {
        console.error("Daemon is offline.");
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
        };
        if (opts.json) {
          console.log(JSON.stringify(detail));
        } else {
          console.log(`id:            ${detail.id}`);
          console.log(`type:          interactive`);
          console.log(`autonomy mode: ${detail.autonomyMode}`);
          console.log(`started:       ${detail.startedAt}`);
          console.log(`last active:   ${detail.lastActive}`);
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
          console.log(JSON.stringify(detail));
        } else {
          console.log(`id:       ${detail.id}`);
          console.log(`type:     workflow`);
          console.log(`workflow: ${detail.workflow}`);
          console.log(`started:  ${detail.startedAt}`);
        }
        return;
      }

      console.error(`Session "${id}" not found.`);
      process.exit(1);
    });

  sessionCmd
    .command("set-mode <id> <mode>")
    .description("Change the autonomy mode (passive, supervised, autonomous) of a running session")
    .option("--json", "Output as JSON")
    .action(async (id: string, mode: string, opts: { json?: boolean }) => {
      if (!isAutonomyMode(mode)) {
        console.error(`Invalid mode "${mode}". Expected one of: passive, supervised, autonomous.`);
        process.exit(1);
      }
      const link = getDaemonTransport();
      if (!link) {
        console.error("Daemon is offline.");
        process.exit(1);
      }
      let res: Response;
      try {
        res = await link.fetchRaw(`/sessions/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autonomy_mode: mode }),
        });
      } catch {
        console.error("Failed to reach the daemon.");
        process.exit(1);
      }
      if (res.status === 404) {
        console.error(`Session "${id}" not found.`);
        process.exit(1);
      }
      if (!res.ok) {
        console.error("Failed to reach the daemon.");
        process.exit(1);
      }
      const body = (await res.json()) as SessionAutonomyResponse;
      const autonomyMode = (body.autonomy_mode ?? mode) as AutonomyMode;
      if (opts.json) {
        console.log(
          JSON.stringify({
            ok: true,
            autonomyMode,
            ...(body.source !== undefined && { source: body.source }),
            ...(body.serveOwned !== undefined && { serveOwned: body.serveOwned }),
          }),
        );
        return;
      }
      console.log(`Session ${id} autonomy mode → ${autonomyMode}`);
      if (body.source) console.log(`source: ${body.source}`);
      if (body.serveOwned) {
        console.log("note: session is owned by a kota serve process; daemon updated registration metadata only");
      }
    });

  return sessionCmd;
}
