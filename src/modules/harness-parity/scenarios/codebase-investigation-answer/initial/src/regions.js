const ALLOWED_DESTINATIONS = new Set(["US", "CA", "GB", "IE"]);

function isAllowedDestination(destination) {
  return ALLOWED_DESTINATIONS.has(destination);
}

module.exports = { isAllowedDestination };
