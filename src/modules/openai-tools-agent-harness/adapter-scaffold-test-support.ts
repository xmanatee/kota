import { beforeEach } from "vitest";
import type { AgentHarness } from "#core/agent-harness/index.js";
import {
  getAllToolsMock,
  tool,
} from "./adapter-shared-runner-test-support.js";

export {
  executeToolMock,
  makeStubStream,
  messagesStreamMock,
  queueEnd,
  queueToolUse,
  streamCallSnapshots,
  streamReturnQueue,
} from "./adapter-shared-runner-test-support.js";

export let openaiToolsScaffoldAgentHarness: AgentHarness;

beforeEach(async () => {
  getAllToolsMock.mockReturnValue([
    "file_edit",
    "file_read",
    "files_overview",
    "git",
    "glob",
    "grep",
    "shell",
  ].map(tool));
  const scaffold = await import("./scaffold-harness.js");
  openaiToolsScaffoldAgentHarness = scaffold.openaiToolsScaffoldAgentHarness;
});
