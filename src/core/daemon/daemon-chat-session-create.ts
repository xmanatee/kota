import type { IncomingMessage, ServerResponse } from "node:http";
import type { KotaJsonObject, KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import type { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import type { DaemonChatMakeAgent, DaemonChatPool } from "./daemon-chat-pool.js";
import { readChatBody } from "./daemon-chat-request.js";
import { jsonResponse } from "./daemon-control-utils.js";
import type { ScopeHostingState } from "./scope-lifecycle-types.js";
import type { ProjectId } from "./scope-registry.js";

export type DaemonChatConversationResolver = {
  conversationExists(conversationId: string, projectId: ProjectId): boolean;
  createConversation(mode: AutonomyMode, projectId: ProjectId): string;
};

export type DaemonChatSessionAdmission = () =>
  | { ok: true }
  | {
      ok: false;
      reason: "scope_not_hosted";
      scopeId: ProjectId;
      state: Exclude<ScopeHostingState, "hosted">;
    };

export async function handleCreateDaemonSession(
  pool: DaemonChatPool,
  bindings: DaemonChatBindingStore,
  req: IncomingMessage,
  res: ServerResponse,
  makeAgent: DaemonChatMakeAgent,
  defaultAutonomyMode: AutonomyMode | undefined,
  projectId: ProjectId,
  resolver: DaemonChatConversationResolver,
  admitSession: DaemonChatSessionAdmission,
): Promise<void> {
  let body: KotaJsonObject;
  try {
    body = await readChatBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  const raw = body.autonomy_mode;
  let mode = defaultAutonomyMode;
  if (raw !== undefined) {
    if (!isAutonomyMode(raw)) {
      jsonResponse(res, 400, { error: "autonomy_mode must be one of: passive, supervised, autonomous" });
      return;
    }
    mode = raw;
  }
  if (mode === undefined) {
    jsonResponse(res, 400, { error: "autonomy_mode is required because no default autonomy mode is configured" });
    return;
  }

  const requestedSessionId = typeof body.session_id === "string" ? body.session_id : undefined;
  const requestedConversationId = typeof body.conversation_id === "string" ? body.conversation_id : undefined;
  try {
    rejectClientSuppliedMcpServers(body.mcp_servers);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  let wakeSessionId: string | undefined;
  let conversationId: string | undefined;
  let createConversation = false;

  if (requestedSessionId) {
    const live = pool.get(requestedSessionId);
    if (live) {
      jsonResponse(res, 409, {
        error: "Session already live",
        session_id: live.id,
        conversation_id: live.conversationId,
      });
      return;
    }
    const binding = bindings.getBySession(requestedSessionId);
    if (!binding) {
      jsonResponse(res, 404, { error: `No binding for session ${requestedSessionId}` });
      return;
    }
    if (binding.projectId !== projectId) {
      jsonResponse(res, 409, {
        error: `Session ${requestedSessionId} is bound to project ${binding.projectId}, not ${projectId}`,
      });
      return;
    }
    if (requestedConversationId && requestedConversationId !== binding.conversationId) {
      jsonResponse(res, 409, {
        error: `Session ${requestedSessionId} is bound to ${binding.conversationId}, not ${requestedConversationId}`,
      });
      return;
    }
    if (!resolver.conversationExists(binding.conversationId, projectId)) {
      jsonResponse(res, 404, {
        error: `Bound conversation ${binding.conversationId} not found in history`,
      });
      return;
    }
    wakeSessionId = requestedSessionId;
    conversationId = binding.conversationId;
  } else if (requestedConversationId) {
    if (!resolver.conversationExists(requestedConversationId, projectId)) {
      jsonResponse(res, 404, { error: `Conversation ${requestedConversationId} not found in history` });
      return;
    }
    const existingBinding = bindings.getByConversation(requestedConversationId);
    if (existingBinding) {
      if (existingBinding.projectId !== projectId) {
        jsonResponse(res, 409, {
          error: `Conversation ${requestedConversationId} is bound to project ${existingBinding.projectId}, not ${projectId}`,
        });
        return;
      }
      const live = pool.get(existingBinding.sessionId);
      if (live) {
        jsonResponse(res, 409, {
          error: "Session already live for this conversation",
          session_id: live.id,
          conversation_id: live.conversationId,
        });
        return;
      }
      wakeSessionId = existingBinding.sessionId;
    }
    conversationId = requestedConversationId;
  } else {
    createConversation = true;
  }

  const admission = admitSession();
  if (!admission.ok) {
    jsonResponse(res, 409, {
      error: `Scope ${admission.scopeId} is ${admission.state} and cannot accept sessions`,
      reason: admission.reason,
      scopeId: admission.scopeId,
      state: admission.state,
    });
    return;
  }

  if (createConversation) {
    try {
      conversationId = resolver.createConversation(mode, projectId);
    } catch (err) {
      jsonResponse(res, 503, { error: (err as Error).message });
      return;
    }
  }

  if (conversationId === undefined) {
    jsonResponse(res, 500, { error: "Session conversation was not resolved" });
    return;
  }

  try {
    const session = pool.create(makeAgent, mode, conversationId, {
      projectId,
      ...(wakeSessionId !== undefined ? { sessionId: wakeSessionId } : {}),
    });
    bindings.put(session.id, session.conversationId, session.projectId);
    jsonResponse(res, 201, {
      session_id: session.id,
      autonomy_mode: mode,
      project_id: session.projectId,
      conversation_id: session.conversationId,
    });
  } catch (err) {
    jsonResponse(res, 503, { error: (err as Error).message });
  }
}

function rejectClientSuppliedMcpServers(value: KotaJsonValue | undefined): void {
  if (value === undefined) return;
  if (!isJsonObject(value)) {
    throw new Error("mcp_servers must be an object");
  }
  if (Object.keys(value).length > 0) {
    throw new Error(
      "client-supplied mcp_servers are not supported by daemon sessions; configure MCP servers in project config",
    );
  }
}

function isJsonObject(value: KotaJsonValue | undefined): value is KotaJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
