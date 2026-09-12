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
