/**
 * Built-in daemon-control routes use the same registration shape as module
 * contributions. Per-domain siblings own parsing and handlers; this file owns
 * only the complete built-in route table and its shared construction inputs.
 */

import type { ServerResponse } from "node:http";
import type { EventJournal } from "#core/events/event-journal.js";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import type { DaemonChatConversationResolver } from "./daemon-chat-handlers.js";
import type { DaemonChatMakeAgent, DaemonChatPool } from "./daemon-chat-pool.js";
import { buildDaemonCoreControlRoutes } from "./daemon-control-core-routes.js";
import { buildDaemonDeadLetterControlRoutes } from "./daemon-control-dead-letter-routes.js";
import { buildDaemonEventControlRoutes } from "./daemon-control-event-routes.js";
import type { DaemonAgentAttemptBoundary } from "./daemon-control-options.js";
import { buildDaemonSessionControlRoutes } from "./daemon-control-session-routes.js";
import { buildDaemonSetupControlRoutes } from "./daemon-control-setup-routes.js";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import { buildDaemonWorkflowControlRoutes } from "./daemon-control-workflow-routes.js";
import type { EventRingBuffer } from "./event-ring-buffer.js";

export type BuiltinControlRouteDeps = {
  handle: DaemonControlHandle;
  eventBuffer: EventRingBuffer;
  eventJournal?: EventJournal;
  sseClients: Set<ServerResponse>;
  chatPool: DaemonChatPool | null;
  makeAgent: DaemonChatMakeAgent | null;
  defaultAutonomyMode: AutonomyMode | undefined;
  chatBindings: DaemonChatBindingStore | null;
  conversationResolver: DaemonChatConversationResolver | null;
  agentAttemptBoundary: DaemonAgentAttemptBoundary | null;
};

export function buildBuiltinControlRoutes(
  deps: BuiltinControlRouteDeps,
): ControlRouteRegistration[] {
  return [
    ...buildDaemonCoreControlRoutes(deps),
    ...buildDaemonEventControlRoutes(deps),
    ...buildDaemonSetupControlRoutes(deps),
    ...buildDaemonDeadLetterControlRoutes(deps),
    ...buildDaemonWorkflowControlRoutes(deps),
    ...buildDaemonSessionControlRoutes(deps),
  ];
}
