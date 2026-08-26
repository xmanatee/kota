import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  createNavigationContainerRef,
  NavigationContainer,
  type NavigatorScreenParams,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Text, TouchableOpacity, View } from 'react-native';
import { useDaemon } from '../context/DaemonContext';
import type {
  UiIntent,
  UiSurfaceBundle,
} from '../daemon/ui-surface.generated';
import { ChatDetailScreen } from '../screens/ChatDetailScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import {
  entrySurface,
  orderedIntents,
  resolveDeepLink,
  surfacesForIntent,
  type UiDeepLinkTarget,
} from '../shared-ui/graph';
import { SharedUiSurface } from '../shared-ui/SharedUiSurface';
import { CenteredMessage } from './CenteredMessage';
import { DaemonRouteScreen } from './DaemonRouteScreen';
import { routeNotificationResponse } from './routeNotificationResponse';
import { navigationStyles as styles } from './styles';

type SurfaceRouteParams = {
  actionId?: string;
  sessionId?: string;
  daemonRoutePath?: string;
};

type SurfaceStackParams = Record<string, SurfaceRouteParams | undefined>;
type IntentTabParams = Record<
  string,
  NavigatorScreenParams<SurfaceStackParams> | undefined
>;

const SESSION_EXTENSION_ROUTE = '__kota_session_extension__';
const DAEMON_ROUTE_EXTENSION_ROUTE = '__kota_daemon_route_extension__';
const SurfaceStack = createNativeStackNavigator<SurfaceStackParams>();
const IntentTabs = createBottomTabNavigator<IntentTabParams>();
const navigationRef = createNavigationContainerRef<IntentTabParams>();

export function AppNavigator() {
  const { state, ui, refreshUi } = useDaemon();
  const [connectionOpen, setConnectionOpen] = useState(false);
  const bundleRef = useRef(ui.bundle);
  const pendingTargetRef = useRef<UiDeepLinkTarget | null>(null);
  bundleRef.current = ui.bundle;

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  }, []);

  const flushPendingTarget = useCallback(() => {
    const bundle = bundleRef.current;
    const target = pendingTargetRef.current;
    if (!bundle || !target) return;
    if (!resolveDeepLink(bundle, target)) {
      pendingTargetRef.current = null;
      return;
    }
    if (navigateToUiTarget(bundle, target)) {
      pendingTargetRef.current = null;
    }
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        routeNotificationResponse(
          response.notification.request.content.data,
          {
            toSharedUi: (target) => {
              pendingTargetRef.current = target;
              flushPendingTarget();
            },
          },
        );
      },
    );
    return () => subscription.remove();
  }, [flushPendingTarget]);

  useEffect(flushPendingTarget, [flushPendingTarget, ui.bundle]);

  if (!state.settingsLoaded) {
    return <CenteredMessage loading title="Loading device settings" />;
  }
  if (!state.daemonUrl || !state.token || connectionOpen) {
    return (
      <View style={styles.fullScreen}>
        {state.daemonUrl && state.token ? (
          <TouchableOpacity
            style={styles.closeConnection}
            accessibilityRole="button"
            accessibilityLabel="Close daemon connection settings"
            onPress={() => setConnectionOpen(false)}
          >
            <Text style={styles.closeConnectionLabel}>Done</Text>
          </TouchableOpacity>
        ) : null}
        <SettingsScreen />
      </View>
    );
  }
  if (ui.loading && !ui.bundle) {
    return <CenteredMessage loading title="Loading shared operator surfaces" />;
  }
  if (ui.error && !ui.bundle) {
    return (
      <CenteredMessage title="Shared UI unavailable" detail={ui.error}>
        <TouchableOpacity
          style={styles.primaryButton}
          accessibilityRole="button"
          accessibilityLabel="Retry shared UI"
          onPress={() => void refreshUi()}
        >
          <Text style={styles.primaryButtonLabel}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          accessibilityRole="button"
          accessibilityLabel="Open daemon connection settings"
          onPress={() => setConnectionOpen(true)}
        >
          <Text style={styles.secondaryButtonLabel}>Connection</Text>
        </TouchableOpacity>
      </CenteredMessage>
    );
  }
  if (!ui.bundle || ui.bundle.surfaces.length === 0) {
    return (
      <CenteredMessage
        title="No operator surfaces"
        detail="The connected scope does not contribute any shared UI surfaces."
      />
    );
  }

  const intents = orderedIntents(ui.bundle);
  return (
    <NavigationContainer ref={navigationRef} onReady={flushPendingTarget}>
      <IntentTabs.Navigator screenOptions={{ headerShown: false }}>
        {intents.map((intent) => (
          <IntentTabs.Screen
            key={intent}
            name={intent}
            options={{
              tabBarLabel: intent,
              tabBarIcon: ({ color }) => (
                <Text style={[styles.tabGlyph, { color }]}>
                  {intent.slice(0, 1)}
                </Text>
              ),
            }}
          >
            {() => (
              <IntentNavigator
                bundle={ui.bundle!}
                intent={intent}
                onOpenConnection={() => setConnectionOpen(true)}
              />
            )}
          </IntentTabs.Screen>
        ))}
      </IntentTabs.Navigator>
    </NavigationContainer>
  );
}

function IntentNavigator({
  bundle,
  intent,
  onOpenConnection,
}: {
  bundle: UiSurfaceBundle;
  intent: UiIntent;
  onOpenConnection: () => void;
}) {
  const { ui, refreshUi } = useDaemon();
  const surfaces = surfacesForIntent(bundle, intent);
  const initial = entrySurface(surfaces);

  return (
    <SurfaceStack.Navigator initialRouteName={initial?.surfaceId}>
      {surfaces.map((surface) => (
        <SurfaceStack.Screen
          key={surface.surfaceId}
          name={surface.surfaceId}
          options={{ title: surface.title }}
        >
          {({ route, navigation }) => (
            <SharedUiSurface
              surface={surface}
              onNavigate={(surfaceId) =>
                navigateToUiTarget(bundle, { surfaceId })
              }
              onOpenLink={(target) => {
                switch (target.kind) {
                  case 'surface':
                    navigateToUiTarget(bundle, {
                      surfaceId: target.surfaceId,
                    });
                    return;
                  case 'session':
                    navigation.navigate(SESSION_EXTENSION_ROUTE, {
                      sessionId: target.sessionId,
                    });
                    return;
                  case 'daemon-route':
                    navigation.navigate(DAEMON_ROUTE_EXTENSION_ROUTE, {
                      daemonRoutePath: target.path,
                    });
                    return;
                  case 'external-url':
                    void Linking.openURL(target.url);
                    return;
                  default:
                    assertLinkNever(target);
                }
              }}
              onRefresh={() => void refreshUi()}
              refreshing={ui.loading}
              onOpenConnection={onOpenConnection}
              liveLogEntries={ui.liveLogEntries}
              highlightedActionId={route.params?.actionId}
            />
          )}
        </SurfaceStack.Screen>
      ))}
      <SurfaceStack.Screen
        name={DAEMON_ROUTE_EXTENSION_ROUTE}
        options={{ title: 'Daemon response' }}
      >
        {({ route }) => (
          <DaemonRouteScreen path={route.params?.daemonRoutePath ?? ''} />
        )}
      </SurfaceStack.Screen>
      <SurfaceStack.Screen
        name={SESSION_EXTENSION_ROUTE}
        options={{ title: 'Session' }}
      >
        {({ route, navigation }) => (
          <ChatDetailScreen
            sessionId={route.params?.sessionId ?? ''}
            onClose={() => navigation.goBack()}
          />
        )}
      </SurfaceStack.Screen>
    </SurfaceStack.Navigator>
  );
}

export function navigateToUiTarget(
  bundle: UiSurfaceBundle,
  target: UiDeepLinkTarget,
): boolean {
  const resolved = resolveDeepLink(bundle, target);
  if (!resolved || !navigationRef.isReady()) return false;
  navigationRef.navigate(resolved.surface.intent, {
    screen: resolved.surface.surfaceId,
    params:
      resolved.actionId === undefined
        ? undefined
        : { actionId: resolved.actionId },
  });
  return true;
}

function assertLinkNever(value: never): never {
  throw new Error(`Unhandled ui.surface.v1 link: ${JSON.stringify(value)}`);
}
