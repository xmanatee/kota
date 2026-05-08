import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ProjectSelector } from '../components/ProjectSelector';
import { useDaemon } from '../context/DaemonContext';
import type { ActiveRun } from '../types';

function formatUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDuration(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s}s`;
}

function ActiveRunCard({
  run,
  onPress,
}: {
  run: ActiveRun;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.cardRow}>
        <Text style={styles.cardTitle}>{run.workflow}</Text>
        <Text style={styles.duration}>◷ {formatDuration(run.startedAt)}</Text>
      </View>
      <Text style={styles.cardSub}>Run ID: {run.runId.slice(-8)}</Text>
    </TouchableOpacity>
  );
}

export function StatusScreen({
  onRunPress,
  onSettingsPress,
}: {
  onRunPress: (runId: string) => void;
  onSettingsPress: () => void;
}) {
  const { state, client, refresh } = useDaemon();
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    refresh();
    await new Promise((r) => setTimeout(r, 800));
    setRefreshing(false);
  }

  async function handleTogglePause() {
    if (!client) return;
    setToggling(true);
    try {
      if (state.status?.workflow.paused) {
        await client.resumeDispatch();
      } else {
        await client.pauseDispatch();
      }
      refresh();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setToggling(false);
    }
  }

  if (!state.settingsLoaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!state.daemonUrl || !state.token) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No daemon configured.</Text>
        <TouchableOpacity style={styles.button} onPress={onSettingsPress}>
          <Text style={styles.buttonText}>Open Settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { status, online, sseConnected } = state;
  const activeRuns = status?.workflow.activeRuns ?? [];
  const paused = status?.workflow.paused ?? false;
  const queueLength = status?.workflow.queueLength ?? 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
    >
      {!online && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>Daemon offline — retrying every 15s</Text>
        </View>
      )}
      {online && !sseConnected && (
        <View style={styles.warnBanner}>
          <Text style={styles.warnText}>Live updates unavailable — polling every 10s</Text>
        </View>
      )}

      <ProjectSelector />

      <View style={styles.section}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: online ? '#30d158' : '#ff3b30' }]} />
          <Text style={styles.statusText}>
            Daemon: {online ? 'Running' : 'Offline'}
          </Text>
        </View>
        {online && status?.startedAt && (
          <Text style={styles.subText}>Uptime: {formatUptime(status.startedAt)}</Text>
        )}
      </View>

      <Text style={styles.sectionHeader}>Active Runs ({activeRuns.length})</Text>
      {activeRuns.length === 0 ? (
        <Text style={styles.emptyText}>No active runs.</Text>
      ) : (
        activeRuns.map((run) => (
          <ActiveRunCard
            key={run.runId}
            run={run}
            onPress={() => onRunPress(run.runId)}
          />
        ))
      )}

      <Text style={styles.sectionHeader}>Queue</Text>
      <View style={styles.card}>
        <Text style={styles.cardSub}>{queueLength} pending</Text>
      </View>

      {online && (
        <TouchableOpacity
          style={[styles.button, toggling && styles.buttonDisabled]}
          onPress={() => void handleTogglePause()}
          disabled={toggling}
        >
          <Text style={styles.buttonText}>
            {paused ? '▶  Resume Dispatch' : '⏸  Pause Dispatch'}
          </Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  content: { padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  offlineBanner: {
    backgroundColor: '#ff3b30',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  offlineText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  warnBanner: {
    backgroundColor: '#ff9500',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  warnText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  section: { marginBottom: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 17, fontWeight: '600', color: '#1c1c1e' },
  subText: { fontSize: 14, color: '#8e8e93', marginTop: 4 },
  sectionHeader: { fontSize: 13, fontWeight: '600', color: '#6c6c70', marginBottom: 8, marginTop: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#1c1c1e' },
  duration: { fontSize: 13, color: '#8e8e93' },
  cardSub: { fontSize: 13, color: '#8e8e93', marginTop: 4 },
  emptyText: { color: '#8e8e93', fontSize: 14, marginBottom: 12 },
  button: {
    backgroundColor: '#007aff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
