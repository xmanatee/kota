import React, { useCallback } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useDaemon } from '../context/DaemonContext';
import type { UiDaemonRouteDocument } from '../daemon/ui';
import { useResourceRequest } from '../hooks/useResourceRequest';
import { classifyDaemonResourceFailure } from '../resource-state';
import { ResourceScreen } from './ResourceScreen';
import { navigationStyles as styles } from './styles';

const MAX_ROUTE_PREVIEW_CHARS = 120_000;
const routeIsEmpty = () => false;

export function DaemonRouteScreen({ path }: { path: string }) {
  const { client } = useDaemon();
  const request = useCallback(() => {
    if (!client) {
      return Promise.reject(
        new TypeError('Daemon connection is unavailable.'),
      );
    }
    return client.getUiDaemonRoute(path);
  }, [client, path]);
  const { resource, retry } = useResourceRequest(
    request,
    routeIsEmpty,
    classifyDaemonResourceFailure,
  );

  return (
    <ResourceScreen
      resource={resource}
      copy={{
        loading: 'Loading daemon response',
        failure: 'Daemon response unavailable',
        retryAccessibilityLabel: 'Retry daemon response',
        empty: 'Daemon response is empty',
        idle: 'Daemon response is not loaded',
        cancelled: 'Daemon request was cancelled',
        semanticUnavailable: 'Daemon response unavailable',
      }}
      onRetry={retry}
    >
      {(document) => (
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
          <Text
            selectable
            style={styles.routeDocument}
            testID="ui-daemon-route-document"
          >
            {formatRouteDocument(document)}
          </Text>
        </ScrollView>
      )}
    </ResourceScreen>
  );
}

function formatRouteDocument(document: UiDaemonRouteDocument): string {
  const rendered = JSON.stringify(document, null, 2);
  if (rendered.length <= MAX_ROUTE_PREVIEW_CHARS) return rendered;
  return `${rendered.slice(0, MAX_ROUTE_PREVIEW_CHARS)}\n\n… Response preview truncated at ${MAX_ROUTE_PREVIEW_CHARS.toLocaleString()} characters.`;
}
