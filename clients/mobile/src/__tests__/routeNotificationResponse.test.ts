import { routeNotificationResponse } from '../navigation/routeNotificationResponse';

describe('routeNotificationResponse', () => {
  function makeRouter() {
    return { toSharedUi: jest.fn() };
  }

  test('forwards stable surface and action ids to live graph navigation', () => {
    const router = makeRouter();
    routeNotificationResponse(
      {
        surfaceId: 'approvals',
        actionId: 'approval.resolve-approval-42',
      },
      router,
    );
    expect(router.toSharedUi).toHaveBeenCalledWith({
      surfaceId: 'approvals',
      actionId: 'approval.resolve-approval-42',
    });
  });

  test('accepts a surface-only target', () => {
    const router = makeRouter();
    routeNotificationResponse({ surfaceId: 'daily-digest' }, router);
    expect(router.toSharedUi).toHaveBeenCalledWith({
      surfaceId: 'daily-digest',
    });
  });

  test('fails closed for malformed targets', () => {
    const router = makeRouter();
    routeNotificationResponse({}, router);
    routeNotificationResponse({ surfaceId: '' }, router);
    routeNotificationResponse({ surfaceId: 'approvals', actionId: 42 }, router);
    routeNotificationResponse(undefined, router);
    routeNotificationResponse(null, router);
    routeNotificationResponse([], router);
    expect(router.toSharedUi).not.toHaveBeenCalled();
  });
});
