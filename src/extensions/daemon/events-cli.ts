import { Command } from "commander";
import { DaemonControlClient } from "../../server/daemon-client.js";

function formatEventSummary(type: string, payload: Record<string, unknown>): string {
  if (type.startsWith("workflow.")) {
    const parts: string[] = [];
    if (payload.workflow) parts.push(String(payload.workflow));
    if (payload.runId) parts.push(String(payload.runId));
    if (payload.status) parts.push(String(payload.status));
    if (payload.stepId) parts.push(`step:${String(payload.stepId)}`);
    return parts.join(" ");
  }
  if (type === "approval.changed") {
    const id = payload.id ? String(payload.id) : "";
    const status = payload.status ? String(payload.status) : "";
    return [id, status].filter(Boolean).join(" ");
  }
  if (type === "task.changed" || type === "queue.changed") {
    return payload.id ? String(payload.id) : "";
  }
  if (type.startsWith("session.")) {
    return payload.sessionId ? String(payload.sessionId) : "";
  }
  const first = Object.values(payload)[0];
  return first != null ? String(first) : "";
}

export function buildEventsCommand(): Command {
  const cmd = new Command("events")
    .description("Inspect the daemon event bus");

  cmd
    .command("tail")
    .description(
      "Stream live events from the daemon event bus.\n" +
      "  Ctrl-C exits cleanly.",
    )
    .option("--json", "Emit raw NDJSON instead of formatted output")
    .option("--filter <prefix>", "Show only events whose type starts with <prefix>")
    .action(async (opts: { json?: boolean; filter?: string }) => {
      const client = DaemonControlClient.fromStateDir();
      if (!client) {
        console.error("Daemon is not running. Start the daemon with `kota daemon start`.");
        process.exit(1);
      }

      let done = false;
      process.once("SIGINT", () => {
        done = true;
      });

      for await (const event of client.events()) {
        if (done) break;
        if (opts.filter && !event.type.startsWith(opts.filter)) continue;

        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ type: event.type, payload: event.payload })}\n`);
        } else {
          const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
          const summary = formatEventSummary(event.type, event.payload);
          console.log(`${ts}  ${event.type.padEnd(32)}  ${summary}`);
        }
      }

      if (!done) {
        console.error("Daemon disconnected.");
        process.exit(1);
      }
    });

  return cmd;
}
