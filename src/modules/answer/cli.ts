/**
 * `kota answer` — cited synthesis over the second brain plus history readback.
 *
 * The subcommand consumes `ctx.client.answer.*` so daemon-up and
 * daemon-down callers share the same code path. Output renders through
 * the rendering module's terminal transport: prose first, citation list
 * second. `--json` keeps the structured `AnswerResult` envelope.
 *
 * `kota answer log` lists newest-first persisted records (one row per
 * entry); `kota answer show <id>` re-renders the full record.
 */
import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { RecallHit, RecallSource } from "#core/server/kota-client.js";
import { blank, line, plain, span } from "#modules/rendering/primitives.js";
import { print, TerminalTransport } from "#modules/rendering/transport.js";
import type {
  AnswerCitation,
  AnswerFilter,
  AnswerHistoryRecord,
} from "./client.js";
import {
  renderAnswerCitationsPlain,
  renderAnswerHistoryEntriesPlain,
} from "./render.js";

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

const FAILURE_MESSAGE: Record<
  "no_hits" | "semantic_unavailable" | "synthesis_failed",
  string
> = {
  no_hits: "No matching sources across the second brain — nothing to synthesize.",
  semantic_unavailable: "Cross-store recall has no registered contributors.",
  synthesis_failed:
    "Synthesis failed (model unreachable or unable to cite resolvable sources).",
};

function formatRecordTimestamp(iso: string): string {
  const idx = iso.indexOf(".");
  const head = idx >= 0 ? iso.slice(0, idx) : iso;
  return `${head}Z`.replace(/Z+$/, "Z");
}

export function registerAnswerCommand(
  program: Command,
  ctx: ModuleContext,
): void {
  const answer = program
    .command("answer")
    .description(
      "Compose, list, and re-read cited answers over the second brain.",
    );

  answer
    .command("log")
    .description("List newest-first persisted answer records.")
    .option("-n, --limit <n>", "Maximum number of records to list (default 20)", "20")
    .option(
      "-b, --before <id>",
      "Cursor: list records older than this id (use the last id from the previous page).",
    )
    .option("--json", "Emit the structured AnswerHistoryListResult as JSON")
    .action(
      async (opts: { limit: string; before?: string; json?: boolean }) => {
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
        const filter: { limit: number; beforeId?: string } = { limit };
        if (opts.before !== undefined) filter.beforeId = opts.before;
        const result = await ctx.client.answer.log(filter);
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result)}\n`);
          return;
        }
        if (result.entries.length === 0) {
          stderrTransport().write(
            line(span("No persisted answer records yet.", "muted")),
          );
          return;
        }
        print(line(plain(renderAnswerHistoryEntriesPlain(result.entries))));
      },
    );

  answer
    .command("show <id>")
    .description("Re-render a persisted answer record by id.")
    .option("--json", "Emit the structured AnswerHistoryRecord as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const result = await ctx.client.answer.show(id);
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (!result.ok) process.exit(1);
        return;
      }
      if (!result.ok) {
        stderrTransport().write(
          line(span(`No answer record found for id "${id}".`, "error")),
        );
        process.exit(1);
      }
      renderRecord(result.record);
    });

  answer
    .command("ask <query>", { isDefault: true })
    .description(
      "Compose one short cited answer from the second brain. Citations resolve back to typed RecallHits.",
    )
    .option("-n, --limit <n>", "Max recall hits fed to synthesis (default 8)", "8")
    .option(
      "-s, --source <source>",
      "Restrict to one source (knowledge|memory|history|tasks|answer). Repeatable.",
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

        renderResolvedAnswer(result.answer, result.citations, result.hits);
      },
    );
}

function renderResolvedAnswer(
  answer: string,
  citations: AnswerCitation[],
  hits: RecallHit[],
): void {
  print(line(plain(answer)));
  const citationsBlock = renderAnswerCitationsPlain(citations, hits);
  if (citationsBlock !== "") {
    print(blank());
    print(line(span("Citations", "muted", true)));
    print(line(plain(citationsBlock)));
  }
}

function renderRecord(record: AnswerHistoryRecord): void {
  print(
    line(
      span(`${formatRecordTimestamp(record.createdAt)}  `, "muted"),
      plain(record.id),
    ),
  );
  print(line(span(`Query: ${record.query}`, "muted")));
  print(blank());
  if (record.result.ok) {
    renderResolvedAnswer(
      record.result.answer,
      record.result.citations,
      record.result.hits,
    );
  } else {
    stderrTransport().write(
      line(span(FAILURE_MESSAGE[record.result.reason], "error")),
    );
  }
}
