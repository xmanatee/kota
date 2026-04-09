/**
 * Notifications extension — owns quiet-hours gating and extension crash alerts.
 *
 * NotificationGate holds non-critical bus events during configured quiet hours
 * and releases them as a batched digest when the window ends.
 *
 * subscribeExtensionCrashAlert monitors extension restart events and emits
 * extension.crash.alert when a crash loop is detected.
 *
 * Both are initialized by the daemon directly (daemon.ts and daemon-subscriptions.ts)
 * because they require daemon-level config and must be active before extensions load.
 */

import type { KotaExtension } from "../../extension-types.js";

export { type ExtensionCrashAlertOptions, subscribeExtensionCrashAlert } from "./extension-crash-alert.js";
export {
  isWithinQuietHours,
  msUntilQuietHoursEnd,
  NotificationGate,
  type QuietHoursConfig,
  validateQuietHours,
} from "./notification-gate.js";

const notificationsModule: KotaExtension = {
  name: "notifications",
  version: "1.0.0",
  description: "Quiet-hours notification gate and extension crash-loop alerting",
};

export default notificationsModule;
