import { expect, it, vi } from "vitest";
import type { KnowledgeClient } from "./client.js";
import { knowledgeCommandReply } from "./commands.js";

it("rejects blank chat queries before the client and preserves the trimmed request", async () => {
  const search = vi.fn<KnowledgeClient["search"]>().mockResolvedValue({ ok: true, entries: [] });
  for (const body of ["", " \n\t "]) {
    expect(await knowledgeCommandReply({ search }, body)).toBe("Usage: /knowledge <query>");
  }
  expect(search).not.toHaveBeenCalled();
  expect(await knowledgeCommandReply({ search }, "  two words  ")).toBe("No matching knowledge entries.");
  expect(search).toHaveBeenCalledExactlyOnceWith("two words", { semantic: true, limit: 10 });
});

it("distinguishes unavailable search from readable results and propagates client failures", async () => {
  const search = vi.fn<KnowledgeClient["search"]>()
    .mockResolvedValueOnce({ ok: false, reason: "semantic_unavailable" })
    .mockResolvedValueOnce({ ok: true, entries: [{ id: "doc-1", title: "Routing decision", type: "note", status: "active", tags: [], created: "2026-09-13", updated: "2026-09-13", content: "Details", meta: {} }] });
  expect(await knowledgeCommandReply({ search }, "query")).toBe("Semantic knowledge search requires an embedding-backed knowledge provider.");
  expect(search).toHaveBeenCalledTimes(1);
  expect(await knowledgeCommandReply({ search }, "query")).toBe("doc-1  note  active  Routing decision");
  const error = new Error("transport disconnected");
  search.mockRejectedValueOnce(error);
  await expect(knowledgeCommandReply({ search }, "query")).rejects.toBe(error);
  expect(search).toHaveBeenCalledTimes(3);
});
