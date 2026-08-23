// SSE event envelope shared by `/events` consumers (the chat session
// stream is typed separately under `sessions.ts`).

// Module-contributed UI surfaces declare refresh and log-stream event names at
// runtime, so the transport preserves any daemon event discriminator. Known
// core names are still narrowed by consumers when they need typed payloads.
export type SseEventType = string;

export interface SseEvent {
  type: SseEventType;
  payload: Record<string, unknown>;
  timestamp?: string;
}
