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
import { AnswerHistoryScreen } from '../screens/AnswerHistoryScreen';
import { AnswerScreen } from '../screens/AnswerScreen';
import { ApprovalDetailScreen } from '../screens/ApprovalDetailScreen';
import { ApprovalListScreen } from '../screens/ApprovalListScreen';
import { AttentionScreen } from '../screens/AttentionScreen';
import { CaptureScreen } from '../screens/CaptureScreen';
import { ChatDetailScreen } from '../screens/ChatDetailScreen';
import { ChatListScreen } from '../screens/ChatListScreen';
import { DigestScreen } from '../screens/DigestScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import {
  InboxHomeScreen,
  KnowledgeHomeScreen,
  WorkHomeScreen,
} from '../screens/IntentHomeScreens';
import { KnowledgeScreen } from '../screens/KnowledgeScreen';
import { MemoryScreen } from '../screens/MemoryScreen';
import { OwnerQuestionListScreen } from '../screens/OwnerQuestionListScreen';
import { RecallScreen } from '../screens/RecallScreen';
import { RetractScreen } from '../screens/RetractScreen';
import { RunDetailScreen } from '../screens/RunDetailScreen';
import { RunListScreen } from '../screens/RunListScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StatusScreen } from '../screens/StatusScreen';
import { TaskQueueScreen } from '../screens/TaskQueueScreen';
import { TaskSearchScreen } from '../screens/TaskSearchScreen';
import { PRIMARY_OPERATOR_TABS } from './operatorIntents';
import { routeNotificationResponse } from './routeNotificationResponse';

export type StatusStackParams = {
  DaemonStatus: undefined;
  RunDetail: { runId: string };
  Settings: undefined;
};

export type InboxStackParams = {
  InboxHome: undefined;
  ApprovalList: undefined;
  ApprovalDetail: { approvalId: string };
  OwnerQuestions: undefined;
  BlockedWork: undefined;
  Attention: undefined;
};

export type WorkStackParams = {
  WorkHome: undefined;
  RunList: undefined;
  RunDetail: { runId: string };
  Tasks: undefined;
  TaskSearch: undefined;
  Digest: undefined;
  AnswerHistory: undefined;
  ChatList: undefined;
  ChatDetail: { sessionId: string };
};

export type KnowledgeStackParams = {
  KnowledgeHome: undefined;
  Answer: undefined;
  Recall: undefined;
  KnowledgeSearch: undefined;
  Memory: undefined;
  History: undefined;
  Capture: undefined;
  Retract: undefined;
};

export type SetupStackParams = {
  Settings: undefined;
};

export type TabParams = {
  Status: undefined;
  Inbox: NavigatorScreenParams<InboxStackParams> | undefined;
  Work: NavigatorScreenParams<WorkStackParams> | undefined;
  Knowledge: NavigatorScreenParams<KnowledgeStackParams> | undefined;
  Setup: undefined;
};

const StatusStack = createNativeStackNavigator<StatusStackParams>();
const InboxStack = createNativeStackNavigator<InboxStackParams>();
const WorkStack = createNativeStackNavigator<WorkStackParams>();
const KnowledgeStack = createNativeStackNavigator<KnowledgeStackParams>();
const SetupStack = createNativeStackNavigator<SetupStackParams>();
const Tab = createBottomTabNavigator<TabParams>();

// Navigation ref for use outside of React tree (e.g. notification response handler).
const navigationRef = createNavigationContainerRef<TabParams>();

function navigateToApproval(approvalId?: string) {
  if (!navigationRef.isReady()) return;
  if (approvalId) {
    navigationRef.navigate('Inbox', {
      screen: 'ApprovalDetail',
      params: { approvalId },
    });
  } else {
    navigationRef.navigate('Inbox', { screen: 'ApprovalList' });
  }
}

function navigateToDigest() {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Work', { screen: 'Digest' });
}

function navigateToAttention() {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Inbox', { screen: 'Attention' });
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

function InboxNavigator() {
  return (
    <InboxStack.Navigator>
      <InboxStack.Screen name="InboxHome" options={{ title: 'Inbox' }}>
        {({ navigation }) => (
          <InboxHomeScreen
            onApprovalsPress={() => navigation.navigate('ApprovalList')}
            onQuestionsPress={() => navigation.navigate('OwnerQuestions')}
            onBlockedWorkPress={() => navigation.navigate('BlockedWork')}
            onAttentionPress={() => navigation.navigate('Attention')}
          />
        )}
      </InboxStack.Screen>
      <InboxStack.Screen name="ApprovalList" options={{ title: 'Approvals' }}>
        {({ navigation }) => (
          <ApprovalListScreen
            onApprovalPress={(id) => navigation.navigate('ApprovalDetail', { approvalId: id })}
          />
        )}
      </InboxStack.Screen>
      <InboxStack.Screen name="ApprovalDetail" options={{ title: 'Approval Detail' }}>
        {({ route, navigation }) => (
          <ApprovalDetailScreen
            approvalId={route.params.approvalId}
            onDone={() => navigation.goBack()}
          />
        )}
      </InboxStack.Screen>
      <InboxStack.Screen
        name="OwnerQuestions"
        component={OwnerQuestionListScreen}
        options={{ title: 'Owner questions' }}
      />
      <InboxStack.Screen
        name="BlockedWork"
        component={TaskQueueScreen}
        options={{ title: 'Blocked work' }}
      />
      <InboxStack.Screen
        name="Attention"
        component={AttentionScreen}
        options={{ title: 'Attention' }}
      />
    </InboxStack.Navigator>
  );
}

function WorkNavigator() {
  return (
    <WorkStack.Navigator>
      <WorkStack.Screen name="WorkHome" options={{ title: 'Work' }}>
        {({ navigation }) => (
          <WorkHomeScreen
            onRunsPress={() => navigation.navigate('RunList')}
            onTasksPress={() => navigation.navigate('Tasks')}
            onTaskSearchPress={() => navigation.navigate('TaskSearch')}
            onDigestPress={() => navigation.navigate('Digest')}
            onAnswerHistoryPress={() => navigation.navigate('AnswerHistory')}
            onChatPress={() => navigation.navigate('ChatList')}
          />
        )}
      </WorkStack.Screen>
      <WorkStack.Screen name="RunList" options={{ title: 'Runs' }}>
        {({ navigation }) => (
          <RunListScreen onRunPress={(id) => navigation.navigate('RunDetail', { runId: id })} />
        )}
      </WorkStack.Screen>
      <WorkStack.Screen name="RunDetail" options={{ title: 'Run Detail' }}>
        {({ route }) => <RunDetailScreen runId={route.params.runId} />}
      </WorkStack.Screen>
      <WorkStack.Screen name="Tasks" component={TaskQueueScreen} />
      <WorkStack.Screen
        name="TaskSearch"
        component={TaskSearchScreen}
        options={{ title: 'Task search' }}
      />
      <WorkStack.Screen name="Digest" component={DigestScreen} />
      <WorkStack.Screen
        name="AnswerHistory"
        component={AnswerHistoryScreen}
        options={{ title: 'Answer history' }}
      />
      <WorkStack.Screen name="ChatList" options={{ title: 'Chat' }}>
        {({ navigation }) => (
          <ChatListScreen
            onSessionPress={(sessionId) => navigation.navigate('ChatDetail', { sessionId })}
          />
        )}
      </WorkStack.Screen>
      <WorkStack.Screen name="ChatDetail" options={{ title: 'Session' }}>
        {({ route, navigation }) => (
          <ChatDetailScreen
            sessionId={route.params.sessionId}
            onClose={() => navigation.goBack()}
          />
        )}
      </WorkStack.Screen>
    </WorkStack.Navigator>
  );
}

function KnowledgeNavigator() {
  return (
    <KnowledgeStack.Navigator>
      <KnowledgeStack.Screen name="KnowledgeHome" options={{ title: 'Knowledge' }}>
        {({ navigation }) => (
          <KnowledgeHomeScreen
            onAnswerPress={() => navigation.navigate('Answer')}
            onRecallPress={() => navigation.navigate('Recall')}
            onKnowledgePress={() => navigation.navigate('KnowledgeSearch')}
            onMemoryPress={() => navigation.navigate('Memory')}
            onHistoryPress={() => navigation.navigate('History')}
            onCapturePress={() => navigation.navigate('Capture')}
            onRetractPress={() => navigation.navigate('Retract')}
          />
        )}
      </KnowledgeStack.Screen>
      <KnowledgeStack.Screen name="Answer" component={AnswerScreen} />
      <KnowledgeStack.Screen name="Recall" component={RecallScreen} />
      <KnowledgeStack.Screen
        name="KnowledgeSearch"
        component={KnowledgeScreen}
        options={{ title: 'Knowledge' }}
      />
      <KnowledgeStack.Screen name="Memory" component={MemoryScreen} />
      <KnowledgeStack.Screen name="History" component={HistoryScreen} />
      <KnowledgeStack.Screen name="Capture" component={CaptureScreen} />
      <KnowledgeStack.Screen name="Retract" component={RetractScreen} />
    </KnowledgeStack.Navigator>
  );
}

function SetupNavigator() {
  return (
    <SetupStack.Navigator>
      <SetupStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Setup' }}
      />
    </SetupStack.Navigator>
  );
}

export function AppNavigator() {
  const { state } = useDaemon();
  const pendingCount = state.pendingApprovalCount;
  const pendingQuestionCount = state.pendingOwnerQuestionCount;
  const blockedCount = state.tasks?.counts.blocked ?? state.tasks?.tasks.blocked?.length ?? 0;
  const inboxCount = pendingCount + pendingQuestionCount + blockedCount;

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
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen
          name={PRIMARY_OPERATOR_TABS[0]}
          component={StatusNavigator}
          options={{ tabBarIcon: () => <Text>📡</Text> }}
        />
        <Tab.Screen
          name={PRIMARY_OPERATOR_TABS[1]}
          component={InboxNavigator}
          options={{
            tabBarIcon: () => <Text>☑</Text>,
            tabBarBadge: inboxCount > 0 ? inboxCount : undefined,
          }}
        />
        <Tab.Screen
          name={PRIMARY_OPERATOR_TABS[2]}
          component={WorkNavigator}
          options={{
            tabBarIcon: () => <Text>◼</Text>,
            tabBarActiveTintColor: state.online ? undefined : '#8e8e93',
          }}
        />
        <Tab.Screen
          name={PRIMARY_OPERATOR_TABS[3]}
          component={KnowledgeNavigator}
          options={{ tabBarIcon: () => <Text>◇</Text> }}
        />
        <Tab.Screen
          name={PRIMARY_OPERATOR_TABS[4]}
          component={SetupNavigator}
          options={{ tabBarIcon: () => <Text>⚙</Text> }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
