import type { Command } from "commander";
import type { OwnerQuestionStatus, PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import { getOwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";

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

function printQuestion(item: PendingOwnerQuestion): void {
  console.log(`  [${item.id}] ${formatAge(item.createdAt)}  source=${item.source}`);
  console.log(`    Question: ${item.question}`);
  console.log(`    Context:  ${item.context.length > 160 ? `${item.context.slice(0, 157)}...` : item.context}`);
  console.log(`    Reason:   ${item.reason}`);
  if (item.proposedAnswers && item.proposedAnswers.length > 0) {
    console.log(`    Proposed: ${item.proposedAnswers.map((a, i) => `[${i + 1}] ${a}`).join("  ")}`);
  }
  console.log();
}

export function registerOwnerQuestionCommands(program: Command): void {
  const cmd = program
    .command("owner-question")
    .description("Manage the owner question queue for agent escalations");

  cmd
    .command("list")
    .description("List pending owner questions")
    .action(() => {
      const queue = getOwnerQuestionQueue();
      const items = queue.list("pending");
      if (items.length === 0) {
        console.log("No pending owner questions.");
        return;
      }
      console.log(`${items.length} pending owner question(s):\n`);
      for (const item of items) printQuestion(item);
    });

  cmd
    .command("answer <id> <answer...>")
    .description("Answer a pending owner question")
    .action((id: string, answerWords: string[]) => {
      const answer = answerWords.join(" ").trim();
      if (!answer) {
        console.error("Error: answer text is required.");
        process.exit(1);
      }
      const item = getOwnerQuestionQueue().answer(id, answer, "cli");
      if (!item) {
        console.error(`Error: owner question "${id}" not found or already resolved.`);
        process.exit(1);
      }
      console.log(`Answered [${id}]: ${answer}`);
    });

  cmd
    .command("dismiss <id>")
    .description("Dismiss a pending owner question without answering")
    .option("-r, --reason <text>", "Reason for dismissal")
    .action((id: string, opts: { reason?: string }) => {
      const item = getOwnerQuestionQueue().dismiss(id, opts.reason, "cli");
      if (!item) {
        console.error(`Error: owner question "${id}" not found or already resolved.`);
        process.exit(1);
      }
      const suffix = opts.reason ? ` — ${opts.reason}` : "";
      console.log(`Dismissed [${id}]${suffix}`);
    });

  cmd
    .command("count")
    .description("Print the number of pending owner questions")
    .action(() => {
      console.log(String(getOwnerQuestionQueue().count("pending")));
    });

  cmd
    .command("history")
    .description("List resolved owner questions")
    .option("--status <status>", `Filter by status: ${VALID_STATUSES.filter((s) => s !== "pending").join(", ")}`)
    .option("-n <count>", "Max results to show (default 20)", "20")
    .option("--since <duration>", "Only show items resolved within this window (e.g. 1h, 24h, 7d)")
    .action((opts: { status?: string; n: string; since?: string }) => {
      const queue = getOwnerQuestionQueue();
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

      const items = queue
        .list()
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
        console.log("No resolved owner questions found.");
        return;
      }
      console.log(`${items.length} resolved owner question(s):\n`);
      for (const item of items) {
        const resolvedAgo = item.resolvedAt ? formatAge(item.resolvedAt) : "—";
        console.log(`  [${item.id}] status=${item.status}  resolved=${resolvedAgo}`);
        console.log(`    Question: ${item.question}`);
        if (item.answer) console.log(`    Answer:   ${item.answer}`);
        if (item.dismissalReason && item.dismissalReason !== "expired") {
          console.log(`    Reason:   ${item.dismissalReason}`);
        }
        console.log();
      }
    });
}
