import type { Command } from "commander";
import type { OwnerQuestionStatus, PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  blank,
  type LineNode,
  line,
  plain,
  type RenderNode,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";

const VALID_STATUSES: OwnerQuestionStatus[] = ["pending", "answered", "dismissed", "expired"];

function formatAge(createdAt: string): string {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(ageMs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(ageMs / 86_400_000);
  return `${days}d ago`;
}

function parseDuration(s: string): number | null {
  const m = /^(\d+)(h|m|d)$/.exec(s);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (m[2] === "h") return n * 3_600_000;
  if (m[2] === "m") return n * 60_000;
  return n * 86_400_000;
}

function statusRole(status: OwnerQuestionStatus): "success" | "warn" | "muted" | "accent" {
  switch (status) {
    case "answered":
      return "success";
    case "dismissed":
      return "muted";
    case "expired":
      return "warn";
    case "pending":
      return "accent";
  }
}

function renderPending(item: PendingOwnerQuestion): RenderNode {
  const rows: LineNode[] = [
    line(
      span(`  [${item.id}]`, "accent", true),
      plain(` ${formatAge(item.createdAt)}  `),
      span(`source=${item.source}`, "muted"),
    ),
    line(span("    Question: ", "muted"), plain(item.question)),
    line(span("    Context:  ", "muted"), plain(
      item.context.length > 160 ? `${item.context.slice(0, 157)}...` : item.context,
    )),
    line(span("    Reason:   ", "muted"), plain(item.reason)),
  ];
  if (item.proposedAnswers && item.proposedAnswers.length > 0) {
    rows.push(line(
      span("    Proposed: ", "muted"),
      plain(item.proposedAnswers.map((a, i) => `[${i + 1}] ${a}`).join("  ")),
    ));
  }
  return stack(...rows, blank());
}

function renderResolved(item: PendingOwnerQuestion): RenderNode {
  const resolvedAgo = item.resolvedAt ? formatAge(item.resolvedAt) : "—";
  const rows: LineNode[] = [
    line(
      span(`  [${item.id}]`, "accent", true),
      plain(" status="),
      span(item.status, statusRole(item.status)),
      plain(`  resolved=${resolvedAgo}`),
    ),
    line(span("    Question: ", "muted"), plain(item.question)),
  ];
  if (item.answer) rows.push(line(span("    Answer:   ", "muted"), plain(item.answer)));
  if (item.dismissalReason && item.dismissalReason !== "expired") {
    rows.push(line(span("    Reason:   ", "muted"), plain(item.dismissalReason)));
  }
  return stack(...rows, blank());
}

export function registerOwnerQuestionCommands(program: Command, ctx: ModuleContext): void {
  const cmd = program
    .command("owner-question")
    .description("Manage the owner question queue for agent escalations");

  cmd
    .command("list")
    .description("List pending owner questions")
    .action(async () => {
      const result = await ctx.client.ownerQuestions.list();
      const items = result.questions;
      if (items.length === 0) {
        print(line(plain("No pending owner questions.")));
        return;
      }
      print(stack(
        line(
          span(String(items.length), "accent", true),
          plain(" pending owner question(s):"),
        ),
        blank(),
        ...items.map(renderPending),
      ));
    });

  cmd
    .command("answer <id> <answer...>")
    .description("Answer a pending owner question")
    .action(async (id: string, answerWords: string[]) => {
      const answer = answerWords.join(" ").trim();
      if (!answer) {
        console.error("Error: answer text is required.");
        process.exit(1);
      }
      const mutate = await ctx.client.ownerQuestions.answer(id, answer);
      if (!mutate.ok) {
        console.error(`Error: owner question "${id}" not found or already resolved.`);
        process.exit(1);
      }
      print(line(
        span("Answered ", "success"),
        span(`[${id}]`, "accent"),
        plain(`: ${answer}`),
      ));
    });

  cmd
    .command("dismiss <id>")
    .description("Dismiss a pending owner question without answering")
    .option("-r, --reason <text>", "Reason for dismissal")
    .action(async (id: string, opts: { reason?: string }) => {
      const mutate = await ctx.client.ownerQuestions.dismiss(id, opts.reason);
      if (!mutate.ok) {
        console.error(`Error: owner question "${id}" not found or already resolved.`);
        process.exit(1);
      }
      const suffix = opts.reason ? ` — ${opts.reason}` : "";
      print(line(
        span("Dismissed ", "muted"),
        span(`[${id}]`, "accent"),
        plain(suffix),
      ));
    });

  cmd
    .command("count")
    .description("Print the number of pending owner questions")
    .action(async () => {
      const result = await ctx.client.ownerQuestions.list();
      // biome-ignore lint/suspicious/noConsole: bare count output consumed by scripts
      console.log(String(result.questions.length));
    });

  cmd
    .command("history")
    .description("List resolved owner questions")
    .option("--status <status>", `Filter by status: ${VALID_STATUSES.filter((s) => s !== "pending").join(", ")}`)
    .option("-n <count>", "Max results to show (default 20)", "20")
    .option("--since <duration>", "Only show items resolved within this window (e.g. 1h, 24h, 7d)")
    .action(async (opts: { status?: string; n: string; since?: string }) => {
      const limit = Math.max(1, parseInt(opts.n, 10) || 20);
      const statusFilter = opts.status as OwnerQuestionStatus | undefined;
      if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
        console.error(`Error: invalid --status "${statusFilter}". Must be one of: ${VALID_STATUSES.join(", ")}`);
        process.exit(1);
      }

      let sinceMs: number | null = null;
      if (opts.since) {
        sinceMs = parseDuration(opts.since);
        if (sinceMs === null) {
          console.error(`Error: invalid --since "${opts.since}". Use format like 1h, 24h, 7d.`);
          process.exit(1);
        }
      }
      const cutoff = sinceMs !== null ? Date.now() - sinceMs : null;

      const all = await ctx.client.ownerQuestions.list({ status: "all" });
      const items = all.questions
        .filter((item) => item.status !== "pending")
        .filter((item) => !statusFilter || item.status === statusFilter)
        .filter((item) => {
          if (cutoff === null) return true;
          const ts = item.resolvedAt ?? item.createdAt;
          return new Date(ts).getTime() >= cutoff;
        })
        .sort((a, b) => {
          const ta = a.resolvedAt ?? a.createdAt;
          const tb = b.resolvedAt ?? b.createdAt;
          return tb.localeCompare(ta);
        })
        .slice(0, limit);

      if (items.length === 0) {
        print(line(plain("No resolved owner questions found.")));
        return;
      }
      print(stack(
        line(
          span(String(items.length), "accent", true),
          plain(" resolved owner question(s):"),
        ),
        blank(),
        ...items.map(renderResolved),
      ));
    });
}
