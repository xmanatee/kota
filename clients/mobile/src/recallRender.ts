import type { RecallHit, RecallSource } from './types';

const SCORE_PRECISION = 3;

/**
 * Per-source tint mapping shared by every mobile-side surface that
 * paints a `{ source }` badge: the recall surface (`RecallScreen`) and
 * the cited-answer surface (`AnswerScreen`). Mirrors the same
 * `knowledge`→blue, `memory`→purple, `history`→green, `tasks`→orange,
 * `answer`→pink vocabulary the macOS `RecallSourceBadge` and the web
 * recall/answer panels speak. Centralizing the table avoids two
 * parallel five-source color maps drifting on the mobile side.
 */
export const RECALL_SOURCE_TINT: Record<
  RecallSource,
  { bg: string; fg: string }
> = {
  knowledge: { bg: 'rgba(0, 122, 255, 0.15)', fg: '#0a5fc2' },
  memory: { bg: 'rgba(175, 82, 222, 0.15)', fg: '#7d3fb0' },
  history: { bg: 'rgba(52, 199, 89, 0.18)', fg: '#1f7a3a' },
  tasks: { bg: 'rgba(255, 149, 0, 0.18)', fg: '#a85a00' },
  answer: { bg: 'rgba(255, 45, 85, 0.15)', fg: '#a8002b' },
};

export function formatRecallScore(score: number): string {
  return score.toFixed(SCORE_PRECISION);
}

/**
 * Per-source title/preview derivation pinned by
 * `clients/conformance/recall-render-fixture.json` and its mobile copy.
 * `RecallScreen`, answer citations, and the plain-text helper all read
 * through this function so drift fails in one contract test.
 */
export function describeRecallHit(hit: RecallHit): string {
  const metadata = formatRecallMetadata(hit);
  switch (hit.source) {
    case 'knowledge':
      return appendMetadata(hit.title, metadata);
    case 'memory':
      return appendMetadata(hit.preview, metadata);
    case 'history':
      return hit.title;
    case 'tasks':
      return `[${hit.state}/${hit.priority}] ${hit.title}`;
    case 'answer':
      return `[${
        hit.result.ok ? `ok(${hit.citationCount})` : hit.result.reason
      }] ${hit.query}`;
  }
}

function formatRecallMetadata(hit: RecallHit): string {
  if (hit.source !== 'knowledge' && hit.source !== 'memory') return '';
  const pieces: string[] = [];
  if (hit.provenance) {
    pieces.push(
      `${formatProvenanceLocator(hit.provenance)} observed ${hit.provenance.observedAt.slice(0, 10)}`,
    );
  }
  if (hit.freshness) {
    const replacement = hit.freshness.replacementId
      ? ` -> ${hit.freshness.replacementId}`
      : '';
    const changed = hit.freshness.changedAt
      ? ` ${hit.freshness.changedAt.slice(0, 10)}`
      : '';
    pieces.push(`${hit.freshness.status}${replacement}${changed}`);
  }
  return pieces.join('; ');
}

function formatProvenanceLocator(
  provenance: NonNullable<
    Extract<RecallHit, { source: 'knowledge' }>['provenance']
  >,
): string {
  switch (provenance.sourceKind) {
    case 'run':
    case 'session':
      return `${provenance.sourceKind}:${provenance.sourceId ?? 'unknown'}`;
    case 'file':
      return `file:${provenance.sourcePath ?? 'unknown'}`;
    case 'url':
      return `url:${provenance.sourceUrl ?? 'unknown'}`;
    case 'tool':
      return `tool:${provenance.sourceTool ?? provenance.sourceId ?? 'unknown'}`;
    case 'manual':
      return 'manual';
  }
}

function appendMetadata(label: string, metadata: string): string {
  return metadata ? `${label} | ${metadata}` : label;
}

/**
 * Plain-text line shape pinned by the shared recall render fixture:
 * padded source, score, id, and the per-source description. An empty
 * result returns the empty string.
 */
export function renderRecallHitsPlain(hits: RecallHit[]): string {
  if (hits.length === 0) return '';
  const sourceWidth = Math.max(...hits.map((h) => h.source.length), 6);
  const idWidth = Math.max(...hits.map((h) => h.id.length), 2);
  const scoreWidth = SCORE_PRECISION + 2; // "0.xxx"
  return hits
    .map((hit) => {
      const source = hit.source.padEnd(sourceWidth);
      const score = formatRecallScore(hit.score).padStart(scoreWidth);
      const id = hit.id.padEnd(idWidth);
      return `${source}  ${score}  ${id}  ${describeRecallHit(hit)}`;
    })
    .join('\n');
}
