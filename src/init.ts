import { execSync } from "node:child_process";
import { basename } from "node:path";
import { getScheduler } from "./core/daemon/scheduler.js";
import { getKnowledgeStore } from "./core/memory/knowledge-store.js";
import { getMemoryStore } from "./core/memory/store.js";
import { getHistoryProvider, getTaskProvider } from "./core/modules/provider-registry.js";
import { detectEnvironment, detectProject, getDirectoryOverview } from "./project-detection.js";

const GIT_TIMEOUT = 5000;

function runGitCommand(cwd: string, command: string): string | null {
  try {
    return execSync(command, { cwd, stdio: "pipe", timeout: GIT_TIMEOUT }).toString().trim();
  } catch {
    return null;
  }
}

/** Get git state: branch, status summary, recent commits. */
function getGitContext(cwd: string): string | null {
  if (!runGitCommand(cwd, "git rev-parse --is-inside-work-tree")) {
    return null;
  }

  const parts: string[] = [];
  const branch = runGitCommand(cwd, "git branch --show-current");
  if (branch) parts.push(`Branch: ${branch}`);

  const status = runGitCommand(cwd, "git status --porcelain");
  if (status) {
    const lines = status.split("\n");
    const counts = { modified: 0, deleted: 0, added: 0, untracked: 0, renamed: 0, other: 0 };
    for (const l of lines) {
      if (l.startsWith("??")) { counts.untracked++; continue; }
      if (l.startsWith("!!")) continue;
      const x = l[0];
      const y = l[1];
      if (x === "M" || y === "M") counts.modified++;
      else if (x === "D" || y === "D") counts.deleted++;
      else if (x === "A") counts.added++;
      else if (x === "R") counts.renamed++;
      else counts.other++;
    }
    const parts2: string[] = [];
    if (counts.modified) parts2.push(`${counts.modified} modified`);
    if (counts.deleted) parts2.push(`${counts.deleted} deleted`);
    if (counts.added) parts2.push(`${counts.added} added`);
    if (counts.untracked) parts2.push(`${counts.untracked} untracked`);
    if (counts.renamed) parts2.push(`${counts.renamed} renamed`);
    if (parts2.length === 0 && counts.other) parts2.push(`${counts.other} changed`);
    if (parts2.length) parts.push(`Working tree: ${parts2.join(", ")}`);
  } else {
    parts.push("Working tree: clean");
  }

  const log = runGitCommand(cwd, "git log --oneline -5");
  if (log) parts.push(`Recent commits:\n${log}`);

  return parts.length ? parts.join("\n") : null;
}

/** System context: current date and platform. */
function getSystemContext(): string {
  const now = new Date();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const platforms: Record<string, string> = { darwin: "macOS", linux: "Linux", win32: "Windows" };
  return `Date: ${date} (${days[now.getDay()]}) | Platform: ${platforms[process.platform] || process.platform}`;
}

/** Search persistent memory for entries relevant to the current project. */
function recallMemories(cwd: string): string | null {
  try {
    const store = getMemoryStore();
    const memories = store.list();
    if (memories.length === 0) return null;

    const dirName = basename(cwd);
    const results = store.search(dirName);
    const shown = results.slice(0, 5);
    if (shown.length === 0) return null;

    return shown
      .map((m) => {
        const tags = m.tags.length ? ` [${m.tags.join(", ")}]` : "";
        return `- ${m.content}${tags}`;
      })
      .join("\n");
  } catch {
    return null;
  }
}

/** Recall active tasks from persistent task store. */
function recallTasks(): string | null {
  try {
    const store = getTaskProvider();
    return store.getActiveSummary();
  } catch {
    return null;
  }
}

/** Check for pending/overdue scheduled items. */
function recallSchedules(): string | null {
  try {
    const scheduler = getScheduler();
    return scheduler.getPendingSummary();
  } catch {
    return null;
  }
}

/** Recall recent knowledge entries relevant to the current project. */
function recallKnowledge(cwd: string): string | null {
  try {
    const store = getKnowledgeStore(cwd);
    const entries = store.list({ scope: "project" });
    if (entries.length === 0) return null;

    const shown = entries.slice(0, 5);
    const lines = shown.map((e) => {
      const tags = e.tags.length > 0 ? ` [${e.tags.join(", ")}]` : "";
      return `- ${e.title} (${e.type}/${e.status})${tags}`;
    });
    const more = entries.length > 5 ? `\n(+${entries.length - 5} more entries)` : "";
    return lines.join("\n") + more;
  } catch {
    return null;
  }
}

/** Show hint about the most recent conversation in this directory. */
function recallRecentConversation(cwd: string): string | null {
  try {
    const history = getHistoryProvider();
    const recent = history.getMostRecent(cwd);
    if (!recent) return null;

    const updated = new Date(recent.updatedAt);
    const now = new Date();
    const ageMs = now.getTime() - updated.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    if (ageHours > 168) return null;

    const ago = ageMs < 60000
      ? "just now"
      : ageHours < 1
        ? `${Math.round(ageMs / 60000)} ${Math.round(ageMs / 60000) === 1 ? "minute" : "minutes"} ago`
        : ageHours < 24
          ? `${Math.round(ageHours)} ${Math.round(ageHours) === 1 ? "hour" : "hours"} ago`
          : `${Math.round(ageHours / 24)} ${Math.round(ageHours / 24) === 1 ? "day" : "days"} ago`;

    return `"${recent.title}" (${recent.messageCount} messages, ${ago}). Resume with: kota run --continue`;
  } catch {
    return null;
  }
}

/**
 * Build session warmup context. Gathered once at session start.
 * Returns empty string if nothing useful found.
 */
export function buildSessionWarmup(cwd?: string): string {
  const dir = cwd || process.cwd();
  const sections: string[] = [];

  sections.push(`**Working directory**: ${dir}`);
  sections.push(`**System**: ${getSystemContext()}`);

  const project = detectProject(dir);
  if (project) {
    sections.push(`**Project**: ${project}`);
  } else {
    const env = detectEnvironment(dir);
    if (env) sections.push(`**Environment**: ${env}`);
  }

  const overview = getDirectoryOverview(dir);
  if (overview) sections.push(`**Directory**:\n${overview}`);

  const git = getGitContext(dir);
  if (git) sections.push(`**Git**:\n${git}`);

  const memories = recallMemories(dir);
  if (memories) sections.push(`**Recalled from memory**:\n${memories}`);

  const tasks = recallTasks();
  if (tasks) sections.push(`**Active tasks from previous session**:\n${tasks}`);

  const schedules = recallSchedules();
  if (schedules) sections.push(`**Scheduled reminders**:\n${schedules}`);

  const knowledge = recallKnowledge(dir);
  if (knowledge) sections.push(`**Knowledge base**:\n${knowledge}`);

  const recentConvo = recallRecentConversation(dir);
  if (recentConvo) sections.push(`**Previous conversation**:\n${recentConvo}`);

  if (sections.length === 0) return "";
  return `\n\n## Session Context (auto-detected)\n\n${sections.join("\n\n")}`;
}
