import type { EventBus } from "../event-bus.js";
import { callTelegramApi } from "../telegram-client.js";

function buildNotificationText(
  id: string,
  tool: string,
  risk: string,
  reason: string,
): string {
  return [
    `Approval required: *${tool}*`,
    `Risk: ${risk}`,
    `Reason: ${reason}`,
    `ID: \`${id}\``,
    ``,
    `kota approval approve ${id}`,
    `kota approval reject ${id}`,
  ].join("\n");
}

export function subscribeApprovalNotification(
  bus: EventBus,
  log?: (message: string) => void,
): () => void {
  return bus.on("approval.requested", (payload) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    if (!token || !chatId) return;

    const text = buildNotificationText(
      payload.id,
      payload.tool,
      payload.risk,
      payload.reason,
    );

    void callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }).catch((err: unknown) => {
      log?.(`Failed to send approval notification: ${(err as Error).message}`);
    });
  });
}
