/**
 * Push-notification module — owns the entire Expo-push surface.
 *
 * Contributes:
 * - `POST /push-tokens` daemon-control route via `controlRoutes` for mobile
 *   clients to register their Expo push token.
 * - An `approval.requested` bus subscription that fans out to every
 *   registered token through the Expo Push API as a best-effort wake-up
 *   hint. SSE remains the authoritative real-time path.
 *
 * The Expo HTTP call is fire-and-forget. We deliberately do not depend on
 * `notification.postWithRetry` because Expo deliveries here sit below the
 * retry primitive — a queue with no consumer would only delay the wake-up
 * signal and grow unbounded if a client was uninstalled.
 */

import type { KotaModule } from "#core/modules/module-types.js";
import { pushNotificationControlRoutes } from "./routes.js";
import { sendPushNotifications } from "./send.js";

let approvalUnsub: (() => void) | null = null;

const pushNotificationModule: KotaModule = {
  name: "push-notification",
  version: "1.0.0",
  description:
    "Expo push notification delivery for approval.requested with mobile-client token registration",

  controlRoutes: (ctx) => pushNotificationControlRoutes(ctx.cwd),

  onLoad: (ctx) => {
    approvalUnsub = ctx.events.subscribe("approval.requested", (payload) => {
      void sendPushNotifications(
        ctx.cwd,
        {
          approvalId: String(payload.id ?? ""),
          tool: String(payload.tool ?? ""),
          risk: String(payload.risk ?? ""),
          source: String(payload.source ?? ""),
        },
        (msg) => ctx.log.warn(msg),
      );
    });
  },

  onUnload: () => {
    approvalUnsub?.();
    approvalUnsub = null;
  },
};

export default pushNotificationModule;
