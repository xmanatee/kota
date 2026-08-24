import type { AgentDef } from "#core/agents/agent-types.js";
import { AUTONOMY_AGENT_DEFAULTS } from "#modules/autonomy/shared.js";

export const builderAgent: AgentDef = {
  name: "builder",
  role: "Ship one cohesive improvement per run by resuming, pulling, or promoting one normalized task.",
  promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  skills: "all",
  // Builder ships arbitrary code changes — its scope is explicitly
  // unrestricted rather than absence-means-unlimited.
  writeScope: [],
};
