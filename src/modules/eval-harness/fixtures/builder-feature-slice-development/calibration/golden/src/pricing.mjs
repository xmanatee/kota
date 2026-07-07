import { getProduct, getService } from "./catalog.mjs";

function itemSubtotalCents(item) {
  const product = getProduct(item.sku);
  return product.priceCents * item.quantity;
}

function notebookQuantity(items) {
  return items
    .filter((item) => item.sku === "notebook")
    .reduce((sum, item) => sum + item.quantity, 0);
}

function giftWrapLine(cart) {
  if (cart.giftWrap !== true) return null;
  const service = getService("gift-wrap");
  if (service === null) {
    throw new Error("Gift-wrap service is missing from the catalog");
  }
  return {
    sku: service.sku,
    label: service.label,
    priceCents: service.priceCents,
    message: cart.giftMessage ?? null,
  };
}

export function priceCart(cart) {
  const items = cart.items.map((item) => {
    const product = getProduct(item.sku);
    return {
      sku: product.sku,
      label: product.label,
      quantity: item.quantity,
      unitPriceCents: product.priceCents,
      subtotalCents: itemSubtotalCents(item),
    };
  });
  const merchandiseCents = items.reduce(
    (sum, item) => sum + item.subtotalCents,
    0,
  );
  const discountCents = notebookQuantity(items) >= 3 ? 300 : 0;
  const giftWrap = giftWrapLine(cart);
  const serviceLines = giftWrap === null ? [] : [giftWrap];
  const serviceCents = serviceLines.reduce(
    (sum, service) => sum + service.priceCents,
    0,
  );
  const shippingCents = merchandiseCents >= 4000 ? 0 : 599;
  const totalCents =
    merchandiseCents - discountCents + serviceCents + shippingCents;

  return {
    items,
    serviceLines,
    giftWrap: {
      requested: cart.giftWrap === true,
      applied: giftWrap !== null,
      message: cart.giftMessage ?? null,
    },
    totals: {
      merchandiseCents,
      discountCents,
      serviceCents,
      shippingCents,
      totalCents,
    },
  };
}
