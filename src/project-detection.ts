import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  { label: "data file", exts: new Set([".csv", ".tsv", ".json", ".jsonl", ".xlsx", ".xls", ".parquet", ".sqlite", ".db"]) },
  { label: "document", exts: new Set([".md", ".txt", ".pdf", ".doc", ".docx", ".rtf", ".odt"]) },
  { label: "image", exts: new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"]) },
  { label: "script", exts: new Set([".sh", ".bash", ".zsh", ".ps1", ".bat"]) },
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

  const parts = found.map(([label, n]) => `${n} ${label}${n === 1 ? "" : "s"}`);
  return `Workspace with ${parts.join(", ")}`;
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
