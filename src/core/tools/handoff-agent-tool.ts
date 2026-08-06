import type { KotaTool } from "#core/agent-harness/message-protocol.js";

export const handoffAgentTool: KotaTool = {
  name: "handoff_agent",
  description:
    "Hand work to a registered named KOTA agent through the agent harness. " +
    "Use this when a known specialist AgentDef should own the next segment. " +
    "The request must include explicit autonomy mode, budget, reason, trace links, and any schema expectations.",
  input_schema: {
    type: "object",
    properties: {
      agent: {
        type: "string",
        description: "Registered AgentDef name to run.",
      },
      mode: {
        type: "string",
        enum: ["call", "transfer"],
        description: "call keeps the parent in control; transfer persists the child session when supported.",
      },
      input: {
        type: "object",
        description: "Structured handoff input for the named agent.",
      },
      reason: {
        type: "string",
        description: "Why this handoff is needed.",
      },
      autonomy_mode: {
        type: "string",
        enum: ["passive", "supervised", "autonomous"],
      },
      budget: {
        type: "object",
        properties: {
          max_turns: { type: "number" },
          max_total_tokens: { type: "number" },
        },
        required: ["max_turns"],
        additionalProperties: false,
      },
      input_schema: {
        type: "object",
        description: "Optional JSON Schema used to validate the structured input before dispatch.",
      },
      output_schema: {
        type: "object",
        description: "Optional JSON Schema for a final fenced JSON object returned by the child agent.",
      },
      scope: {
        type: "object",
        properties: {
          scope_id: { type: "string" },
          project_id: { type: "string" },
        },
        required: ["scope_id"],
        additionalProperties: false,
      },
      resume_session_id: {
        type: "string",
        description: "Existing child session id to resume. Only valid with transfer mode.",
      },
      parent: {
        type: "object",
        properties: {
          run_id: { type: "string" },
          step_id: { type: "string" },
          session_id: { type: "string" },
          tool_use_id: { type: "string" },
          span_id: { type: "string" },
        },
        additionalProperties: false,
      },
      allowed_tools: {
        type: "array",
        minItems: 1,
        items: { type: "string" },
        description:
          "Non-empty finite child capability list. The runtime uses it to classify the handoff's aggregate effect; omission is treated as an unbounded external/destructive capability envelope.",
      },
      disallowed_tools: {
        type: "array",
        items: { type: "string" },
      },
      write_scope: {
        type: "array",
        items: { type: "string" },
        description: "Optional narrower write scope for this handoff.",
      },
    },
    required: ["agent", "mode", "input", "reason", "autonomy_mode", "budget", "scope"],
    additionalProperties: false,
  },
  output_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["completed"] },
      agentName: { type: "string" },
      mode: { type: "string", enum: ["call", "transfer"] },
      childSessionId: { type: "string" },
      resumedSessionId: { type: "string" },
      turns: { type: "number" },
      content: { type: "string" },
      trace: { type: "object" },
      structuredOutput: { type: "object" },
    },
    required: ["kind", "agentName", "mode", "turns", "content", "trace"],
  },
};
