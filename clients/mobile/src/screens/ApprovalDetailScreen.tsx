import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

export function ApprovalDetailScreen({
  approvalId,
  onDone,
}: {
  approvalId: string;
  onDone: () => void;
}) {
  const { state, client, refresh } = useDaemon();
  const [note, setNote] = useState('');
  const [acting, setActing] = useState(false);

  const approval: Approval | undefined = useMemo(
    () => state.approvals.find((a) => a.id === approvalId),
    [state.approvals, approvalId],
  );

  async function handleApprove() {
    if (!client || acting || !approval) return;
    setActing(true);
    try {
      await client.approve(approvalId, note || undefined);
      refresh();
      onDone();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to approve.');
    } finally {
      setActing(false);
    }
  }

  async function handleReject() {
    if (!client || acting || !approval) return;
    setActing(true);
    try {
      await client.reject(approvalId, note || undefined);
      refresh();
      onDone();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to reject.');
    } finally {
      setActing(false);
    }
  }

  if (!approval) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Approval not found or already resolved.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Tool</Text>
          <Text style={styles.fieldValue}>{approval.tool}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Risk</Text>
          <Text style={[styles.fieldValue, { color: riskColor(approval.risk) }]}>
            {approval.risk}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Requested</Text>
          <Text style={styles.fieldValue}>{timeAgo(approval.createdAt)}</Text>
        </View>
        {approval.reason && (
          <View style={styles.block}>
            <Text style={styles.fieldLabel}>Reason</Text>
            <Text style={styles.bodyText}>{approval.reason}</Text>
          </View>
        )}

        <Text style={styles.fieldLabel}>Input</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator style={styles.codeBox}>
          <Text style={styles.codeText}>
            {JSON.stringify(approval.input, null, 2)}
          </Text>
        </ScrollView>

        <Text style={styles.fieldLabel}>Note (optional)</Text>
        <TextInput
          style={styles.noteInput}
          value={note}
          onChangeText={setNote}
          placeholder="Add a note to this decision…"
          multiline
          numberOfLines={3}
        />

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.rejectBtn, acting && styles.btnDisabled]}
            onPress={() => void handleReject()}
            disabled={acting}
          >
            <Text style={styles.rejectBtnText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.approveBtn, acting && styles.btnDisabled]}
            onPress={() => void handleApprove()}
            disabled={acting}
          >
            <Text style={styles.approveBtnText}>Approve</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  content: { padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  block: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#6c6c70', marginBottom: 4 },
  fieldValue: { fontSize: 15, color: '#1c1c1e', fontWeight: '500' },
  bodyText: { fontSize: 14, color: '#3c3c43' },
  codeBox: {
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  codeText: { fontFamily: 'monospace', fontSize: 12, color: '#d4d4d8' },
  noteInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#1c1c1e',
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c6c6c8',
  },
  actions: { flexDirection: 'row', gap: 12 },
  approveBtn: {
    flex: 1,
    backgroundColor: '#30d158',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  approveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  rejectBtn: {
    flex: 1,
    backgroundColor: '#ff3b30',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  rejectBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.6 },
  errorText: { color: '#ff3b30', fontSize: 14 },
});
