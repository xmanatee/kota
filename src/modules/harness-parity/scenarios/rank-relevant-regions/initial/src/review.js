const MANUAL_REVIEW_THRESHOLD_MINOR = 5000;

function requiresManualReview(quote) {
  return quote.totalMinor > MANUAL_REVIEW_THRESHOLD_MINOR;
}

module.exports = { MANUAL_REVIEW_THRESHOLD_MINOR, requiresManualReview };
