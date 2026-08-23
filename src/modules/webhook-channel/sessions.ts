import type { ModuleContext } from "#core/modules/module-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";

export type WebhookSession = {
  id: string;
  createdAt: string;
  send: (prompt: string) => Promise<string>;
  close: () => void;
};

export type WebhookSessionFactory = (options: {
  label: string;
  autonomyMode: AutonomyMode;
  ctx: ModuleContext;
}) => Pick<WebhookSession, "send" | "close">;

export const directSessions = new Map<string, WebhookSession>();
export const sourceSessions = new Map<string, WebhookSession>();
let nextSessionId = 1;

export function generateWebhookSessionId(): string {
  return `wh-${Date.now().toString(36)}-${(nextSessionId++).toString(36)}`;
}

export function createAgentSession({
  label,
  autonomyMode,
  ctx,
}: {
  label: string;
  autonomyMode: AutonomyMode;
  ctx: ModuleContext;
}): Pick<WebhookSession, "send" | "close"> {
  const agent = ctx.createSession({
    autonomyMode,
    model: ctx.config.model,
    label,
    noHistory: false,
    historySource: "action",
    reflectionEnabled: false,
  });
  return {
    send: (prompt) => agent.send(prompt),
    close: () => agent.close(),
  };
}

export function clearSessions(): void {
  for (const session of directSessions.values()) session.close();
  directSessions.clear();
  for (const session of sourceSessions.values()) session.close();
  sourceSessions.clear();
  nextSessionId = 1;
}

export function listWebhookSessionIds(): string[] {
  return [...directSessions.values(), ...sourceSessions.values()].map(
    (session) => `webhook:${session.id}`,
  );
}
