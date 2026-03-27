import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const PRIORITY_ORDER = ["p0", "p1", "p2", "p3"] as const;
const COOLDOWN_MINUTES = 10;
const COOLDOWN_RUNS = 2;

export type ClaimTaskResult = {
  chosenTaskId: string;
};

export function isClaimTaskResult(value: unknown): value is ClaimTaskResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "chosenTaskId" in value &&
    typeof (value as ClaimTaskResult).chosenTaskId === "string"
  );
}

function extractPriority(content: string): string {
  const match = content.match(/^priority:\s*(\S+)/m);
  return match?.[1] ?? "p3";
}

export function parseLastAttemptRunId(content: string): string | null {
  const historyStart = content.indexOf("## Attempt History");
  if (historyStart === -1) return null;
  const historyBody = content.slice(historyStart + "## Attempt History".length);
  const lines = historyBody
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));
  if (lines.length === 0) return null;
  const lastLine = lines[lines.length - 1];
  // format: - DATE | RUN_ID | SUMMARY
  const parts = lastLine.slice(2).split(" | ");
  return parts[1] ?? null;
}

export function parseRunIdTimestamp(runId: string): Date | null {
  // runId: 2026-03-27T05-36-54-005Z-workflow-id
  const m = runId.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function countBuilderRunsSince(projectDir: string, since: Date): number {
  const runsDir = join(projectDir, ".kota", "runs");
  if (!existsSync(runsDir)) return 0;
  const entries = readdirSync(runsDir);
  return entries.filter((name) => {
    if (!name.includes("-builder-")) return false;
    const t = parseRunIdTimestamp(name);
    return t !== null && t > since;
  }).length;
}

function isInCooldown(content: string, projectDir: string, now: Date): boolean {
  const runId = parseLastAttemptRunId(content);
  if (!runId) return false;
  const lastAttempt = parseRunIdTimestamp(runId);
  if (!lastAttempt) return false;
  const minutesElapsed = (now.getTime() - lastAttempt.getTime()) / 60_000;
  if (minutesElapsed < COOLDOWN_MINUTES) return true;
  return countBuilderRunsSince(projectDir, lastAttempt) < COOLDOWN_RUNS;
}

export function claimTask(projectDir: string, now = new Date()): ClaimTaskResult | null {
  const readyDir = join(projectDir, "tasks", "ready");
  if (!existsSync(readyDir)) return null;

  const files = readdirSync(readyDir).filter(
    (name) => name.endsWith(".md") && name !== "AGENTS.md",
  );
  if (files.length === 0) return null;

  type TaskEntry = {
    file: string;
    content: string;
    priorityRank: number;
    lastAttempt: Date | null;
    inCooldown: boolean;
  };

  const tasks: TaskEntry[] = files.map((file) => {
    const content = readFileSync(join(readyDir, file), "utf-8");
    const priority = extractPriority(content);
    const rank = PRIORITY_ORDER.indexOf(priority as (typeof PRIORITY_ORDER)[number]);
    const effectiveRank = rank === -1 ? PRIORITY_ORDER.length : rank;
    const runId = parseLastAttemptRunId(content);
    const lastAttempt = runId ? parseRunIdTimestamp(runId) : null;
    return {
      file,
      content,
      priorityRank: effectiveRank,
      lastAttempt,
      inCooldown: isInCooldown(content, projectDir, now),
    };
  });

  const eligible = tasks.filter((t) => !t.inCooldown);

  let chosenFile: string;

  if (eligible.length > 0) {
    let best = eligible[0];
    for (const t of eligible) {
      if (t.priorityRank < best.priorityRank) best = t;
    }
    chosenFile = best.file;
  } else {
    // All tasks are in cooldown — pick least-recently-attempted as fallback
    let oldest = tasks[0];
    for (const t of tasks) {
      const oldestTime = oldest.lastAttempt?.getTime() ?? 0;
      const tTime = t.lastAttempt?.getTime() ?? 0;
      if (tTime < oldestTime) oldest = t;
    }
    chosenFile = oldest.file;
  }

  const srcPath = join(readyDir, chosenFile);
  const doingDir = join(projectDir, "tasks", "doing");
  const dstPath = join(doingDir, chosenFile);

  execSync(`git mv "${srcPath}" "${dstPath}"`, { cwd: projectDir });
  const content = readFileSync(dstPath, "utf-8");
  const updated = content.replace(/^status:\s*ready$/m, "status: doing");
  writeFileSync(dstPath, updated, "utf-8");
  execSync(`git add "${dstPath}"`, { cwd: projectDir });

  const chosenTaskId = basename(chosenFile, ".md");
  return { chosenTaskId };
}
