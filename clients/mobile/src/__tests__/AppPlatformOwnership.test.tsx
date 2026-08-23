import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import React from 'react';
import { Platform } from 'react-native';
import { cleanup, render } from '@testing-library/react-native';
import App from '../../App';

const originalPlatformOs = Platform.OS;

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: originalPlatformOs,
  });
});

test.each([
  [
    'ios',
    'Install the KOTA Apple client for the native iPhone operator experience.',
  ],
  ['web', 'Use the Android app or another supported KOTA client.'],
] as const)(
  'keeps daemon and product behavior unmounted on %s',
  (platform, ownershipMessage) => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: platform,
    });

    const view = render(<App />);

    expect(view.getByText('KOTA React Native is Android-only')).toBeTruthy();
    expect(view.getByText(ownershipMessage)).toBeTruthy();
    expect(view.queryByTestId('ui-surface-status')).toBeNull();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(
      Notifications.addNotificationResponseReceivedListener,
    ).not.toHaveBeenCalled();
    expect(Notifications.setNotificationHandler).not.toHaveBeenCalled();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  },
);
