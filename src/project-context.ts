import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveScopedSearch } from "#core/util/path-scope.js";

const CONTEXT_FILENAME = ".kota.md";
const MAX_CONTENT_LENGTH = 8_000;

type ProjectContextFile = {
  path: string;
  content: string;
};

/**
 * Walk up the directory tree from `startDir`, collecting all .kota.md files.
 * Returns them root-first (outermost ancestor first), so more-specific
 * project context appears last and can override general context.
 */
export function findProjectContextFiles(
  startDir?: string,
  rootDir?: string,
): ProjectContextFile[] {
  const scope = resolveScopedSearch(startDir, rootDir);
  const found: ProjectContextFile[] = [];
  let dir = scope.startDir;

  while (true) {
    const candidate = join(dir, CONTEXT_FILENAME);
    if (existsSync(candidate)) {
      const content = readFileSync(candidate, "utf-8").trim();
      if (content) {
        found.push({ path: candidate, content });
      }
    }

    if (dir === scope.rootDir) break;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return found.reverse();
}

/**
 * Build a project context string suitable for injection into the system prompt.
 * Returns empty string if no .kota.md files found.
 */
export function loadProjectContext(startDir?: string, rootDir?: string): string {
  const files = findProjectContextFiles(startDir, rootDir);
  if (files.length === 0) return "";

  const sections = files.map((f) => {
    let content = f.content;
    if (content.length > MAX_CONTENT_LENGTH) {
      content = `${content.slice(0, MAX_CONTENT_LENGTH)}\n... (truncated)`;
    }
    return `### ${f.path}\n\n${content}`;
  });

  return (
    "\n\n## Project Context (from .kota.md files)\n\n" +
    sections.join("\n\n---\n\n")
  );
}
