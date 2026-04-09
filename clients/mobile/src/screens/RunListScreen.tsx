import React, { useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDaemon } from '../context/DaemonContext';
import type { RunSummary, RunStatus } from '../types';

function statusIcon(status: RunStatus): string {
  switch (status) {
    case 'success':
      return '✓';
    case 'failed':
      return '✗';
    case 'interrupted':
      return '⊘';
    case 'completed-with-warnings':
      return '⚠';
    default:
      return '?';
  }
}

function statusColor(status: RunStatus): string {
  switch (status) {
    case 'success':
      return '#30d158';
    case 'failed':
      return '#ff3b30';
    case 'interrupted':
      return '#ff9500';
    case 'completed-with-warnings':
      return '#ff9500';
    default:
      return '#8e8e93';
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function RunRow({ run, onPress }: { run: RunSummary; onPress: () => void }) {
  const color = statusColor(run.status);
  const icon = statusIcon(run.status);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={styles.rowTop}>
        <Text style={styles.workflow}>{run.workflow}</Text>
        <View style={styles.statusBadge}>
          <Text style={[styles.statusIcon, { color }]}>{icon} {run.status}</Text>
          <Text style={styles.dur}>{formatDuration(run.durationMs)}</Text>
        </View>
      </View>
      <View style={styles.rowBottom}>
        <Text style={styles.date}>{formatDate(run.startedAt)}</Text>
        {run.totalCostUsd !== undefined && (
          <Text style={styles.cost}>${run.totalCostUsd.toFixed(2)}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export function RunListScreen({ onRunPress }: { onRunPress: (id: string) => void }) {
  const { state, refresh } = useDaemon();
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    refresh();
    await new Promise((r) => setTimeout(r, 800));
    setRefreshing(false);
  }

  return (
    <FlatList
      style={styles.container}
      data={state.runs}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <RunRow run={item} onPress={() => onRunPress(item.id)} />
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={() => (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {state.online ? 'No runs yet.' : 'Daemon offline.'}
          </Text>
        </View>
      )}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />
      }
      contentContainerStyle={state.runs.length === 0 ? styles.emptyContainer : undefined}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  row: {
    backgroundColor: '#fff',
    padding: 14,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  workflow: { fontSize: 15, fontWeight: '600', color: '#1c1c1e' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusIcon: { fontSize: 13, fontWeight: '600' },
  dur: { fontSize: 13, color: '#8e8e93' },
  date: { fontSize: 13, color: '#8e8e93' },
  cost: { fontSize: 13, color: '#8e8e93' },
  separator: { height: 0 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyContainer: { flexGrow: 1 },
  emptyText: { color: '#8e8e93', fontSize: 14 },
});
