/**
 * Notifications module — owns quiet-hours gating and module crash alerts.
 *
 * NotificationGate holds non-critical bus events during configured quiet hours
 * and releases them as a batched digest when the window ends.
 *
 * subscribeModuleCrashAlert monitors module restart events and emits
 * module.crash.alert when a crash loop is detected.
 *
 * Both are initialized by the daemon directly (daemon.ts and daemon-subscriptions.ts)
 * because they require daemon-level config and must be active before modules load.
 */

import type { KotaModule } from "../../module-types.js";

export { type ModuleCrashAlertOptions, subscribeModuleCrashAlert } from "./module-crash-alert.js";
export {
  isWithinQuietHours,
  msUntilQuietHoursEnd,
  NotificationGate,
  type QuietHoursConfig,
  validateQuietHours,
} from "./notification-gate.js";

const notificationsModule: KotaModule = {
  name: "notifications",
  version: "1.0.0",
  description: "Quiet-hours notification gate and module crash-loop alerting",
};

export default notificationsModule;
