import { type AutonomyMode, isAutonomyMode } from "../tools/autonomy-mode.js";
import type { KotaConfig } from "./config.js";

/**
 * Channel and config slice schemas already type `defaultAutonomyMode` as
 * `AutonomyMode | undefined`, so the channel input is also typed. The runtime
 * `isAutonomyMode` check still guards against tests or ad-hoc callers that
 * have asserted around the type — fail loudly with the offending value if it
 * slips through.
 */
export function resolveChannelAutonomyMode(
  channelDefault: AutonomyMode | undefined,
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
