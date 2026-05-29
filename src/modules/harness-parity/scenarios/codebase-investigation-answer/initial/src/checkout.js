const { getProduct } = require("./catalog.js");
const { isAllowedDestination } = require("./regions.js");

const REVIEW_THRESHOLD_MINOR = 5000;

function quoteOrder(order) {
  const product = getProduct(order.sku);
  const regionAllowed = isAllowedDestination(order.destination);
  const giftWrapMinor = order.giftWrap === true ? product.giftWrapMinor : 0;
  const totalMinor = product.baseMinor + giftWrapMinor;
  const decision = !regionAllowed
    ? "blocked_region"
    : totalMinor >= REVIEW_THRESHOLD_MINOR
      ? "manual_review"
      : "auto_approved";

  return {
    sku: order.sku,
    destination: order.destination,
    regionAllowed,
    baseMinor: product.baseMinor,
    giftWrapMinor,
    totalMinor,
    reviewThresholdMinor: REVIEW_THRESHOLD_MINOR,
    decision,
  };
}

module.exports = { quoteOrder, REVIEW_THRESHOLD_MINOR };
