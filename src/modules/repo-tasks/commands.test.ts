import { expect, it, vi } from "vitest";
import type { RepoTasksClient } from "./client.js";
import { tasksCommandReply } from "./commands.js";

it("rejects blank chat queries before the client and preserves the trimmed request", async () => {
  const search = vi.fn<RepoTasksClient["search"]>().mockResolvedValue({ ok: true, tasks: [] });
  for (const body of ["", " \n\t "]) {
    expect(await tasksCommandReply({ search }, body)).toBe("Usage: /tasks <query>");
  }
  expect(search).not.toHaveBeenCalled();
  expect(await tasksCommandReply({ search }, "  two words  ")).toBe("No matching tasks.");
  expect(search).toHaveBeenCalledExactlyOnceWith("two words", { semantic: true, limit: 10 });
});

it("distinguishes unavailable search from readable results and propagates client failures", async () => {
  const search = vi.fn<RepoTasksClient["search"]>()
    .mockResolvedValueOnce({ ok: false, reason: "semantic_unavailable" })
    .mockResolvedValueOnce({ ok: true, tasks: [{ id: "task-1", title: "Improve routing", state: "done", priority: null, score: 0 }] });
  expect(await tasksCommandReply({ search }, "query")).toBe("Semantic task search requires an embedding-backed repo-tasks provider.");
  expect(search).toHaveBeenCalledTimes(1);
  expect(await tasksCommandReply({ search }, "query")).toBe("task-1  done   —     Improve routing");
  const error = new Error("transport disconnected");
  search.mockRejectedValueOnce(error);
  await expect(tasksCommandReply({ search }, "query")).rejects.toBe(error);
  expect(search).toHaveBeenCalledTimes(3);
});
