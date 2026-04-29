/**
 * Typed event declaration owned by the webhook-channel module.
 */

import type { ChannelUserIdentity } from "#core/channels/channel.js";
import { defineModuleEvent } from "#core/events/module-event.js";

export type WebhookChannelSessionPayload = {
  sessionId: string;
  identity: ChannelUserIdentity;
  resumed: boolean;
  source?: string;
};

/**
 * A webhook-channel session was created or resumed in response to an inbound
 * webhook request. Subscribers (operator dashboards, audit log) use this to
 * observe channel session activity without watching every HTTP route.
 */
export const webhookChannelSession =
  defineModuleEvent<WebhookChannelSessionPayload>(
    "webhook-channel.session",
    ["sessionId", "identity", "resumed", "source"],
  );
