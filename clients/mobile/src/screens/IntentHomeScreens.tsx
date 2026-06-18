import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDaemon } from '../context/DaemonContext';
import type { TaskEntry } from '../types';

function IntentRow({
  title,
  detail,
  count,
  onPress,
}: {
  title: string;
  detail: string;
  count?: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      {count !== undefined && (
        <View style={[styles.count, count > 0 ? styles.countActive : styles.countQuiet]}>
          <Text style={[styles.countText, count > 0 ? styles.countTextActive : styles.countTextQuiet]}>
            {count}
          </Text>
        </View>
      )}
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function BlockedTaskPreview({ task }: { task: TaskEntry }) {
  return (
    <View style={styles.blockedTask}>
      <Text style={styles.blockedPriority}>{task.priority}</Text>
      <View style={styles.blockedText}>
        <Text style={styles.blockedTitle} numberOfLines={1}>
          {task.title}
        </Text>
        {task.summary.length > 0 && (
          <Text style={styles.blockedSummary} numberOfLines={2}>
            {task.summary}
          </Text>
        )}
      </View>
    </View>
  );
}

export function InboxHomeScreen({
  onApprovalsPress,
  onQuestionsPress,
  onBlockedWorkPress,
  onAttentionPress,
}: {
  onApprovalsPress: () => void;
  onQuestionsPress: () => void;
  onBlockedWorkPress: () => void;
  onAttentionPress: () => void;
}) {
  const { state } = useDaemon();
  const approvals = state.approvals.filter((approval) => approval.status === 'pending');
  const questions = state.ownerQuestions.filter((question) => question.status === 'pending');
  const blockedTasks = state.tasks?.tasks.blocked ?? [];
  const attentionCount = state.attention?.data.items.length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Inbox</Text>
      <Text style={styles.subtitle}>Owner actions and blocked work.</Text>

      <View style={styles.section}>
        <IntentRow
          title="Approvals"
          detail="Commands waiting for operator approval."
          count={approvals.length}
          onPress={onApprovalsPress}
        />
        <IntentRow
          title="Owner questions"
          detail="Questions that need a human answer."
          count={questions.length}
          onPress={onQuestionsPress}
        />
        <IntentRow
          title="Blocked work"
          detail="Tasks that cannot move without an unblocker."
          count={blockedTasks.length}
          onPress={onBlockedWorkPress}
        />
        <IntentRow
          title="Attention"
          detail="Daemon attention digest and runtime warnings."
          count={attentionCount}
          onPress={onAttentionPress}
        />
      </View>

      {approvals.length > 0 && (
        <View style={styles.preview}>
          <Text style={styles.previewTitle}>Approvals now</Text>
          {approvals.slice(0, 3).map((approval) => (
            <Text key={approval.id} style={styles.previewLine} numberOfLines={1}>
              {approval.tool}
            </Text>
          ))}
        </View>
      )}

      {questions.length > 0 && (
        <View style={styles.preview}>
          <Text style={styles.previewTitle}>Questions now</Text>
          {questions.slice(0, 3).map((question) => (
            <Text key={question.id} style={styles.previewLine} numberOfLines={2}>
              {question.question}
            </Text>
          ))}
        </View>
      )}

      {blockedTasks.length > 0 && (
        <View style={styles.preview}>
          <Text style={styles.previewTitle}>Blocked now</Text>
          {blockedTasks.slice(0, 3).map((task) => (
            <BlockedTaskPreview key={task.id} task={task} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

export function WorkHomeScreen({
  onRunsPress,
  onTasksPress,
  onTaskSearchPress,
  onDigestPress,
  onAnswerHistoryPress,
  onChatPress,
}: {
  onRunsPress: () => void;
  onTasksPress: () => void;
  onTaskSearchPress: () => void;
  onDigestPress: () => void;
  onAnswerHistoryPress: () => void;
  onChatPress: () => void;
}) {
  const { state } = useDaemon();
  const activeRuns = state.status?.workflow.activeRuns.length ?? 0;
  const queuedTasks =
    (state.tasks?.counts.ready ?? 0) + (state.tasks?.counts.doing ?? 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Work</Text>
      <Text style={styles.subtitle}>Runs, tasks, sessions, and daily operating views.</Text>
      <View style={styles.section}>
        <IntentRow title="Runs" detail="Recent and active workflow runs." count={activeRuns} onPress={onRunsPress} />
        <IntentRow title="Tasks" detail="Queue state grouped by task status." count={queuedTasks} onPress={onTasksPress} />
        <IntentRow title="Task search" detail="Search repo task records." onPress={onTaskSearchPress} />
        <IntentRow title="Digest" detail="Daily operator digest." onPress={onDigestPress} />
        <IntentRow title="Answer history" detail="Past cited answer records." onPress={onAnswerHistoryPress} />
        <IntentRow title="Chat" detail="Interactive daemon sessions." onPress={onChatPress} />
      </View>
    </ScrollView>
  );
}

export function KnowledgeHomeScreen({
  onAnswerPress,
  onRecallPress,
  onKnowledgePress,
  onMemoryPress,
  onHistoryPress,
  onCapturePress,
  onRetractPress,
}: {
  onAnswerPress: () => void;
  onRecallPress: () => void;
  onKnowledgePress: () => void;
  onMemoryPress: () => void;
  onHistoryPress: () => void;
  onCapturePress: () => void;
  onRetractPress: () => void;
}) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Knowledge</Text>
      <Text style={styles.subtitle}>Ask, recall, search, capture, and retract records.</Text>
      <View style={styles.section}>
        <IntentRow title="Ask" detail="Synthesize an answer with citations." onPress={onAnswerPress} />
        <IntentRow title="Recall" detail="Search across knowledge, memory, history, and tasks." onPress={onRecallPress} />
        <IntentRow title="Knowledge" detail="Search structured knowledge entries." onPress={onKnowledgePress} />
        <IntentRow title="Memory" detail="Search persistent memory." onPress={onMemoryPress} />
        <IntentRow title="History" detail="Search prior conversations." onPress={onHistoryPress} />
        <IntentRow title="Capture" detail="Route a note into the right store." onPress={onCapturePress} />
        <IntentRow title="Retract" detail="Remove a record from a supported store." onPress={onRetractPress} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  content: { padding: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#1c1c1e' },
  subtitle: { marginTop: 4, marginBottom: 16, fontSize: 14, color: '#6c6c70' },
  section: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden' },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d1d6',
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: '#1c1c1e' },
  rowDetail: { marginTop: 2, fontSize: 12, color: '#6c6c70' },
  count: {
    minWidth: 28,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  countActive: { backgroundColor: '#ff9500' },
  countQuiet: { backgroundColor: '#e5e5ea' },
  countText: { fontSize: 12, fontWeight: '700' },
  countTextActive: { color: '#fff' },
  countTextQuiet: { color: '#6c6c70' },
  chevron: { color: '#8e8e93', fontSize: 26, lineHeight: 26 },
  preview: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
  },
  previewTitle: {
    marginBottom: 10,
    fontSize: 13,
    fontWeight: '700',
    color: '#6c6c70',
    textTransform: 'uppercase',
  },
  previewLine: {
    paddingVertical: 6,
    fontSize: 14,
    fontWeight: '600',
    color: '#1c1c1e',
  },
  blockedTask: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  blockedPriority: { width: 24, fontSize: 12, fontWeight: '700', color: '#ff9500' },
  blockedText: { flex: 1 },
  blockedTitle: { fontSize: 14, fontWeight: '600', color: '#1c1c1e' },
  blockedSummary: { marginTop: 2, fontSize: 12, color: '#6c6c70' },
});
