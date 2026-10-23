process.env.EXPO_NO_TELEMETRY = '1';
process.env.DO_NOT_TRACK = '1';
await import('expo/bin/cli');
