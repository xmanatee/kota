import { execSync } from "node:child_process";
import {
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const ESCALATION_THRESHOLD = 3;

export type AttemptSummary = {
  attempts: Record<string, number>;
  completions: Set<string>;
};

export function loadBuilderAttemptSummary(
  projectDir: string,
  maxRuns = 10,
): AttemptSummary {
  try {
    const hashOutput = execSync(
      `git log --grep="^Builder:" -n ${maxRuns} --format="%H"`,
      { cwd: projectDir, encoding: "utf-8" },
    );
    const hashes = hashOutput.trim().split("\n").filter(Boolean);

    const attempts: Record<string, number> = {};
    const completions = new Set<string>();

    for (const hash of hashes) {
      const filesOutput = execSync(
        `git diff-tree --no-commit-id -r --name-only ${hash} -- tasks/doing/ tasks/done/`,
        { cwd: projectDir, encoding: "utf-8" },
      );
      for (const line of filesOutput.split("\n")) {
        const trimmed = line.trim();
        const doingMatch = trimmed.match(/^tasks\/doing\/(task-[^/]+)\.md$/);
        const doneMatch = trimmed.match(/^tasks\/done\/(task-[^/]+)\.md$/);
        if (doingMatch) {
          const taskId = doingMatch[1];
          attempts[taskId] = (attempts[taskId] ?? 0) + 1;
        }
        if (doneMatch) {
          completions.add(doneMatch[1]);
        }
      }
    }

    return { attempts, completions };
  } catch {
    return { attempts: {}, completions: new Set() };
  }
}

export function getReadyTaskIds(projectDir: string): string[] {
  try {
    const readyDir = join(projectDir, "tasks", "ready");
    return readdirSync(readyDir)
      .filter((f) => f.startsWith("task-") && f.endsWith(".md"))
      .map((f) => f.slice(0, -3));
  } catch {
    return [];
  }
}

export function findTasksToEscalate(
  readyTaskIds: string[],
  summary: AttemptSummary,
): string[] {
  return readyTaskIds.filter(
    (id) =>
      (summary.attempts[id] ?? 0) >= ESCALATION_THRESHOLD &&
      !summary.completions.has(id),
  );
}

export function escalateTaskFiles(projectDir: string, taskIds: string[]): void {
  for (const taskId of taskIds) {
    const readyPath = join(projectDir, "tasks", "ready", `${taskId}.md`);
    const blockedPath = join(projectDir, "tasks", "blocked", `${taskId}.md`);

    let content = readFileSync(readyPath, "utf-8");

    content = content.replace(/^status: ready$/m, "status: blocked");

    if (!content.includes("## Blocker")) {
      content +=
        `\n## Blocker\n\nAuto-escalated after ${ESCALATION_THRESHOLD}+ builder attempts without completing. ` +
        "Investigate why the builder repeatedly fails or stalls on this task before returning it to ready.\n";
    }

    writeFileSync(blockedPath, content);
    unlinkSync(readyPath);
  }
}

export function autoEscalateBlockedTasks(projectDir: string): string[] {
  const readyTaskIds = getReadyTaskIds(projectDir);
  if (readyTaskIds.length === 0) return [];

  const summary = loadBuilderAttemptSummary(projectDir);
  const toEscalate = findTasksToEscalate(readyTaskIds, summary);

  if (toEscalate.length === 0) return [];

  escalateTaskFiles(projectDir, toEscalate);

  const slugs = toEscalate.join(", ");
  execSync("git add tasks/ready/ tasks/blocked/", { cwd: projectDir });
  execSync(
    `git commit -m "Explorer: auto-escalate stuck tasks to blocked (${slugs})"`,
    { cwd: projectDir },
  );

  return toEscalate;
}
