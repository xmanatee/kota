import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type {
  AgentHandoffMode,
  AgentHandoffRequest,
} from "#core/agents/handoff.js";
import { assembleDelegateResult } from "./delegate-format.js";
import type { ToolResult } from "./index.js";

export function formatCompletedHandoffResult(input: {
  agentName: string;
  mode: AgentHandoffMode;
  text: string;
  turns: number;
  trace: AgentHandoffRequest["trace"];
  childSessionId?: string;
  resumeSessionId?: string;
  structuredOutput?: KotaJsonObject;
  harnessName: string;
  maxTurns: number;
}): ToolResult {
  const traceWithChild = {
    ...input.trace,
    ...(input.childSessionId ? { childSessionId: input.childSessionId } : {}),
  };
  const structuredContent: KotaJsonObject = {
    kind: "completed",
    agentName: input.agentName,
    mode: input.mode,
    turns: input.turns,
    content: input.text,
    trace: traceWithChild,
    ...(input.childSessionId ? { childSessionId: input.childSessionId } : {}),
    ...(input.resumeSessionId !== undefined
      ? { resumedSessionId: input.resumeSessionId }
      : {}),
    ...(input.structuredOutput ? { structuredOutput: input.structuredOutput } : {}),
  };
  const assembled = assembleDelegateResult(
    input.text,
    {
      mode: `handoff:${input.agentName}`,
      turnsUsed: input.turns,
      turnsMax: input.maxTurns,
      toolsUsed: [input.harnessName],
      completionReason: "done",
      urlsFetched: [],
      searchQueries: [],
    },
    new Set(),
    [],
  );
  return {
    ...assembled,
    structuredContent,
    _meta: { handoff: structuredContent },
  };
}
