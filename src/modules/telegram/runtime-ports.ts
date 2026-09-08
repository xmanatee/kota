import type { ModuleRuntimeContext } from "#core/modules/module-types.js";

/** Ports consumed by Telegram readiness, scope binding and notification delivery. */
export type TelegramRuntimePorts = Pick<
  ModuleRuntimeContext,
  | "cwd"
  | "config"
  | "storage"
  | "getModuleConfig"
  | "getSecret"
  | "getProvider"
  | "events"
  | "log"
  | "client"
>;
