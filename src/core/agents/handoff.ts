import type {
  KotaJsonObject,
  KotaJsonValue,
  KotaToolInputSchema,
} from "#core/agent-harness/message-protocol.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { AgentToolPolicy } from "./agent-types.js";

export type AgentHandoffMode = "call" | "transfer";

export type AgentHandoffScope = {
  scopeId: string;
  projectId?: string;
};

export type AgentHandoffBudget = {
  maxTurns: number;
};

export type AgentHandoffTraceLink = {
  causationId: string;
  parentSessionId?: string;
  parentToolUseId?: string;
  parentRunId?: string;
  parentStepId?: string;
  parentSpanId?: string;
};

export type AgentHandoffRequest = {
  agentName: string;
  mode: AgentHandoffMode;
  reason: string;
  input: KotaJsonObject;
  inputSchema?: KotaToolInputSchema;
  outputSchema?: KotaToolInputSchema;
  scope: AgentHandoffScope;
  autonomyMode: AutonomyMode;
  budget: AgentHandoffBudget;
  toolPolicy: AgentToolPolicy;
  writeScope: readonly string[];
  resumeSessionId?: string;
  trace: AgentHandoffTraceLink;
};

export type AgentHandoffResult = {
  kind: "completed";
  agentName: string;
  mode: AgentHandoffMode;
  content: string;
  structuredOutput?: KotaJsonObject;
  childSessionId?: string;
  resumedSessionId?: string;
  turns: number;
  trace: AgentHandoffTraceLink & {
    childSessionId?: string;
  };
};

export type AgentToolPolicyResolution =
  | { ok: true; policy: AgentToolPolicy }
  | { ok: false; message: string };

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function resolveAgentToolPolicy(
  agentPolicy: AgentToolPolicy | undefined,
  requestedPolicy: AgentToolPolicy | undefined,
): AgentToolPolicyResolution {
  const agentAllowed = agentPolicy?.allowed;
  const requestedAllowed = requestedPolicy?.allowed;
  if (agentAllowed && requestedAllowed) {
    const allowedSet = new Set(agentAllowed);
    const outsideAgentPolicy = requestedAllowed.filter((tool) => !allowedSet.has(tool));
    if (outsideAgentPolicy.length > 0) {
      return {
        ok: false,
        message:
          `requested allowed tool(s) exceed the registered agent policy: ` +
          outsideAgentPolicy.sort().join(", "),
      };
    }
  }

  const allowed = requestedAllowed ?? agentAllowed;
  const disallowed = uniqueSorted([
    ...(agentPolicy?.disallowed ?? []),
    ...(requestedPolicy?.disallowed ?? []),
  ]);
  return {
    ok: true,
    policy: {
      ...(allowed !== undefined ? { allowed: uniqueSorted(allowed) } : {}),
      ...(disallowed.length > 0 ? { disallowed } : {}),
    },
  };
}

function formatJson(value: KotaJsonValue | KotaToolInputSchema): string {
  return JSON.stringify(value, null, 2);
}

export function buildAgentHandoffPrompt(request: AgentHandoffRequest): string {
  const lines = [
    `Named agent handoff (${request.mode}) to ${request.agentName}.`,
    "",
    `Reason: ${request.reason}`,
    "",
    "Input:",
    formatJson(request.input),
    "",
    "Trace:",
    formatJson({
      causationId: request.trace.causationId,
      ...(request.trace.parentSessionId ? { parentSessionId: request.trace.parentSessionId } : {}),
      ...(request.trace.parentToolUseId ? { parentToolUseId: request.trace.parentToolUseId } : {}),
      ...(request.trace.parentRunId ? { parentRunId: request.trace.parentRunId } : {}),
      ...(request.trace.parentStepId ? { parentStepId: request.trace.parentStepId } : {}),
      ...(request.trace.parentSpanId ? { parentSpanId: request.trace.parentSpanId } : {}),
      scope: request.scope,
      ...(request.resumeSessionId ? { resumeSessionId: request.resumeSessionId } : {}),
    }),
  ];

  if (request.inputSchema) {
    lines.push("", "Input schema:", formatJson(request.inputSchema));
  }
  if (request.outputSchema) {
    lines.push(
      "",
      "Return a final fenced JSON block matching this output schema:",
      formatJson(request.outputSchema),
    );
  }

  return lines.join("\n");
}
