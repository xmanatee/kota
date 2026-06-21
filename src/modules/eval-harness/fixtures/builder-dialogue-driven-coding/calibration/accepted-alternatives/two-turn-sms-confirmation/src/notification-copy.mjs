const CHANNEL_LABELS = {
  email: "Email update",
  sms: "Text alert",
};

export function formatLaunchNotification(event) {
  if (!event || typeof event.productName !== "string" || typeof event.launchAtUtc !== "string") {
    throw new TypeError("formatLaunchNotification requires productName and launchAtUtc strings.");
  }
  const label = event.channel === "sms" ? CHANNEL_LABELS.sms : CHANNEL_LABELS[event.channel] ?? CHANNEL_LABELS.sms;
  return `${label}: ${event.productName} launches at ${event.launchAtUtc}`;
}
