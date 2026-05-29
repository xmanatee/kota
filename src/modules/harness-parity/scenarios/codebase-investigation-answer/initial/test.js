const assert = require("node:assert/strict");
const { quoteOrder } = require("./src/checkout.js");

assert.equal(
  quoteOrder({ sku: "notebook-pro", destination: "GB", giftWrap: false })
    .decision,
  "auto_approved",
);
assert.equal(
  quoteOrder({ sku: "notebook-pro", destination: "GB", giftWrap: true })
    .decision,
  "manual_review",
);
assert.equal(
  quoteOrder({ sku: "pocket-pen", destination: "NO", giftWrap: false })
    .decision,
  "blocked_region",
);

console.log("ok");
