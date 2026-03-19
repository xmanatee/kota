import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";

export const filesOverviewTool: Anthropic.Tool = {
  name: "files_overview",
  description:
    "Scan a directory and return a structured overview: file counts by type, sizes, and content previews (headings for markdown, columns for CSV, keys for JSON). More informative than glob (paths only) but cheaper than reading each file individually.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Directory to analyze (default: cwd)",
      },
      max_depth: {
        type: "number",
        description: "Max recursion depth (default: 2, 0 = current dir only)",
      },
    },
    required: [],
  },
};

const EXT_CAT: Record<string, string> = {};
for (const [cat, exts] of [
  ["Documents", ".md .txt .rst .pdf .doc .docx .rtf .org"],
  ["Data", ".csv .tsv .json .jsonl .xml .yaml .yml .toml .sql .sqlite .db"],
  ["Code", ".ts .tsx .js .jsx .py .go .rs .java .c .cpp .h .hpp .rb .php .swift .kt"],
  ["Images", ".png .jpg .jpeg .gif .webp .svg .ico .bmp"],
  ["Config", ".env .ini .cfg .conf .properties .editorconfig"],
  ["Shell", ".sh .bash .zsh .fish .ps1 .bat .cmd"],
  ["Styles", ".css .scss .sass .less"],
])
  for (const e of exts.split(" ")) EXT_CAT[e] = cat;

export function categorize(ext: string): string {
  return EXT_CAT[ext.toLowerCase()] ?? "Other";
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

interface Entry { path: string; size: number; category: string; preview?: string }

const PREVIEWABLE = new Set([
  ".md", ".txt", ".rst", ".org", ".csv", ".tsv", ".json", ".yaml", ".yml", ".toml",
]);

async function getPreview(
  filePath: string, ext: string, size: number,
): Promise<string | undefined> {
  if (size === 0) return "(empty)";
  if (size > 50_000 || !PREVIEWABLE.has(ext.toLowerCase())) return undefined;

  try {
    const text = await readFile(filePath, "utf-8");
    const lo = ext.toLowerCase();

    if ([".md", ".txt", ".rst", ".org"].includes(lo)) {
      const lines = text.split("\n").filter((l) => l.trim());
      return (lines.find((l) => l.startsWith("#")) ?? lines[0])?.slice(0, 80);
    }

    if (lo === ".csv" || lo === ".tsv") {
      const lines = text.split("\n").filter((l) => l.trim());
      const sep = lo === ".tsv" ? "\t" : ",";
      const cols = lines[0]?.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
      if (!cols) return undefined;
      const rows = lines.length - 1;
      const colStr = cols.slice(0, 8).join(", ");
      const extra = cols.length > 8 ? ` (+${cols.length - 8})` : "";
      return `${rows} rows, columns: ${colStr}${extra}`;
    }

    if (lo === ".json") {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return `array[${parsed.length}]`;
        if (parsed && typeof parsed === "object") {
          const keys = Object.keys(parsed);
          const keyStr = keys.slice(0, 6).join(", ");
          const extra = keys.length > 6 ? ` (+${keys.length - 6})` : "";
          return `keys: ${keyStr}${extra}`;
        }
      } catch { return undefined; }
    }

    if ([".yaml", ".yml", ".toml"].includes(lo)) {
      const topKeys = text
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("#") && l !== "---")
        .filter((l) => /^\S/.test(l))
        .slice(0, 5)
        .map((l) => l.split(/[=:]/)[0]?.trim());
      if (topKeys.length) return `keys: ${topKeys.join(", ")}`;
    }

    return undefined;
  } catch { return undefined; }
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "__pycache__", ".next", ".venv", "venv", "coverage", ".cache",
]);

async function scan(
  dir: string, maxDepth: number, depth = 0,
): Promise<{ files: Entry[]; dirs: string[] }> {
  const files: Entry[] = [];
  const dirs: string[] = [];

  let entries: import("node:fs").Dirent[];
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return { files, dirs }; }

  for (const e of entries) {
    if (SKIP_DIRS.has(e.name) || (e.name.startsWith(".") && e.name !== ".env")) continue;
    const full = join(dir, e.name);

    if (e.isDirectory()) {
      dirs.push(e.name);
      if (depth < maxDepth) {
        const sub = await scan(full, maxDepth, depth + 1);
        files.push(...sub.files.map((f) => ({ ...f, path: join(e.name, f.path) })));
      }
    } else if (e.isFile()) {
      try {
        const s = await stat(full);
        const ext = extname(e.name);
        files.push({
          path: e.name,
          size: s.size,
          category: categorize(ext),
          preview: await getPreview(full, ext, s.size),
        });
      } catch { /* skip inaccessible */ }
    }
  }
  return { files, dirs };
}

export async function runFilesOverview(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const basePath = (input.path as string) || ".";
  const maxDepth = (input.max_depth as number) ?? 2;

  try {
    const s = await stat(basePath);
    if (!s.isDirectory()) {
      return { content: `Error: ${basePath} is not a directory`, is_error: true };
    }
  } catch {
    return { content: `Error: Directory not found: ${basePath}`, is_error: true };
  }

  const { files, dirs } = await scan(basePath, maxDepth);
  if (files.length === 0 && dirs.length === 0) {
    return { content: `Directory ${basePath} is empty.` };
  }

  const groups: Record<string, Entry[]> = {};
  for (const f of files) (groups[f.category] ??= []).push(f);

  const total = files.reduce((sum, f) => sum + f.size, 0);
  const lines = [
    `Directory: ${basePath} (${files.length} files, ${dirs.length} subdirs, ${fmtSize(total)} total)`,
  ];
  if (dirs.length) lines.push(`Subdirectories: ${dirs.join(", ")}`);
  lines.push("");

  for (const [cat, cf] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
    const catSize = cf.reduce((sum, f) => sum + f.size, 0);
    lines.push(`${cat} (${cf.length} files, ${fmtSize(catSize)}):`);
    cf.sort((a, b) => b.size - a.size);
    for (const f of cf.slice(0, 20)) {
      let l = `  ${f.path} (${fmtSize(f.size)})`;
      if (f.preview) l += ` — ${f.preview}`;
      lines.push(l);
    }
    if (cf.length > 20) lines.push(`  ... and ${cf.length - 20} more`);
    lines.push("");
  }

  return { content: lines.join("\n") };
}
export const registration = {
	tool: filesOverviewTool,
	runner: runFilesOverview,
	risk: "safe" as const,
	kind: "discovery" as const,
};
