import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  createNavigationContainerRef,
  NavigationContainer,
  NavigatorScreenParams,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import React, { useEffect } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { useDaemon } from '../context/DaemonContext';
import { ApprovalDetailScreen } from '../screens/ApprovalDetailScreen';
import { ApprovalListScreen } from '../screens/ApprovalListScreen';
import { AttentionScreen } from '../screens/AttentionScreen';
import { ChatDetailScreen } from '../screens/ChatDetailScreen';
import { ChatListScreen } from '../screens/ChatListScreen';
import { DigestScreen } from '../screens/DigestScreen';
import { KnowledgeScreen } from '../screens/KnowledgeScreen';
import { MemoryScreen } from '../screens/MemoryScreen';
import { OwnerQuestionListScreen } from '../screens/OwnerQuestionListScreen';
import { RunDetailScreen } from '../screens/RunDetailScreen';
import { RunListScreen } from '../screens/RunListScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StatusScreen } from '../screens/StatusScreen';
import { TaskQueueScreen } from '../screens/TaskQueueScreen';
import { routeNotificationResponse } from './routeNotificationResponse';

export type StatusStackParams = {
  DaemonStatus: undefined;
  RunDetail: { runId: string };
  Settings: undefined;
};

export type RunsStackParams = {
  RunList: undefined;
  RunDetail: { runId: string };
};

export type ApprovalsStackParams = {
  ApprovalList: undefined;
  ApprovalDetail: { approvalId: string };
};

export type ChatStackParams = {
  ChatList: undefined;
  ChatDetail: { sessionId: string };
};

export type TabParams = {
  Status: undefined;
  Runs: undefined;
  Approvals: NavigatorScreenParams<ApprovalsStackParams> | undefined;
  Questions: undefined;
  Tasks: undefined;
  Attention: undefined;
  Digest: undefined;
  Knowledge: undefined;
  Memory: undefined;
  Chat: NavigatorScreenParams<ChatStackParams> | undefined;
};

const StatusStack = createNativeStackNavigator<StatusStackParams>();
const RunsStack = createNativeStackNavigator<RunsStackParams>();
const ApprovalsStack = createNativeStackNavigator<ApprovalsStackParams>();
const ChatStack = createNativeStackNavigator<ChatStackParams>();
const Tab = createBottomTabNavigator<TabParams>();

// Navigation ref for use outside of React tree (e.g. notification response handler).
const navigationRef = createNavigationContainerRef<TabParams>();

function navigateToApproval(approvalId?: string) {
  if (!navigationRef.isReady()) return;
  if (approvalId) {
    navigationRef.navigate('Approvals', {
      screen: 'ApprovalDetail',
      params: { approvalId },
    });
  } else {
    navigationRef.navigate('Approvals');
  }
}

function navigateToDigest() {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Digest');
}

function navigateToAttention() {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Attention');
}

// Configure how notifications are presented while the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function StatusNavigator() {
  return (
    <StatusStack.Navigator>
      <StatusStack.Screen
        name="DaemonStatus"
        options={({ navigation }) => ({
          title: 'KOTA',
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
              <Text style={{ fontSize: 22 }}>⚙</Text>
            </TouchableOpacity>
          ),
        })}
      >
        {({ navigation }) => (
          <StatusScreen
            onRunPress={(runId) => navigation.navigate('RunDetail', { runId })}
            onSettingsPress={() => navigation.navigate('Settings')}
          />
        )}
      </StatusStack.Screen>
      <StatusStack.Screen name="RunDetail" options={{ title: 'Run Detail' }}>
        {({ route }) => <RunDetailScreen runId={route.params.runId} />}
      </StatusStack.Screen>
      <StatusStack.Screen name="Settings" component={SettingsScreen} />
    </StatusStack.Navigator>
  );
}

function RunsNavigator() {
  return (
    <RunsStack.Navigator>
      <RunsStack.Screen name="RunList" options={{ title: 'Runs' }}>
        {({ navigation }) => (
          <RunListScreen onRunPress={(id) => navigation.navigate('RunDetail', { runId: id })} />
        )}
      </RunsStack.Screen>
      <RunsStack.Screen name="RunDetail" options={{ title: 'Run Detail' }}>
        {({ route }) => <RunDetailScreen runId={route.params.runId} />}
      </RunsStack.Screen>
    </RunsStack.Navigator>
  );
}

function ApprovalsNavigator() {
  return (
    <ApprovalsStack.Navigator>
      <ApprovalsStack.Screen name="ApprovalList" options={{ title: 'Approvals' }}>
        {({ navigation }) => (
          <ApprovalListScreen
            onApprovalPress={(id) => navigation.navigate('ApprovalDetail', { approvalId: id })}
          />
        )}
      </ApprovalsStack.Screen>
      <ApprovalsStack.Screen name="ApprovalDetail" options={{ title: 'Approval Detail' }}>
        {({ route, navigation }) => (
          <ApprovalDetailScreen
            approvalId={route.params.approvalId}
            onDone={() => navigation.goBack()}
          />
        )}
      </ApprovalsStack.Screen>
    </ApprovalsStack.Navigator>
  );
}

function ChatNavigator() {
  return (
    <ChatStack.Navigator>
      <ChatStack.Screen name="ChatList" options={{ title: 'Chat' }}>
        {({ navigation }) => (
          <ChatListScreen
            onSessionPress={(sessionId) => navigation.navigate('ChatDetail', { sessionId })}
          />
        )}
      </ChatStack.Screen>
      <ChatStack.Screen name="ChatDetail" options={{ title: 'Session' }}>
        {({ route, navigation }) => (
          <ChatDetailScreen
            sessionId={route.params.sessionId}
            onClose={() => navigation.goBack()}
          />
        )}
      </ChatStack.Screen>
    </ChatStack.Navigator>
  );
}

export function AppNavigator() {
  const { state } = useDaemon();
  const pendingCount = state.pendingApprovalCount;
  const pendingQuestionCount = state.pendingOwnerQuestionCount;

  // Handle notification taps. Navigate based on the `screen` field in the payload.
  // Old notifications without `screen` open the app home as-is (no navigation).
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      routeNotificationResponse(response.notification.request.content.data, {
        toApproval: navigateToApproval,
        toDigest: navigateToDigest,
        toAttention: navigateToAttention,
      });
    });
    return () => sub.remove();
  }, []);

  return (
    <NavigationContainer ref={navigationRef}>
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
      >
        <Tab.Screen
          name="Status"
          component={StatusNavigator}
          options={{ tabBarIcon: () => <Text>📡</Text> }}
        />
        <Tab.Screen
          name="Runs"
          component={RunsNavigator}
          options={{ tabBarIcon: () => <Text>📋</Text> }}
        />
        <Tab.Screen
          name="Approvals"
          component={ApprovalsNavigator}
          options={{
            tabBarIcon: () => <Text>✅</Text>,
            tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          }}
        />
        <Tab.Screen
          name="Questions"
          component={OwnerQuestionListScreen}
          options={{
            tabBarIcon: () => <Text>❓</Text>,
            tabBarBadge: pendingQuestionCount > 0 ? pendingQuestionCount : undefined,
            headerShown: true,
            title: 'Questions',
          }}
        />
        <Tab.Screen
          name="Tasks"
          component={TaskQueueScreen}
          options={{ tabBarIcon: () => <Text>📌</Text>, headerShown: true, title: 'Tasks' }}
        />
        <Tab.Screen
          name="Attention"
          component={AttentionScreen}
          options={{ tabBarIcon: () => <Text>🔔</Text>, headerShown: true, title: 'Attention' }}
        />
        <Tab.Screen
          name="Digest"
          component={DigestScreen}
          options={{ tabBarIcon: () => <Text>📰</Text>, headerShown: true, title: 'Digest' }}
        />
        <Tab.Screen
          name="Knowledge"
          component={KnowledgeScreen}
          options={{ tabBarIcon: () => <Text>📚</Text>, headerShown: true, title: 'Knowledge' }}
        />
        <Tab.Screen
          name="Memory"
          component={MemoryScreen}
          options={{ tabBarIcon: () => <Text>🧠</Text>, headerShown: true, title: 'Memory' }}
        />
        <Tab.Screen
          name="Chat"
          component={ChatNavigator}
          options={{
            tabBarIcon: () => <Text>💬</Text>,
            tabBarActiveTintColor: state.online ? undefined : '#8e8e93',
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
