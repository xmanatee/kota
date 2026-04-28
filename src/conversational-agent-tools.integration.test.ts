/**
 * End-to-end tests for the agent-callable cross-store seam tools.
 *
 * Each describe boots a per-user agent session through the `openai-tools`
 * harness against the production capture/recall/answer/retract providers
 * wired to real on-disk stores. A scripted ModelClient drives one session
 * per describe.
 *
 * `capture / recall / answer round trip`:
 *   The agent fires three tool_use blocks in sequence (`capture`,
 *   `recall`, `answer`) and finishes with a plain text reply. The tests
 *   assert (a) capture writes a typed memory record, (b) recall returns
 *   ranked hits across registered contributors, (c) answer produces a
 *   cited envelope with a fresh `AnswerHistoryRecord`.
 *
 * `retract round trip`:
 *   The agent fires `retract` on a previously-captured memory entry,
 *   followed by a `recall` that should no longer surface the retracted
 *   record. Anchors the read-side seam settling after retract through
 *   the production `RetractProviderImpl`. The dangerous-tool runs under
 *   the same harness posture the peer arms use — no test-only autonomy
 *   elevation, no test-only override.
 */

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearCustomTools } from "#core/tools/index.js";
import type { Synthesizer } from "#modules/answer/answer-types.js";
import {
  buildCrossStoreFixture,
  type CrossStoreFixture,
  endTurn,
  findLastToolResult,
  registerCrossStoreTools,
  runScriptedAgentSession,
  SEEDED_KNOWLEDGE_TITLE,
  type StreamCallSnapshot,
  toolUseTurn,
} from "./conversational-cross-store-fixture.integration.js";

const CAPTURE_NOTE = "Operator wants xhighmnemo decomposer default for autonomy steps.";
const RECALL_QUERY = "min-max normalization";
const ANSWER_QUERY = "How does the recall seam rank hits?";
const FOLLOWUP_ANSWER_QUERY =
  "Which contributors does the recall seam rank into the top hits?";
const FABRICATED_ANSWER_ID = "answer-id-that-never-existed";
const RETRACTABLE_NOTE = "Operator scheduled retroterm checkin for thursday only.";
const POST_RETRACT_RECALL_QUERY = "retroterm checkin thursday";

type Harness = {
  fixture: CrossStoreFixture;
  snapshots: StreamCallSnapshot[];
};

describe("conversational agent tools — capture / recall / answer round trip", () => {
  let harness: Harness;

  beforeAll(async () => {
    clearCustomTools();
    const fixture = buildCrossStoreFixture("kota-conv-tools-");
    registerCrossStoreTools(fixture);
    const snapshots: StreamCallSnapshot[] = [];
    harness = { fixture, snapshots };

    const queue = [
      toolUseTurn("msg_capture", "call_capture", "capture", {
        text: CAPTURE_NOTE,
        target: "memory",
      }),
      toolUseTurn("msg_recall", "call_recall", "recall", {
        query: RECALL_QUERY,
      }),
      toolUseTurn("msg_answer", "call_answer", "answer", {
        query: ANSWER_QUERY,
      }),
      endTurn("msg_done", "all done"),
    ];
    await runScriptedAgentSession({
      prompt: "exercise the cross-store agent tools",
      snapshots,
      pickStream: () => {
        const next = queue.shift();
        if (!next) throw new Error("streamMock: no scripted return value");
        return next;
      },
    });
  });

  afterAll(() => {
    clearCustomTools();
    rmSync(harness.fixture.projectRoot, { recursive: true, force: true });
  });

  it("registers all four agent-callable tools and exposes them on every turn", () => {
    expect(harness.snapshots.length).toBeGreaterThanOrEqual(4);
    const toolNames = harness.snapshots[0].tools?.map((t) => t.name) ?? [];
    expect(toolNames).toContain("capture");
    expect(toolNames).toContain("recall");
    expect(toolNames).toContain("answer");
    expect(toolNames).toContain("retract");
  });

  it("(a) capture wrote a typed memory record reachable through the underlying MemoryStore", () => {
    const captured = harness.fixture.memoryStore
      .list()
      .find((r) => r.content === CAPTURE_NOTE);
    expect(captured).toBeDefined();
    const captureToolResult = findLastToolResult(harness.snapshots, "call_capture");
    expect(captureToolResult).toBeDefined();
    expect(captureToolResult).toContain("Captured: memory");
  });

  it("(b) recall returned ranked hits across registered contributors and the harness fed the rendered hits back to the model", () => {
    const recallToolResult = findLastToolResult(harness.snapshots, "call_recall");
    expect(recallToolResult).toBeDefined();
    if (!recallToolResult) throw new Error("unreachable");
    expect(recallToolResult).toContain("knowledge");
    expect(recallToolResult).toContain(SEEDED_KNOWLEDGE_TITLE);
  });

  it("(c) answer produced a cited envelope and appended one AnswerHistoryRecord that includes the cross-store recall hits the synthesizer was shown", async () => {
    const answerToolResult = findLastToolResult(harness.snapshots, "call_answer");
    expect(answerToolResult).toBeDefined();
    if (!answerToolResult) throw new Error("unreachable");
    expect(answerToolResult).toContain("min-max normalization");
    expect(answerToolResult).toContain("Citations");
    expect(answerToolResult).toContain("knowledge");

    const entries = await harness.fixture.answerHistoryStore.listAnswers();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const newest = entries[0];
    expect(newest.query).toBe(ANSWER_QUERY);
    expect(newest.result.ok).toBe(true);
    if (!newest.result.ok) throw new Error("unreachable");
    expect(newest.result.citationCount).toBeGreaterThanOrEqual(1);

    const record = await harness.fixture.answerHistoryStore.getAnswer(
      newest.id,
    );
    if (!record) throw new Error("expected stored answer record");
    expect(record.result.ok).toBe(true);
    if (!record.result.ok) throw new Error("unreachable");
    const sources = new Set(record.recallHits.map((h) => h.source));
    expect(sources.has("knowledge")).toBe(true);
    const citation = record.result.citations[0];
    const matchedHit = record.recallHits.find(
      (h) => h.source === citation.source && h.id === citation.id,
    );
    expect(matchedHit).toBeDefined();
  });
});

describe("conversational agent tools — prior answers surface as recall hits", () => {
  let harness: Harness;

  beforeAll(async () => {
    clearCustomTools();
    const fixture = buildCrossStoreFixture("kota-conv-answer-recall-");
    registerCrossStoreTools(fixture);
    const snapshots: StreamCallSnapshot[] = [];
    harness = { fixture, snapshots };

    // Seed an answer-history record by exercising AnswerProvider end-to-end
    // on the fixture. This is the same flow `kota answer <query>` and the
    // `answer` agent tool run, so the persisted envelope is identical to
    // what real operator traffic would produce.
    const seeded = await fixture.answerProvider.answer(ANSWER_QUERY);
    if (!seeded.ok) throw new Error("setup: expected seed answer to succeed");

    const queue = [
      toolUseTurn("msg_recall_after_answer", "call_recall_after_answer", "recall", {
        query: ANSWER_QUERY,
      }),
      endTurn("msg_done", "all done"),
    ];
    await runScriptedAgentSession({
      prompt: "verify prior cited answers surface through recall",
      snapshots,
      pickStream: () => {
        const next = queue.shift();
        if (!next) throw new Error("streamMock: no scripted return value");
        return next;
      },
    });
  });

  afterAll(() => {
    clearCustomTools();
    rmSync(harness.fixture.projectRoot, { recursive: true, force: true });
  });

  it("a fact-shaped follow-up turn that has a matching prior cited answer surfaces the prior answer as an `answer`-source recall hit", async () => {
    // Direct seam assertion: the production RecallProviderImpl returns a
    // typed `answer`-source hit for the query that already produced an
    // answer-history record. The scoring contract checked here is the
    // task's "comes back as one of the top-K", not the absolute score.
    const hits = await harness.fixture.recallProvider.recall(ANSWER_QUERY, {
      topK: 8,
    });
    const sources = new Set(hits.map((h) => h.source));
    expect(sources.has("knowledge")).toBe(true);
    expect(sources.has("answer")).toBe(true);
    const answerHit = hits.find((h) => h.source === "answer");
    if (!answerHit) throw new Error("expected an answer-source hit");
    if (answerHit.source !== "answer") throw new Error("type narrowing");
    expect(answerHit.query).toBe(ANSWER_QUERY);
    expect(answerHit.result).toEqual({ ok: true });

    // Agent-loop assertion: the `recall` tool the agent fired through the
    // production harness rendered the same prior-answer hit alongside the
    // existing knowledge/memory/history hits.
    const recallToolResult = findLastToolResult(
      harness.snapshots,
      "call_recall_after_answer",
    );
    expect(recallToolResult).toBeDefined();
    if (!recallToolResult) throw new Error("unreachable");
    expect(recallToolResult).toContain("answer");
    expect(recallToolResult).toContain(ANSWER_QUERY);
  });
});

describe("conversational agent tools — answer-then-answer chain (prior cited answer becomes evidence for follow-up cited answer)", () => {
  describe("(positive) follow-up answer turn cites the seeded envelope through [answer:<id>]", () => {
    let harness: Harness;
    let seededAnswerId: string;

    beforeAll(async () => {
      clearCustomTools();
      const fixture = buildCrossStoreFixture("kota-conv-answer-chain-pos-");
      registerCrossStoreTools(fixture);
      const snapshots: StreamCallSnapshot[] = [];
      harness = { fixture, snapshots };

      // Seed an answer-history record by exercising AnswerProviderImpl
      // end-to-end on the fixture — same call path the `kota answer <q>`
      // CLI and the `answer` agent tool use, so the persisted envelope is
      // identical to what real operator traffic would produce.
      const seeded = await fixture.answerProvider.answer(ANSWER_QUERY);
      if (!seeded.ok) throw new Error("setup: expected seed answer to succeed");
      const entries = await fixture.answerHistoryStore.listAnswers();
      if (entries.length === 0) {
        throw new Error("setup: expected one persisted answer history entry");
      }
      seededAnswerId = entries[0].id;

      const queue = [
        toolUseTurn("msg_followup_answer", "call_followup_answer", "answer", {
          query: FOLLOWUP_ANSWER_QUERY,
        }),
        endTurn("msg_done", "all done"),
      ];
      await runScriptedAgentSession({
        prompt: "anchor the answer-then-answer chain through the agent loop",
        snapshots,
        pickStream: () => {
          const next = queue.shift();
          if (!next) throw new Error("streamMock: no scripted return value");
          return next;
        },
      });
    });

    afterAll(() => {
      clearCustomTools();
      rmSync(harness.fixture.projectRoot, { recursive: true, force: true });
    });

    it("the follow-up `answer` tool result contains an inline [answer:<id>] marker referencing the seeded envelope", () => {
      const answerToolResult = findLastToolResult(
        harness.snapshots,
        "call_followup_answer",
      );
      expect(answerToolResult).toBeDefined();
      if (!answerToolResult) throw new Error("unreachable");
      expect(answerToolResult).toContain(`[answer:${seededAnswerId}]`);
      expect(answerToolResult).toContain("Citations");
      expect(answerToolResult).toContain("answer");
    });

    it("the persisted AnswerHistoryRecord for the follow-up turn carries an `answer`-source citation matching the seeded envelope id", async () => {
      const entries = await harness.fixture.answerHistoryStore.listAnswers();
      // newest-first ordering: index 0 is the follow-up, index 1 is the seed.
      expect(entries.length).toBeGreaterThanOrEqual(2);
      const followup = entries[0];
      expect(followup.query).toBe(FOLLOWUP_ANSWER_QUERY);
      expect(followup.result.ok).toBe(true);
      const record = await harness.fixture.answerHistoryStore.getAnswer(
        followup.id,
      );
      if (!record) throw new Error("expected stored follow-up record");
      if (!record.result.ok) throw new Error("expected ok result");
      const answerCitation = record.result.citations.find(
        (c) => c.source === "answer",
      );
      expect(answerCitation).toBeDefined();
      if (!answerCitation) throw new Error("unreachable");
      expect(answerCitation.id).toBe(seededAnswerId);
    });

    it("the recorded recallHits for the follow-up record include the seeded envelope as an `answer`-source hit", async () => {
      const entries = await harness.fixture.answerHistoryStore.listAnswers();
      const followup = entries[0];
      const record = await harness.fixture.answerHistoryStore.getAnswer(
        followup.id,
      );
      if (!record) throw new Error("expected stored follow-up record");
      const answerHit = record.recallHits.find(
        (h) => h.source === "answer" && h.id === seededAnswerId,
      );
      expect(answerHit).toBeDefined();
      if (!answerHit) throw new Error("unreachable");
      if (answerHit.source !== "answer") throw new Error("type narrowing");
      expect(answerHit.query).toBe(ANSWER_QUERY);
      expect(answerHit.result).toEqual({ ok: true });
    });
  });

  describe("(negative) fabricated [answer:<unknown-id>] marker still trips retry-and-reject", () => {
    let harness: Harness;

    beforeAll(async () => {
      clearCustomTools();
      // The fabrication synthesizer falls back to the default knowledge-cited
      // reply for the seed call (no `answer` hit yet) and emits a fabricated
      // `[answer:<unknown-id>]` marker on the follow-up call (when an
      // `answer` hit is in the pile). Retry runs with the same fabrication
      // so the AnswerProviderImpl retry-and-reject contract surfaces
      // `synthesis_failed` for the answer arm just as it does for the
      // existing knowledge/memory/tasks arms.
      const fabricationSynthesizer: Synthesizer = async ({ hits }) => {
        const answerHit = hits.find((h) => h.source === "answer");
        if (answerHit) {
          return `The prior cited answer [answer:${FABRICATED_ANSWER_ID}] still applies.`;
        }
        const knowledgeHit = hits.find((h) => h.source === "knowledge");
        if (!knowledgeHit) {
          throw new Error("expected knowledge hit in seeded fixture");
        }
        return `The recall seam ranks hits using min-max normalization [knowledge:${knowledgeHit.id}].`;
      };
      const fixture = buildCrossStoreFixture("kota-conv-answer-chain-neg-", {
        synthesizer: fabricationSynthesizer,
      });
      registerCrossStoreTools(fixture);
      const snapshots: StreamCallSnapshot[] = [];
      harness = { fixture, snapshots };

      const seeded = await fixture.answerProvider.answer(ANSWER_QUERY);
      if (!seeded.ok) {
        throw new Error("setup: expected seed answer to succeed");
      }

      const queue = [
        toolUseTurn(
          "msg_followup_answer_neg",
          "call_followup_answer_neg",
          "answer",
          { query: FOLLOWUP_ANSWER_QUERY },
        ),
        endTurn("msg_done", "all done"),
      ];
      await runScriptedAgentSession({
        prompt: "anchor the negative arm of the answer-then-answer chain",
        snapshots,
        pickStream: () => {
          const next = queue.shift();
          if (!next) throw new Error("streamMock: no scripted return value");
          return next;
        },
      });
    });

    afterAll(() => {
      clearCustomTools();
      rmSync(harness.fixture.projectRoot, { recursive: true, force: true });
    });

    it("rejects the follow-up synthesis as `synthesis_failed` and persists one extra failure record", async () => {
      const answerToolResult = findLastToolResult(
        harness.snapshots,
        "call_followup_answer_neg",
      );
      expect(answerToolResult).toBeDefined();
      if (!answerToolResult) throw new Error("unreachable");
      // The renderer surfaces the failure verbatim; the fabricated marker
      // never reaches the operator as a usable citation.
      expect(answerToolResult.toLowerCase()).toContain("synthesis failed");
      expect(answerToolResult).not.toContain(FABRICATED_ANSWER_ID);

      const entries = await harness.fixture.answerHistoryStore.listAnswers();
      // Two records: the successful seed and the failed follow-up.
      expect(entries.length).toBe(2);
      const followup = entries[0];
      expect(followup.query).toBe(FOLLOWUP_ANSWER_QUERY);
      expect(followup.result.ok).toBe(false);
      if (followup.result.ok) throw new Error("unreachable");
      expect(followup.result.reason).toBe("synthesis_failed");
    });
  });
});

describe("conversational agent tools — retract round trip", () => {
  let harness: Harness;
  let retractedMemoryId: string;

  beforeAll(async () => {
    clearCustomTools();
    const fixture = buildCrossStoreFixture("kota-conv-retract-");
    registerCrossStoreTools(fixture);
    const snapshots: StreamCallSnapshot[] = [];
    harness = { fixture, snapshots };

    // Pre-capture through the production wiring so the retract arm has a
    // real `RetractProviderImpl`-reachable memory record to remove.
    const capture = await fixture.captureProvider.capture(RETRACTABLE_NOTE, {
      target: "memory",
    });
    if (!capture.ok || capture.record.target !== "memory") {
      throw new Error("setup: expected memory capture to succeed");
    }
    retractedMemoryId = capture.record.recordId;

    // Pre-recall sanity: the captured note is reachable before the agent
    // retracts it, so a missing post-retract hit is meaningful.
    const preHits = await fixture.recallProvider.recall(
      POST_RETRACT_RECALL_QUERY,
    );
    if (
      !preHits.some(
        (h) => h.source === "memory" && h.id === retractedMemoryId,
      )
    ) {
      throw new Error("setup: expected memory hit before retract");
    }

    await runScriptedAgentSession({
      prompt: "retract the prior memory entry and confirm it is gone",
      snapshots,
      pickStream: (snaps) => {
        const turn = snaps.length - 1;
        switch (turn) {
          case 0:
            return toolUseTurn("msg_retract", "call_retract", "retract", {
              target: "memory",
              id: retractedMemoryId,
            });
          case 1:
            return toolUseTurn(
              "msg_recall_after",
              "call_recall_after",
              "recall",
              { query: POST_RETRACT_RECALL_QUERY },
            );
          case 2:
            return endTurn("msg_done", "retract done");
          default:
            throw new Error(`streamMock: unexpected turn ${turn}`);
        }
      },
    });
  });

  afterAll(() => {
    clearCustomTools();
    rmSync(harness.fixture.projectRoot, { recursive: true, force: true });
  });

  it("admits the dangerous `retract` tool under the same harness posture capture/recall/answer use", () => {
    expect(harness.snapshots.length).toBeGreaterThanOrEqual(3);
    const toolNames = harness.snapshots[0].tools?.map((t) => t.name) ?? [];
    expect(toolNames).toContain("retract");
  });

  it("retracts the captured memory record through the production RetractProvider and renders the typed success body", () => {
    const retractToolResult = findLastToolResult(
      harness.snapshots,
      "call_retract",
    );
    expect(retractToolResult).toBeDefined();
    if (!retractToolResult) throw new Error("unreachable");
    expect(retractToolResult).toBe(`Retracted: memory  ${retractedMemoryId}`);

    // Read-side: the entry is gone from the underlying MemoryStore.
    const remaining = harness.fixture.memoryStore
      .list()
      .find((r) => r.id === retractedMemoryId);
    expect(remaining).toBeUndefined();
  });

  it("a follow-up recall through the agent loop returns no hit for the retracted record's content", () => {
    const recallAfterResult = findLastToolResult(
      harness.snapshots,
      "call_recall_after",
    );
    expect(recallAfterResult).toBeDefined();
    if (!recallAfterResult) throw new Error("unreachable");
    expect(recallAfterResult).not.toContain(retractedMemoryId);
    expect(recallAfterResult).not.toContain(RETRACTABLE_NOTE);
  });
});
