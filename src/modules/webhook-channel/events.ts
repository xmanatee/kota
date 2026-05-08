/**
 * Typed event declaration owned by the webhook-channel module.
 */

import type { ChannelUserIdentity } from "#core/channels/channel.js";
import { defineDaemonWideModuleEvent } from "#core/events/module-event.js";

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
 *
 * Daemon-wide: webhook-channel sessions are session-bound, and core sessions
 * are still daemon-default until the session-projectId attribution slice
 * lands. This declaration tracks the same boundary as `BusEvents["session.*"]`;
 * it migrates to project scope once sessions carry projectId.
 */
export const webhookChannelSession =
  defineDaemonWideModuleEvent<WebhookChannelSessionPayload>(
    "webhook-channel.session",
    ["sessionId", "identity", "resumed", "source"],
  );
