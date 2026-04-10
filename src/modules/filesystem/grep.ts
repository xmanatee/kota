import { execSync } from "node:child_process";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "../../core/tools/tool-result.js";

export const grepTool: Anthropic.Tool = {
  name: "grep",
  description:
    "Search file contents using regex patterns. Returns matching lines with file paths and line numbers. " +
    "Use files_only for file lists, count_only for match counts — both reduce output size. " +
    "Do NOT use to find files by name or module only (use glob).",
  input_schema: {
    type: "object" as const,
    properties: {
      pattern: {
        type: "string",
        description: "Regex pattern to search for",
      },
      path: {
        type: "string",
        description: "Directory or file to search in (default: cwd)",
      },
      file_glob: {
        type: "string",
        description: 'Filter files by glob pattern (e.g. "*.ts", "*.py")',
      },
      max_results: {
        type: "number",
        description: "Maximum number of matching lines to return (default: 50)",
      },
      context_lines: {
        type: "number",
        description: "Lines of context to show around each match (default: 0)",
      },
      files_only: {
        type: "boolean",
        description: "Return only file paths that contain matches (no line content)",
      },
      count_only: {
        type: "boolean",
        description: "Return match counts per file (e.g. 'src/foo.ts:12') and total",
      },
    },
    required: ["pattern"],
  },
};

/** Escape a string for safe interpolation inside single quotes in shell commands. */
function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

/** Format rg --count output: add total and filter zero-count lines (grep -c includes them). */
export function formatCountOutput(raw: string): string {
  const lines = raw.split("\n").filter(Boolean);
  const entries: string[] = [];
  let total = 0;
  for (const line of lines) {
    const sep = line.lastIndexOf(":");
    if (sep === -1) continue;
    const count = parseInt(line.slice(sep + 1), 10);
    if (Number.isNaN(count) || count === 0) continue;
    entries.push(line);
    total += count;
  }
  if (entries.length === 0) return "No matches found.";
  return `${entries.join("\n")}\n\nTotal: ${total} matches in ${entries.length} files`;
}

export async function runGrep(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const pattern = input.pattern as string;
  const path = (input.path as string) || ".";
  const fileGlob = input.file_glob as string | undefined;
  const maxResults = (input.max_results as number) || 50;
  const contextLines = (input.context_lines as number) || 0;

  if (!pattern) {
    return { content: "Error: pattern is required", is_error: true };
  }

  // Try ripgrep first, fall back to grep
  const hasRg = (() => {
    try {
      execSync("which rg", { encoding: "utf-8", stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  })();

  const filesOnly = Boolean(input.files_only);
  const countOnly = Boolean(input.count_only);

  let cmd: string;
  if (hasRg) {
    if (filesOnly) {
      cmd = `rg --files-with-matches`;
    } else if (countOnly) {
      cmd = `rg --count`;
    } else {
      cmd = `rg -n --no-heading -m ${maxResults}`;
      if (contextLines > 0) cmd += ` -C ${contextLines}`;
    }
    if (fileGlob) cmd += ` --glob '${shellEscape(fileGlob)}'`;
    cmd += ` '${shellEscape(pattern)}' '${shellEscape(path)}'`;
  } else {
    if (filesOnly) {
      cmd = `grep -rl`;
    } else if (countOnly) {
      cmd = `grep -rc`;
    } else {
      cmd = `grep -rn -m ${maxResults}`;
      if (contextLines > 0) cmd += ` -C ${contextLines}`;
    }
    if (fileGlob) cmd += ` --include='${shellEscape(fileGlob)}'`;
    else if (!filesOnly && !countOnly) cmd += ` --include='${shellEscape("*")}'`;
    cmd += ` '${shellEscape(pattern)}' '${shellEscape(path)}'`;
  }

  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (!output) return { content: "No matches found." };

    if (countOnly) {
      return { content: formatCountOutput(output) };
    }
    return { content: output };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string };
    // grep/rg return exit code 1 for "no matches"
    if (e.status === 1) return { content: "No matches found." };
    return { content: `Search error: ${(err as Error).message}`, is_error: true };
  }
}

export const registration = {
  tool: grepTool,
  runner: runGrep,
  risk: "safe" as const,
  kind: "discovery" as const,
};
