import React from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDaemon } from '../context/DaemonContext';
import { renderHistorySearchPlain } from '../historyRender';

const SEMANTIC_UNAVAILABLE_TEXT =
  'Semantic history search requires an embedding-backed history provider.';
const EMPTY_RESULTS_TEXT = 'No matching conversations.';
const EMPTY_QUERY_HINT = 'Type a query and tap Search to query history.';

export function HistoryScreen() {
  const {
    state,
    setHistoryQuery,
    searchHistory,
  } = useDaemon();
  const {
    online,
    historyQuery,
    historyResult,
    historyLoading,
    historyError,
  } = state;

  const trimmed = historyQuery.trim();
  const hasQuery = trimmed.length > 0;

  const onSubmit = () => {
    if (!hasQuery) return;
    void searchHistory(trimmed);
  };

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

  const headerBadge = renderHeaderBadge(historyResult);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={historyLoading}
          onRefresh={onSubmit}
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
        <Text style={styles.title}>History</Text>
        {headerBadge !== null && (
          <View
            style={[
              styles.badge,
              headerBadge.active ? styles.badgeActive : styles.badgeQuiet,
            ]}
          >
            <Text
              style={
                headerBadge.active
                  ? styles.badgeTextActive
                  : styles.badgeTextQuiet
              }
            >
              {headerBadge.label}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.queryRow}>
        <TextInput
          style={styles.queryInput}
          placeholder="Search history…"
          autoCapitalize="none"
          autoCorrect={false}
          value={historyQuery}
          onChangeText={setHistoryQuery}
          onSubmitEditing={onSubmit}
          returnKeyType="search"
        />
        <TouchableOpacity
          style={[
            styles.searchButton,
            (!hasQuery || !online || historyLoading) &&
              styles.searchButtonDisabled,
          ]}
          onPress={onSubmit}
          disabled={!hasQuery || !online || historyLoading}
        >
          <Text style={styles.searchButtonText}>Search</Text>
        </TouchableOpacity>
      </View>

      {historyError !== null && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{historyError}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={onSubmit}
            disabled={!hasQuery || historyLoading || !online}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {historyError === null &&
        historyResult === null &&
        historyLoading && (
          <View style={styles.center}>
            <ActivityIndicator size="small" />
          </View>
        )}

      {historyError === null && !hasQuery && historyResult === null && (
        <Text style={styles.usageHint}>{EMPTY_QUERY_HINT}</Text>
      )}

      {historyError === null && historyResult !== null && (
        <HistoryBody result={historyResult} />
      )}
    </ScrollView>
  );
}

function HistoryBody({
  result,
}: {
  result: NonNullable<ReturnType<typeof useDaemon>['state']['historyResult']>;
}) {
  if (result.ok === false) {
    return (
      <View style={styles.semanticBox}>
        <Text style={styles.semanticText}>{SEMANTIC_UNAVAILABLE_TEXT}</Text>
      </View>
    );
  }
  if (result.conversations.length === 0) {
    return (
      <View style={styles.bodyCard}>
        <Text style={styles.body}>{EMPTY_RESULTS_TEXT}</Text>
      </View>
    );
  }
  return (
    <View style={styles.bodyCard}>
      <Text style={styles.body}>
        {renderHistorySearchPlain(result.conversations)}
      </Text>
    </View>
  );
}

function renderHeaderBadge(
  result: ReturnType<typeof useDaemon>['state']['historyResult'],
): { label: string; active: boolean } | null {
  if (result === null) return null;
  if (result.ok === false) {
    return { label: 'semantic unavailable', active: false };
  }
  const count = result.conversations.length;
  if (count === 0) return { label: 'no matches', active: false };
  return {
    label: `${count} ${count === 1 ? 'conversation' : 'conversations'}`,
    active: true,
  };
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
  badgeActive: { backgroundColor: 'rgba(0, 122, 255, 0.15)' },
  badgeQuiet: { backgroundColor: 'rgba(142, 142, 147, 0.15)' },
  badgeTextActive: { color: '#0a5fc2', fontSize: 11, fontWeight: '600' },
  badgeTextQuiet: { color: '#6c6c70', fontSize: 11, fontWeight: '600' },
  queryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  queryInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1c1c1e',
  },
  searchButton: {
    backgroundColor: '#007aff',
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  searchButtonDisabled: { backgroundColor: '#a8a8ad' },
  searchButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
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
  usageHint: { color: '#8e8e93', fontSize: 13 },
  semanticBox: {
    backgroundColor: 'rgba(255, 149, 0, 0.12)',
    borderRadius: 10,
    padding: 12,
  },
  semanticText: { color: '#c25e00', fontSize: 13 },
  errorBox: {
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    borderRadius: 10,
    padding: 12,
    gap: 8,
    marginBottom: 12,
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
