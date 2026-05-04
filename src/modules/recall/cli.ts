/**
 * `kota recall <query>` — one cross-store recall query.
 *
 * The subcommand consumes `ctx.client.recall.recall` so daemon-up and
 * daemon-down callers share the same code path. Output renders through the
 * rendering module's terminal transport; `--json` keeps the structured
 * payload for consumers that want to parse it.
 */
import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { line, plain, span } from "#modules/rendering/primitives.js";
import { print, TerminalTransport } from "#modules/rendering/transport.js";
import type { RecallFilter, RecallSource } from "./client.js";
import { renderRecallHitsPlain } from "./render.js";

const ALLOWED_SOURCES: ReadonlyArray<RecallSource> = [
  "knowledge",
  "memory",
  "history",
  "tasks",
  "answer",
];

let stderrRenderer: TerminalTransport | null = null;
function stderrTransport(): TerminalTransport {
  if (!stderrRenderer) {
    stderrRenderer = new TerminalTransport({ stream: process.stderr });
  }
  return stderrRenderer;
}

function collectSources(value: string, previous: RecallSource[]): RecallSource[] {
  if (!(ALLOWED_SOURCES as readonly string[]).includes(value)) {
    console.error(
      `Unknown source "${value}". Valid: ${ALLOWED_SOURCES.join(", ")}`,
    );
    process.exit(1);
  }
  return [...previous, value as RecallSource];
}

export function registerRecallCommand(
  program: Command,
  ctx: ModuleContext,
): void {
  program
    .command("recall <query>")
    .description(
      "Search every registered store at once and return ranked, source-tagged hits.",
    )
    .option("-n, --limit <n>", "Max hits to return (default 20)", "20")
    .option(
      "-s, --source <source>",
      "Restrict to one source (knowledge|memory|history|tasks|answer). Repeatable.",
      collectSources,
      [] as RecallSource[],
    )
    .option("--min-score <n>", "Drop hits below this normalized score (0..1)")
    .option("--json", "Emit the structured payload as JSON")
    .action(
      async (
        query: string,
        opts: {
          limit: string;
          source: RecallSource[];
          minScore?: string;
          json?: boolean;
        },
      ) => {
        const trimmed = query.trim();
        if (!trimmed) {
          stderrTransport().write(
            line(span("Usage: kota recall <query>", "warn")),
          );
          process.exit(1);
        }
        const limit = Number.parseInt(opts.limit, 10);
        if (!Number.isFinite(limit) || limit <= 0) {
          stderrTransport().write(
            line(
              span(
                `Error: --limit must be a positive integer, got "${opts.limit}"`,
                "error",
              ),
            ),
          );
          process.exit(1);
        }
        const filter: RecallFilter = { topK: limit };
        if (opts.source.length > 0) filter.sources = opts.source;
        if (opts.minScore !== undefined) {
          const minScore = Number.parseFloat(opts.minScore);
          if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
            stderrTransport().write(
              line(
                span(
                  `Error: --min-score must be a number in [0, 1], got "${opts.minScore}"`,
                  "error",
                ),
              ),
            );
            process.exit(1);
          }
          filter.minScore = minScore;
        }

        const result = await ctx.client.recall.recall(trimmed, filter);

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result)}\n`);
          if (!result.ok) process.exit(1);
          return;
        }

        if (!result.ok) {
          stderrTransport().write(
            line(
              span(
                "Cross-store recall has no registered contributors.",
                "error",
              ),
            ),
          );
          process.exit(1);
        }

        if (result.hits.length === 0) {
          print(line(plain("No matching hits.")));
          return;
        }

        print(line(plain(renderRecallHitsPlain(result.hits))));
      },
    );
}
