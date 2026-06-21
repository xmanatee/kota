const { calculateOrderTotal } = require("./pricing.js");
const { requiresManualReview } = require("./review.js");

function checkout(order) {
  const quote = calculateOrderTotal(order);
  return {
    ...quote,
    decision: requiresManualReview(quote) ? "manual_review" : "auto_approved",
  };
}

module.exports = { checkout };
