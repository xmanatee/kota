import { expect, it, vi } from "vitest";
import type { CaptureClient, CaptureResult } from "./client.js";
import { captureCommandReply } from "./commands.js";

it("rejects empty bodies before capture and gives explicit target guidance", async () => {
  const capture = vi.fn<CaptureClient["capture"]>();
  for (const target of [undefined, "memory", "knowledge", "tasks", "inbox"] as const) {
    expect(await captureCommandReply({ capture }, " \n\t", target)).toBe(
      "Capture target ambiguous. Suggestions: memory, knowledge, tasks, inbox. Re-run with one of: /capture-to-memory, /capture-to-knowledge, /capture-to-tasks, /capture-to-inbox.",
    );
  }
  expect(capture).not.toHaveBeenCalled();
});

it("preserves complete content and distinguishes untargeted from explicit capture", async () => {
  const capture = vi.fn<CaptureClient["capture"]>().mockResolvedValue({ ok: true, target: "memory", id: "m1" });
  const body = "  Title\n\n  indented detail\nlast line  \n";
  await captureCommandReply({ capture }, body);
  expect(capture).toHaveBeenLastCalledWith(body, undefined);
  for (const target of ["memory", "knowledge", "tasks", "inbox"] as const) {
    await captureCommandReply({ capture }, body, target);
    expect(capture).toHaveBeenLastCalledWith(body, { target });
  }
});

it.each<[CaptureResult, string]>([
  [{ ok: true, target: "tasks", id: "task-fix", path: "data/tasks/task-fix.md" }, "Captured to tasks: task-fix (data/tasks/task-fix.md)"],
  [{ ok: false, target: "tasks", reason: "invalid_body", message: "Incomplete" }, "Capture into tasks requires a complete task body: Incomplete"],
  [{ ok: false, target: "inbox", reason: "write_failed", message: "Unavailable" }, "Capture into inbox failed: Unavailable"],
  [{ ok: false, reason: "ambiguous", suggestions: ["knowledge", "inbox"] }, "Capture target ambiguous. Suggestions: knowledge, inbox. Re-run with one of: /capture-to-knowledge, /capture-to-inbox."],
])("renders the domain outcome %j", async (result, expected) => {
  expect(await captureCommandReply({ capture: async () => result }, "body")).toBe(expected);
});

it("propagates transport errors to channel error handling", async () => {
  const error = new Error("scope unavailable");
  await expect(captureCommandReply({ capture: async () => { throw error; } }, "body")).rejects.toBe(error);
});
