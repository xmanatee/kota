import { stat } from "node:fs/promises";
import { join } from "node:path";
import { glob as globFn } from "glob";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import {
  isProtectedProjectPath,
  protectedProjectGlobIgnores,
} from "#core/tools/protected-project-paths.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { resolveToolPath } from "./path-resolver.js";

export const globTool: KotaTool = {
  name: "glob",
  description:
    "Find files matching a glob pattern. Returns paths sorted by modification time (newest first). " +
    "Do NOT use to search file contents by text or pattern (use grep).",
  input_schema: {
    type: "object" as const,
    properties: {
      pattern: {
        type: "string",
        description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.tsx")',
      },
      path: {
        type: "string",
        description: "Base directory to search from (default: cwd)",
      },
      max_results: {
        type: "number",
        description: "Maximum files to return (default: 100)",
      },
    },
    required: ["pattern"],
  },
};

export async function runGlob(
  input: Record<string, unknown>,
  context?: ToolRunnerContext,
): Promise<ToolResult> {
  const pattern = input.pattern as string;
  const rawBasePath = (input.path as string) || ".";
  const basePath = resolveToolPath(rawBasePath, context);
  const maxResults = Math.max(1, (input.max_results as number) || 100);

  if (!pattern) {
    return { content: "Error: pattern is required", is_error: true };
  }

  const files = (await globFn(pattern, {
    cwd: basePath,
    nodir: true,
    ignore: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      ...protectedProjectGlobIgnores(context),
    ],
  })).filter((file) => !isProtectedProjectPath(join(basePath, file), context));

  if (files.length === 0) {
    return { content: "No files matched." };
  }

  // Sort by modification time (newest first)
  const withMtime = await Promise.all(
    files.map(async (f) => {
      try {
        const s = await stat(join(basePath, f));
        return { file: f, mtime: s.mtimeMs };
      } catch {
        return { file: f, mtime: 0 };
      }
    }),
  );
  withMtime.sort((a, b) => b.mtime - a.mtime);

  const limited = withMtime.slice(0, maxResults).map((w) => w.file);
  const result = limited.join("\n");
  const suffix =
    files.length > maxResults
      ? `\n\n[Showing ${maxResults} of ${files.length} matches]`
      : "";

  return { content: result + suffix };
}
