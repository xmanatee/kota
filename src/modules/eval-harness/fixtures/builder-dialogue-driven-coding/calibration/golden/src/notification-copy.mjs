const CHANNEL_PREFIXES = {
  email: "Email update",
  sms: "Text alert",
};

export function formatLaunchNotification(event) {
  if (!event || typeof event.productName !== "string" || typeof event.launchAtUtc !== "string") {
    throw new TypeError("formatLaunchNotification requires productName and launchAtUtc strings.");
  }
  const prefix = CHANNEL_PREFIXES[event.channel] ?? CHANNEL_PREFIXES.sms;
  return `${prefix}: ${event.productName} launches at ${event.launchAtUtc}`;
}
