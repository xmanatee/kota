import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

const CONTEXT_FILENAME = ".kota.md";
const MAX_CLIMB = 10;
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
export function findProjectContextFiles(startDir?: string): ProjectContextFile[] {
  const cwd = resolve(startDir || process.cwd());
  const found: ProjectContextFile[] = [];
  let dir = cwd;

  for (let i = 0; i < MAX_CLIMB; i++) {
    const candidate = join(dir, CONTEXT_FILENAME);
    if (existsSync(candidate)) {
      try {
        const content = readFileSync(candidate, "utf-8").trim();
        if (content) {
          found.push({ path: candidate, content });
        }
      } catch {
        // Skip unreadable files
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  // Reverse so root-level context comes first, project-level last
  return found.reverse();
}

/**
 * Build a project context string suitable for injection into the system prompt.
 * Returns empty string if no .kota.md files found.
 */
export function loadProjectContext(startDir?: string): string {
  const files = findProjectContextFiles(startDir);
  if (files.length === 0) return "";

  const sections = files.map((f) => {
    let content = f.content;
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.slice(0, MAX_CONTENT_LENGTH) + "\n... (truncated)";
    }
    return `### ${f.path}\n\n${content}`;
  });

  return (
    "\n\n## Project Context (from .kota.md files)\n\n" +
    sections.join("\n\n---\n\n")
  );
}
