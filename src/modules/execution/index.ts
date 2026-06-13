/**
 * Execution module — shell commands, background processes, code REPL,
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

import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { localWriteEffect, readOnlyLocalEffect } from "#core/tools/effect.js";
import { cleanupSessions, codeExecTool, runCodeExec } from "./code-exec.js";
import {
  deregisterExecutionCodeRunners,
  registerExecutionCodeRunners,
} from "./code-runner-adapter.js";
import { computerUseTool, runComputerUse } from "./computer-use.js";
import { cleanupProcesses, processTool, runProcess } from "./process.js";
import { runScreenshot, screenshotTool } from "./screenshot.js";
import { runShell, shellTool } from "./shell.js";

const tools: ToolDef[] = [
  {
    tool: shellTool,
    runner: runShell,
    effect: localWriteEffect(),
  },
  {
    tool: processTool,
    runner: runProcess,
    effect: localWriteEffect(),
    group: "management",
  },
  {
    tool: codeExecTool,
    runner: runCodeExec,
    effect: localWriteEffect(),
    group: "code",
  },
  {
    tool: computerUseTool,
    runner: runComputerUse,
    effect: {
      kind: "destructive",
      scope: "operator-surface",
      idempotent: false,
      openWorld: true,
    },
    group: "gui",
  },
  {
    tool: screenshotTool,
    runner: runScreenshot,
    effect: readOnlyLocalEffect(),
    group: "gui",
  },
];

const executionModule: KotaModule = {
  name: "execution",
  version: "1.0.0",
  description:
    "Execution tools: shell, process, code_exec, computer_use, screenshot",
  manifest: {
    schemaVersion: 1,
    capabilities: [
      {
        id: "execution.local-process",
        description:
          "Run shell commands, background processes, and code execution sessions against the local project.",
        scope: "project",
        scopePolicyHooks: ["writes", "retention"],
      },
      {
        id: "execution.gui",
        description: "Capture screenshots and drive local GUI automation through computer-use controls.",
        scope: "global",
        scopePolicyHooks: ["owner-confirmation", "external-effects"],
      },
    ],
    dataClasses: [
      {
        id: "execution.command-output",
        description: "Shell, process, and REPL stdout/stderr returned to the agent.",
        sensitivity: "internal",
        retention: "run-artifact",
        redaction: "metadata-only",
      },
      {
        id: "execution.screenshot",
        description: "Local screen captures and GUI state inspected during computer-use runs.",
        sensitivity: "personal",
        retention: "run-artifact",
        redaction: "metadata-only",
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: [
        "Execution tools can mutate local process, filesystem, REPL, and GUI state and are blocked unless trial mode can isolate the target.",
      ],
    },
  },
  tools,
  onLoad: (ctx) => {
    registerExecutionCodeRunners();
    ctx.registerCleanupHook(() => {
      cleanupProcesses();
      cleanupSessions();
      deregisterExecutionCodeRunners();
    });
  },
};

export default executionModule;
