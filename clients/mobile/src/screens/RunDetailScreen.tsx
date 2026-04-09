import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useDaemon } from '../context/DaemonContext';
import type { RunDetail, RunStep } from '../types';

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StepRow({ step }: { step: RunStep }) {
  const icon = step.status === 'success' ? '✓' : step.status === 'failed' ? '✗' : '○';
  const color = step.status === 'success' ? '#30d158' : step.status === 'failed' ? '#ff3b30' : '#8e8e93';
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepHeader}>
        <Text style={[styles.stepIcon, { color }]}>{icon}</Text>
        <Text style={styles.stepId}>{step.id}</Text>
        <Text style={styles.stepDur}>{formatDuration(step.durationMs)}</Text>
      </View>
      {step.toolCalls && step.toolCalls.length > 0 && (
        <Text style={styles.stepTools}>
          {step.toolCalls.map((t) => `${t.count}× ${t.tool}`).join('  ')}
        </Text>
      )}
      {step.reused && <Text style={styles.stepReused}>reused from previous run</Text>}
    </View>
  );
}

export function RunDetailScreen({ runId }: { runId: string }) {
  const { client } = useDaemon();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) {
      setLoading(false);
      setError('No daemon connection.');
      return;
    }
    setLoading(true);
    client
      .getRunDetail(runId)
      .then((r) => {
        setRun(r);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load run.');
      })
      .finally(() => setLoading(false));
  }, [client, runId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error || !run) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? 'Run not found.'}</Text>
      </View>
    );
  }

  const statusColor =
    run.status === 'success'
      ? '#30d158'
      : run.status === 'failed'
        ? '#ff3b30'
        : '#ff9500';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.workflow}>{run.workflow}</Text>
        <Text style={[styles.status, { color: statusColor }]}>— {run.status}</Text>
      </View>
      <Text style={styles.meta}>
        {formatDate(run.startedAt)} · {formatDuration(run.durationMs)}
      </Text>
      {run.totalCostUsd !== undefined && (
        <Text style={styles.meta}>Cost: ${run.totalCostUsd.toFixed(4)}</Text>
      )}
      {run.causedBy && (
        <Text style={styles.meta}>Triggered by: {run.causedBy.workflow}</Text>
      )}

      {run.warnings && run.warnings.length > 0 && (
        <View style={styles.warningBox}>
          {run.warnings.map((w, i) => (
            <Text key={i} style={styles.warningText}>⚠ {w.message}</Text>
          ))}
        </View>
      )}

      <Text style={styles.sectionHeader}>Steps</Text>
      {run.steps.map((step) => (
        <StepRow key={step.id} step={step} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  content: { padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 },
  workflow: { fontSize: 20, fontWeight: '700', color: '#1c1c1e' },
  status: { fontSize: 17, fontWeight: '600', marginLeft: 6 },
  meta: { fontSize: 14, color: '#8e8e93', marginBottom: 2 },
  warningBox: {
    backgroundColor: '#fff3e0',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  warningText: { color: '#ff9500', fontSize: 13 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6c6c70',
    marginTop: 20,
    marginBottom: 8,
  },
  stepRow: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepIcon: { fontSize: 14, fontWeight: '700', width: 14 },
  stepId: { flex: 1, fontSize: 14, fontWeight: '500', color: '#1c1c1e' },
  stepDur: { fontSize: 13, color: '#8e8e93' },
  stepTools: { fontSize: 12, color: '#8e8e93', marginTop: 4, marginLeft: 20 },
  stepReused: { fontSize: 12, color: '#007aff', marginTop: 2, marginLeft: 20 },
  errorText: { color: '#ff3b30', fontSize: 14 },
});
