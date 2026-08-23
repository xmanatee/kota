import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { DaemonProvider } from './src/context/DaemonContext';
import { AppNavigator } from './src/navigation';

export default function App() {
  if (Platform.OS !== 'android') {
    return <AndroidOnlyOwnershipNotice />;
  }

  return (
    <DaemonProvider>
      <StatusBar style="auto" />
      <AppNavigator />
    </DaemonProvider>
  );
}

function AndroidOnlyOwnershipNotice() {
  return (
    <View style={styles.notice}>
      <Text accessibilityRole="header" style={styles.noticeTitle}>
        KOTA React Native is Android-only
      </Text>
      <Text style={styles.noticeBody}>
        {Platform.OS === 'ios'
          ? 'Install the KOTA Apple client for the native iPhone operator experience.'
          : 'Use the Android app or another supported KOTA client.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#f2f2f7',
    padding: 28,
  },
  noticeTitle: { color: '#1c1c1e', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  noticeBody: { color: '#6c6c70', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
