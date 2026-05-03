/**
 * Boundary regression for the mobile digest and attention pull seams.
 *
 * The mobile `getDigest` / `getAttention` paths now strict-decode the
 * daemon response through the shared conformance decoders
 * (`src/daemon/conformance/decoders.ts`). A malformed payload — missing
 * required field on digest, drifted `data.items[]` entry on attention —
 * must throw a `ContractDecodeError` at the mobile boundary instead of
 * silently flowing into `DigestScreen` / `AttentionScreen` as a
 * typed-but-invalid object. The macOS Swift seam already enforces this
 * via `Codable`; the per-store search seams enforce it via their own
 * `parse*SearchResponse`. This test pins the parity for digest and
 * attention.
 */

import { ContractDecodeError } from '../daemon/conformance/decoders';
import { getAttention } from '../daemon/attention';
import { getDigest } from '../daemon/digest';
import type { DaemonHttp } from '../daemon/http';

function mockFetch(body: unknown): jest.SpyInstance {
  const response = {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as unknown as Response;
  return jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(response as unknown as Response);
}

const HTTP: DaemonHttp = { baseUrl: 'http://daemon.test', token: 't' };

afterEach(() => {
  jest.restoreAllMocks();
});

describe('mobile getDigest decoder boundary', () => {
  test('rejects a payload missing data.queueDelta with ContractDecodeError', async () => {
    mockFetch({
      data: {
        windowStartedAt: '2026-04-26T08:00:00.000Z',
        windowEndedAt: '2026-04-27T08:00:00.000Z',
        builderCommits: [],
        explorerAdditions: [],
        decomposerSplits: [],
        blockedPromoterMoves: [],
        failedMonitoredRuns: [],
        pendingOwnerQuestions: [],
        agingOperatorCaptures: [],
        // queueDelta intentionally omitted to simulate a daemon drift.
        quiet: false,
      },
      text: 'Daily digest 2026-04-27',
    });
    await expect(getDigest(HTTP)).rejects.toBeInstanceOf(ContractDecodeError);
  });

  test('rejects a payload with a drifted failedMonitoredRuns[].status', async () => {
    mockFetch({
      data: {
        windowStartedAt: '2026-04-26T08:00:00.000Z',
        windowEndedAt: '2026-04-27T08:00:00.000Z',
        builderCommits: [],
        explorerAdditions: [],
        decomposerSplits: [],
        blockedPromoterMoves: [],
        failedMonitoredRuns: [
          {
            runId: 'run-1',
            workflow: 'builder',
            // 'crashed' is not in the typed union; decoder must reject.
            status: 'crashed',
            startedAt: '2026-04-26T08:00:00.000Z',
          },
        ],
        pendingOwnerQuestions: [],
        agingOperatorCaptures: [],
        queueDelta: {
          current: { backlog: 0, ready: 0, doing: 0, blocked: 0 },
          previous: null,
          delta: { backlog: null, ready: null, doing: null, blocked: null },
        },
        quiet: false,
      },
      text: 'Daily digest 2026-04-27',
    });
    await expect(getDigest(HTTP)).rejects.toBeInstanceOf(ContractDecodeError);
  });

  test('passes a well-formed payload through the decoder unchanged', async () => {
    mockFetch({
      data: {
        windowStartedAt: '2026-04-26T08:00:00.000Z',
        windowEndedAt: '2026-04-27T08:00:00.000Z',
        builderCommits: [],
        explorerAdditions: [],
        decomposerSplits: [],
        blockedPromoterMoves: [],
        failedMonitoredRuns: [],
        pendingOwnerQuestions: [],
        agingOperatorCaptures: [],
        queueDelta: {
          current: { backlog: 0, ready: 1, doing: 0, blocked: 0 },
          previous: null,
          delta: { backlog: null, ready: null, doing: null, blocked: null },
        },
        quiet: false,
      },
      text: 'Daily digest 2026-04-27',
    });
    const decoded = await getDigest(HTTP);
    expect(decoded.data.queueDelta.current.ready).toBe(1);
    expect(decoded.text).toContain('Daily digest');
  });
});

describe('mobile getAttention decoder boundary', () => {
  test('rejects a payload with a malformed data.items[] entry', async () => {
    mockFetch({
      data: {
        items: [
          { label: 'Owner question', detail: 'oq-1 pending 3d' },
          // detail missing — decoder must reject.
          { label: 'Builder warnings' },
        ],
      },
      text: 'Attention required 2026-04-27',
    });
    await expect(getAttention(HTTP)).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
  });

  test('rejects a payload missing data entirely', async () => {
    mockFetch({ text: 'Attention required 2026-04-27' });
    await expect(getAttention(HTTP)).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
  });

  test('passes a well-formed payload through the decoder unchanged', async () => {
    mockFetch({
      data: {
        items: [{ label: 'Owner question', detail: 'oq-1 pending 3d' }],
      },
      text: 'Attention required 2026-04-27',
    });
    const decoded = await getAttention(HTTP);
    expect(decoded.data.items).toHaveLength(1);
    expect(decoded.data.items[0]).toEqual({
      label: 'Owner question',
      detail: 'oq-1 pending 3d',
    });
  });
});
