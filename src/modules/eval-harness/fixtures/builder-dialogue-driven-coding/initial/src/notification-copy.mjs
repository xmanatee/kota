export function formatLaunchNotification(event) {
  if (!event || typeof event.productName !== "string" || typeof event.launchAtUtc !== "string") {
    throw new TypeError("formatLaunchNotification requires productName and launchAtUtc strings.");
  }
  return `Email update: ${event.productName} launches at ${event.launchAtUtc}`;
}
