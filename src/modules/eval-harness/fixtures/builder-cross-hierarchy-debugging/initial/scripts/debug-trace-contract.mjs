export const verificationCommand = "node --test test/signal-flow.test.mjs";

export const requiredCausalFiles = [
  "src/gateway.mjs",
  "src/signal-flow.mjs",
  "src/channel-registry.mjs",
];

export const allowedChangedPaths = new Set([
  "debug-trace-result.json",
  "src/channel-registry.mjs",
  "data/tasks/ready/task-fix-cross-hierarchy-signal-routing.md",
  "data/tasks/done/task-fix-cross-hierarchy-signal-routing.md",
]);

export const forbiddenChangedPaths = [
  "src/gateway.mjs",
  "src/signal-flow.mjs",
  "scripts/check-debug-trace.mjs",
  "scripts/debug-trace-artifact.mjs",
  "scripts/debug-trace-contract.mjs",
  "scripts/debug-trace-git.mjs",
  "scripts/debug-trace-runner.mjs",
  "test/signal-flow.test.mjs",
  "package.json",
];

export const verificationCases = [
  {
    id: "visible-line-a-pressure",
    signal: { id: "sig-visible-a", path: "plant-alpha/line-a/press/pump-7", reading: 96 },
    expected: {
      topic: "queue/safety-cutoff",
      severity: "critical",
      ruleKey: "plant-alpha/line-a/press",
      owner: "pressure-safety",
    },
  },
  {
    id: "hidden-line-b-pressure",
    signal: { id: "sig-hidden-b", path: "plant-alpha/line-b/press/pump-2", reading: 91 },
    expected: {
      topic: "queue/safety-cutoff",
      severity: "critical",
      ruleKey: "plant-alpha/line-b/press",
      owner: "pressure-safety",
    },
  },
  {
    id: "adjacent-temperature-route",
    signal: { id: "sig-temp-a", path: "plant-alpha/line-a/temp/probe-4", reading: 78 },
    expected: {
      topic: "queue/thermal-watch",
      severity: "warning",
      ruleKey: "plant-alpha/line-a/temp",
      owner: "thermal-ops",
    },
  },
  {
    id: "holdout-line-a-pressure-sibling",
    signal: { id: "sig-holdout-a", path: "plant-alpha/line-a/press/pump-19", reading: 97 },
    expected: {
      topic: "queue/safety-cutoff",
      severity: "critical",
      ruleKey: "plant-alpha/line-a/press",
      owner: "pressure-safety",
    },
  },
  {
    id: "holdout-line-b-pressure-sibling",
    signal: { id: "sig-holdout-b", path: "plant-alpha/line-b/press/pump-44", reading: 93 },
    expected: {
      topic: "queue/safety-cutoff",
      severity: "critical",
      ruleKey: "plant-alpha/line-b/press",
      owner: "pressure-safety",
    },
  },
  {
    id: "holdout-temperature-sibling",
    signal: { id: "sig-holdout-temp", path: "plant-alpha/line-a/temp/probe-11", reading: 81 },
    expected: {
      topic: "queue/thermal-watch",
      severity: "warning",
      ruleKey: "plant-alpha/line-a/temp",
      owner: "thermal-ops",
    },
  },
];

export const concreteSignalPaths = verificationCases.map((entry) => entry.signal.path);

export function validArtifactTemplate() {
  return {
    schemaVersion: 1,
    failingEvidence: {
      command: verificationCommand,
      exitCode: 1,
      outputExcerpt:
        "visible-line-a-pressure routed plant-alpha/line-a/press/pump-7 to queue/ambient-monitor, expected queue/safety-cutoff",
    },
    symptom: {
      file: "src/gateway.mjs",
      layer: "gateway dispatch",
      observed: "gateway emitted queue/ambient-monitor for a pressure alarm",
    },
    rootCause: {
      file: "src/channel-registry.mjs",
      layer: "channel registry",
      fix: "restore ancestor prefix lookup for hierarchical signal paths",
    },
    causalPath: [
      "src/gateway.mjs: dispatchAlert exposed the wrong downstream queue",
      "src/signal-flow.mjs: buildSignalFlow delegated channel selection",
      "src/channel-registry.mjs: resolveChannel skipped ancestor prefixes",
    ],
    verification: {
      command: verificationCommand,
      exitCode: 0,
      status: "passed",
      behaviorDigest: "placeholder",
      cases: verificationCases.map((entry) => entry.id),
    },
    metrics: {
      causalPathCoverage: requiredCausalFiles.length,
      regressionCasesPassed: verificationCases.length,
    },
  };
}
