// SSE event envelope shared by `/events` consumers (the chat session
// stream is typed separately under `sessions.ts`).

export type SseEventType =
  | 'workflow.started'
  | 'workflow.completed'
  | 'workflow.step.completed'
  | 'queue.changed'
  | 'approval.changed'
  | 'task.changed'
  | 'owner.question.asked'
  | 'owner.question.changed'
  | 'owner.question.resolved'
  | 'owner.question.dismissed'
  | 'owner.question.expired';

export interface SseEvent {
  type: SseEventType;
  payload: Record<string, unknown>;
  timestamp?: string;
}
