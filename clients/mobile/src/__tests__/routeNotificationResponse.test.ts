/**
 * Verifies the deep-link contract for notification taps used by the
 * push-notification module. The pure router maps `data.screen` to a
 * navigation method on the supplied router; both branches the daemon
 * currently emits are pinned here.
 */

import { routeNotificationResponse } from '../navigation/routeNotificationResponse';

describe('routeNotificationResponse', () => {
  function makeRouter() {
    return {
      toApproval: jest.fn(),
      toDigest: jest.fn(),
      toAttention: jest.fn(),
    };
  }

  test('routes screen=approvals with approvalId to ApprovalDetail', () => {
    const router = makeRouter();
    routeNotificationResponse(
      { screen: 'approvals', approvalId: 'approval-42' },
      router,
    );
    expect(router.toApproval).toHaveBeenCalledWith('approval-42');
    expect(router.toDigest).not.toHaveBeenCalled();
    expect(router.toAttention).not.toHaveBeenCalled();
  });

  test('routes screen=approvals without approvalId to ApprovalList', () => {
    const router = makeRouter();
    routeNotificationResponse({ screen: 'approvals' }, router);
    expect(router.toApproval).toHaveBeenCalledWith(undefined);
  });

  test('routes screen=digest to the DigestScreen tab', () => {
    const router = makeRouter();
    routeNotificationResponse({ screen: 'digest' }, router);
    expect(router.toDigest).toHaveBeenCalledTimes(1);
    expect(router.toApproval).not.toHaveBeenCalled();
    expect(router.toAttention).not.toHaveBeenCalled();
  });

  test('routes screen=attention to the AttentionScreen tab', () => {
    const router = makeRouter();
    routeNotificationResponse({ screen: 'attention' }, router);
    expect(router.toAttention).toHaveBeenCalledTimes(1);
    expect(router.toDigest).not.toHaveBeenCalled();
    expect(router.toApproval).not.toHaveBeenCalled();
  });

  test('ignores notifications with unknown or missing screen field', () => {
    const router = makeRouter();
    routeNotificationResponse({}, router);
    routeNotificationResponse({ screen: 'unknown' }, router);
    routeNotificationResponse(undefined, router);
    routeNotificationResponse(null, router);
    routeNotificationResponse('not an object', router);
    expect(router.toApproval).not.toHaveBeenCalled();
    expect(router.toDigest).not.toHaveBeenCalled();
    expect(router.toAttention).not.toHaveBeenCalled();
  });

  test('ignores screen=approvals when approvalId is not a string', () => {
    const router = makeRouter();
    routeNotificationResponse({ screen: 'approvals', approvalId: 42 }, router);
    expect(router.toApproval).toHaveBeenCalledWith(undefined);
  });
});
