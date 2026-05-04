/**
 * `kota capture <text>` — one cross-store capture write.
 *
 * The subcommand consumes `ctx.client.capture.capture` so daemon-up and
 * daemon-down callers share the same code path. Output renders through
 * the rendering module's terminal transport; `--json` keeps the
 * structured `CaptureResult` envelope for consumers that want to parse
 * it.
 */
import type { Command } from "commander";
import { ensureCliProvidersFor } from "#core/modules/cli-providers.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { line, plain, span } from "#modules/rendering/primitives.js";
import { print, TerminalTransport } from "#modules/rendering/transport.js";
import { CAPTURE_TARGET_ORDER } from "./capture-types.js";
import type { CaptureFilter, CaptureTarget } from "./client.js";
import { renderCaptureResultPlain } from "./render.js";

let stderrRenderer: TerminalTransport | null = null;
function stderrTransport(): TerminalTransport {
  if (!stderrRenderer) {
    stderrRenderer = new TerminalTransport({ stream: process.stderr });
  }
  return stderrRenderer;
}

function parseTarget(value: string): CaptureTarget {
  if (!(CAPTURE_TARGET_ORDER as readonly string[]).includes(value)) {
    console.error(
      `Unknown target "${value}". Valid: ${CAPTURE_TARGET_ORDER.join(", ")}`,
    );
    process.exit(1);
  }
  return value as CaptureTarget;
}

export function registerCaptureCommand(
  program: Command,
  ctx: ModuleContext,
): void {
  program
    .command("capture <text...>")
    .description(
      "Capture one natural-language note and route it to memory, knowledge, tasks, or inbox.",
    )
    .option(
      "-t, --target <target>",
      `Pin the destination store (one of: ${CAPTURE_TARGET_ORDER.join(", ")}). Skips classification.`,
    )
    .option(
      "-h, --hint <hint>",
      "Optional free-form hint the classifier may consume when no target is set.",
    )
    .option("--json", "Emit the structured CaptureResult as JSON")
    .action(
      async (
        textParts: string[],
        opts: { target?: string; hint?: string; json?: boolean },
      ) => {
        const text = textParts.join(" ").trim();
        if (text === "") {
          stderrTransport().write(
            line(span("Usage: kota capture <text>", "warn")),
          );
          process.exit(1);
        }
        const filter: CaptureFilter = {};
        if (opts.target !== undefined) filter.target = parseTarget(opts.target);
        if (opts.hint !== undefined && opts.hint !== "") filter.hint = opts.hint;

        await ensureCliProvidersFor(["capture"]);
        const result = await ctx.client.capture.capture(
          text,
          Object.keys(filter).length > 0 ? filter : undefined,
        );

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result)}\n`);
          if (!result.ok) process.exit(1);
          return;
        }

        if (!result.ok) {
          stderrTransport().write(
            line(span(renderCaptureResultPlain(result), "error")),
          );
          process.exit(1);
        }

        print(line(plain(renderCaptureResultPlain(result))));
      },
    );
}
