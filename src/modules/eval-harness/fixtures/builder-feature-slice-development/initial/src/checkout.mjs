import { priceCart } from "./pricing.mjs";
import { renderReceipt } from "./receipt-renderer.mjs";

export function buildCheckoutSummary(cart) {
  const pricedCart = priceCart(cart);
  return {
    ...pricedCart,
    receipt: renderReceipt(pricedCart),
    fulfillment: {
      itemSkus: pricedCart.items.map((item) => item.sku),
      serviceSkus: pricedCart.serviceLines.map((service) => service.sku),
      giftWrap: pricedCart.giftWrap,
    },
  };
}
