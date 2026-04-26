/**
 * Pure dispatcher for `Notifications.addNotificationResponseReceivedListener`
 * payloads. Keeps the deep-link contract (`data.screen` → target tab/screen)
 * out of the React tree so it stays unit-testable without rendering the full
 * tab navigator.
 *
 * Recognized payloads:
 * - `{ screen: "approvals", approvalId? }` → ApprovalsTab/ApprovalDetail
 * - `{ screen: "digest" }` → DigestTab
 * - `{ screen: "attention" }` → AttentionTab
 *
 * Anything else is a no-op (older notifications without a `screen` field, or
 * payloads from a future version the mobile app has not learned yet).
 */

export type NotificationRouter = {
  toApproval(approvalId?: string): void;
  toDigest(): void;
  toAttention(): void;
};

export function routeNotificationResponse(
  data: unknown,
  router: NotificationRouter,
): void {
  if (!data || typeof data !== "object") return;
  const fields = data as Record<string, unknown>;
  const screen = fields.screen;

  if (screen === "approvals") {
    const approvalId = typeof fields.approvalId === "string" ? fields.approvalId : undefined;
    router.toApproval(approvalId);
    return;
  }

  if (screen === "digest") {
    router.toDigest();
    return;
  }

  if (screen === "attention") {
    router.toAttention();
    return;
  }
}
