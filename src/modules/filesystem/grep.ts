import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { globSync } from "glob";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { isScopePolicyPathWithin } from "#core/daemon/scope-policy-paths.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import {
  isProtectedScopePath,
  protectedScopeGlobIgnores,
  protectedScopePathError,
} from "#core/tools/protected-scope-paths.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { resolvePathThroughExistingAncestor } from "#core/util/real-path.js";
import { resolveToolPath } from "./path-resolver.js";

export const grepTool: KotaTool = {
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

const DEFAULT_MAX_RESULTS = 50;
const MAX_RESULTS_LIMIT = 10_000;
const DEFAULT_CONTEXT_LINES = 0;
const MAX_CONTEXT_LINES_LIMIT = 100;

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
  context?: ToolRunnerContext,
): Promise<ToolResult> {
  const pattern = input.pattern as string;
  const rawPath = (input.path as string) || ".";
  const path = resolveToolPath(rawPath, context);
  const fileGlob = input.file_glob as string | undefined;

  if (!pattern) {
    return { content: "Error: pattern is required", is_error: true };
  }

  const rawMaxResults = input.max_results;
  if (
    rawMaxResults !== undefined &&
    (typeof rawMaxResults !== "number" ||
      !Number.isFinite(rawMaxResults) ||
      !Number.isInteger(rawMaxResults) ||
      rawMaxResults < 1 ||
      rawMaxResults > MAX_RESULTS_LIMIT)
  ) {
    return {
      content: `Error: max_results must be a finite integer between 1 and ${MAX_RESULTS_LIMIT}`,
      is_error: true,
    };
  }
  const maxResults =
    rawMaxResults === undefined ? DEFAULT_MAX_RESULTS : rawMaxResults;

  const rawContextLines = input.context_lines;
  if (
    rawContextLines !== undefined &&
    (typeof rawContextLines !== "number" ||
      !Number.isFinite(rawContextLines) ||
      !Number.isInteger(rawContextLines) ||
      rawContextLines < 0 ||
      rawContextLines > MAX_CONTEXT_LINES_LIMIT)
  ) {
    return {
      content: `Error: context_lines must be a finite integer between 0 and ${MAX_CONTEXT_LINES_LIMIT}`,
      is_error: true,
    };
  }
  const contextLines =
    rawContextLines === undefined ? DEFAULT_CONTEXT_LINES : rawContextLines;

  if (isProtectedScopePath(path, context)) {
    return { content: protectedScopePathError(rawPath), is_error: true };
  }

  // Match runtime exclusions against the real directory when the search root is an alias.
  const searchPath = resolvePathThroughExistingAncestor(path) ?? path;

  // Try ripgrep first, fall back to grep
  const hasRg = (() => {
    try {
      execFileSync("rg", ["--version"], { encoding: "utf-8", stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  })();

  const filesOnly = Boolean(input.files_only);
  const countOnly = Boolean(input.count_only);

  let command: string;
  const args: string[] = ["-H"];
  if (hasRg) {
    command = "rg";
    args.push("--no-config", "--max-depth", "0");
    if (fileGlob) args.push("--glob", fileGlob);
    if (filesOnly) {
      args.push("--files-with-matches");
    } else if (countOnly) {
      args.push("--count");
    } else {
      args.push("-n", "--no-heading", "-m", String(maxResults));
      if (contextLines > 0) args.push("-C", String(contextLines));
    }
  } else {
    command = "grep";
    args.push("-d", "skip");
    if (filesOnly) {
      args.push("-l");
    } else if (countOnly) {
      args.push("-c");
    } else {
      args.push("-n", "-m", String(maxResults));
      if (contextLines > 0) args.push("-C", String(contextLines));
    }
    if (fileGlob) args.push(`--include=${fileGlob}`);
    else if (!filesOnly && !countOnly) args.push("--include=*");
  }

  try {
    // Enumerate names first: recursive content search cannot enforce resolved
    // store identities (including symlinks outside the scope) with glob flags.
    let files: string[];
    if (!statSync(searchPath).isDirectory()) {
      files = [searchPath];
    } else if (hasRg) {
      const listArgs = ["--no-config", "--files", "--null"];
      if (fileGlob) listArgs.push("--glob", fileGlob);
      for (const ignore of protectedScopeGlobIgnores(context)) {
        listArgs.push("--iglob", `!${ignore}`);
      }
      files = executeSearch(command, [...listArgs, "--", searchPath]).split("\0").filter(Boolean);
    } else {
      files = globSync("**/*", {
        cwd: searchPath, absolute: true, dot: true, nodir: true, follow: false,
        ignore: {
          ignored: (entry) => isProtectedScopePath(entry.fullpath(), context),
          childrenIgnored: (entry) => isProtectedScopePath(entry.fullpath(), context),
        },
      });
    }

    const chunks: string[] = [];
    let outputBytes = 0;
    for (let offset = 0; offset < files.length; offset += 64) {
      const batch = files.slice(offset, offset + 64).filter((file) =>
        isScopePolicyPathWithin(searchPath, file) &&
        !isProtectedScopePath(file, context) &&
        statSync(file).isFile(),
      );
      if (batch.length === 0) continue;
      const chunk = executeSearch(command, [...args, "--", pattern, ...batch]);
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > 1024 * 1024) throw new Error("Search output exceeds 1 MiB");
      if (chunk) chunks.push(chunk.trimEnd());
    }
    const output = chunks.join("\n").trim();

    if (!output) return { content: "No matches found." };

    if (countOnly) {
      return { content: formatCountOutput(output) };
    }
    return { content: output };
  } catch (err: unknown) {
    return { content: `Search error: ${(err as Error).message}`, is_error: true };
  }
}

function executeSearch(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    if ((err as { status?: number }).status === 1) return "";
    throw err;
  }
}
