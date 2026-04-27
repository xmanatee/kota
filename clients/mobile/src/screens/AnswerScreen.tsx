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
import { describeRecallHit, RECALL_SOURCE_TINT } from '../recallRender';
import type {
  AnswerCitation,
  AnswerResult,
  RecallHit,
} from '../types';

const FAILURE_MESSAGE: Record<
  Extract<AnswerResult, { ok: false }>['reason'],
  string
> = {
  no_hits: 'No matching sources for this question.',
  semantic_unavailable:
    'Answer unavailable — no recall contributors registered.',
  synthesis_failed: 'Could not compose a cited answer for this question.',
};

const EMPTY_QUERY_HINT =
  'Type a question and tap Ask to compose a cited answer across knowledge, memory, history, and tasks.';

export function AnswerScreen() {
  const { state, setAnswerQuery, answer } = useDaemon();
  const { online, answerQuery, answerResult, answerLoading, answerError } =
    state;

  const trimmed = answerQuery.trim();
  const hasQuery = trimmed.length > 0;

  const onSubmit = () => {
    if (!hasQuery) return;
    void answer(trimmed);
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

  const headerBadge = renderHeaderBadge(answerResult);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={answerLoading} onRefresh={onSubmit} />
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
        <Text style={styles.title}>Answer</Text>
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
          placeholder="Ask the second brain…"
          autoCapitalize="none"
          autoCorrect={false}
          value={answerQuery}
          onChangeText={setAnswerQuery}
          onSubmitEditing={onSubmit}
          returnKeyType="search"
        />
        <TouchableOpacity
          style={[
            styles.askButton,
            (!hasQuery || !online || answerLoading) &&
              styles.askButtonDisabled,
          ]}
          onPress={onSubmit}
          disabled={!hasQuery || !online || answerLoading}
        >
          <Text style={styles.askButtonText}>Ask</Text>
        </TouchableOpacity>
      </View>

      {answerError !== null && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{answerError}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={onSubmit}
            disabled={!hasQuery || answerLoading || !online}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {answerError === null && answerResult === null && answerLoading && (
        <View style={styles.center}>
          <ActivityIndicator size="small" />
        </View>
      )}

      {answerError === null && !hasQuery && answerResult === null && (
        <Text style={styles.usageHint}>{EMPTY_QUERY_HINT}</Text>
      )}

      {answerError === null && answerResult !== null && (
        <AnswerBody result={answerResult} />
      )}
    </ScrollView>
  );
}

function AnswerBody({ result }: { result: AnswerResult }) {
  if (result.ok === false) {
    return (
      <View style={styles.noticeBox}>
        <Text style={styles.noticeText}>{FAILURE_MESSAGE[result.reason]}</Text>
      </View>
    );
  }
  return (
    <View style={styles.successWrap}>
      <View style={styles.bodyCard}>
        <Text style={styles.body}>{result.answer}</Text>
      </View>
      {result.citations.length > 0 && (
        <View style={styles.citationsList}>
          {result.citations.map((citation, index) => (
            <CitationRow
              key={`${citation.source}:${citation.id}:${index}`}
              citation={citation}
              hits={result.hits}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function CitationRow({
  citation,
  hits,
}: {
  citation: AnswerCitation;
  hits: RecallHit[];
}) {
  const tint = RECALL_SOURCE_TINT[citation.source];
  const hit = findHit(hits, citation);
  return (
    <View style={styles.citationRow}>
      <View style={[styles.sourceBadge, { backgroundColor: tint.bg }]}>
        <Text style={[styles.sourceBadgeText, { color: tint.fg }]}>
          {citation.source}
        </Text>
      </View>
      {hit !== null ? (
        <>
          <Text style={styles.score}>{hit.score.toFixed(3)}</Text>
          <Text style={styles.citationDescribe} numberOfLines={2}>
            {describeRecallHit(hit)}
          </Text>
        </>
      ) : (
        <Text style={styles.citationDescribe} numberOfLines={2}>
          {citation.id}
        </Text>
      )}
    </View>
  );
}

function findHit(hits: RecallHit[], citation: AnswerCitation): RecallHit | null {
  for (const hit of hits) {
    if (hit.source === citation.source && hit.id === citation.id) {
      return hit;
    }
  }
  return null;
}

function renderHeaderBadge(
  result: AnswerResult | null,
): { label: string; active: boolean } | null {
  if (result === null) return null;
  if (result.ok === false) {
    switch (result.reason) {
      case 'no_hits':
        return { label: 'no hits', active: false };
      case 'semantic_unavailable':
        return { label: 'recall unavailable', active: false };
      case 'synthesis_failed':
        return { label: 'synthesis failed', active: false };
    }
  }
  const count = result.citations.length;
  if (count === 0) return { label: 'answered', active: true };
  return {
    label: `${count} ${count === 1 ? 'cite' : 'cites'}`,
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
  askButton: {
    backgroundColor: '#007aff',
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  askButtonDisabled: { backgroundColor: '#a8a8ad' },
  askButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  successWrap: { gap: 12 },
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
    fontSize: 14,
    color: '#1c1c1e',
    lineHeight: 20,
  },
  citationsList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  citationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60, 60, 67, 0.1)',
  },
  sourceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    minWidth: 64,
    alignItems: 'center',
  },
  sourceBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  score: {
    fontFamily: 'Courier',
    fontSize: 11,
    color: '#6c6c70',
    minWidth: 40,
  },
  citationDescribe: {
    flex: 1,
    fontSize: 13,
    color: '#1c1c1e',
    lineHeight: 18,
  },
  emptyText: { color: '#8e8e93', fontSize: 14 },
  usageHint: { color: '#8e8e93', fontSize: 13 },
  noticeBox: {
    backgroundColor: 'rgba(255, 149, 0, 0.12)',
    borderRadius: 10,
    padding: 12,
  },
  noticeText: { color: '#c25e00', fontSize: 13 },
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
