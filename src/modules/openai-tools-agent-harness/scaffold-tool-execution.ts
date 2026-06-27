import type { AgentHarnessRunOptions } from "#core/agent-harness/index.js";
import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type { ToolResultEntry } from "#core/tools/tool-runner.js";
import { executeOpenaiToolCalls } from "./adapter-runtime.js";
import { OPENAI_TOOLS_ASK_OWNER_TOOL_NAME } from "./constants.js";
import { SCAFFOLD_TOOL_NAMES } from "./scaffold-tool-definitions.js";
import type { ValidatedToolUseBlock } from "./tool-loop.js";

type OpenaiToolExecutionContext = Parameters<typeof executeOpenaiToolCalls>[2];

function toolUse(
  id: string,
  name: string,
  input: KotaJsonObject,
): ValidatedToolUseBlock {
  return { type: "tool_use", id, name, input };
}

function stringInput(input: KotaJsonObject, key: string): string | null {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringValueInput(input: KotaJsonObject, key: string): string | null {
  const value = input[key];
  return typeof value === "string" ? value : null;
}

function numberInput(
  input: KotaJsonObject,
  key: string,
  fallback: number,
): number {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanInput(input: KotaJsonObject, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayInput(input: KotaJsonObject, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function errorResult(block: ValidatedToolUseBlock, content: string): ToolResultEntry {
  return { tool_use_id: block.id, content, is_error: true };
}

function combineResults(
  block: ValidatedToolUseBlock,
  label: string,
  results: readonly ToolResultEntry[],
): ToolResultEntry {
  const content = results
    .map((result, index) => {
      const status = result.is_error === true ? "error" : "ok";
      return `## ${label}.${index + 1} ${status}\n${result.content}`;
    })
    .join("\n\n");
  return {
    tool_use_id: block.id,
    content,
    is_error: results.some((result) => result.is_error === true),
  };
}

function optionsForUnderlyingTools(
  options: AgentHarnessRunOptions,
): AgentHarnessRunOptions {
  return { ...options, allowedTools: [] };
}

async function runUnderlying(
  blocks: ValidatedToolUseBlock[],
  options: AgentHarnessRunOptions,
  context: OpenaiToolExecutionContext,
): Promise<ToolResultEntry[]> {
  return executeOpenaiToolCalls(blocks, optionsForUnderlyingTools(options), context);
}

function inspectCalls(block: ValidatedToolUseBlock): ValidatedToolUseBlock[] {
  const pattern = stringInput(block.input, "pattern");
  const path = stringInput(block.input, "path");
  const maxResults = numberInput(block.input, "max_results", 80);
  const calls: ValidatedToolUseBlock[] = [
    toolUse(`${block.id}:status`, "git", { op: "status" }),
    toolUse(`${block.id}:overview`, "files_overview", path ? { path } : {}),
  ];
  if (pattern) {
    calls.push(
      toolUse(`${block.id}:glob`, "glob", {
        pattern,
        ...(path ? { path } : {}),
        max_results: maxResults,
      }),
    );
  }
  return calls;
}

function searchReadCalls(block: ValidatedToolUseBlock): ValidatedToolUseBlock[] {
  const pattern = stringInput(block.input, "pattern");
  const path = stringInput(block.input, "path");
  const fileGlob = stringInput(block.input, "file_glob");
  const readPaths = stringArrayInput(block.input, "read_paths");
  const calls: ValidatedToolUseBlock[] = [];
  if (pattern) {
    calls.push(
      toolUse(`${block.id}:grep`, "grep", {
        pattern,
        ...(path ? { path } : {}),
        ...(fileGlob ? { file_glob: fileGlob } : {}),
        max_results: numberInput(block.input, "max_results", 50),
        context_lines: numberInput(block.input, "context_lines", 0),
      }),
    );
  }
  for (const [index, readPath] of readPaths.entries()) {
    calls.push(
      toolUse(`${block.id}:read:${index + 1}`, "file_read", {
        path: readPath,
        limit: 240,
      }),
    );
  }
  return calls;
}

function editCall(block: ValidatedToolUseBlock): ValidatedToolUseBlock | ToolResultEntry {
  const path = stringInput(block.input, "path");
  const oldString = stringInput(block.input, "old_string");
  const newString = stringValueInput(block.input, "new_string");
  if (!path || !oldString || newString === null) {
    return errorResult(
      block,
      "scaffold_edit requires path, old_string, and new_string.",
    );
  }
  return toolUse(`${block.id}:file_edit`, "file_edit", {
    path,
    old_string: oldString,
    new_string: newString,
    ...(booleanInput(block.input, "replace_all") !== undefined
      ? { replace_all: booleanInput(block.input, "replace_all") ?? false }
      : {}),
  });
}

function applyPatchCall(block: ValidatedToolUseBlock): ValidatedToolUseBlock | ToolResultEntry {
  const patch = stringInput(block.input, "patch");
  if (!patch) return errorResult(block, "scaffold_apply_patch requires patch.");
  const encoded = Buffer.from(patch, "utf-8").toString("base64");
  return toolUse(`${block.id}:git_apply`, "shell", {
    command:
      "python3 - <<'PY'\n" +
      "import base64, subprocess\n" +
      `patch = base64.b64decode("${encoded}")\n` +
      "raise SystemExit(subprocess.run(['git', 'apply', '--whitespace=nowarn', '-'], input=patch).returncode)\n" +
      "PY",
    timeout_ms: numberInput(block.input, "timeout_ms", 120_000),
    stream_output: false,
  });
}

function runCommandCall(
  block: ValidatedToolUseBlock,
  suffix: string,
): ValidatedToolUseBlock | ToolResultEntry {
  const command = stringInput(block.input, "command");
  if (!command) return errorResult(block, `${block.name} requires command.`);
  return toolUse(`${block.id}:${suffix}`, "shell", {
    command,
    timeout_ms: numberInput(block.input, "timeout_ms", 120_000),
    stream_output: false,
  });
}

async function executeSingleScaffoldCall(
  block: ValidatedToolUseBlock,
  options: AgentHarnessRunOptions,
  context: OpenaiToolExecutionContext,
): Promise<ToolResultEntry> {
  if (block.name === OPENAI_TOOLS_ASK_OWNER_TOOL_NAME) {
    const [result] = await executeOpenaiToolCalls([block], options, context);
    return result ?? errorResult(block, "ask_owner returned no result.");
  }
  if (options.disallowedTools?.includes(block.name)) {
    return errorResult(block, `Tool "${block.name}" is in disallowedTools and cannot run.`);
  }
  if (
    options.allowedTools &&
    options.allowedTools.length > 0 &&
    !options.allowedTools.includes(block.name)
  ) {
    return errorResult(block, `Tool "${block.name}" is not in allowedTools and cannot run.`);
  }
  if (!SCAFFOLD_TOOL_NAMES.has(block.name)) {
    return errorResult(block, `Unknown scaffold tool: ${block.name}`);
  }
  if (block.name === "scaffold_inspect") {
    return combineResults(
      block,
      block.name,
      await runUnderlying(inspectCalls(block), options, context),
    );
  }
  if (block.name === "scaffold_search_read") {
    const calls = searchReadCalls(block);
    if (calls.length === 0) {
      return errorResult(
        block,
        "scaffold_search_read requires pattern or read_paths.",
      );
    }
    return combineResults(
      block,
      block.name,
      await runUnderlying(calls, options, context),
    );
  }
  if (block.name === "scaffold_edit") {
    const call = editCall(block);
    if ("content" in call) return call;
    return combineResults(block, block.name, await runUnderlying([call], options, context));
  }
  if (block.name === "scaffold_apply_patch") {
    const call = applyPatchCall(block);
    if ("content" in call) return call;
    return combineResults(block, block.name, await runUnderlying([call], options, context));
  }
  if (block.name === "scaffold_run") {
    const call = runCommandCall(block, "run");
    if ("content" in call) return call;
    return combineResults(block, block.name, await runUnderlying([call], options, context));
  }

  const verifyCall = runCommandCall(block, "verify");
  if ("content" in verifyCall) return verifyCall;
  const results = await runUnderlying(
    [verifyCall, toolUse(`${block.id}:diff`, "git", { op: "diff" })],
    options,
    context,
  );
  return {
    ...combineResults(block, block.name, results),
    is_error: results[0]?.is_error === true,
  };
}

export async function executeScaffoldToolCalls(
  toolBlocks: ValidatedToolUseBlock[],
  options: AgentHarnessRunOptions,
  context: OpenaiToolExecutionContext,
): Promise<ToolResultEntry[]> {
  const results: ToolResultEntry[] = [];
  for (const block of toolBlocks) {
    results.push(await executeSingleScaffoldCall(block, options, context));
  }
  return results;
}
