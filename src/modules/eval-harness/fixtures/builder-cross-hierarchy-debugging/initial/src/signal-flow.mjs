import { resolveChannel } from "./channel-registry.mjs";

export function buildSignalFlow(signal) {
  const channel = resolveChannel(signal.path);
  return {
    signalId: signal.id,
    sourcePath: signal.path,
    reading: signal.reading,
    destinationQueue: channel.queue,
    severity: channel.severity,
    owner: channel.owner,
    ruleKey: channel.ruleKey,
  };
}
