module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: [
    '<rootDir>/node_modules/.pnpm/(?!(?:react-native|jest-react-native|@react-native\\+.*|expo(?:nent|-.*)?|@expo\\+.*|@expo-google-fonts\\+.*|react-navigation|@react-navigation\\+.*|@sentry\\+.*|native-base|react-native-svg)@)',
    'node_modules/(?!.pnpm|(?:jest-)?react-native|@react-native(?:-community)?|expo(?:nent)?|@expo(?:nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/.*|native-base|react-native-svg)',
  ],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
};
