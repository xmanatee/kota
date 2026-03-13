import type Anthropic from "@anthropic-ai/sdk";
import { shellTool, runShell } from "./shell.js";
import { fileReadTool, runFileRead } from "./file-read.js";
import { fileWriteTool, runFileWrite } from "./file-write.js";
import { fileEditTool, runFileEdit } from "./file-edit.js";
import { grepTool, runGrep } from "./grep.js";
import { globTool, runGlob } from "./glob.js";
import { todoTool, runTodo, getTodoState } from "./todo.js";

export type ToolResult = {
  content: string;
  is_error?: boolean;
};

type ToolRunner = (input: Record<string, unknown>) => Promise<ToolResult>;

const runners: Record<string, ToolRunner> = {
  shell: runShell,
  file_read: runFileRead,
  file_write: runFileWrite,
  file_edit: runFileEdit,
  grep: runGrep,
  glob: runGlob,
  todo: runTodo,
};

export const allTools: Anthropic.Tool[] = [
  shellTool,
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  grepTool,
  globTool,
  todoTool,
];

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const runner = runners[name];
  if (!runner) {
    return { content: `Unknown tool: ${name}`, is_error: true };
  }
  try {
    return await runner(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Tool error: ${msg}`, is_error: true };
  }
}

export { getTodoState };
