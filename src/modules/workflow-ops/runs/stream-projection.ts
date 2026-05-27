import type {
  KotaAgentMessage,
  KotaAgentMessageType,
} from "#core/agent-harness/index.js";

export type WorkflowRunStreamEventName =
  | "step_output"
  | "step_tool"
  | "step_tool_result"
  | "step_status"
  | "step_result"
  | "step_thinking";

const KOTA_AGENT_MESSAGE_TYPES = new Set<string>([
  "text",
  "thinking",
  "tool_call",
  "tool_result",
  "status",
  "result",
  "raw",
]);

type StreamPayloadBase<TType extends KotaAgentMessageType> = {
  stepId: string;
  messageType: TType;
  sessionId?: string;
};

export type WorkflowRunStreamEvent =
  | {
      eventName: "step_output";
      payload: StreamPayloadBase<"text"> & { text: string };
    }
  | {
      eventName: "step_tool";
      payload: StreamPayloadBase<"tool_call"> & {
        tool: string;
        toolUseId: string;
        input: Extract<KotaAgentMessage, { type: "tool_call" }>["input"];
      };
    }
  | {
      eventName: "step_tool_result";
      payload: StreamPayloadBase<"tool_result"> & {
        toolUseId: string;
        isError: boolean;
        content: Extract<KotaAgentMessage, { type: "tool_result" }>["content"];
      };
    }
  | {
      eventName: "step_status";
      payload: StreamPayloadBase<"status"> & {
        category: string;
        description?: string;
        toolName?: string;
        output?: string[];
        text?: string;
      };
    }
  | {
      eventName: "step_result";
      payload: StreamPayloadBase<"result"> & {
        isError: boolean;
        subtype?: string;
        text?: string;
        numTurns?: number;
        totalCostUsd?: number;
        inputTokens?: number;
        outputTokens?: number;
      };
    }
  | {
      eventName: "step_thinking";
      payload: StreamPayloadBase<"thinking"> & { thinking: string };
    };

export function parseKotaAgentMessageLine(line: string): KotaAgentMessage | null {
  try {
    const message = JSON.parse(line) as KotaAgentMessage | null;
    if (!message || typeof message !== "object") return null;
    if (typeof message.type !== "string") return null;
    if (!KOTA_AGENT_MESSAGE_TYPES.has(message.type)) return null;
    return message;
  } catch {
    return null;
  }
}

export function projectAgentMessageToRunStreamEvents(
  stepId: string,
  message: KotaAgentMessage,
): WorkflowRunStreamEvent[] {
  switch (message.type) {
    case "text":
      if (!message.text) return [];
      return [{
        eventName: "step_output",
        payload: {
          stepId,
          messageType: "text",
          text: message.text,
          ...(message.sessionId !== undefined && { sessionId: message.sessionId }),
        },
      }];
    case "thinking":
      if (!message.thinking) return [];
      return [{
        eventName: "step_thinking",
        payload: {
          stepId,
          messageType: "thinking",
          thinking: message.thinking,
          ...(message.sessionId !== undefined && { sessionId: message.sessionId }),
        },
      }];
    case "tool_call":
      if (!message.toolUseId || !message.toolName) return [];
      return [{
        eventName: "step_tool",
        payload: {
          stepId,
          messageType: "tool_call",
          tool: message.toolName,
          toolUseId: message.toolUseId,
          input: message.input,
          ...(message.sessionId !== undefined && { sessionId: message.sessionId }),
        },
      }];
    case "tool_result":
      if (!message.toolUseId) return [];
      return [{
        eventName: "step_tool_result",
        payload: {
          stepId,
          messageType: "tool_result",
          toolUseId: message.toolUseId,
          isError: message.isError,
          content: message.content,
          ...(message.sessionId !== undefined && { sessionId: message.sessionId }),
        },
      }];
    case "status":
      if (!message.category) return [];
      return [{
        eventName: "step_status",
        payload: {
          stepId,
          messageType: "status",
          category: message.category,
          ...(message.description !== undefined && { description: message.description }),
          ...(message.toolName !== undefined && { toolName: message.toolName }),
          ...(message.output !== undefined && { output: message.output }),
          ...(message.text !== undefined && { text: message.text }),
          ...(message.sessionId !== undefined && { sessionId: message.sessionId }),
        },
      }];
    case "result":
      return [{
        eventName: "step_result",
        payload: {
          stepId,
          messageType: "result",
          isError: message.isError,
          ...(message.subtype !== undefined && { subtype: message.subtype }),
          ...(message.text !== undefined && { text: message.text }),
          ...(message.numTurns !== undefined && { numTurns: message.numTurns }),
          ...(message.totalCostUsd !== undefined && { totalCostUsd: message.totalCostUsd }),
          ...(message.inputTokens !== undefined && { inputTokens: message.inputTokens }),
          ...(message.outputTokens !== undefined && { outputTokens: message.outputTokens }),
          ...(message.sessionId !== undefined && { sessionId: message.sessionId }),
        },
      }];
    case "raw":
      return [];
    default:
      return [];
  }
}
