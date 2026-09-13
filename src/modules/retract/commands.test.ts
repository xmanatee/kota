import { expect, it, vi } from "vitest";
import type { RetractClient, RetractResult } from "./client.js";
import { retractCommandReply } from "./commands.js";

it("rejects empty identifiers with target-specific usage before retraction", async () => {
  const retract = vi.fn<RetractClient["retract"]>();
  for (const [target, argument] of [["memory", "id"], ["knowledge", "slug"], ["tasks", "id"], ["inbox", "path"]] as const) {
    expect(await retractCommandReply({ retract }, target, " \n\t")).toBe(`Usage: /retract-${target} <${argument}>`);
  }
  expect(retract).not.toHaveBeenCalled();
});

it("forwards each explicit target and the exact identifier without interpreting paths", async () => {
  const retract = vi.fn<RetractClient["retract"]>(async request => ({ ...request, ok: false, reason: "not_found" }));
  for (const target of ["memory", "knowledge", "tasks", "inbox"] as const) {
    const identifier = " data/inbox/Case-Sensitive note.md ";
    await retractCommandReply({ retract }, target, identifier);
    expect(retract).toHaveBeenLastCalledWith({ target, identifier });
  }
});

it.each<[RetractResult, string]>([
  [{ ok: true, target: "tasks", identifier: "task-fix", id: "task-fix", previousPath: "data/tasks/task-fix.md", path: "data/tasks/archive/task-fix.md", fromState: "open", toState: "dropped" }, "Retracted: tasks  task-fix  data/tasks/task-fix.md -> data/tasks/archive/task-fix.md (dropped)"],
  [{ ok: false, target: "tasks", identifier: "bad/id", reason: "invalid_id" }, 'Retract tasks: invalid identifier "bad/id".'],
  [{ ok: false, target: "memory", identifier: "m1", reason: "not_found" }, 'Retract memory: no record with identifier "m1".'],
  [{ ok: false, target: "inbox", identifier: "note.md", reason: "retract_failed", message: "Unavailable" }, "Retract from inbox failed: Unavailable"],
])("renders the domain outcome %j", async (result, expected) => {
  expect(await retractCommandReply({ retract: async () => result }, result.target, result.identifier)).toBe(expected);
});

it("propagates transport errors to channel error handling", async () => {
  const error = new Error("scope unavailable");
  await expect(retractCommandReply({ retract: async () => { throw error; } }, "memory", "m1")).rejects.toBe(error);
});
