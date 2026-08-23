import type { UiDeepLinkTarget } from '../shared-ui/graph';

export type NotificationRouter = {
  toSharedUi(target: UiDeepLinkTarget): void;
};

/**
 * Routes daemon-owned notification targets without maintaining a mobile screen
 * catalog. The graph lookup in `AppNavigator` validates both stable ids before
 * navigation, so stale notifications fail closed after a capability unload.
 */
export function routeNotificationResponse(
  data: unknown,
  router: NotificationRouter,
): void {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const fields = data as Record<string, unknown>;
  if (
    typeof fields.surfaceId !== 'string' ||
    fields.surfaceId.trim().length === 0
  ) {
    return;
  }
  if (fields.actionId !== undefined && typeof fields.actionId !== 'string') {
    return;
  }
  router.toSharedUi({
    surfaceId: fields.surfaceId,
    ...(typeof fields.actionId === 'string'
      ? { actionId: fields.actionId }
      : {}),
  });
}
