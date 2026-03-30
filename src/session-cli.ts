import type { Command } from "commander";
import type { InteractiveSession } from "./scheduler/daemon-control.js";
import { DaemonControlClient } from "./server/daemon-client.js";
import type { WorkflowActiveRun } from "./workflow/run-types.js";

type SessionEntry =
  | { kind: "interactive"; id: string; startedAt: string; lastActive: number }
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

export function registerSessionCommands(program: Command): void {
  const sessionCmd = program
    .command("session")
    .description("Inspect active sessions tracked by the daemon");

  sessionCmd
    .command("list")
    .description("List all active sessions (interactive and workflow)")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const client = DaemonControlClient.fromStateDir();
      if (!client) {
        if (opts.json) {
          console.log(JSON.stringify({ sessions: [], offline: true }));
        } else {
          console.log("Daemon is offline. No active sessions.");
        }
        return;
      }

      const status = await client.getDaemonStatus();
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
      console.log(`${"ID".padEnd(idWidth)}  ${"Type".padEnd(typeWidth)}  ${"Agent/Workflow".padEnd(20)}  Started`);
      console.log("-".repeat(idWidth + typeWidth + 40));
      for (const s of sessions) {
        const agent = s.kind === "workflow" ? s.workflow : "(interactive)";
        console.log(
          `${s.id.padEnd(idWidth)}  ${s.kind.padEnd(typeWidth)}  ${agent.padEnd(20)}  ${s.startedAt}`,
        );
      }
    });

  sessionCmd
    .command("inspect <id>")
    .description("Show detail for a single active session")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const client = DaemonControlClient.fromStateDir();
      if (!client) {
        console.error("Daemon is offline.");
        process.exit(1);
      }

      const status = await client.getDaemonStatus();
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
        };
        if (opts.json) {
          console.log(JSON.stringify(detail));
        } else {
          console.log(`id:          ${detail.id}`);
          console.log(`type:        interactive`);
          console.log(`started:     ${detail.startedAt}`);
          console.log(`last active: ${detail.lastActive}`);
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
}
