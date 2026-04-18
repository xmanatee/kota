import { type AutonomyMode, isAutonomyMode } from "../tools/autonomy-mode.js";
import type { KotaConfig } from "./config.js";

export function resolveChannelAutonomyMode(
  channelDefault: unknown,
  config: KotaConfig | undefined,
  channelLabel: string,
): AutonomyMode {
  if (channelDefault !== undefined) {
    if (!isAutonomyMode(channelDefault)) {
      throw new Error(
        `${channelLabel}: defaultAutonomyMode must be one of passive, supervised, autonomous (got ${JSON.stringify(channelDefault)})`,
      );
    }
    return channelDefault;
  }
  const serveDefault = config?.serve?.defaultAutonomyMode;
  if (serveDefault !== undefined) {
    if (!isAutonomyMode(serveDefault)) {
      throw new Error(
        `config.serve.defaultAutonomyMode must be one of passive, supervised, autonomous (got ${JSON.stringify(serveDefault)})`,
      );
    }
    return serveDefault;
  }
  throw new Error(
    `${channelLabel}: autonomy mode is not configured. Set defaultAutonomyMode on the channel config or config.serve.defaultAutonomyMode on the daemon.`,
  );
}
