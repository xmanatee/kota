import assert from "node:assert/strict";
import test from "node:test";
import { dispatchAlert } from "../src/gateway.mjs";

const cases = [
  {
    id: "visible-line-a-pressure",
    signal: {
      id: "sig-visible-a",
      path: "plant-alpha/line-a/press/pump-7",
      reading: 96,
    },
    expectedTopic: "queue/safety-cutoff",
    expectedSeverity: "critical",
    expectedRuleKey: "plant-alpha/line-a/press",
  },
  {
    id: "hidden-line-b-pressure",
    signal: {
      id: "sig-hidden-b",
      path: "plant-alpha/line-b/press/pump-2",
      reading: 91,
    },
    expectedTopic: "queue/safety-cutoff",
    expectedSeverity: "critical",
    expectedRuleKey: "plant-alpha/line-b/press",
  },
  {
    id: "adjacent-temperature-route",
    signal: {
      id: "sig-temp-a",
      path: "plant-alpha/line-a/temp/probe-4",
      reading: 78,
    },
    expectedTopic: "queue/thermal-watch",
    expectedSeverity: "warning",
    expectedRuleKey: "plant-alpha/line-a/temp",
  },
];

for (const scenario of cases) {
  test(`signal route: ${scenario.id}`, () => {
    const dispatched = dispatchAlert(scenario.signal);
    assert.equal(
      dispatched.topic,
      scenario.expectedTopic,
      `${scenario.id} routed ${scenario.signal.path} to ${dispatched.topic}, expected ${scenario.expectedTopic}`,
    );
    assert.equal(
      dispatched.payload.severity,
      scenario.expectedSeverity,
      `${scenario.id} severity should come from the matched channel rule`,
    );
    assert.equal(
      dispatched.payload.ruleKey,
      scenario.expectedRuleKey,
      `${scenario.id} should report the matched hierarchy rule`,
    );
  });
}
