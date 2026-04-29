/**
 * KOTA-native streaming message envelopes emitted by an agent harness adapter
 * to the optional `onMessage` callback on `AgentHarnessRunOptions`. Adapters
 * translate their native runtime frames (claude-agent-sdk SDKMessage, openai
 * chat completion deltas, future Codex/Gemini/Vercel runtime events, …) into
 * one of the variants below before invoking the callback.
 *
 * The protocol is a strict discriminated union — every consumer picks a
 * variant by `type` and reads only the typed fields declared on that variant.
 * Provider-specific frames that do not map onto an existing variant must be
 * surfaced as `KotaAgentRawMessage` with the adapter name and a raw payload,
 * never as a permissive `Record<string, unknown>` arm on the union.
 */
import type { KotaContentBlock } from "./message-protocol.js";

/** Session id the adapter assigned to this run, if any. */
export type KotaAgentMessageEnvelope = {
  sessionId?: string;
};

/** Streaming or final-turn assistant text. */
export type KotaAgentTextMessage = KotaAgentMessageEnvelope & {
  type: "text";
  text: string;
};

/**
 * Assistant reasoning content (e.g. extended-thinking blocks). Adapters that
 * surface a reasoning channel emit one frame per reasoning block; adapters
 * without a reasoning channel never emit this variant.
 */
export type KotaAgentThinkingMessage = KotaAgentMessageEnvelope & {
  type: "thinking";
  thinking: string;
};

/** Assistant tool call. `input` is the validated tool argument object. */
export type KotaAgentToolCallMessage = KotaAgentMessageEnvelope & {
  type: "tool_call";
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
};

/** User-side tool result mirrored back to the model. */
export type KotaAgentToolResultMessage = KotaAgentMessageEnvelope & {
  type: "tool_result";
  toolUseId: string;
  isError: boolean;
  content: string | KotaContentBlock[];
};

/**
 * Adapter or provider status frame the agent emitted (e.g. SDK system
 * announcements, auth status, tool start, queue position). Carries a
 * KOTA-native `category` plus optional human-readable text. Adapters that
 * cannot reduce a frame to one of these fields must use
 * `KotaAgentRawMessage` instead of overloading this variant.
 */
export type KotaAgentStatusMessage = KotaAgentMessageEnvelope & {
  type: "status";
  category: string;
  description?: string;
  toolName?: string;
  output?: string[];
  text?: string;
};

/** Terminal frame announcing the run completed. */
export type KotaAgentResultMessage = KotaAgentMessageEnvelope & {
  type: "result";
  text?: string;
  subtype?: string;
  isError: boolean;
  numTurns?: number;
  totalCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
};

/**
 * Escape hatch for adapter-specific frames that do not fit any KOTA-native
 * variant. The `adapter` field names the harness that emitted the payload so
 * downstream tooling can choose to inspect adapter-specific shapes. Core
 * code should not branch on `payload`; it is opaque.
 */
export type KotaAgentRawMessage = KotaAgentMessageEnvelope & {
  type: "raw";
  adapter: string;
  payload: Record<string, unknown>;
};

export type KotaAgentMessage =
  | KotaAgentTextMessage
  | KotaAgentThinkingMessage
  | KotaAgentToolCallMessage
  | KotaAgentToolResultMessage
  | KotaAgentStatusMessage
  | KotaAgentResultMessage
  | KotaAgentRawMessage;

export type KotaAgentMessageType = KotaAgentMessage["type"];
