import type { Command } from "commander";
import type {
  OwnerQuestionStatus,
  PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  blank,
  type LineNode,
  line,
  plain,
  prose,
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

function formatDurationMs(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.round(ms / 1000)}s`;
}

function answerBehaviorText(item: PendingOwnerQuestion): string {
  switch (item.answerBehavior ?? "unknown") {
    case "workflow-resume":
      return "Answer resumes the waiting workflow after owner.question.resolved.";
    case "record-only":
      return "Answer is recorded only; no suspended workflow resumes automatically.";
    case "unknown":
      return "Answer behavior was not recorded for this question.";
  }
}

function originRows(item: PendingOwnerQuestion): LineNode[] {
  const origin = item.origin;
  if (!origin) {
    return [
      line(span("    Origin:   ", "muted"), plain("not recorded")),
      line(span("    Source:   ", "muted"), plain(item.source)),
    ];
  }
  if (origin.kind === "workflow") {
    return [
      line(span("    Workflow: ", "muted"), plain(origin.workflowName)),
      line(span("    Run:      ", "muted"), plain(origin.runId)),
      line(span("    Step:     ", "muted"), plain(origin.stepId ?? "not recorded")),
      line(span("    Task:     ", "muted"), plain(origin.taskId ?? "not recorded")),
      line(span("    Source:   ", "muted"), plain(item.source)),
    ];
  }
  if (origin.kind === "session") {
    return [
      line(span("    Session:  ", "muted"), plain(origin.sessionId ?? "not recorded")),
      line(span("    Source:   ", "muted"), plain(item.source)),
    ];
  }
  return [
    line(span("    Origin:   ", "muted"), plain(origin.source)),
    line(span("    Source:   ", "muted"), plain(item.source)),
  ];
}

function timeoutRows(item: PendingOwnerQuestion): LineNode[] {
  const rows: LineNode[] = [
    line(
      span("    Timeout:  ", "muted"),
      plain(item.timeoutMs === undefined ? "not recorded" : formatDurationMs(item.timeoutMs)),
    ),
  ];
  if (item.defaultResolution) {
    rows.push(line(span("    Default:  ", "muted"), plain(item.defaultResolution)));
  }
  if (item.defaultAnswer) {
    rows.push(line(span("    Default answer: ", "muted"), plain(item.defaultAnswer)));
  }
  return rows;
}

function proposedAnswerRows(item: PendingOwnerQuestion): LineNode[] {
  if (!item.proposedAnswers || item.proposedAnswers.length === 0) {
    return [line(span("    Proposed: ", "muted"), plain("none"))];
  }
  return item.proposedAnswers.map((answer, index) =>
    line(span(`    Proposed ${index + 1}: `, "muted"), plain(answer)),
  );
}

function renderDetail(item: PendingOwnerQuestion): RenderNode {
  const rows: RenderNode[] = [
    line(
      span(`Owner question [${item.id}]`, "accent", true),
      plain(" status="),
      span(item.status, statusRole(item.status)),
    ),
    line(span("    Created:  ", "muted"), plain(item.createdAt)),
    ...originRows(item),
    line(span("    Behavior: ", "muted"), plain(answerBehaviorText(item))),
    line(span("    Question: ", "muted"), plain(item.question)),
    line(span("    Reason:   ", "muted"), plain(item.reason)),
    line(span("    Context:", "muted")),
    prose(item.context),
    ...proposedAnswerRows(item),
    ...timeoutRows(item),
  ];
  if (item.status === "pending") {
    rows.push(
      line(span("    Answer:   ", "muted"), plain(`kota owner-question answer ${item.id} <your answer>`)),
      line(span("    Dismiss:  ", "muted"), plain(`kota owner-question dismiss ${item.id}`)),
    );
  }
  if (item.resolvedAt) rows.push(line(span("    Resolved: ", "muted"), plain(item.resolvedAt)));
  if (item.resolutionSource) {
    rows.push(line(span("    Resolved by: ", "muted"), plain(item.resolutionSource)));
  }
  if (item.answer) rows.push(line(span("    Final answer: ", "muted"), plain(item.answer)));
  if (item.dismissalReason) {
    rows.push(line(span("    Dismissal reason: ", "muted"), plain(item.dismissalReason)));
  }
  return stack(...rows, blank());
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
    line(span("    Detail:   ", "muted"), plain(`kota owner-question show ${item.id}`)),
    line(span("    Behavior: ", "muted"), plain(answerBehaviorText(item))),
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
  const rows: RenderNode[] = [
    line(
      span(`  [${item.id}]`, "accent", true),
      plain(" status="),
      span(item.status, statusRole(item.status)),
      plain(`  resolved=${resolvedAgo}`),
    ),
    ...originRows(item),
    line(span("    Behavior: ", "muted"), plain(answerBehaviorText(item))),
    line(span("    Question: ", "muted"), plain(item.question)),
    line(span("    Reason:   ", "muted"), plain(item.reason)),
    line(span("    Context:", "muted")),
    prose(item.context),
    ...timeoutRows(item),
  ];
  if (item.answer) rows.push(line(span("    Answer:   ", "muted"), plain(item.answer)));
  if (item.resolutionSource) {
    rows.push(line(span("    Resolved by: ", "muted"), plain(item.resolutionSource)));
  }
  if (item.dismissalReason && item.dismissalReason !== "expired") {
    rows.push(line(span("    Dismissal reason: ", "muted"), plain(item.dismissalReason)));
  }
  return stack(...rows, blank());
}

async function loadOwnerQuestionById(
  ctx: ModuleContext,
  id: string,
): Promise<PendingOwnerQuestion | null> {
  const result = await ctx.client.ownerQuestions.list({ status: "all" });
  return result.questions.find((item) => item.id === id) ?? null;
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
    .command("show <id>")
    .alias("detail")
    .description("Show full details for a pending or resolved owner question")
    .action(async (id: string) => {
      const item = await loadOwnerQuestionById(ctx, id);
      if (!item) {
        console.error(`Error: owner question "${id}" not found.`);
        process.exit(1);
      }
      print(renderDetail(item));
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
