export function priceOrder(order) {
  const subtotalCents = order.items.reduce(
    (sum, item) => sum + item.unitCents * item.quantity,
    0,
  );
  const loyaltyDiscountCents =
    order.customer.tier === "gold" && subtotalCents >= 5000
      ? Math.round(subtotalCents * 0.1)
      : 0;
  const deliveryFeeCents = subtotalCents >= 7500 ? 0 : 799;
  const totalCents = subtotalCents - loyaltyDiscountCents + deliveryFeeCents;

  return {
    currency: "USD",
    customerTier: order.customer.tier,
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalCents,
    loyaltyDiscountCents,
    deliveryFeeCents,
    totalCents,
  };
}
