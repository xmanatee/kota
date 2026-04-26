import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDaemon } from '../context/DaemonContext';

export function DigestScreen() {
  const { state, refreshDigest } = useDaemon();
  const { online, digest, digestLoading, digestError } = state;

  useEffect(() => {
    if (online && digest === null && !digestLoading && digestError === null) {
      void refreshDigest();
    }
  }, [online, digest, digestLoading, digestError, refreshDigest]);

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
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={digestLoading}
          onRefresh={() => void refreshDigest()}
        />
      }
    >
      {!online && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            Daemon offline — retrying every 15s
          </Text>
        </View>
      )}

      <View style={styles.headerRow}>
        <Text style={styles.title}>Daily Digest</Text>
        {digest !== null && (
          <View
            style={[
              styles.badge,
              digest.data.quiet ? styles.badgeQuiet : styles.badgeActive,
            ]}
          >
            <Text
              style={
                digest.data.quiet ? styles.badgeTextQuiet : styles.badgeTextActive
              }
            >
              {digest.data.quiet ? 'quiet window' : 'active'}
            </Text>
          </View>
        )}
      </View>

      {digestError !== null && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{digestError}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => void refreshDigest()}
            disabled={digestLoading || !online}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {digestError === null && digest === null && digestLoading && (
        <View style={styles.center}>
          <ActivityIndicator size="small" />
        </View>
      )}

      {digestError === null && digest !== null && (
        <View style={styles.bodyCard}>
          <Text style={styles.body}>{digest.text}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  content: { padding: 16 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  offlineBanner: {
    backgroundColor: '#ff3b30',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  offlineText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  title: { fontSize: 17, fontWeight: '600', color: '#1c1c1e' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeActive: { backgroundColor: 'rgba(48, 209, 88, 0.15)' },
  badgeQuiet: { backgroundColor: 'rgba(142, 142, 147, 0.15)' },
  badgeTextActive: { color: '#1f8a3a', fontSize: 11, fontWeight: '600' },
  badgeTextQuiet: { color: '#6c6c70', fontSize: 11, fontWeight: '600' },
  bodyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  body: {
    fontFamily: 'Courier',
    fontSize: 12,
    color: '#1c1c1e',
    lineHeight: 18,
  },
  emptyText: { color: '#8e8e93', fontSize: 14 },
  errorBox: {
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  errorText: { color: '#ff3b30', fontSize: 13 },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#007aff',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
