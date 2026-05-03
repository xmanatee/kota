/**
 * `kota retract --target <store> --id|--slug|--path <ident>` —
 * remove or supersede one prior cross-store record.
 *
 * The subcommand consumes `ctx.client.retract.retract` so daemon-up and
 * daemon-down callers share the same code path. Output renders through
 * the rendering module's terminal transport; `--json` keeps the
 * structured `RetractResult` envelope for consumers that want to parse
 * it.
 *
 * Argument shape is target-specific and validated up front so ambiguous
 * combinations fail at parse time rather than at the seam:
 *
 * - `--target memory   --id <memory-id>`
 * - `--target knowledge --slug <knowledge-slug>`
 * - `--target tasks    --id <task-id>`
 * - `--target inbox    --path <repo-relative-inbox-path>`
 */
import type { Command } from "commander";
import { ensureCliProvidersFor } from "#core/modules/cli-providers.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { line, plain, span } from "#modules/rendering/primitives.js";
import { print, TerminalTransport } from "#modules/rendering/transport.js";
import type { RetractRequest, RetractTarget } from "./client.js";
import { renderRetractResultPlain } from "./render.js";
import { RETRACT_TARGET_ORDER } from "./retract-types.js";

let stderrRenderer: TerminalTransport | null = null;
function stderrTransport(): TerminalTransport {
  if (!stderrRenderer) {
    stderrRenderer = new TerminalTransport({ stream: process.stderr });
  }
  return stderrRenderer;
}

function failUsage(message: string): never {
  stderrTransport().write(line(span(message, "warn")));
  process.exit(1);
}

function parseTarget(value: string): RetractTarget {
  if (!(RETRACT_TARGET_ORDER as readonly string[]).includes(value)) {
    failUsage(
      `Unknown target "${value}". Valid: ${RETRACT_TARGET_ORDER.join(", ")}`,
    );
  }
  return value as RetractTarget;
}

function buildRequest(opts: {
  target: RetractTarget;
  id?: string;
  slug?: string;
  path?: string;
}): RetractRequest {
  switch (opts.target) {
    case "memory": {
      if (opts.slug !== undefined || opts.path !== undefined)
        failUsage("memory retract takes --id only (no --slug / --path).");
      const id = opts.id ?? "";
      if (id === "") failUsage("memory retract requires --id <memory-id>.");
      return { target: "memory", id };
    }
    case "knowledge": {
      if (opts.id !== undefined || opts.path !== undefined)
        failUsage("knowledge retract takes --slug only (no --id / --path).");
      const slug = opts.slug ?? "";
      if (slug === "")
        failUsage("knowledge retract requires --slug <knowledge-slug>.");
      return { target: "knowledge", slug };
    }
    case "tasks": {
      if (opts.slug !== undefined || opts.path !== undefined)
        failUsage("tasks retract takes --id only (no --slug / --path).");
      const id = opts.id ?? "";
      if (id === "") failUsage("tasks retract requires --id <task-id>.");
      return { target: "tasks", id };
    }
    case "inbox": {
      if (opts.id !== undefined || opts.slug !== undefined)
        failUsage("inbox retract takes --path only (no --id / --slug).");
      const path = opts.path ?? "";
      if (path === "")
        failUsage(
          "inbox retract requires --path <data/inbox/note-foo.md>.",
        );
      return { target: "inbox", path };
    }
  }
}

export function registerRetractCommand(
  program: Command,
  ctx: ModuleContext,
): void {
  program
    .command("retract")
    .description(
      "Remove or supersede one prior cross-store record (memory, knowledge, tasks, inbox). " +
        "Tasks route through the state machine into data/tasks/dropped/ — the file is not deleted.",
    )
    .requiredOption(
      "-t, --target <target>",
      `Destination store (one of: ${RETRACT_TARGET_ORDER.join(", ")}).`,
    )
    .option("--id <id>", "Memory id or task id (memory and tasks targets).")
    .option("--slug <slug>", "Knowledge slug (knowledge target only).")
    .option(
      "--path <path>",
      "Repo-relative inbox path (inbox target only, e.g. data/inbox/note-foo.md).",
    )
    .option("--json", "Emit the structured RetractResult as JSON")
    .action(
      async (opts: {
        target: string;
        id?: string;
        slug?: string;
        path?: string;
        json?: boolean;
      }) => {
        const target = parseTarget(opts.target);
        const request = buildRequest({
          target,
          ...(opts.id !== undefined && { id: opts.id }),
          ...(opts.slug !== undefined && { slug: opts.slug }),
          ...(opts.path !== undefined && { path: opts.path }),
        });

        await ensureCliProvidersFor(["retract"]);
        const result = await ctx.client.retract.retract(request);

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result)}\n`);
          if (!result.ok) process.exit(1);
          return;
        }

        if (!result.ok) {
          stderrTransport().write(
            line(span(renderRetractResultPlain(result), "error")),
          );
          process.exit(1);
        }

        print(line(plain(renderRetractResultPlain(result))));
      },
    );
}
