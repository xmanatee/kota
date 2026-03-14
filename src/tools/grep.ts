import type Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";
import type { ToolResult } from "./index.js";

export const grepTool: Anthropic.Tool = {
  name: "grep",
  description:
    "Search file contents using regex patterns. Returns matching lines with file paths and line numbers.",
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
    },
    required: ["pattern"],
  },
};

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

  let cmd: string;
  if (hasRg) {
    cmd = `rg -n --no-heading -m ${maxResults}`;
    if (contextLines > 0) cmd += ` -C ${contextLines}`;
    if (fileGlob) cmd += ` --glob '${fileGlob}'`;
    cmd += ` '${pattern.replace(/'/g, "'\\''")}' '${path}'`;
  } else {
    cmd = `grep -rn --include='${fileGlob || "*"}'`;
    cmd += ` -m ${maxResults}`;
    if (contextLines > 0) cmd += ` -C ${contextLines}`;
    cmd += ` '${pattern.replace(/'/g, "'\\''")}' '${path}'`;
  }

  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (!output) return { content: "No matches found." };
    return { content: output };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string };
    // grep/rg return exit code 1 for "no matches"
    if (e.status === 1) return { content: "No matches found." };
    return { content: `Search error: ${(err as Error).message}`, is_error: true };
  }
}
