import { expect, it, vi } from "vitest";
import type { HistoryClient } from "./client.js";
import { historyCommandReply } from "./commands.js";

it("rejects blank chat queries before the client and preserves the trimmed request", async () => {
  const search = vi.fn<HistoryClient["search"]>().mockResolvedValue({ ok: true, conversations: [] });
  for (const body of ["", " \n\t "]) {
    expect(await historyCommandReply({ search }, body)).toBe("Usage: /history <query>");
  }
  expect(search).not.toHaveBeenCalled();
  expect(await historyCommandReply({ search }, "  two words  ")).toBe("No matching conversations.");
  expect(search).toHaveBeenCalledExactlyOnceWith("two words", { semantic: true, limit: 10 });
});

it("distinguishes unavailable search from readable results and propagates client failures", async () => {
  const search = vi.fn<HistoryClient["search"]>()
    .mockResolvedValueOnce({ ok: false, reason: "semantic_unavailable" })
    .mockResolvedValueOnce({ ok: true, conversations: [{ id: "chat-1", title: "Routing discussion", createdAt: "2026-09-13T10:00:00Z", updatedAt: "2026-09-13T10:00:00Z", model: "model", messageCount: 0, cwd: "/scope" }] });
  expect(await historyCommandReply({ search }, "query")).toBe("Semantic conversation search requires an embedding-backed history provider.");
  expect(search).toHaveBeenCalledTimes(1);
  expect(await historyCommandReply({ search }, "query")).toBe("chat-1  2026-09-13 10:00     0 msgs  Routing discussion");
  const error = new Error("transport disconnected");
  search.mockRejectedValueOnce(error);
  await expect(historyCommandReply({ search }, "query")).rejects.toBe(error);
  expect(search).toHaveBeenCalledTimes(3);
});
