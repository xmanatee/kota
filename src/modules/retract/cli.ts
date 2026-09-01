/**
 * `kota retract --target <store> --identifier <ident>` —
 * remove or supersede one prior cross-store record.
 *
 * The subcommand consumes `ctx.client.retract.retract` so daemon-up and
 * daemon-down callers share the same code path. Output renders through
 * the rendering module's terminal transport; `--json` keeps the
 * structured `RetractResult` envelope for consumers that want to parse
 * it.
 *
 * The uniform identifier is interpreted only by the selected store transform.
 */
import type { Command } from "commander";
import { ensureCliProvidersFor } from "#core/modules/cli-providers.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { line, plain, span } from "#modules/rendering/primitives.js";
import { print, TerminalTransport, writeJson } from "#modules/rendering/transport.js";
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

function buildRequest(target: RetractTarget, identifier: string): RetractRequest {
  if (identifier.trim() === "") failUsage("retract requires an identifier.");
  return { target, identifier };
}

export function registerRetractCommand(
  program: Command,
  ctx: ModuleContext,
): void {
  program
    .command("retract")
    .description(
      "Remove or supersede one prior cross-store record (memory, knowledge, tasks, inbox). " +
        "Tasks route through the state machine into data/tasks/archive/ — the file is not deleted.",
    )
    .requiredOption(
      "-t, --target <target>",
      `Destination store (one of: ${RETRACT_TARGET_ORDER.join(", ")}).`,
    )
    .requiredOption(
      "-i, --identifier <identifier>",
      "Record id, knowledge slug, task id, or repo-relative inbox path.",
    )
    .option("--json", "Emit the structured RetractResult as JSON")
    .action(
      async (opts: {
        target: string;
        identifier: string;
        json?: boolean;
      }) => {
        const target = parseTarget(opts.target);
        const request = buildRequest(target, opts.identifier);

        await ensureCliProvidersFor(["retract"]);
        const result = await ctx.client.retract.retract(request);

        if (opts.json) {
          writeJson(result);
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
