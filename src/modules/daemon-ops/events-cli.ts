import { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { getDaemonTransport } from "#core/server/daemon-transport.js";

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

/**
 * Resolve the project the events stream filters on. Returns:
 *  - the explicit `--project` value when provided (validated to be a
 *    configured id or `null` to opt into cross-project listing),
 *  - the daemon's currently active selection when no flag is set, or
 *  - `null` when the daemon hosts a single project (no filter needed).
 *
 * `--all-projects` opts into cross-project listing explicitly. The
 * combined flag set rejects `--project` + `--all-projects`.
 */
async function resolveEventsProjectFilter(
  ctx: ModuleContext,
  opts: { project?: string; allProjects?: boolean },
): Promise<{ ok: true; projectId: string | null } | { ok: false; message: string }> {
  if (opts.project && opts.allProjects) {
    return { ok: false, message: "--project and --all-projects are mutually exclusive." };
  }
  if (opts.allProjects) return { ok: true, projectId: null };
  const view = await ctx.client.projects.list();
  if (!view.ok) {
    if (opts.project) return { ok: true, projectId: opts.project };
    return { ok: true, projectId: null };
  }
  if (opts.project) {
    if (!view.projects.some((p) => p.projectId === opts.project)) {
      return { ok: false, message: `Unknown project: "${opts.project}".` };
    }
    return { ok: true, projectId: opts.project };
  }
  if (view.projects.length <= 1) return { ok: true, projectId: null };
  const fallback = view.activeProjectId ?? view.defaultProjectId;
  return { ok: true, projectId: fallback };
}

/**
 * Read an optional `projectId` field from any event-bus payload. The
 * SSE union and the `/api/events` ring-buffer response both carry
 * heterogeneous payload shapes; payloads that genuinely don't scope to a
 * project just don't expose the field, and the helper returns
 * `undefined` so the caller treats the event as cross-project.
 */
function readEventProjectId(payload: object): string | undefined {
  if ("projectId" in payload && typeof payload.projectId === "string") {
    return payload.projectId;
  }
  return undefined;
}

function eventMatchesProject(payload: object, projectId: string | null): boolean {
  if (projectId === null) return true;
  const carried = readEventProjectId(payload);
  if (carried === undefined) return true;
  return carried === projectId;
}

export function buildEventsCommand(ctx: ModuleContext): Command {
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
    .option(
      "--project <id>",
      "Filter to one configured project (default: daemon's active project)",
    )
    .option("--all-projects", "Stream events from every configured project (opt-in)")
    .action(async (opts: { json?: boolean; filter?: string; project?: string; allProjects?: boolean }) => {
      const link = getDaemonTransport();
      if (!link) {
        console.error("Daemon is not running. Start the daemon with `kota daemon start`.");
        process.exit(1);
      }

      const filter = await resolveEventsProjectFilter(ctx, opts);
      if (!filter.ok) {
        console.error(filter.message);
        process.exit(1);
      }

      let done = false;
      process.once("SIGINT", () => {
        done = true;
      });

      for await (const event of link.events()) {
        if (done) break;
        if (opts.filter && !event.type.startsWith(opts.filter)) continue;
        if (!eventMatchesProject(event.payload, filter.projectId)) continue;

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

  cmd
    .command("query")
    .description(
      "Query recent buffered events from the daemon ring buffer.\n" +
      "  Unlike 'tail', this returns historical events and exits.",
    )
    .option("--type <pattern>", "Filter by event type (prefix match, or glob with *)")
    .option("--since <duration>", "Only events within the last duration (e.g. 5m, 1h, 30s)")
    .option("--limit <n>", "Maximum number of events to return", "50")
    .option("--json", "Output raw NDJSON for scripting")
    .option(
      "--project <id>",
      "Filter to one configured project (default: daemon's active project)",
    )
    .option("--all-projects", "Include events from every configured project (opt-in)")
    .action(async (opts: { type?: string; since?: string; limit: string; json?: boolean; project?: string; allProjects?: boolean }) => {
      const link = getDaemonTransport();
      if (!link) {
        console.error("Daemon is not running. Start the daemon with `kota daemon start`.");
        process.exitCode = 1;
        return;
      }

      const filter = await resolveEventsProjectFilter(ctx, opts);
      if (!filter.ok) {
        console.error(filter.message);
        process.exitCode = 1;
        return;
      }

      let sinceIso: string | undefined;
      if (opts.since) {
        const ms = parseDuration(opts.since);
        if (ms == null) {
          console.error(`Invalid duration: ${opts.since}. Use e.g. 5m, 1h, 30s.`);
          process.exitCode = 1;
          return;
        }
        sinceIso = new Date(Date.now() - ms).toISOString();
      }

      const limit = parseInt(opts.limit, 10);
      const params = new URLSearchParams();
      if (opts.type) params.set("type", opts.type);
      if (sinceIso) params.set("since", sinceIso);
      params.set("limit", String(Number.isNaN(limit) ? 50 : limit));
      const result = await link.request<{
        events: Array<{ type: string; payload: Record<string, unknown>; timestamp: string }>;
      }>("GET", `/api/events?${params.toString()}`);

      if (!result) {
        console.error("Failed to query events from daemon.");
        process.exitCode = 1;
        return;
      }

      const filtered = result.events.filter((ev) => eventMatchesProject(ev.payload, filter.projectId));
      if (filtered.length === 0) {
        if (!opts.json) console.log("No matching events.");
        return;
      }

      for (const ev of filtered) {
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(ev)}\n`);
        } else {
          const ts = ev.timestamp.replace("T", " ").replace("Z", "");
          const summary = formatEventSummary(ev.type, ev.payload);
          console.log(`${ts}  ${ev.type.padEnd(32)}  ${summary}`);
        }
      }
    });

  return cmd;
}

function parseDuration(input: string): number | undefined {
  const match = input.match(/^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|hour)s?$/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "s" || unit === "sec") return value * 1000;
  if (unit === "m" || unit === "min") return value * 60_000;
  if (unit === "h" || unit === "hr" || unit === "hour") return value * 3_600_000;
  return undefined;
}
