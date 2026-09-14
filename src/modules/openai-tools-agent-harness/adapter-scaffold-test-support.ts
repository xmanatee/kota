import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach } from "vitest";
import type { AgentHarness } from "#core/agent-harness/index.js";
import { registerTool, type ToolRunner } from "#core/tools/index.js";
import executionModule from "#modules/execution/index.js";
import filesystemModule from "#modules/filesystem/index.js";
import gitModule from "#modules/git/index.js";
import "./adapter-shared-runner-test-support.js";

export {
  makeStubStream,
  messagesStreamMock,
  queueEnd,
  queueToolUse,
  streamCallSnapshots,
  streamReturnQueue,
} from "./adapter-shared-runner-test-support.js";

export let openaiToolsScaffoldAgentHarness: AgentHarness;
const disposers: Array<() => void> = [];

beforeEach(async () => {
  const underlyingTools = new Set([
    "file_edit", "file_read", "files_overview", "git", "glob", "grep", "shell",
  ]);
  for (const module of [filesystemModule, executionModule, gitModule]) {
    if (!Array.isArray(module.tools)) throw new Error("Expected static fixture tools");
    for (const definition of module.tools) {
      if (underlyingTools.has(definition.tool.name)) {
        disposers.push(registerTool(
          definition.tool,
          definition.tool.name === "shell" ? runFixtureVerifier : definition.runner,
          module.name,
          definition,
        ));
      }
    }
  }
  const scaffold = await import("./scaffold-harness.js");
  openaiToolsScaffoldAgentHarness = scaffold.openaiToolsScaffoldAgentHarness;
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

// The adapter owns edit/verify sequencing. This bounded verifier executes the real
// temporary fixture in a fresh Node process with fixed argv. General shell launch
// and its platform sandbox remain with the execution owner.
const runFixtureVerifier: ToolRunner = async (input, context) => {
  if (input.command !== "node test.cjs" || !context?.cwd) {
    throw new Error("Expected node test.cjs in a temporary fixture directory");
  }
  try {
    await promisify(execFile)(process.execPath, ["test.cjs"], {
      cwd: context.cwd, signal: context.signal, timeout: 10_000,
    });
    return { content: "Fixture verifier passed" };
  } catch (error) {
    return { content: String(error), is_error: true };
  }
};
