import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const DOCS_DIR = join(REPO_ROOT, "docs");
const AGENTS_LINE_BASELINE_PATH = join(REPO_ROOT, "src", "docs-agents-line-baseline.json");
const ALLOWED_DOCS = new Set([
  "docs/AGENTS.md",
  "docs/ARCHITECTURE.md",
  "docs/STANDARDS.md",
]);
const REFERENCE_SCAN_ROOTS = ["AGENTS.md", "docs", "src", "clients", "examples", "schema"];
const TEXT_EXTENSIONS = new Set([".md", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]);
const SKIPPED_SCAN_DIRECTORIES = new Set([
  ".git",
  ".turbo",
  ".next",
  ".expo",
  ".build",
  ".kota",
  ".worktrees",
  "dist",
  "node_modules",
]);
const retiredDocsPattern =
  /docs\/(?:FOREIGN-MODULES|MCP|DAEMON|DAEMON-API|CONFIG|STORES|WORKFLOWS|LEARNING|NOTIFICATIONS)|(?:FOREIGN-MODULES|MCP|DAEMON|DAEMON-API|CONFIG|STORES|WORKFLOWS|LEARNING|NOTIFICATIONS)\.md/;

function listMarkdown(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...listMarkdown(path));
    } else if (path.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

function listTextFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return [];
  if (stat.isDirectory()) {
    return readdirSync(path)
      .filter((entry) => !SKIPPED_SCAN_DIRECTORIES.has(entry))
      .flatMap((entry) => listTextFiles(join(path, entry)));
  }
  return TEXT_EXTENSIONS.has(extname(path)) ? [path] : [];
}

const forbiddenDocsCatalogPatterns = [
  {
    label: "HTTP route catalog",
    pattern: /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[a-z0-9_/:-]+/i,
  },
  {
    label: "event-name catalog",
    pattern: /`(?:workflow|owner|approval|module)\.[a-z0-9._-]+`/,
  },
  {
    label: "retired docs surface",
    pattern: retiredDocsPattern,
  },
  {
    label: "removed workflow cost forecast surface",
    pattern: /\/workflow\/cost\/forecast|workflow\.cost\.|costAnomaly|onCostAnomaly/,
  },
  {
    label: "external link catalog",
    pattern: /^##\s+(?:External Anchors|External References|References)\b[\s\S]*https?:\/\//mi,
  },
  {
    label: "external best-practice catalog URL",
    pattern: /https?:\/\/(?:docs\.openclaw\.ai|docs\.temporal\.io|www\.home-assistant\.io|developers\.home-assistant\.io|nodered\.org|jsonforms\.io|backstage\.io|textual\.textualize\.io|modelcontextprotocol\.io|openai\.com\/index\/introducing-the-codex-app|github\.com\/(?:vadimdemedes|charmbracelet))\b/i,
  },
];

describe("docs surface", () => {
  it("keeps durable docs limited to repo-wide guidance", () => {
    const docs = listMarkdown(DOCS_DIR).map((file) => file.slice(REPO_ROOT.length + 1)).sort();

    expect(docs).toEqual([...ALLOWED_DOCS].sort());
  });

  it("keeps generated/checkable protocol catalogs out of durable docs", () => {
    const violations: string[] = [];
    for (const file of listMarkdown(DOCS_DIR)) {
      const relative = file.slice(REPO_ROOT.length + 1);
      const content = readFileSync(file, "utf-8");
      for (const { label, pattern } of forbiddenDocsCatalogPatterns) {
        if (pattern.test(content)) violations.push(`${relative}: ${label}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps live surfaces from linking to retired docs catalogs", () => {
    const violations: string[] = [];
    for (const root of REFERENCE_SCAN_ROOTS) {
      for (const file of listTextFiles(join(REPO_ROOT, root))) {
        const relative = file.slice(REPO_ROOT.length + 1);
        if (relative === "src/docs-surface.test.ts") continue;
        const content = readFileSync(file, "utf-8");
        if (retiredDocsPattern.test(content)) violations.push(relative);
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps scoped repo guidance in AGENTS files instead of README inventories", () => {
    const readmes = REFERENCE_SCAN_ROOTS.flatMap((root) => listTextFiles(join(REPO_ROOT, root)))
      .map((file) => file.slice(REPO_ROOT.length + 1))
      .filter((file) => file.endsWith("/README.md") || file === "README.md")
      .sort();

    expect(readmes).toEqual([]);
  });

  it("does not add or grow oversized AGENTS files beyond the ratchet baseline", () => {
    const baseline = JSON.parse(readFileSync(AGENTS_LINE_BASELINE_PATH, "utf8")) as Record<string, number>;
    const current: Record<string, number> = {};
    for (const file of listTextFiles(REPO_ROOT)) {
      const relative = file.slice(REPO_ROOT.length + 1);
      if (!relative.endsWith("AGENTS.md")) continue;
      if (relative.includes("/fixtures/")) continue;
      const content = readFileSync(file, "utf8");
      const lineCount = content === "" ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
      if (lineCount > 100) current[relative] = lineCount;
    }

    const violations: string[] = [];
    for (const [file, lineCount] of Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) {
      const allowed = baseline[file];
      if (allowed === undefined) {
        violations.push(`${file}: new oversized AGENTS.md (${lineCount} lines)`);
      } else if (lineCount > allowed) {
        violations.push(`${file}: ${lineCount} lines exceeds baseline ${allowed}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
