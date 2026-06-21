const assert = require("node:assert/strict");
const { checkout } = require("./src/checkout.js");

const result = checkout({
  sku: "pilot-bag",
  giftWrap: true,
});

assert.equal(result.baseMinor, 4200);
assert.equal(result.giftWrapMinor, 800);
assert.equal(result.totalMinor, 5000);
assert.equal(
  result.decision,
  "manual_review",
  "gift wrap brings the order exactly to the manual review threshold",
);

console.log("ok");
