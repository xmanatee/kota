import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { describeRecallHit, RECALL_SOURCE_TINT } from './recallRender';
import type { AnswerCitation, AnswerResult, RecallHit } from './types';

export const ANSWER_FAILURE_MESSAGE: Record<
  Extract<AnswerResult, { ok: false }>['reason'],
  string
> = {
  no_hits: 'No matching sources for this question.',
  semantic_unavailable:
    'Answer unavailable — no recall contributors registered.',
  synthesis_failed: 'Could not compose a cited answer for this question.',
};

/**
 * Exhaustive renderer for the discriminated `AnswerResult` union shared
 * by the live `AnswerScreen` (which renders `AnswerProvider.answer`
 * results) and the `AnswerHistoryScreen` show view (which renders the
 * persisted `AnswerHistoryRecord.result`). Keeps the four arms (`ok:
 * true` plus `no_hits` / `semantic_unavailable` / `synthesis_failed`)
 * one-to-one across both surfaces — no second citation parser, no
 * second prose layout. Renders `[source:id]` markers verbatim inside
 * the answer body; the citation list is rendered alongside the body,
 * not inlined into it.
 */
export function AnswerBody({ result }: { result: AnswerResult }) {
  if (result.ok === false) {
    return (
      <View style={styles.noticeBox}>
        <Text style={styles.noticeText}>
          {ANSWER_FAILURE_MESSAGE[result.reason]}
        </Text>
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

/**
 * Header badge shape for the `AnswerScreen` and `AnswerHistoryScreen`
 * show view. Returns `null` for "no result yet"; otherwise discriminates
 * between the four `AnswerResult` arms with the same vocabulary on both
 * surfaces.
 */
export function renderAnswerHeaderBadge(
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
  noticeBox: {
    backgroundColor: 'rgba(255, 149, 0, 0.12)',
    borderRadius: 10,
    padding: 12,
  },
  noticeText: { color: '#c25e00', fontSize: 13 },
});
