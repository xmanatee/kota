import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getHistory } from "./history.js";
import { getMemoryStore } from "./memory.js";
import { getScheduler } from "./scheduler.js";
import { getTaskStore } from "./task-store.js";

/** Detect project type from config files in cwd. */
export function detectProject(cwd: string): string | null {
  const checks: Array<{ file: string; detect: (raw: string) => string }> = [
    {
      file: "package.json",
      detect: (raw) => {
        try {
          const pkg = JSON.parse(raw);
          const parts: string[] = [];
          if (pkg.name) parts.push(pkg.name);

          const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
          const frameworks: string[] = [];
          for (const name of ["react", "next", "vue", "svelte", "express", "fastify", "hono"]) {
            if (allDeps[name]) frameworks.push(name);
          }
          if (frameworks.length) parts.push(`frameworks: ${frameworks.join(", ")}`);

          if (allDeps.typescript) parts.push("TypeScript");
          if (allDeps.vitest || allDeps.jest) parts.push(`tests: ${allDeps.vitest ? "vitest" : "jest"}`);

          const scripts = pkg.scripts ? Object.keys(pkg.scripts).slice(0, 8).join(", ") : "";
          if (scripts) parts.push(`scripts: ${scripts}`);

          return `Node.js project${parts.length ? ` — ${parts.join("; ")}` : ""}`;
        } catch {
          return "Node.js project";
        }
      },
    },
    {
      file: "Cargo.toml",
      detect: (raw) => {
        const nameMatch = raw.match(/^name\s*=\s*"(.+?)"/m);
        return `Rust project${nameMatch ? ` — ${nameMatch[1]}` : ""}`;
      },
    },
    {
      file: "pyproject.toml",
      detect: (raw) => {
        const nameMatch = raw.match(/^name\s*=\s*"(.+?)"/m);
        return `Python project${nameMatch ? ` — ${nameMatch[1]}` : ""}`;
      },
    },
    {
      file: "go.mod",
      detect: (raw) => {
        const modMatch = raw.match(/^module\s+(\S+)/m);
        return `Go project${modMatch ? ` — ${modMatch[1]}` : ""}`;
      },
    },
    { file: "requirements.txt", detect: () => "Python project" },
    { file: "Makefile", detect: () => "Make-based project" },
  ];

  for (const { file, detect } of checks) {
    const path = join(cwd, file);
    if (existsSync(path)) {
      try {
        return detect(readFileSync(path, "utf-8"));
      } catch {
        return detect("");
      }
    }
  }
  return null;
}

const ENV_CATEGORIES: Array<{ label: string; exts: Set<string> }> = [
  { label: "data", exts: new Set([".csv", ".tsv", ".json", ".jsonl", ".xlsx", ".xls", ".parquet", ".sqlite", ".db"]) },
  { label: "documents", exts: new Set([".md", ".txt", ".pdf", ".doc", ".docx", ".rtf", ".odt"]) },
  { label: "images", exts: new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"]) },
  { label: "scripts", exts: new Set([".sh", ".bash", ".zsh", ".ps1", ".bat"]) },
];

/** Characterize a non-code directory by the types of files it contains. */
export function detectEnvironment(cwd: string): string | null {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(cwd, { withFileTypes: true });
  } catch {
    return null;
  }

  const counts: Record<string, number> = {};
  let fileCount = 0;
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith(".")) continue;
    fileCount++;
    const dot = e.name.lastIndexOf(".");
    if (dot < 1) continue;
    const ext = e.name.slice(dot).toLowerCase();
    for (const cat of ENV_CATEGORIES) {
      if (cat.exts.has(ext)) {
        counts[cat.label] = (counts[cat.label] || 0) + 1;
      }
    }
  }

  if (fileCount === 0) return null;

  const found = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (found.length === 0) return null;

  const parts = found.map(([label, n]) => `${n} ${label}`);
  return `Workspace with ${parts.join(", ")} file${fileCount > 1 ? "s" : ""}`;
}

/** Get git state: branch, status summary, recent commits. */
function getGitContext(cwd: string): string | null {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
  } catch {
    return null;
  }

  const parts: string[] = [];
  try {
    const branch = execSync("git branch --show-current", { cwd, stdio: "pipe" }).toString().trim();
    if (branch) parts.push(`Branch: ${branch}`);
  } catch { /* ignore */ }

  try {
    const status = execSync("git status --porcelain", { cwd, stdio: "pipe" }).toString().trim();
    if (status) {
      const lines = status.split("\n");
      const modified = lines.filter((l) => l.startsWith(" M") || l.startsWith("M ")).length;
      const added = lines.filter((l) => l.startsWith("A ") || l.startsWith("??")).length;
      const parts2: string[] = [];
      if (modified) parts2.push(`${modified} modified`);
      if (added) parts2.push(`${added} untracked/added`);
      if (parts2.length) parts.push(`Working tree: ${parts2.join(", ")}`);
    } else {
      parts.push("Working tree: clean");
    }
  } catch { /* ignore */ }

  try {
    const log = execSync("git log --oneline -5 2>/dev/null", { cwd, stdio: "pipe" }).toString().trim();
    if (log) parts.push(`Recent commits:\n${log}`);
  } catch { /* ignore */ }

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
  const store = getMemoryStore();
  const memories = store.list();
  if (memories.length === 0) return null;

  // Search by directory basename and parent basename
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
}

/** Recall active tasks from persistent task store. */
function recallTasks(): string | null {
  const store = getTaskStore();
  return store.getActiveSummary();
}

/** Check for pending/overdue scheduled items. */
function recallSchedules(): string | null {
  const scheduler = getScheduler();
  return scheduler.getPendingSummary();
}

/** Show hint about the most recent conversation in this directory. */
function recallRecentConversation(cwd: string): string | null {
  try {
    const history = getHistory();
    const recent = history.getMostRecent(cwd);
    if (!recent) return null;

    const updated = new Date(recent.updatedAt);
    const now = new Date();
    const ageMs = now.getTime() - updated.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    // Only show if conversation is recent (< 7 days)
    if (ageHours > 168) return null;

    const ago = ageHours < 1
      ? `${Math.round(ageMs / 60000)} minutes ago`
      : ageHours < 24
        ? `${Math.round(ageHours)} hours ago`
        : `${Math.round(ageHours / 24)} days ago`;

    return `"${recent.title}" (${recent.messageCount} messages, ${ago}). Resume with: kota run --continue`;
  } catch {
    return null;
  }
}

/** List top-level files and directories, skipping noise. */
export function getDirectoryOverview(cwd: string): string | null {
  const skipDirs = new Set([
    "node_modules", "dist", "build", "__pycache__", "target", "coverage",
  ]);
  try {
    const entries = readdirSync(cwd, { withFileTypes: true });
    const dirs: string[] = [];
    const files: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) dirs.push(`${e.name}/`);
      } else if (e.isFile()) {
        files.push(e.name);
      }
    }
    if (dirs.length === 0 && files.length === 0) return null;
    const parts: string[] = [];
    if (dirs.length > 0) {
      const shown = dirs.slice(0, 10);
      const more = dirs.length > 10 ? ` (+${dirs.length - 10} more)` : "";
      parts.push(`Dirs: ${shown.join(", ")}${more}`);
    }
    if (files.length > 0) {
      const shown = files.slice(0, 15);
      const more = files.length > 15 ? ` (+${files.length - 15} more)` : "";
      parts.push(`Files: ${shown.join(", ")}${more}`);
    }
    return parts.join("\n");
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

  const recentConvo = recallRecentConversation(dir);
  if (recentConvo) sections.push(`**Previous conversation**:\n${recentConvo}`);

  if (sections.length === 0) return "";
  return `\n\n## Session Context (auto-detected)\n\n${sections.join("\n\n")}`;
}
