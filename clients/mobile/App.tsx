import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { DaemonProvider } from './src/context/DaemonContext';
import { AppNavigator } from './src/navigation';

export default function App() {
  return (
    <DaemonProvider>
      <StatusBar style="auto" />
      <AppNavigator />
    </DaemonProvider>
  );
}
