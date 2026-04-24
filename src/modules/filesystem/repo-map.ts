import { readFileSync } from "node:fs";
import { glob as globFn } from "glob";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolResult } from "#core/tools/index.js";

export const repoMapTool: KotaTool = {
  name: "repo_map",
  description:
    "Generate a structural map of the codebase showing file paths and exported symbols " +
    "(functions, classes, types, constants).",
  input_schema: {
    type: "object" as const,
    properties: {
      directory: {
        type: "string",
        description: "Root directory to scan (default: cwd)",
      },
      pattern: {
        type: "string",
        description: 'Glob pattern for files (default: "**/*.{ts,tsx,js,jsx,py}")',
      },
    },
    required: [],
  },
};

const MAX_FILES = 100;
const MAX_SYMBOLS = 200;

type SymbolPattern = { re: RegExp; format: (m: RegExpMatchArray) => string };

const TS_PATTERNS: SymbolPattern[] = [
  { re: /^export\s+(async\s+)?function\s+(\w+)(.*)/, format: (m) => `  fn ${m[2]}${trimSig(m[3])}` },
  { re: /^export\s+default\s+(async\s+)?function\s*(\w*)(.*)/, format: (m) => `  default fn ${m[2] || "(anon)"}${trimSig(m[3])}` },
  { re: /^export\s+(abstract\s+)?class\s+(\w+)/, format: (m) => `  class ${m[2]}` },
  { re: /^export\s+(?:const|let|var)\s+(\w+)/, format: (m) => `  const ${m[1]}` },
  { re: /^export\s+interface\s+(\w+)/, format: (m) => `  interface ${m[1]}` },
  { re: /^export\s+type\s+(\w+)/, format: (m) => `  type ${m[1]}` },
  { re: /^export\s+enum\s+(\w+)/, format: (m) => `  enum ${m[1]}` },
];

const PY_PATTERNS: SymbolPattern[] = [
  { re: /^(async\s+)?def\s+(\w+)\((.*)/, format: (m) => `  ${m[1] || ""}def ${m[2]}(${trimSig(m[3])}` },
  { re: /^class\s+(\w+)(.*)/, format: (m) => `  class ${m[1]}${trimSig(m[2])}` },
];

export function trimSig(s: string): string {
  const cleaned = s.trim();
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned;
}

export function extractSymbols(content: string, isPython: boolean): string[] {
  const patterns = isPython ? PY_PATTERNS : TS_PATTERNS;
  const symbols: string[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trimStart();
    for (const { re, format } of patterns) {
      const match = trimmed.match(re);
      if (match) {
        symbols.push(format(match));
        break;
      }
    }
  }

  return symbols;
}

export async function runRepoMap(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const directory = (input.directory as string) || ".";
  const pattern = (input.pattern as string) || "**/*.{ts,tsx,js,jsx,py}";

  const files = await globFn(pattern, {
    cwd: directory,
    nodir: true,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/*.d.ts"],
  });

  if (files.length === 0) {
    return { content: "No source files found." };
  }

  const sorted = files.sort();
  const limited = sorted.slice(0, MAX_FILES);
  const output: string[] = [];
  let symbolCount = 0;

  for (const file of limited) {
    if (symbolCount >= MAX_SYMBOLS) break;

    const fullPath = directory === "." ? file : `${directory}/${file}`;
    try {
      const content = readFileSync(fullPath, "utf-8");
      const isPython = file.endsWith(".py");
      const symbols = extractSymbols(content, isPython);

      if (symbols.length > 0) {
        output.push(file);
        const remaining = MAX_SYMBOLS - symbolCount;
        const toAdd = symbols.slice(0, remaining);
        output.push(...toAdd);
        symbolCount += toAdd.length;
      }
    } catch {
      // Skip unreadable files
    }
  }

  if (output.length === 0) {
    return { content: "No exported symbols found in scanned files." };
  }

  const suffix =
    files.length > MAX_FILES
      ? `\n\n[Scanned ${MAX_FILES} of ${files.length} files]`
      : "";

  return { content: output.join("\n") + suffix };
}
export const registration = {
	tool: repoMapTool,
	runner: runRepoMap,
	risk: "safe" as const,
	kind: "discovery" as const,
	group: "advanced_editing",
};
