import { describe, expect, it, vi } from "vitest";
import type { AnswerClient, AnswerHistoryRecord, AnswerResult } from "./client.js";
import { answerCommandReply, answerLogCommandReply, answerShowCommandReply } from "./commands.js";

function client() {
  return {
    answer: vi.fn<AnswerClient["answer"]>(),
    log: vi.fn<AnswerClient["log"]>(),
    show: vi.fn<AnswerClient["show"]>(),
  };
}

const cited: AnswerResult = {
  ok: true,
  answer: "Use the shared owner [memory:m1].",
  citations: [{ source: "memory", id: "m1" }],
  hits: [{ source: "memory", id: "m1", score: 1, preview: "Shared command behavior", created: "2026-09-13" }],
};
const record: AnswerHistoryRecord = {
  id: "record-1", createdAt: "2026-09-13T00:00:00.000Z", query: "Where does this belong?",
  filter: {}, recallHits: cited.hits, result: cited,
};

// The answer owner verifies chat request policy and presentation once. Channel
// tests own parsing, scope admission, output limits and transport delivery.
describe("answer command replies", () => {
  it("returns usage for missing queries and ids without invoking the client", async () => {
    const answer = client();
    expect(await answerCommandReply(answer, "")).toBe("Usage: /answer <query>");
    expect(await answerShowCommandReply(answer, "")).toBe("Usage: /answer-show <id>");
    expect(answer.answer).not.toHaveBeenCalled();
    expect(answer.show).not.toHaveBeenCalled();
  });

  it("defaults the history page and accepts a positive integer limit", async () => {
    const answer = client();
    answer.log.mockResolvedValue({ entries: [] });
    expect(await answerLogCommandReply(answer, "")).toBe("No past answer records yet.");
    expect(answer.log).toHaveBeenLastCalledWith({ limit: 5 });
    await answerLogCommandReply(answer, "7");
    expect(answer.log).toHaveBeenLastCalledWith({ limit: 7 });
  });

  it("rejects malformed limits without reading history", async () => {
    const answer = client();
    for (const body of ["nope", "0", "-1", "1.5", "7tail", "01", "+2", "1e2", "Infinity"]) {
      expect(await answerLogCommandReply(answer, body)).toBe("Usage: /answer-log [N]");
    }
    expect(answer.log).not.toHaveBeenCalled();
  });

  it("presents live and stored cited answers consistently through the supplied client", async () => {
    const answer = client();
    answer.answer.mockResolvedValue(cited);
    answer.show.mockResolvedValue({ ok: true, record });
    const reply = await answerCommandReply(answer, "Where does this belong?");
    expect(reply).toBe("Use the shared owner [memory:m1].\n\nCitations\nmemory  1.000  m1  Shared command behavior");
    expect(await answerShowCommandReply(answer, "record-1")).toBe(reply);
    expect(answer.answer).toHaveBeenCalledExactlyOnceWith("Where does this belong?");
    expect(answer.show).toHaveBeenCalledExactlyOnceWith("record-1");
  });

  it.each([
    ["no_hits", "No matching knowledge, memory, or history sources — nothing to synthesize."],
    ["semantic_unavailable", "Cross-store recall has no registered contributors."],
    ["synthesis_failed", "Synthesis failed (model unreachable or unable to cite resolvable sources)."],
  ] as const)("keeps %s truthful in live and stored replies", async (reason, expected) => {
    const answer = client();
    const result: AnswerResult = { ok: false, reason };
    answer.answer.mockResolvedValue(result);
    answer.show.mockResolvedValue({ ok: true, record: { ...record, result } });
    expect(await answerCommandReply(answer, "question")).toBe(expected);
    expect(await answerShowCommandReply(answer, record.id)).toBe(expected);
  });

  it("distinguishes an absent record from a stored answer failure", async () => {
    const answer = client();
    answer.show.mockResolvedValue({ ok: false, reason: "not_found" });
    expect(await answerShowCommandReply(answer, "missing")).toBe('No answer record found for id "missing".');
  });

  it("lists stored success and failure records in the returned order", async () => {
    const answer = client();
    answer.log.mockResolvedValue({ entries: [
      { ...record, result: { ok: true, citationCount: 1 } },
      { ...record, id: "failed-1", query: "Missing sources?", result: { ok: false, reason: "no_hits" } },
    ] });
    const reply = await answerLogCommandReply(answer, "2");
    expect(reply.split("\n")).toEqual([
      expect.stringMatching(/^2026-09-13T00:00:00Z {2}ok\(1\)\s+record-1 {2}Where does this belong\?$/),
      expect.stringMatching(/^2026-09-13T00:00:00Z {2}no_hits\s+failed-1 {2}Missing sources\?$/),
    ]);
  });

  it("propagates client errors to the channel instead of reporting an empty result", async () => {
    const answer = client();
    const error = new Error("selected scope unavailable");
    answer.answer.mockRejectedValue(error);
    answer.log.mockRejectedValue(error);
    answer.show.mockRejectedValue(error);
    await expect(answerCommandReply(answer, "query")).rejects.toBe(error);
    await expect(answerLogCommandReply(answer, "")).rejects.toBe(error);
    await expect(answerShowCommandReply(answer, "id")).rejects.toBe(error);
  });
});
