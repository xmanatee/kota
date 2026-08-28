import { apiFetch, apiJson, withScope } from "./client-runtime";
import type {
  AutonomyMode,
  InteractiveSession,
  SlashCommand,
  SlashCommandInvocation,
} from "./types";

export const chatApi = {
  listSessions: (scopeId: string) =>
    apiJson<{ sessions: InteractiveSession[] }>(
      withScope("/api/sessions", scopeId),
    ),
  createSession: (scopeId: string, autonomyMode?: AutonomyMode) =>
    apiJson<{ session_id: string; autonomy_mode?: AutonomyMode }>(
      withScope("/api/sessions", scopeId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          autonomyMode ? { autonomy_mode: autonomyMode } : {},
        ),
      },
    ),
  setSessionAutonomyMode: (id: string, mode: AutonomyMode) =>
    apiJson<{ session_id: string; autonomy_mode: AutonomyMode }>(
      `/api/sessions/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autonomy_mode: mode }),
      },
    ),
  chat: (message: string, sessionId: string) =>
    apiFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, session_id: sessionId }),
    }),
  listSlashCommands: () =>
    apiJson<{ commands: SlashCommand[] }>("/api/commands"),
  invokeSlashCommand: (name: string) =>
    apiJson<SlashCommandInvocation>("/api/commands/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
};
