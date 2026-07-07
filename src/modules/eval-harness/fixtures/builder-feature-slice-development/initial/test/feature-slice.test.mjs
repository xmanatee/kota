import assert from "node:assert/strict";
import test from "node:test";
import { buildCheckoutSummary } from "../src/checkout.mjs";

function starterCart(overrides = {}) {
  return {
    items: [
      { sku: "notebook", quantity: 3 },
      { sku: "pen", quantity: 2 },
    ],
    ...overrides,
  };
}

test("regression: bulk notebook discount stays intact", () => {
  const summary = buildCheckoutSummary(starterCart());
  assert.equal(summary.totals.merchandiseCents, 4100);
  assert.equal(summary.totals.discountCents, 300);
  assert.equal(summary.totals.shippingCents, 0);
  assert.equal(summary.totals.totalCents, 3800);
});

test("regression: free shipping uses merchandise before discounts", () => {
  const summary = buildCheckoutSummary({
    items: [{ sku: "planner", quantity: 2 }],
  });
  assert.equal(summary.totals.merchandiseCents, 5600);
  assert.equal(summary.totals.discountCents, 0);
  assert.equal(summary.totals.shippingCents, 0);
  assert.equal(summary.totals.totalCents, 5600);
});

test("regression: plain receipt keeps item, discount, shipping, and total lines", () => {
  const summary = buildCheckoutSummary(starterCart());
  assert.match(summary.receipt, /3 x Notebook: \$36\.00/);
  assert.match(summary.receipt, /2 x Pen: \$5\.00/);
  assert.match(summary.receipt, /Bulk discount: -\$3\.00/);
  assert.match(summary.receipt, /Shipping: FREE/);
  assert.match(summary.receipt, /Total: \$38\.00/);
  assert.doesNotMatch(summary.receipt, /Gift wrap/);
});

test("feature: gift wrap adds a catalog backed service fee and receipt line", () => {
  const summary = buildCheckoutSummary(
    starterCart({ giftWrap: true, giftMessage: "For Ada" }),
  );
  assert.equal(summary.totals.serviceCents, 499);
  assert.equal(summary.totals.totalCents, 4299);
  assert.match(summary.receipt, /Gift wrap: \$4\.99/);
  assert.match(summary.receipt, /Gift message: For Ada/);
});

test("feature: gift wrap is represented in fulfillment metadata", () => {
  const summary = buildCheckoutSummary(
    starterCart({ giftWrap: true, giftMessage: "For Lin" }),
  );
  assert.deepEqual(summary.fulfillment.serviceSkus, ["svc-gift-wrap"]);
  assert.equal(summary.fulfillment.giftWrap.requested, true);
  assert.equal(summary.fulfillment.giftWrap.applied, true);
  assert.equal(summary.fulfillment.giftWrap.message, "For Lin");
});
