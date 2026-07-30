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
import type { Approval } from '../types';

function riskColor(risk: string): string {
  switch (risk) {
    case 'dangerous':
      return '#ff3b30';
    case 'elevated':
      return '#ff9500';
    default:
      return '#34c759';
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m === 1) return '1m ago';
  return `${m}m ago`;
}

function ApprovalRow({
  approval,
  onPress,
}: {
  approval: Approval;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Review approval for ${approval.tool}`}
    >
      <View style={styles.rowTop}>
        <Text style={[styles.risk, { color: riskColor(approval.risk) }]}>
          ⚠ {approval.tool} — {approval.risk}
        </Text>
        <Text style={styles.age}>{timeAgo(approval.createdAt)}</Text>
      </View>
      <Text style={styles.reviewHint}>
        {approval.review.status === 'available'
          ? 'Open to review the complete input and conversation context'
          : 'Open to reject; input is unavailable after daemon restart'}
      </Text>
    </TouchableOpacity>
  );
}

export function ApprovalListScreen({
  onApprovalPress,
}: {
  onApprovalPress: (id: string) => void;
}) {
  const { state, refresh } = useDaemon();
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    refresh();
    await new Promise((r) => setTimeout(r, 800));
    setRefreshing(false);
  }

  const pending = state.approvals.filter((a) => a.status === 'pending');

  return (
    <FlatList
      style={styles.container}
      data={pending}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <ApprovalRow
          approval={item}
          onPress={() => onApprovalPress(item.id)}
        />
      )}
      ListEmptyComponent={() => (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No pending approvals.</Text>
        </View>
      )}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />
      }
      contentContainerStyle={pending.length === 0 ? styles.emptyContainer : styles.list}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  list: { paddingVertical: 8 },
  row: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  risk: { fontSize: 14, fontWeight: '600' },
  age: { fontSize: 13, color: '#8e8e93' },
  reviewHint: { fontSize: 13, color: '#3c3c43' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyContainer: { flexGrow: 1 },
  emptyText: { color: '#8e8e93', fontSize: 14 },
});
