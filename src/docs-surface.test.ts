import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const DOCS_DIR = join(process.cwd(), "docs");
const ALLOWED_DOCS = new Set([
  "docs/AGENTS.md",
  "docs/ARCHITECTURE.md",
  "docs/STANDARDS.md",
]);
const REFERENCE_SCAN_ROOTS = ["AGENTS.md", "docs", "src", "clients", "examples", "schema"];
const TEXT_EXTENSIONS = new Set([".md", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]);
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
  const stat = statSync(path);
  if (stat.isDirectory()) {
    return readdirSync(path)
      .filter((entry) => ![".git", ".turbo", ".next", ".expo", ".build", "dist", "node_modules"].includes(entry))
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
];

describe("docs surface", () => {
  it("keeps durable docs limited to repo-wide guidance", () => {
    const docs = listMarkdown(DOCS_DIR).map((file) => file.slice(process.cwd().length + 1)).sort();

    expect(docs).toEqual([...ALLOWED_DOCS].sort());
  });

  it("keeps generated/checkable protocol catalogs out of durable docs", () => {
    const violations: string[] = [];
    for (const file of listMarkdown(DOCS_DIR)) {
      const relative = file.slice(process.cwd().length + 1);
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
      for (const file of listTextFiles(join(process.cwd(), root))) {
        const relative = file.slice(process.cwd().length + 1);
        if (relative === "src/docs-surface.test.ts") continue;
        const content = readFileSync(file, "utf-8");
        if (retiredDocsPattern.test(content)) violations.push(relative);
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps scoped repo guidance in AGENTS files instead of README inventories", () => {
    const readmes = REFERENCE_SCAN_ROOTS.flatMap((root) => listTextFiles(join(process.cwd(), root)))
      .map((file) => file.slice(process.cwd().length + 1))
      .filter((file) => file.endsWith("/README.md") || file === "README.md")
      .sort();

    expect(readmes).toEqual([]);
  });
});
