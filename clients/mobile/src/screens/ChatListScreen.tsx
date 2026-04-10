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
import type { InteractiveSession } from '../types';

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

export function ChatListScreen({
  onSessionPress,
}: {
  onSessionPress: (sessionId: string) => void;
}) {
  const { state, client } = useDaemon();
  const [sessions, setSessions] = useState<InteractiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const fetchSessions = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const res = await client.getSessions();
      setSessions(res.sessions.filter((s) => s.source === 'daemon'));
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load sessions.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (state.online) void fetchSessions();
  }, [state.online, fetchSessions]);

  async function handleNewSession() {
    if (!client || creating) return;
    setCreating(true);
    try {
      const res = await client.createSession();
      await fetchSessions();
      onSessionPress(res.session_id);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to create session.');
    } finally {
      setCreating(false);
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
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={sessions.length === 0 ? styles.flatListEmpty : undefined}
      />
      <View style={styles.footer}>
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
  chevron: { fontSize: 20, color: '#c7c7cc', marginLeft: 8 },
  flatListEmpty: { flex: 1 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 17, fontWeight: '600', color: '#1c1c1e', marginBottom: 6 },
  emptySubtext: { fontSize: 14, color: '#6c6c70', textAlign: 'center' },
  footer: { padding: 16, paddingBottom: 24 },
  newBtn: {
    backgroundColor: '#007aff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  newBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.6 },
});
