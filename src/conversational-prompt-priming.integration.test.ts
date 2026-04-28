/**
 * End-to-end test for the cross-store conversational-prompt-priming wiring.
 *
 * Exercises the production capture/recall/answer/retract modules: each
 * module's `onLoad` registers a per-turn dynamic system-prompt state
 * contributor via `ctx.registerDynamicStateProvider`. The contributors
 * are gated by the session's effective tool policy: when the matching
 * tool is admitted, the conversational-pattern block is appended to the
 * system prompt; when the tool is excluded, the contributor emits the
 * empty string.
 *
 * The test asserts the bullets in the task's "Done When":
 *
 *   Positive:
 *     - A session that admits all four tools sees all four blocks in
 *       the per-turn dynamic state, and the runtime recall → answer →
 *       answer-history-append chain produces a fresh `AnswerHistoryRecord`
 *       (i.e. behavior changed, not just prompt text). The retract arm
 *       drives the production `RetractProviderImpl` against the seeded
 *       memory record and asserts the read-side seam settles via a
 *       follow-up recall.
 *
 *   Negative:
 *     - A session whose tool policy admits only `recall` sees the recall
 *       block but neither the capture, the answer, nor the retract block.
 */

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  collectDynamicState,
  registerDynamicStateProvider,
  resetDynamicStateProviders,
} from "#core/loop/dynamic-state.js";
import {
  ANSWER_CONVERSATIONAL_BLOCK,
  ANSWER_DYNAMIC_STATE_NAME,
  buildAnswerDynamicStateProvider,
} from "#modules/answer/system-prompt.js";
import {
  buildCaptureDynamicStateProvider,
  CAPTURE_CONVERSATIONAL_BLOCK,
  CAPTURE_DYNAMIC_STATE_NAME,
} from "#modules/capture/system-prompt.js";
import {
  buildRecallDynamicStateProvider,
  RECALL_CONVERSATIONAL_BLOCK,
  RECALL_DYNAMIC_STATE_NAME,
} from "#modules/recall/system-prompt.js";
import {
  buildRetractDynamicStateProvider,
  RETRACT_CONVERSATIONAL_BLOCK,
  RETRACT_DYNAMIC_STATE_NAME,
} from "#modules/retract/system-prompt.js";
import {
  buildCrossStoreFixture,
  type CrossStoreFixture,
} from "./conversational-cross-store-fixture.integration.js";

const ANSWER_QUERY = "How does the recall seam rank hits?";
const RECALL_QUERY = "min-max normalization";
const RETRACTABLE_NOTE = "Operator scheduled retroterm checkin for thursday only.";
const RETRACT_RECALL_QUERY = "retroterm checkin thursday";

describe("conversational prompt priming (capture / recall / answer / retract)", () => {
  let fixture: CrossStoreFixture;

  beforeAll(() => {
    resetDynamicStateProviders();
    fixture = buildCrossStoreFixture("kota-conv-priming-");

    // Register the contributors through the same global registry every
    // module's `onLoad` writes to. `loop-send.ts` collects from this
    // registry per turn — the runtime path is unchanged.
    registerDynamicStateProvider(
      CAPTURE_DYNAMIC_STATE_NAME,
      buildCaptureDynamicStateProvider(),
    );
    registerDynamicStateProvider(
      RECALL_DYNAMIC_STATE_NAME,
      buildRecallDynamicStateProvider(),
    );
    registerDynamicStateProvider(
      ANSWER_DYNAMIC_STATE_NAME,
      buildAnswerDynamicStateProvider(),
    );
    registerDynamicStateProvider(
      RETRACT_DYNAMIC_STATE_NAME,
      buildRetractDynamicStateProvider(),
    );
  });

  afterAll(() => {
    resetDynamicStateProviders();
    rmSync(fixture.projectRoot, { recursive: true, force: true });
  });

  it("(positive) per-turn system prompt contains all four conversational blocks when every tool is admitted", () => {
    const dynamicState = collectDynamicState({
      activeTools: new Set(["capture", "recall", "answer", "retract"]),
    });
    expect(dynamicState).toContain(CAPTURE_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).toContain(RECALL_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).toContain(ANSWER_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).toContain(RETRACT_CONVERSATIONAL_BLOCK.trim());
  });

  it("(positive) recall returns the seeded knowledge hit and answer appends a fresh AnswerHistoryRecord — i.e. behavior changed, not just prompt text", async () => {
    const recallHits = await fixture.recallProvider.recall(RECALL_QUERY);
    const knowledgeHit = recallHits.find((h) => h.source === "knowledge");
    expect(knowledgeHit).toBeDefined();
    expect(knowledgeHit?.id).toBeDefined();

    const beforeEntries = await fixture.answerHistoryStore.listAnswers();
    const beforeCount = beforeEntries.length;

    const answerResult = await fixture.answerProvider.answer(ANSWER_QUERY);
    expect(answerResult.ok).toBe(true);
    if (!answerResult.ok) throw new Error("unreachable");
    expect(answerResult.answer).toContain("min-max normalization");
    expect(answerResult.citations.length).toBeGreaterThanOrEqual(1);

    const afterEntries = await fixture.answerHistoryStore.listAnswers();
    expect(afterEntries.length).toBe(beforeCount + 1);
    const newest = afterEntries[0];
    expect(newest.query).toBe(ANSWER_QUERY);
    expect(newest.result.ok).toBe(true);
    if (!newest.result.ok) throw new Error("unreachable");
    expect(newest.result.citationCount).toBeGreaterThanOrEqual(1);

    const stored = await fixture.answerHistoryStore.getAnswer(newest.id);
    if (!stored) throw new Error("expected stored answer record");
    expect(stored.result.ok).toBe(true);
    if (!stored.result.ok) throw new Error("unreachable");
    const sources = new Set(stored.recallHits.map((h) => h.source));
    expect(sources.has("knowledge")).toBe(true);
  });

  it("(positive) retract removes a captured memory record through the production provider and a follow-up recall no longer surfaces it", async () => {
    const capture = await fixture.captureProvider.capture(RETRACTABLE_NOTE, {
      target: "memory",
    });
    expect(capture.ok).toBe(true);
    if (!capture.ok || capture.record.target !== "memory") {
      throw new Error("unreachable");
    }
    const memoryId = capture.record.recordId;

    const before = await fixture.recallProvider.recall(RETRACT_RECALL_QUERY);
    expect(
      before.some((h) => h.source === "memory" && h.id === memoryId),
    ).toBe(true);

    const result = await fixture.retractProvider.retract({
      target: "memory",
      id: memoryId,
    });
    expect(result).toEqual({
      ok: true,
      record: { target: "memory", recordId: memoryId },
    });

    const after = await fixture.recallProvider.recall(RETRACT_RECALL_QUERY);
    expect(
      after.some((h) => h.source === "memory" && h.id === memoryId),
    ).toBe(false);
  });

  it("(negative) per-turn system prompt suppresses capture / answer / retract blocks when the session admits only recall", () => {
    const dynamicState = collectDynamicState({
      activeTools: new Set(["recall"]),
    });
    expect(dynamicState).toContain(RECALL_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).not.toContain(CAPTURE_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).not.toContain(ANSWER_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).not.toContain(RETRACT_CONVERSATIONAL_BLOCK.trim());
  });

  it("(negative) per-turn system prompt suppresses every block when the session admits no cross-store tool", () => {
    const dynamicState = collectDynamicState({
      activeTools: new Set(["shell", "file_read"]),
    });
    expect(dynamicState).not.toContain(CAPTURE_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).not.toContain(RECALL_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).not.toContain(ANSWER_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).not.toContain(RETRACT_CONVERSATIONAL_BLOCK.trim());
  });
});
