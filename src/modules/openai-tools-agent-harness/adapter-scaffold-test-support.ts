import { beforeEach } from "vitest";
import type { AgentHarness } from "#core/agent-harness/index.js";

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
  const scaffold = await import("./scaffold-harness.js");
  openaiToolsScaffoldAgentHarness = scaffold.openaiToolsScaffoldAgentHarness;
});
