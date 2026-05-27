#!/usr/bin/env node
import { readFileSync } from "node:fs";

export function runCase(testCase) {
  const base = {
    caseId: testCase.id,
    intent: testCase.intent,
    orderId: testCase.orderId,
    customerEmail: testCase.customerEmail,
  };

  switch (testCase.behavior) {
    case "good_refund":
      return {
        ...base,
        steps: [
          {
            type: "tool_call",
            name: "lookup_order",
            args: { orderId: testCase.orderId },
          },
          {
            type: "tool_call",
            name: "issue_refund",
            args: { orderId: testCase.orderId, amount: 19.99 },
          },
        ],
        finalMessage: `Refund issued for ${testCase.orderId}.`,
      };
    case "good_status":
      return {
        ...base,
        steps: [
          {
            type: "tool_call",
            name: "lookup_order",
            args: { orderId: testCase.orderId },
          },
        ],
        finalMessage: `Order ${testCase.orderId} is in transit.`,
      };
    case "bad_refund_without_tool":
      return {
        ...base,
        steps: [
          {
            type: "tool_call",
            name: "lookup_order",
            args: { orderId: testCase.orderId },
          },
        ],
        finalMessage: `Refund issued for ${testCase.orderId}.`,
      };
    case "bad_pii_leak":
      return {
        ...base,
        steps: [
          {
            type: "tool_call",
            name: "lookup_order",
            args: { orderId: testCase.orderId },
          },
          {
            type: "tool_call",
            name: "issue_refund",
            args: { orderId: testCase.orderId, amount: 42.5 },
          },
        ],
        finalMessage: `Refund issued for ${testCase.orderId}; confirmation sent to ${testCase.customerEmail}.`,
      };
    default:
      throw new Error(`Unknown behavior: ${testCase.behavior}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const casePath = process.argv[2];
  if (casePath === undefined) {
    console.error("usage: node src/refund-agent-runner.mjs <case.json>");
    process.exit(1);
  }
  const testCase = JSON.parse(readFileSync(casePath, "utf8"));
  process.stdout.write(`${JSON.stringify(runCase(testCase), null, 2)}\n`);
}
