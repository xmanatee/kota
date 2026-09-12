import assert from "node:assert/strict";
import test from "node:test";
import { priceOrder } from "../src/cart-pricing.mjs";
import { item, order } from "./helpers/pricing-helpers.mjs";

test("prices standard small carts with paid delivery", () => {
  const summary = priceOrder(
    order({
      items: [item("starter pack", 1250, 2)],
    }),
  );

  assert.deepEqual(summary, {
    currency: "USD",
    customerTier: "standard",
    itemCount: 2,
    subtotalCents: 2500,
    loyaltyDiscountCents: 0,
    deliveryFeeCents: 799,
    totalCents: 3299,
  });
});

test("applies the gold loyalty discount at the threshold subtotal", () => {
  const summary = priceOrder(
    order({
      tier: "gold",
      items: [item("threshold bundle", 2500, 2)],
    }),
  );

  assert.equal(summary.subtotalCents, 5000);
  assert.equal(summary.loyaltyDiscountCents, 500);
  assert.equal(summary.deliveryFeeCents, 799);
  assert.equal(summary.totalCents, 5299);
});

test("does not give loyalty discount to silver customers", () => {
  const summary = priceOrder(
    order({
      tier: "silver",
      items: [item("silver bundle", 3000, 2)],
    }),
  );

  assert.equal(summary.subtotalCents, 6000);
  assert.equal(summary.loyaltyDiscountCents, 0);
  assert.equal(summary.deliveryFeeCents, 799);
  assert.equal(summary.totalCents, 6799);
});

test("keeps free delivery based on subtotal before discounts", () => {
  const summary = priceOrder(
    order({
      tier: "gold",
      items: [item("large cart", 4000, 2)],
    }),
  );

  assert.equal(summary.subtotalCents, 8000);
  assert.equal(summary.loyaltyDiscountCents, 800);
  assert.equal(summary.deliveryFeeCents, 0);
  assert.equal(summary.totalCents, 7200);
});
