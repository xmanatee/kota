import { buildSignalFlow } from "./signal-flow.mjs";

export function dispatchAlert(signal) {
  const flow = buildSignalFlow(signal);
  return {
    topic: `queue/${flow.destinationQueue}`,
    payload: {
      signalId: flow.signalId,
      sourcePath: flow.sourcePath,
      reading: flow.reading,
      severity: flow.severity,
      owner: flow.owner,
      ruleKey: flow.ruleKey,
    },
  };
}
