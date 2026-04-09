import React, { useState } from 'react';
import {
  Alert,
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

function inputSummary(input: Record<string, unknown>): string {
  const first = Object.values(input)[0];
  if (typeof first === 'string') return first.slice(0, 80);
  return JSON.stringify(input).slice(0, 80);
}

function ApprovalRow({
  approval,
  onPress,
  onApprove,
  onReject,
}: {
  approval: Approval;
  onPress: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isDangerous = approval.risk === 'dangerous';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={styles.rowTop}>
        <Text style={[styles.risk, { color: riskColor(approval.risk) }]}>
          ⚠ {approval.tool} — {approval.risk}
        </Text>
        <Text style={styles.age}>{timeAgo(approval.createdAt)}</Text>
      </View>
      <Text style={styles.summary} numberOfLines={2}>
        {inputSummary(approval.input)}
      </Text>
      {!isDangerous && (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.approveBtn} onPress={onApprove}>
            <Text style={styles.approveBtnText}>Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.rejectBtn} onPress={onReject}>
            <Text style={styles.rejectBtnText}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}
      {isDangerous && (
        <Text style={styles.tapHint}>Tap for details to approve</Text>
      )}
    </TouchableOpacity>
  );
}

export function ApprovalListScreen({
  onApprovalPress,
}: {
  onApprovalPress: (id: string) => void;
}) {
  const { state, client, refresh } = useDaemon();
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    refresh();
    await new Promise((r) => setTimeout(r, 800));
    setRefreshing(false);
  }

  async function handleApprove(id: string) {
    if (!client || acting) return;
    setActing(id);
    try {
      await client.approve(id);
      refresh();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to approve.');
    } finally {
      setActing(null);
    }
  }

  async function handleReject(id: string) {
    if (!client || acting) return;
    setActing(id);
    try {
      await client.reject(id);
      refresh();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to reject.');
    } finally {
      setActing(null);
    }
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
          onApprove={() => void handleApprove(item.id)}
          onReject={() => void handleReject(item.id)}
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
  summary: { fontSize: 13, color: '#3c3c43', marginBottom: 10, fontFamily: 'monospace' },
  actions: { flexDirection: 'row', gap: 10 },
  approveBtn: {
    flex: 1,
    backgroundColor: '#30d158',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  approveBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  rejectBtn: {
    flex: 1,
    backgroundColor: '#ff3b30',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  rejectBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  tapHint: { fontSize: 12, color: '#8e8e93', textAlign: 'center', marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyContainer: { flexGrow: 1 },
  emptyText: { color: '#8e8e93', fontSize: 14 },
});
