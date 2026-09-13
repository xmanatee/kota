import { expect, it, vi } from "vitest";
import type { MemoryClient } from "./client.js";
import { memoryCommandReply } from "./commands.js";

it("rejects blank chat queries before the client and preserves the trimmed request", async () => {
  const search = vi.fn<MemoryClient["search"]>().mockResolvedValue({ ok: true, entries: [] });
  for (const body of ["", " \n\t "]) {
    expect(await memoryCommandReply({ search }, body)).toBe("Usage: /memory <query>");
  }
  expect(search).not.toHaveBeenCalled();
  expect(await memoryCommandReply({ search }, "  two words  ")).toBe("No matching memory entries.");
  expect(search).toHaveBeenCalledExactlyOnceWith("two words", { semantic: true, limit: 10 });
});

it("distinguishes unavailable search from readable results and propagates client failures", async () => {
  const search = vi.fn<MemoryClient["search"]>()
    .mockResolvedValueOnce({ ok: false, reason: "semantic_unavailable" })
    .mockResolvedValueOnce({ ok: true, entries: [{ id: "mem-1", created: "2026-09-13T10:00:00Z", content: "Prefer quiet mornings" }] });
  expect(await memoryCommandReply({ search }, "query")).toBe("Semantic memory search requires an embedding-backed memory provider.");
  expect(search).toHaveBeenCalledTimes(1);
  expect(await memoryCommandReply({ search }, "query")).toBe("mem-1  2026-09-13 10:00  Prefer quiet mornings");
  const error = new Error("transport disconnected");
  search.mockRejectedValueOnce(error);
  await expect(memoryCommandReply({ search }, "query")).rejects.toBe(error);
  expect(search).toHaveBeenCalledTimes(3);
});
