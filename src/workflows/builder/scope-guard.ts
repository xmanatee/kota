import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowStepContext } from "../../workflow/run-types.js";

export type ScopeGuardResult =
  | { blocked: false; taskId: string | null }
  | {
      blocked: true;
      taskId: string;
      taskFile: string;
      fromDir: "doing" | "ready";
      reason: string;
      wordCount: number;
      doneWhenItems: number;
    };

type TaskCandidate = {
  filePath: string;
  fileName: string;
  fromDir: "doing" | "ready";
};

/**
 * Oversized when any single threshold is hit, or when two combined signals fire together.
 *
 * Thresholds are calibrated against current ready tasks (280–454 words, 3–5 done-when
 * items) to avoid false positives while catching genuinely broad tasks.
 */
const THRESHOLDS = {
  wordCount: 700,
  doneWhenItems: 8,
  combinedWordCount: 450,
  combinedDoneWhenItems: 6,
} as const;

function findCandidateTask(projectDir: string): TaskCandidate | null {
  const doingDir = join(projectDir, "tasks", "doing");
  if (existsSync(doingDir)) {
    const files = readdirSync(doingDir).filter(
      (f) => f.endsWith(".md") && f !== "AGENTS.md",
    );
    if (files.length > 0) {
      return {
        filePath: join(doingDir, files[0]),
        fileName: files[0],
        fromDir: "doing",
      };
    }
  }

  const readyDir = join(projectDir, "tasks", "ready");
  if (!existsSync(readyDir)) return null;

  const files = readdirSync(readyDir).filter(
    (f) => f.endsWith(".md") && f !== "AGENTS.md",
  );
  if (files.length === 0) return null;

  type RankedCandidate = { file: string; priority: number };
  const ranked: RankedCandidate[] = files.map((file) => {
    const content = readFileSync(join(readyDir, file), "utf-8");
    const m = content.match(/^priority:\s+p(\d+)/m);
    return { file, priority: m ? parseInt(m[1], 10) : 99 };
  });
  ranked.sort((a, b) => a.priority - b.priority);

  return {
    filePath: join(readyDir, ranked[0].file),
    fileName: ranked[0].file,
    fromDir: "ready",
  };
}

function countBodyWords(content: string): number {
  const fmEnd = content.indexOf("\n---\n", 4);
  const body = fmEnd >= 0 ? content.slice(fmEnd + 5) : content;
  return body.trim().split(/\s+/).filter(Boolean).length;
}

function countDoneWhenItems(content: string): number {
  const startIdx = content.indexOf("## Done When");
  if (startIdx < 0) return 0;
  const rest = content.slice(startIdx);
  const nextSectionIdx = rest.slice(1).indexOf("\n## ");
  const section = nextSectionIdx >= 0 ? rest.slice(0, nextSectionIdx + 1) : rest;
  return (section.match(/^- /gm) ?? []).length;
}

function isOversized(wordCount: number, doneWhenItems: number): boolean {
  if (wordCount >= THRESHOLDS.wordCount) return true;
  if (doneWhenItems >= THRESHOLDS.doneWhenItems) return true;
  if (
    wordCount >= THRESHOLDS.combinedWordCount &&
    doneWhenItems >= THRESHOLDS.combinedDoneWhenItems
  )
    return true;
  return false;
}

function updateFrontmatter(content: string, reason: string): string {
  const fmEnd = content.indexOf("\n---\n", 4);
  if (fmEnd < 0) return content;
  const fm = content.slice(0, fmEnd);
  const body = content.slice(fmEnd + 5);
  const updated = fm
    .replace(/^status:\s+\S+/m, "status: blocked")
    .replace(/^updated_at:\s+.+$/m, `updated_at: ${new Date().toISOString()}`);
  return `${updated}\nblocked_reason: "Scope guard: ${reason.replace(/"/g, "'")}"\n---\n${body}`;
}

export function runScopeGuard(ctx: WorkflowStepContext): ScopeGuardResult {
  const { projectDir } = ctx;

  const candidate = findCandidateTask(projectDir);
  if (!candidate) return { blocked: false, taskId: null };

  const content = readFileSync(candidate.filePath, "utf-8");

  const idMatch = content.match(/^id:\s+(.+)$/m);
  const taskId = idMatch ? idMatch[1].trim() : null;
  if (!taskId) return { blocked: false, taskId: null };

  const allowOversized = /^allow_oversized:\s+true/m.test(content);
  if (allowOversized) return { blocked: false, taskId };

  const wordCount = countBodyWords(content);
  const doneWhenItems = countDoneWhenItems(content);

  if (!isOversized(wordCount, doneWhenItems)) return { blocked: false, taskId };

  const reason = buildReason(taskId, wordCount, doneWhenItems);
  const updatedContent = updateFrontmatter(content, reason);

  const blockedDir = join(projectDir, "tasks", "blocked");
  const destPath = join(blockedDir, candidate.fileName);

  writeFileSync(candidate.filePath, updatedContent, "utf-8");
  execFileSync("git", ["mv", candidate.filePath, destPath], { cwd: projectDir });

  const titleMatch = content.match(/^title:\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : taskId;
  const notifText = `Task blocked for scope: "${title}" — ${reason} Add allow_oversized: true to the task frontmatter to override.`;

  console.warn(`[scope-guard] ${notifText}`);

  ctx.emit("workflow.attention.digest", {
    items: [{ label: `Scope guard blocked: ${taskId}`, detail: notifText }],
    text: `Attention: ${notifText}`,
  });

  return {
    blocked: true,
    taskId,
    taskFile: candidate.fileName,
    fromDir: candidate.fromDir,
    reason,
    wordCount,
    doneWhenItems,
  };
}

function buildReason(taskId: string, wordCount: number, doneWhenItems: number): string {
  const signals: string[] = [];
  if (wordCount >= THRESHOLDS.wordCount) signals.push(`${wordCount} body words`);
  if (doneWhenItems >= THRESHOLDS.doneWhenItems)
    signals.push(`${doneWhenItems} done-when items`);
  if (
    wordCount >= THRESHOLDS.combinedWordCount &&
    doneWhenItems >= THRESHOLDS.combinedDoneWhenItems
  )
    signals.push(`combined scope signals (${wordCount} words + ${doneWhenItems} items)`);
  return `${taskId} exceeds execution budget (${signals.join(", ")}). Split into smaller tasks.`;
}
