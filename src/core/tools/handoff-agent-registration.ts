import { localWriteEffect } from "./effect.js";
import { runHandoffAgent } from "./handoff-agent.js";
import { resolveHandoffAgentEffect } from "./handoff-agent-effect.js";
import { handoffAgentTool } from "./handoff-agent-tool.js";

export const registration = {
  tool: handoffAgentTool,
  runner: runHandoffAgent,
  effect: localWriteEffect(),
  resolveEffect: resolveHandoffAgentEffect,
};
