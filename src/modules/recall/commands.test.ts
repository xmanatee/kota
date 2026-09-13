import { expect, it, vi } from "vitest";
import type { RecallClient } from "./client.js";
import { recallCommandReply } from "./commands.js";

it("rejects blank chat queries before the client and preserves the trimmed request", async () => {
  const recall = vi.fn<RecallClient["recall"]>().mockResolvedValue({ ok: true, hits: [] });
  for (const body of ["", " \n\t "]) {
    expect(await recallCommandReply({ recall }, body)).toBe("Usage: /recall <query>");
  }
  expect(recall).not.toHaveBeenCalled();
  expect(await recallCommandReply({ recall }, "  two words  ")).toBe("No matching items.");
  expect(recall).toHaveBeenCalledExactlyOnceWith("two words");
});

it("distinguishes unavailable search from readable results and propagates client failures", async () => {
  const recall = vi.fn<RecallClient["recall"]>()
    .mockResolvedValueOnce({ ok: false, reason: "semantic_unavailable" })
    .mockResolvedValueOnce({ ok: true, hits: [{ source: "memory", id: "mem-1", score: 0, preview: "Prefer quiet mornings", created: "2026-09-13" }, { source: "history", id: "chat-1", score: 0.8, title: "Routing discussion", cwd: "/scope", updatedAt: "2026-09-13" }] });
  expect(await recallCommandReply({ recall }, "query")).toBe("Cross-store recall is not configured: no contributors are registered.");
  expect(recall).toHaveBeenCalledTimes(1);
  expect(await recallCommandReply({ recall }, "query")).toBe("memory   0.000  mem-1   Prefer quiet mornings\nhistory  0.800  chat-1  Routing discussion");
  const error = new Error("transport disconnected");
  recall.mockRejectedValueOnce(error);
  await expect(recallCommandReply({ recall }, "query")).rejects.toBe(error);
  expect(recall).toHaveBeenCalledTimes(3);
});
