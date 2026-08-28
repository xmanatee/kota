/**
 * Push-notification module — owns the entire Expo-push surface.
 *
 * Contributes:
 * - `POST /push-tokens` daemon-control route via `controlRoutes` for mobile
 *   clients to register their Expo push token.
 * - Bus subscriptions that fan each event out to every registered token
 *   through the Expo Push API as a best-effort wake-up hint:
 *     - `approval.requested` → deep-links into the shared approval action.
 *     - `workflow.daily.digest` → opens the shared daily-digest surface.
 *     - `workflow.attention.digest` → opens the shared inbox surface.
 *   SSE remains the authoritative real-time path; the push payload's
 *   stable surface and action ids identify the tap target.
 *
 * The Expo HTTP call is fire-and-forget. We deliberately do not depend on
 * `notification.postWithRetry` because Expo deliveries here sit below the
 * retry primitive — a queue with no consumer would only delay the wake-up
 * signal and grow unbounded if a client was uninstalled.
 */

import type { KotaModule } from "#core/modules/module-types.js";
import { operatorSurfaceEffect } from "#core/tools/effect.js";
import { pushNotificationControlRoutes } from "./routes.js";
import { sendDigestPushNotifications, sendPushNotifications } from "./send.js";

const pushNotificationModule: KotaModule = {
  name: "push-notification",
  version: "1.0.0",
  description:
    "Expo push notification delivery for approvals and digest events with mobile-client token registration",
  effects: [
    {
      id: "push-notification.expo-delivery",
      description: "Deliver approval and digest wake-up notifications through the Expo Push API.",
      source: "notification",
      effect: operatorSurfaceEffect(),
      capabilityIds: ["push-notification.delivery"],
    },
  ],
  manifest: {
    schemaVersion: 1,
    capabilities: [
      {
        id: "push-notification.tokens",
        description: "Register mobile-client Expo push tokens through the daemon-control route.",
        scope: "scope",
        scopePolicyHooks: ["channels", "retention"],
      },
      {
        id: "push-notification.delivery",
        description: "Send approval and digest wake-up notifications to registered mobile clients.",
        scope: "external",
        scopePolicyHooks: ["channels", "external-effects", "owner-confirmation"],
      },
    ],
    dataClasses: [
      {
        id: "push-notification.tokens",
        description: "Expo push tokens and device ids persisted under the scope runtime directory.",
        sensitivity: "personal",
        retention: "scope-durable",
        redaction: "metadata-only",
      },
      {
        id: "push-notification.payloads",
        description: "Approval ids, digest previews, and mobile deep-link screen identifiers sent in pushes.",
        sensitivity: "internal",
        retention: "operator-visible",
        redaction: "metadata-only",
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: [
        "Expo push delivery is operator-visible external I/O and is blocked in workflow trial mode.",
      ],
    },
  },

  controlRoutes: (ctx) => pushNotificationControlRoutes(ctx.cwd),

  onLoad: (ctx) => {
    const unsubs = [
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
            surfaceId: "daily-digest",
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
            surfaceId: "inbox",
          },
          (msg) => ctx.log.warn(msg),
        );
      }),
    ];
    return { dispose: () => unsubs.forEach((unsubscribe) => unsubscribe()) };
  },
};

export default pushNotificationModule;
