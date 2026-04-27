/**
 * `kota answer <query>` — one short cited answer over the second brain.
 *
 * The subcommand consumes `ctx.client.answer.answer` so daemon-up and
 * daemon-down callers share the same code path. Output renders through
 * the rendering module's terminal transport: prose first, citation list
 * second. `--json` keeps the structured `AnswerResult` envelope.
 */
import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  AnswerFilter,
  RecallSource,
} from "#core/server/kota-client.js";
import { blank, line, plain, span } from "#modules/rendering/primitives.js";
import { print, TerminalTransport } from "#modules/rendering/transport.js";
import { renderAnswerCitationsPlain } from "./render.js";

const ALLOWED_SOURCES: ReadonlyArray<RecallSource> = [
  "knowledge",
  "memory",
  "history",
  "tasks",
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

const FAILURE_MESSAGE: Record<
  "no_hits" | "semantic_unavailable" | "synthesis_failed",
  string
> = {
  no_hits: "No matching sources across the second brain — nothing to synthesize.",
  semantic_unavailable: "Cross-store recall has no registered contributors.",
  synthesis_failed:
    "Synthesis failed (model unreachable or unable to cite resolvable sources).",
};

export function registerAnswerCommand(
  program: Command,
  ctx: ModuleContext,
): void {
  program
    .command("answer <query>")
    .description(
      "Compose one short cited answer from the second brain. Citations resolve back to typed RecallHits.",
    )
    .option("-n, --limit <n>", "Max recall hits fed to synthesis (default 8)", "8")
    .option(
      "-s, --source <source>",
      "Restrict to one source (knowledge|memory|history|tasks). Repeatable.",
      collectSources,
      [] as RecallSource[],
    )
    .option("--min-score <n>", "Drop hits below this normalized score (0..1)")
    .option("--json", "Emit the structured AnswerResult as JSON")
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
            line(span("Usage: kota answer <query>", "warn")),
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
        const filter: AnswerFilter = { topK: limit };
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

        const result = await ctx.client.answer.answer(trimmed, filter);

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result)}\n`);
          if (!result.ok) process.exit(1);
          return;
        }

        if (!result.ok) {
          stderrTransport().write(
            line(span(FAILURE_MESSAGE[result.reason], "error")),
          );
          process.exit(1);
        }

        print(line(plain(result.answer)));
        const citationsBlock = renderAnswerCitationsPlain(
          result.citations,
          result.hits,
        );
        if (citationsBlock !== "") {
          print(blank());
          print(line(span("Citations", "muted", true)));
          print(line(plain(citationsBlock)));
        }
      },
    );
}
