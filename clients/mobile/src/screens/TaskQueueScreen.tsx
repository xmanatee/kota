import React, { useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useDaemon } from '../context/DaemonContext';
import type { TaskCounts, TaskEntry } from '../types';

function CountBadge({ label, count }: { label: string; count: number }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeCount}>{count}</Text>
      <Text style={styles.badgeLabel}>{label}</Text>
    </View>
  );
}

function TaskCard({ task }: { task: TaskEntry }) {
  const priorityColor =
    task.priority === 'p1'
      ? '#ff3b30'
      : task.priority === 'p2'
        ? '#ff9500'
        : '#8e8e93';
  return (
    <View style={styles.taskCard}>
      <View style={styles.taskHeader}>
        <Text style={[styles.priority, { color: priorityColor }]}>{task.priority}</Text>
        <Text style={styles.area}>{task.area}</Text>
      </View>
      <Text style={styles.taskTitle}>{task.title}</Text>
      {task.summary && <Text style={styles.taskSummary} numberOfLines={2}>{task.summary}</Text>}
    </View>
  );
}

export function TaskQueueScreen() {
  const { state, refresh } = useDaemon();
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    refresh();
    await new Promise((r) => setTimeout(r, 800));
    setRefreshing(false);
  }

  const counts: TaskCounts = state.tasks?.counts ?? {};
  const doing: TaskEntry[] = state.tasks?.tasks.doing ?? [];
  const ready: TaskEntry[] = state.tasks?.tasks.ready ?? [];
  const blocked: TaskEntry[] = state.tasks?.tasks.blocked ?? [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
    >
      <View style={styles.countsRow}>
        <CountBadge label="inbox" count={counts.inbox ?? 0} />
        <CountBadge label="ready" count={counts.ready ?? 0} />
        <CountBadge label="doing" count={counts.doing ?? 0} />
        <CountBadge label="blocked" count={counts.blocked ?? 0} />
        <CountBadge label="backlog" count={counts.backlog ?? 0} />
      </View>

      {doing.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>In Progress</Text>
          {doing.map((t) => <TaskCard key={t.id} task={t} />)}
        </>
      )}

      {ready.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>Ready</Text>
          {ready.map((t) => <TaskCard key={t.id} task={t} />)}
        </>
      )}

      {blocked.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>Blocked</Text>
          {blocked.map((t) => <TaskCard key={t.id} task={t} />)}
        </>
      )}

      {doing.length === 0 && ready.length === 0 && blocked.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {state.online ? 'No tasks in queue.' : 'Daemon offline.'}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  content: { padding: 16 },
  countsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  badge: { alignItems: 'center', minWidth: 44 },
  badgeCount: { fontSize: 20, fontWeight: '700', color: '#1c1c1e' },
  badgeLabel: { fontSize: 11, color: '#8e8e93', marginTop: 2 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6c6c70',
    marginBottom: 8,
    marginTop: 8,
  },
  taskCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  taskHeader: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  priority: { fontSize: 12, fontWeight: '700' },
  area: { fontSize: 12, color: '#8e8e93' },
  taskTitle: { fontSize: 14, fontWeight: '600', color: '#1c1c1e' },
  taskSummary: { fontSize: 13, color: '#3c3c43', marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#8e8e93', fontSize: 14 },
});
