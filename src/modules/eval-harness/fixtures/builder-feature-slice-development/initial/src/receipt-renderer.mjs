export function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function renderReceipt(pricedCart) {
  const lines = pricedCart.items.map(
    (item) =>
      `${item.quantity} x ${item.label}: ${formatMoney(item.subtotalCents)}`,
  );
  if (pricedCart.totals.discountCents > 0) {
    lines.push(`Bulk discount: -${formatMoney(pricedCart.totals.discountCents)}`);
  }
  lines.push(
    pricedCart.totals.shippingCents === 0
      ? "Shipping: FREE"
      : `Shipping: ${formatMoney(pricedCart.totals.shippingCents)}`,
  );
  lines.push(`Total: ${formatMoney(pricedCart.totals.totalCents)}`);
  return lines.join("\n");
}
