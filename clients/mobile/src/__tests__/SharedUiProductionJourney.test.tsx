import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import React from 'react';
import { Platform } from 'react-native';
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import App from '../../App';
import type { UiSurfaceBundle } from '../daemon/ui-surface.generated';
import {
  callsForPath,
  contractBundle,
  createDaemonRequestHandler,
  DAEMON_TOKEN,
  DAEMON_URL,
  findLaunchAction,
  type FetchCall,
  loadJourneyBundle,
  MockSseRequest,
  type NotificationListener,
  notificationResponse,
  sseRequests,
} from './SharedUiProductionJourney.test-fixture';

let activeBundle: UiSurfaceBundle;
let fetchCalls: FetchCall[];
let notificationListener: NotificationListener | null;
let fetchSpy: jest.SpyInstance;
let originalXmlHttpRequest: typeof XMLHttpRequest;
let originalPlatformOs: typeof Platform.OS;

describe('Android shared UI production journey', () => {
  beforeEach(() => {
    originalPlatformOs = Platform.OS;
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    activeBundle = loadJourneyBundle();
    fetchCalls = [];
    notificationListener = null;
    sseRequests.length = 0;

    const secureStore = SecureStore.getItemAsync as jest.MockedFunction<
      typeof SecureStore.getItemAsync
    >;
    secureStore.mockImplementation(async (key) => {
      if (key === 'kota_daemon_url') return DAEMON_URL;
      if (key === 'kota_daemon_token') return DAEMON_TOKEN;
      if (key === 'kota_push_notifications_enabled') return 'false';
      return null;
    });

    const addNotificationListener =
      Notifications.addNotificationResponseReceivedListener as jest.MockedFunction<
        typeof Notifications.addNotificationResponseReceivedListener
      >;
    addNotificationListener.mockImplementation((listener) => {
      notificationListener = listener;
      return { remove: jest.fn() };
    });

    originalXmlHttpRequest = globalThis.XMLHttpRequest;
    Object.defineProperty(globalThis, 'XMLHttpRequest', {
      configurable: true,
      writable: true,
      value: MockSseRequest,
    });
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        createDaemonRequestHandler(() => activeBundle, fetchCalls),
      );
  });

  afterEach(() => {
    cleanup();
    fetchSpy.mockRestore();
    (
      SecureStore.getItemAsync as jest.MockedFunction<
        typeof SecureStore.getItemAsync
      >
    ).mockReset();
    (
      Notifications.addNotificationResponseReceivedListener as jest.MockedFunction<
        typeof Notifications.addNotificationResponseReceivedListener
      >
    ).mockReset();
    Object.defineProperty(globalThis, 'XMLHttpRequest', {
      configurable: true,
      writable: true,
      value: originalXmlHttpRequest,
    });
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatformOs,
    });
  });

  test('navigates by stable ids, refreshes from SSE, and executes a confirmed action through production providers', async () => {
    const { surface, action } = findLaunchAction(activeBundle);
    const refreshEvent = surface.refreshEvents?.[0];
    if (!refreshEvent) {
      throw new Error(`${surface.surfaceId} needs a refresh event for the journey.`);
    }
    const view = render(<App />);

    await waitFor(() => {
      expect(notificationListener).not.toBeNull();
      expect(sseRequests.length).toBeGreaterThan(0);
      expect(view.getByTestId('ui-surface-status')).toBeTruthy();
    });

    await act(async () => {
      notificationListener?.(
        notificationResponse({
          surfaceId: surface.surfaceId,
          actionId: action.actionId,
        }),
      );
    });
    await waitFor(() => {
      expect(view.getByTestId(`ui-surface-${surface.surfaceId}`)).toBeTruthy();
      expect(view.getByTestId(`ui-action-${action.actionId}`)).toBeTruthy();
    });

    const uiFetchesBeforeEvent = uiSurfaceFetches().length;
    act(() => {
      sseRequests.at(-1)?.emit(refreshEvent, {
        scopeId: surface.scopeId,
        message: 'Production journey refresh event.',
      });
    });
    await waitFor(
      () => expect(uiSurfaceFetches().length).toBeGreaterThan(uiFetchesBeforeEvent),
      { timeout: 2_000 },
    );
    const uiFetchesAfterEvent = uiSurfaceFetches().length;

    fireEvent.press(view.getByLabelText(action.label));
    const confirmation = action.confirmation;
    if (confirmation.mode !== 'required') {
      throw new Error(`${action.actionId} lost its required confirmation.`);
    }
    expect(view.getByText(confirmation.detail)).toBeTruthy();
    await act(async () => {
      fireEvent.press(
        view.getByLabelText(confirmation.confirmLabel),
      );
    });
    await waitFor(() => expect(actionRequests()).toHaveLength(1));

    const actionRequest = actionRequests()[0]!;
    expect(actionRequest.authorization).toBe(`Bearer ${DAEMON_TOKEN}`);
    expect(JSON.parse(actionRequest.body ?? '{}')).toMatchObject({
      scopeId: action.scopeId,
      surfaceId: action.surfaceId,
      actionId: action.actionId,
    });
  });

  test('retries daemon-route failures through the authenticated native stack', async () => {
    activeBundle = contractBundle;
    const targetSurface = activeBundle.surfaces.find(
      (surface) => surface.surfaceId === 'operator-control',
    );
    if (!targetSurface) throw new Error('Missing operator-control fixture.');
    const view = render(<App />);

    await waitFor(() => {
      expect(notificationListener).not.toBeNull();
      expect(view.getByTestId('ui-surface-status')).toBeTruthy();
    });
    act(() => {
      notificationListener?.(
        notificationResponse({ surfaceId: targetSurface.surfaceId }),
      );
    });
    await waitFor(() =>
      expect(
        view.getByTestId(`ui-surface-${targetSurface.surfaceId}`),
      ).toBeTruthy(),
    );

    const requestHandler = createDaemonRequestHandler(
      () => activeBundle,
      fetchCalls,
    );
    let routeAttempts = 0;
    fetchSpy.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (
        url.pathname === '/ui/surfaces' &&
        !url.searchParams.has('scopeId') &&
        routeAttempts++ === 0
      ) {
        throw new TypeError('Temporary daemon connection failure.');
      }
      return requestHandler(input, init);
    });

    fireEvent.press(view.getByLabelText('Open shared UI surface route'));
    await waitFor(() => {
      expect(view.getByText('Temporary daemon connection failure.')).toBeTruthy();
    });
    fireEvent.press(view.getByLabelText('Retry daemon response'));
    await waitFor(() => {
      expect(view.getByTestId('ui-daemon-route-screen')).toBeTruthy();
      expect(view.getByTestId('ui-daemon-route-document')).toBeTruthy();
    });
    expect(routeAttempts).toBe(2);

    const request = fetchCalls.find(
      (call) =>
        new URL(call.url).pathname === '/ui/surfaces' &&
        !new URL(call.url).searchParams.has('scopeId'),
    );
    expect(request).toMatchObject({
      method: 'GET',
      authorization: `Bearer ${DAEMON_TOKEN}`,
    });
  });
});

function uiSurfaceFetches(): FetchCall[] {
  return callsForPath(fetchCalls, '/ui/surfaces');
}

function actionRequests(): FetchCall[] {
  return callsForPath(fetchCalls, '/ui/actions/execute');
}
