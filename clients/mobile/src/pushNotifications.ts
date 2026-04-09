import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { DaemonClient } from './daemonClient';

const DEVICE_ID_KEY = 'kota_push_device_id';

async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  return id;
}

export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function registerPushTokenWithDaemon(client: DaemonClient): Promise<void> {
  const granted = await requestNotificationPermissions();
  if (!granted) return;

  let pushToken: string;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync();
    pushToken = data;
  } catch {
    // Not available in simulator or Expo Go without EAS project config.
    return;
  }

  const deviceId = await getOrCreateDeviceId();
  await client.registerPushToken(deviceId, pushToken);
}
