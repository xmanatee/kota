import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AnswerBody,
  ANSWER_FAILURE_MESSAGE,
  renderAnswerHeaderBadge,
} from '../answerRender';
import { useDaemon } from '../context/DaemonContext';
import type { AnswerHistoryEntry, AnswerHistoryRecord } from '../types';

const QUERY_TRUNCATE = 60;
const EMPTY_LOG_TEXT = 'No answers in history yet.';
const NOT_FOUND_TEXT = 'No answer record with that id.';

type Mode = { mode: 'log' } | { mode: 'show'; id: string };

export function AnswerHistoryScreen() {
  const {
    state,
    loadAnswerLog,
    loadMoreAnswerLog,
    openAnswerShow,
    closeAnswerShow,
  } = useDaemon();
  const [view, setView] = useState<Mode>({ mode: 'log' });

  useEffect(() => {
    if (!state.online) return;
    if (
      state.answerLogEntries.length === 0 &&
      !state.answerLogLoading &&
      state.answerLogError === null
    ) {
      void loadAnswerLog();
    }
  }, [
    state.online,
    state.answerLogEntries.length,
    state.answerLogLoading,
    state.answerLogError,
    loadAnswerLog,
  ]);

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

  if (view.mode === 'show') {
    return (
      <ShowView
        onBack={() => {
          closeAnswerShow();
          setView({ mode: 'log' });
        }}
      />
    );
  }

  return (
    <LogView
      onSelect={(id) => {
        setView({ mode: 'show', id });
        void openAnswerShow(id);
      }}
      onRefresh={() => loadAnswerLog()}
      onLoadOlder={() => loadMoreAnswerLog()}
    />
  );
}

function LogView({
  onSelect,
  onRefresh,
  onLoadOlder,
}: {
  onSelect: (id: string) => void;
  onRefresh: () => Promise<void>;
  onLoadOlder: () => Promise<void>;
}) {
  const { state } = useDaemon();
  const {
    online,
    answerLogEntries,
    answerLogLoading,
    answerLogError,
    answerLogHasMore,
  } = state;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={answerLogLoading}
          onRefresh={() => void onRefresh()}
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
        <Text style={styles.title}>Answer history</Text>
      </View>

      {answerLogError !== null && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{answerLogError}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => void onRefresh()}
            disabled={!online || answerLogLoading}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {answerLogError === null &&
        answerLogEntries.length === 0 &&
        answerLogLoading && (
          <View style={styles.center}>
            <ActivityIndicator size="small" />
          </View>
        )}

      {answerLogError === null &&
        !answerLogLoading &&
        answerLogEntries.length === 0 && (
          <Text style={styles.emptyText}>{EMPTY_LOG_TEXT}</Text>
        )}

      {answerLogEntries.length > 0 && (
        <View style={styles.entriesList}>
          {answerLogEntries.map((entry) => (
            <LogRow key={entry.id} entry={entry} onSelect={onSelect} />
          ))}
        </View>
      )}

      {answerLogEntries.length > 0 && answerLogHasMore && (
        <TouchableOpacity
          style={[
            styles.loadOlderButton,
            (answerLogLoading || !online) && styles.loadOlderButtonDisabled,
          ]}
          onPress={() => void onLoadOlder()}
          disabled={answerLogLoading || !online}
        >
          <Text style={styles.loadOlderButtonText}>Load older</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function LogRow({
  entry,
  onSelect,
}: {
  entry: AnswerHistoryEntry;
  onSelect: (id: string) => void;
}) {
  return (
    <TouchableOpacity
      style={styles.entryRow}
      onPress={() => onSelect(entry.id)}
    >
      <Text style={styles.entryTimestamp} numberOfLines={1}>
        {entry.createdAt}
      </Text>
      <ResultBadge entry={entry} />
      <Text style={styles.entryQuery} numberOfLines={2}>
        {truncateQuery(entry.query)}
      </Text>
    </TouchableOpacity>
  );
}

function ResultBadge({ entry }: { entry: AnswerHistoryEntry }) {
  if (entry.result.ok) {
    return (
      <View style={[styles.entryBadge, styles.entryBadgeActive]}>
        <Text style={styles.entryBadgeTextActive}>
          {`${entry.result.citationCount} ${
            entry.result.citationCount === 1 ? 'cite' : 'cites'
          }`}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.entryBadge, styles.entryBadgeQuiet]}>
      <Text style={styles.entryBadgeTextQuiet}>{entry.result.reason}</Text>
    </View>
  );
}

function ShowView({ onBack }: { onBack: () => void }) {
  const { state } = useDaemon();
  const {
    answerShowRecord,
    answerShowMissing,
    answerShowLoading,
    answerShowError,
  } = state;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        {answerShowRecord !== null &&
          (() => {
            const badge = renderAnswerHeaderBadge(answerShowRecord.result);
            if (badge === null) return null;
            return (
              <View
                style={[
                  styles.badge,
                  badge.active ? styles.badgeActive : styles.badgeQuiet,
                ]}
              >
                <Text
                  style={
                    badge.active
                      ? styles.badgeTextActive
                      : styles.badgeTextQuiet
                  }
                >
                  {badge.label}
                </Text>
              </View>
            );
          })()}
      </View>

      {answerShowError !== null && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{answerShowError}</Text>
        </View>
      )}

      {answerShowError === null && answerShowLoading && (
        <View style={styles.center}>
          <ActivityIndicator size="small" />
        </View>
      )}

      {answerShowError === null && !answerShowLoading && answerShowMissing && (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>{NOT_FOUND_TEXT}</Text>
        </View>
      )}

      {answerShowRecord !== null && (
        <ShowBody record={answerShowRecord} />
      )}
    </ScrollView>
  );
}

function ShowBody({ record }: { record: AnswerHistoryRecord }) {
  return (
    <View style={styles.showBody}>
      <View style={styles.recordHeader}>
        <Text style={styles.recordId}>{record.id}</Text>
        <Text style={styles.recordTimestamp}>{record.createdAt}</Text>
        <Text style={styles.recordQuery}>{record.query}</Text>
      </View>
      <AnswerBody result={record.result} />
    </View>
  );
}

function truncateQuery(text: string): string {
  if (text.length <= QUERY_TRUNCATE) return text;
  return `${text.slice(0, QUERY_TRUNCATE - 1)}…`;
}

// Re-export for tests that want to assert the failure-message vocabulary
// is shared with the live `AnswerScreen`.
export { ANSWER_FAILURE_MESSAGE };

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
  emptyText: { color: '#8e8e93', fontSize: 14 },
  entriesList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60, 60, 67, 0.1)',
  },
  entryTimestamp: {
    fontFamily: 'Courier',
    fontSize: 10,
    color: '#6c6c70',
    minWidth: 92,
  },
  entryBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    minWidth: 64,
    alignItems: 'center',
  },
  entryBadgeActive: { backgroundColor: 'rgba(52, 199, 89, 0.18)' },
  entryBadgeQuiet: { backgroundColor: 'rgba(255, 149, 0, 0.18)' },
  entryBadgeTextActive: {
    color: '#1f7a3a',
    fontSize: 11,
    fontWeight: '600',
  },
  entryBadgeTextQuiet: {
    color: '#a85a00',
    fontSize: 11,
    fontWeight: '600',
  },
  entryQuery: {
    flex: 1,
    fontSize: 13,
    color: '#1c1c1e',
    lineHeight: 18,
  },
  loadOlderButton: {
    marginTop: 12,
    backgroundColor: '#007aff',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  loadOlderButtonDisabled: { backgroundColor: '#a8a8ad' },
  loadOlderButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  backButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  backButtonText: { color: '#007aff', fontSize: 14, fontWeight: '600' },
  showBody: { gap: 12 },
  recordHeader: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  recordId: {
    fontFamily: 'Courier',
    fontSize: 10,
    color: '#6c6c70',
  },
  recordTimestamp: {
    fontFamily: 'Courier',
    fontSize: 10,
    color: '#6c6c70',
  },
  recordQuery: {
    fontSize: 14,
    color: '#1c1c1e',
    lineHeight: 20,
  },
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
  noticeBox: {
    backgroundColor: 'rgba(255, 149, 0, 0.12)',
    borderRadius: 10,
    padding: 12,
  },
  noticeText: { color: '#c25e00', fontSize: 13 },
});
