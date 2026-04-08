/**
 * Execution extension — shell commands, background processes, code REPL,
 * computer use, and screenshot tools.
 *
 * Tools:
 *   shell         — execute shell commands with streaming output
 *   process       — manage background processes (start/output/signal/list)
 *   code_exec     — execute code in a persistent Python or Node.js REPL
 *   computer_use  — control mouse and keyboard for GUI automation
 *   screenshot    — capture a screenshot of the screen
 *
 * This is a high-risk capability surface. Shell, process, and code_exec can
 * execute arbitrary code. computer_use controls the GUI. screenshot is read-only.
 */

import type { KotaExtension, ToolDef } from "../../extension-types.js";
import { codeExecTool, runCodeExec } from "./code-exec.js";
import { computerUseTool, runComputerUse } from "./computer-use.js";
import { processTool, runProcess } from "./process.js";
import { runScreenshot, screenshotTool } from "./screenshot.js";
import { runShell, shellTool } from "./shell.js";

const tools: ToolDef[] = [
  {
    tool: shellTool,
    runner: runShell,
    risk: "moderate",
    kind: "action",
  },
  {
    tool: processTool,
    runner: runProcess,
    risk: "moderate",
    kind: "action",
    group: "management",
  },
  {
    tool: codeExecTool,
    runner: runCodeExec,
    risk: "moderate",
    kind: "action",
    group: "code",
  },
  {
    tool: computerUseTool,
    runner: runComputerUse,
    risk: "moderate",
    kind: "action",
    group: "gui",
  },
  {
    tool: screenshotTool,
    runner: runScreenshot,
    risk: "safe",
    kind: "discovery",
    group: "gui",
  },
];

const executionModule: KotaExtension = {
  name: "execution",
  version: "1.0.0",
  description:
    "Execution tools: shell, process, code_exec, computer_use, screenshot",
  tools,
};

export default executionModule;
