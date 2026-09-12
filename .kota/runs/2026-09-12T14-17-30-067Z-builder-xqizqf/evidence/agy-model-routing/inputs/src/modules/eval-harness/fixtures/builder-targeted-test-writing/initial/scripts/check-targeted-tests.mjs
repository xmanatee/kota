#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const mutations = [
  {
    id: "gold-threshold-exclusive",
    description: "Gold loyalty discount starts above the threshold instead of at it.",
    search: "order.customer.tier === \"gold\" && subtotalCents >= 5000",
    replacement: "order.customer.tier === \"gold\" && subtotalCents > 5000",
  },
  {
    id: "silver-discount-leak",
    description: "Non-bronze customers incorrectly receive the gold loyalty discount.",
    search: "order.customer.tier === \"gold\" && subtotalCents >= 5000",
    replacement: "order.customer.tier !== \"bronze\" && subtotalCents >= 5000",
  },
  {
    id: "delivery-after-discount",
    description: "Free delivery is calculated after the loyalty discount.",
    search: "const deliveryFeeCents = subtotalCents >= 7500 ? 0 : 799;",
    replacement:
      "const deliveryFeeCents = subtotalCents - loyaltyDiscountCents >= 7500 ? 0 : 799;",
  },
];

function runTests() {
  const result = spawnSync(process.execPath, ["--test", "test/pricing.test.mjs"], {
    encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status === null) throw new Error("Test execution did not finish");
  return result.status;
}

const sourcePath = "src/cart-pricing.mjs";
const original = readFileSync(sourcePath, "utf8");
assert.equal(runTests(), 0, "Authored tests must pass on the correct implementation");
const results = [];
try {
  for (const mutation of mutations) {
    assert.ok(original.includes(mutation.search), `Invalid mutation ${mutation.id}`);
    writeFileSync(sourcePath, original.replace(mutation.search, mutation.replacement));
    results.push({ id: mutation.id, caught: runTests() !== 0 });
  }
} finally {
  writeFileSync(sourcePath, original);
}
const mutationsCaught = results.filter(result => result.caught).length;
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/test-writing-evidence.json", JSON.stringify({
  mutationsCaught, mutations: results,
}, null, 2) + "\n");
assert.equal(mutationsCaught, mutations.length, "Authored tests must expose each pricing defect");
console.log(process.argv.includes("--metric-only") ? mutationsCaught : JSON.stringify(results));
