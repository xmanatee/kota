import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useDaemon } from '../context/DaemonContext';
import type { UiDaemonRouteDocument } from '../daemon/ui';
import { navigationStyles as styles } from './styles';

type RouteState =
  | { status: 'loading' }
  | { status: 'loaded'; document: UiDaemonRouteDocument }
  | { status: 'error'; message: string };

const MAX_ROUTE_PREVIEW_CHARS = 120_000;

export function DaemonRouteScreen({ path }: { path: string }) {
  const { client } = useDaemon();
  const [routeState, setRouteState] = useState<RouteState>({
    status: 'loading',
  });

  useEffect(() => {
    let active = true;
    setRouteState({ status: 'loading' });
    if (!client) {
      setRouteState({
        status: 'error',
        message: 'Daemon connection is unavailable.',
      });
      return () => {
        active = false;
      };
    }
    void client.getUiDaemonRoute(path).then(
      (document) => {
        if (active) setRouteState({ status: 'loaded', document });
      },
      (error) => {
        if (active) {
          setRouteState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [client, path]);

  return (
    <ScrollView
      style={styles.routeScreen}
      contentContainerStyle={styles.routeContent}
      testID="ui-daemon-route-screen"
    >
      <View style={styles.routeHeader}>
        <Text style={styles.routeEyebrow}>Authenticated daemon route</Text>
        <Text selectable style={styles.routePath}>
          {path}
        </Text>
      </View>
      {routeState.status === 'loading' ? (
        <View style={styles.routeLoading}>
          <ActivityIndicator
            color="#0a67c7"
            accessibilityLabel="Loading daemon response"
          />
          <Text style={styles.messageDetail}>Loading daemon response</Text>
        </View>
      ) : routeState.status === 'error' ? (
        <Text style={styles.routeError} accessibilityRole="alert">
          {routeState.message}
        </Text>
      ) : (
        <Text
          selectable
          style={styles.routeDocument}
          testID="ui-daemon-route-document"
        >
          {formatRouteDocument(routeState.document)}
        </Text>
      )}
    </ScrollView>
  );
}

function formatRouteDocument(document: UiDaemonRouteDocument): string {
  const rendered = JSON.stringify(document, null, 2);
  if (rendered.length <= MAX_ROUTE_PREVIEW_CHARS) return rendered;
  return `${rendered.slice(0, MAX_ROUTE_PREVIEW_CHARS)}\n\n… Response preview truncated at ${MAX_ROUTE_PREVIEW_CHARS.toLocaleString()} characters.`;
}
