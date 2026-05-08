import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDaemon } from '../context/DaemonContext';
import type { AutonomyMode, InteractiveSession } from '../types';

const AUTONOMY_MODES: AutonomyMode[] = ['passive', 'supervised', 'autonomous'];

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m === 1) return '1m ago';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h === 1) return '1h ago';
  return `${h}h ago`;
}

function cycleMode(mode: AutonomyMode): AutonomyMode {
  const idx = AUTONOMY_MODES.indexOf(mode);
  return AUTONOMY_MODES[(idx + 1) % AUTONOMY_MODES.length];
}

export function ChatListScreen({
  onSessionPress,
}: {
  onSessionPress: (sessionId: string) => void;
}) {
  const { state, client } = useDaemon();
  const [sessions, setSessions] = useState<InteractiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSessionMode, setNewSessionMode] =
    useState<AutonomyMode>('supervised');

  const projectId = state.activeProjectId ?? undefined;

  const fetchSessions = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const res = await client.getSessions(projectId);
      setSessions(res.sessions.filter((s) => s.source === 'daemon'));
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load sessions.');
    } finally {
      setLoading(false);
    }
  }, [client, projectId]);

  useEffect(() => {
    if (state.online) void fetchSessions();
  }, [state.online, fetchSessions]);

  async function handleNewSession() {
    if (!client || creating) return;
    setCreating(true);
    try {
      const res = await client.createSession(newSessionMode, projectId);
      await fetchSessions();
      onSessionPress(res.session_id);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to create session.');
    } finally {
      setCreating(false);
    }
  }

  async function cycleSessionMode(session: InteractiveSession) {
    if (!client) return;
    const next = cycleMode(session.autonomyMode);
    try {
      await client.setSessionAutonomyMode(session.id, next);
      await fetchSessions();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to change mode.');
    }
  }

  if (!state.online) {
    return (
      <View style={styles.center}>
        <Text style={styles.offlineIcon}>💬</Text>
        <Text style={styles.offlineText}>Daemon offline</Text>
        <Text style={styles.offlineSubtext}>Connect to a daemon to start a chat session.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void fetchSessions()} />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No active sessions</Text>
              <Text style={styles.emptySubtext}>Tap "New Session" to start chatting.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => onSessionPress(item.id)}>
            <View style={styles.rowLeft}>
              <Text style={styles.sessionId} numberOfLines={1}>{item.id}</Text>
              <Text style={styles.sessionMeta}>
                {item.busy ? '● Active · ' : ''}{timeAgo(item.lastActive)}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.modeBadge}
              onPress={() => void cycleSessionMode(item)}
            >
              <Text style={styles.modeBadgeText}>{item.autonomyMode}</Text>
            </TouchableOpacity>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={sessions.length === 0 ? styles.flatListEmpty : undefined}
      />
      <View style={styles.footer}>
        <View style={styles.modeRow}>
          <Text style={styles.modeLabel}>New session mode:</Text>
          <View style={styles.modePicker}>
            {AUTONOMY_MODES.map((m) => (
              <TouchableOpacity
                key={m}
                style={[
                  styles.modeChip,
                  newSessionMode === m && styles.modeChipActive,
                ]}
                onPress={() => setNewSessionMode(m)}
              >
                <Text
                  style={[
                    styles.modeChipText,
                    newSessionMode === m && styles.modeChipTextActive,
                  ]}
                >
                  {m}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <TouchableOpacity
          style={[styles.newBtn, creating && styles.btnDisabled]}
          onPress={() => void handleNewSession()}
          disabled={creating}
        >
          {creating
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.newBtnText}>New Session</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  offlineIcon: { fontSize: 48, marginBottom: 12 },
  offlineText: { fontSize: 17, fontWeight: '600', color: '#1c1c1e', marginBottom: 6 },
  offlineSubtext: { fontSize: 14, color: '#6c6c70', textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 14,
  },
  rowLeft: { flex: 1 },
  sessionId: { fontSize: 15, fontWeight: '600', color: '#1c1c1e', marginBottom: 2, fontFamily: 'monospace' },
  sessionMeta: { fontSize: 13, color: '#6c6c70' },
  modeBadge: {
    backgroundColor: '#e5e5ea',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 8,
  },
  modeBadgeText: { fontSize: 11, fontWeight: '600', color: '#1c1c1e' },
  chevron: { fontSize: 20, color: '#c7c7cc', marginLeft: 8 },
  flatListEmpty: { flex: 1 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 17, fontWeight: '600', color: '#1c1c1e', marginBottom: 6 },
  emptySubtext: { fontSize: 14, color: '#6c6c70', textAlign: 'center' },
  footer: { padding: 16, paddingBottom: 24 },
  modeRow: { marginBottom: 12 },
  modeLabel: { fontSize: 13, color: '#6c6c70', marginBottom: 6 },
  modePicker: { flexDirection: 'row', gap: 6 },
  modeChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#e5e5ea',
    alignItems: 'center',
  },
  modeChipActive: { backgroundColor: '#007aff' },
  modeChipText: { fontSize: 13, color: '#1c1c1e', fontWeight: '600' },
  modeChipTextActive: { color: '#fff' },
  newBtn: {
    backgroundColor: '#007aff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  newBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.6 },
});
