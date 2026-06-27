import type { KotaTool } from "#core/agent-harness/index.js";
import { OPENAI_TOOLS_ASK_OWNER_TOOL_NAME } from "./constants.js";

const SCAFFOLD_SYSTEM_PROMPT = [
  "KOTA scaffold mode is active. Use the scaffold tools instead of raw low-level tools.",
  "Inspect first, make the smallest bounded edit, then call scaffold_verify after every edit path.",
  "If native tool calls are unavailable, return exactly one JSON object: {\"action\":\"scaffold_search_read\",\"input\":{...}}.",
  "After scaffold_verify fails, repair from the verifier output and call scaffold_verify again. Do not claim success without a passing verifier.",
].join("\n");

export const SCAFFOLD_TOOL_NAMES = new Set([
  "scaffold_inspect",
  "scaffold_search_read",
  "scaffold_edit",
  "scaffold_apply_patch",
  "scaffold_run",
  "scaffold_verify",
]);

export const scaffoldTools: readonly KotaTool[] = [
  {
    name: "scaffold_inspect",
    description:
      "Inspect the repository with a compact status, file overview, and optional glob listing before choosing files to read.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: 'Optional glob pattern, such as "src/**/*.ts".',
        },
        path: {
          type: "string",
          description: "Optional base directory for inspection.",
        },
        max_results: {
          type: "number",
          description: "Maximum glob results to include. Default: 80.",
        },
      },
    },
  },
  {
    name: "scaffold_search_read",
    description:
      "Search targeted files and read selected paths in one step. Use this to package context for a smaller model before editing.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Optional regex pattern to search with grep.",
        },
        path: {
          type: "string",
          description: "Directory or file to search in. Default: cwd.",
        },
        file_glob: {
          type: "string",
          description: 'Optional file filter for grep, such as "*.ts".',
        },
        read_paths: {
          type: "array",
          description: "Files to read after searching.",
          items: { type: "string" },
        },
        max_results: {
          type: "number",
          description: "Maximum grep matches. Default: 50.",
        },
        context_lines: {
          type: "number",
          description: "Grep context lines. Default: 0.",
        },
      },
    },
  },
  {
    name: "scaffold_edit",
    description:
      "Apply a bounded exact-string edit through KOTA's file_edit tool. Prefer this for small localized changes.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File to edit." },
        old_string: {
          type: "string",
          description:
            "Exact current text to replace. Include enough surrounding context to make it unique.",
        },
        new_string: { type: "string", description: "Replacement text." },
        replace_all: {
          type: "boolean",
          description: "Replace all exact matches. Default: false.",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "scaffold_apply_patch",
    description:
      "Apply a unified diff patch through KOTA's shell tool. Use when several bounded edits are clearer as one patch.",
    input_schema: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          description: "Unified diff accepted by git apply.",
        },
        timeout_ms: {
          type: "number",
          description: "Patch application timeout. Default: 120000.",
        },
      },
      required: ["patch"],
    },
  },
  {
    name: "scaffold_run",
    description:
      "Run a diagnostic command through KOTA's shell tool with summarized output. Use for tests, builds, or simple probes.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to run in the working directory.",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds. Default: 120000.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "scaffold_verify",
    description:
      "Run the deterministic verifier and include git diff status. This is required after any scaffolded edit path.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Verification command to run." },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds. Default: 120000.",
        },
      },
      required: ["command"],
    },
  },
];

export function buildScaffoldSystemPrompt(base: string | undefined): string {
  return base && base.trim().length > 0
    ? `${base}\n\n${SCAFFOLD_SYSTEM_PROMPT}`
    : SCAFFOLD_SYSTEM_PROMPT;
}

export function selectScaffoldToolDefinitions(
  allowed: readonly string[] | undefined,
  disallowed: readonly string[] | undefined,
  includeAskOwner: boolean,
): KotaTool[] {
  const denySet = new Set(disallowed ?? []);
  const allowSet = allowed && allowed.length > 0 ? new Set(allowed) : null;
  if (includeAskOwner && allowSet) allowSet.add(OPENAI_TOOLS_ASK_OWNER_TOOL_NAME);
  const visible = scaffoldTools.filter((tool) => {
    if (denySet.has(tool.name)) return false;
    if (allowSet && !allowSet.has(tool.name)) return false;
    return true;
  });
  if (!includeAskOwner || denySet.has(OPENAI_TOOLS_ASK_OWNER_TOOL_NAME)) {
    return visible;
  }
  if (allowSet && !allowSet.has(OPENAI_TOOLS_ASK_OWNER_TOOL_NAME)) {
    return visible;
  }
  return [
    ...visible,
    {
      name: OPENAI_TOOLS_ASK_OWNER_TOOL_NAME,
      description: "Ask the repo owner a blocking question.",
      input_schema: {
        type: "object",
        properties: {
          question: { type: "string" },
        },
        required: ["question"],
      },
    },
  ];
}
