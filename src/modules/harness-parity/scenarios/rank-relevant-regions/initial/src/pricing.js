const { getProduct } = require("./catalog.js");

function calculateOrderTotal(order) {
  const product = getProduct(order.sku);
  const giftWrapMinor = order.giftWrap === true ? product.giftWrapMinor : 0;
  const totalMinor = product.baseMinor + giftWrapMinor;
  return {
    sku: order.sku,
    baseMinor: product.baseMinor,
    giftWrapMinor,
    totalMinor,
  };
}

module.exports = { calculateOrderTotal };
