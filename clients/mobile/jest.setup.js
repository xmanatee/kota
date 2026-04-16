// Silence the Expo winter-runtime warning during tests.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExpoPushToken[fake]' })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  setNotificationHandler: jest.fn(),
}));
