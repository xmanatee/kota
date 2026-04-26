/**
 * Push-notification module — owns the entire Expo-push surface.
 *
 * Contributes:
 * - `POST /push-tokens` daemon-control route via `controlRoutes` for mobile
 *   clients to register their Expo push token.
 * - Bus subscriptions that fan each event out to every registered token
 *   through the Expo Push API as a best-effort wake-up hint:
 *     - `approval.requested` → deep-links into the approval detail.
 *     - `workflow.daily.digest` → wakes the mobile DigestScreen for the
 *       08:00 cadence rollup.
 *     - `workflow.attention.digest` → wakes the same screen with an
 *       attention-posture title when something needs the operator.
 *   SSE remains the authoritative real-time path; the push payload's
 *   `data.screen` field deep-links the tap target.
 *
 * The Expo HTTP call is fire-and-forget. We deliberately do not depend on
 * `notification.postWithRetry` because Expo deliveries here sit below the
 * retry primitive — a queue with no consumer would only delay the wake-up
 * signal and grow unbounded if a client was uninstalled.
 */

import type { KotaModule } from "#core/modules/module-types.js";
import { pushNotificationControlRoutes } from "./routes.js";
import { sendDigestPushNotifications, sendPushNotifications } from "./send.js";

let unsubs: (() => void)[] = [];

const pushNotificationModule: KotaModule = {
  name: "push-notification",
  version: "1.0.0",
  description:
    "Expo push notification delivery for approvals and digest events with mobile-client token registration",

  controlRoutes: (ctx) => pushNotificationControlRoutes(ctx.cwd),

  onLoad: (ctx) => {
    unsubs = [
      ctx.events.subscribe("approval.requested", (payload) => {
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
      }),
      ctx.events.subscribe("workflow.daily.digest", (payload) => {
        void sendDigestPushNotifications(
          ctx.cwd,
          {
            title: "KOTA daily digest",
            body: String(payload.text ?? ""),
          },
          (msg) => ctx.log.warn(msg),
        );
      }),
      ctx.events.subscribe("workflow.attention.digest", (payload) => {
        void sendDigestPushNotifications(
          ctx.cwd,
          {
            title: "KOTA needs your attention",
            body: String(payload.text ?? ""),
          },
          (msg) => ctx.log.warn(msg),
        );
      }),
    ];
  },

  onUnload: () => {
    for (const unsub of unsubs) unsub();
    unsubs = [];
  },
};

export default pushNotificationModule;
