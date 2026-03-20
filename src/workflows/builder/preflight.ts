import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_FRONTMATTER_KEYS = [
  "id",
  "title",
  "status",
  "priority",
  "area",
  "summary",
] as const;

const REQUIRED_SECTIONS = ["## Problem", "## Desired Outcome", "## Done When"] as const;

export type TaskValidationFailure = {
  file: string;
  reason: string;
};

export type BuilderPreflightResult = {
  validCount: number;
  invalidTasks: TaskValidationFailure[];
};

export function isBuilderPreflightResult(
  value: unknown,
): value is BuilderPreflightResult {
  if (!value || typeof value !== "object") return false;
  return (
    "validCount" in value &&
    typeof (value as BuilderPreflightResult).validCount === "number" &&
    "invalidTasks" in value &&
    Array.isArray((value as BuilderPreflightResult).invalidTasks)
  );
}

export function validateReadyTask(
  _fileName: string,
  content: string,
): { valid: true } | { valid: false; reason: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return { valid: false, reason: "missing frontmatter block" };
  }

  const frontmatter = frontmatterMatch[1];
  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    const lineMatch = frontmatter.match(new RegExp(`^${key}:(.*)$`, "m"));
    if (!lineMatch || !lineMatch[1].trim()) {
      return { valid: false, reason: `missing or empty frontmatter key: ${key}` };
    }
  }

  for (const section of REQUIRED_SECTIONS) {
    const sectionPattern = new RegExp(`${escapeRegex(section)}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`);
    const sectionMatch = content.match(sectionPattern);
    if (!sectionMatch || !sectionMatch[1].trim()) {
      return { valid: false, reason: `missing or empty section: ${section}` };
    }
  }

  return { valid: true };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function runBuilderPreflight(projectDir: string): BuilderPreflightResult {
  const readyDir = join(projectDir, "tasks", "ready");
  if (!existsSync(readyDir)) {
    return { validCount: 0, invalidTasks: [] };
  }

  const files = readdirSync(readyDir).filter(
    (name) => name.endsWith(".md") && name !== "AGENTS.md",
  );

  let validCount = 0;
  const invalidTasks: TaskValidationFailure[] = [];

  for (const file of files) {
    const filePath = join(readyDir, file);
    const content = readFileSync(filePath, "utf-8");
    const result = validateReadyTask(file, content);
    if (result.valid) {
      validCount++;
    } else {
      invalidTasks.push({ file, reason: result.reason });
    }
  }

  return { validCount, invalidTasks };
}
