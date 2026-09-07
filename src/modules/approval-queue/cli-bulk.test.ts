import { afterEach, describe, expect, it, vi } from "vitest";
import { approval, cleanup, cli } from "./cli-test-support.integration.js";

const confirmation = vi.hoisted(() => vi.fn<(message: string) => Promise<boolean>>());
vi.mock("./cli-support.js", async (original) => ({
  ...await original<typeof import("./cli-support.js")>(), promptConfirm: confirmation,
}));
afterEach(cleanup);

describe("approval CLI batches", () => {
  it.each(["approve-all", "reject-all"])("requires confirmation for %s unless --yes is supplied", async (command) => {
    const view = cli();
    view.client.list.mockResolvedValue({ approvals: [approval()] });
    confirmation.mockResolvedValue(false);
    expect(await view.run(command)).toContain("Aborted.");
    expect(view.client.approve).not.toHaveBeenCalled();
    expect(view.client.reject).not.toHaveBeenCalled();
  });

  it("filters the reviewed batch, forwards notes, and reports partial failure with a nonzero exit", async () => {
    const view = cli();
    const good = approval();
    const bad = approval({ id: "abcd1234" });
    const safe = approval({ id: "aaaaaaaa", risk: "safe" });
    view.client.list.mockResolvedValue({ approvals: [good, bad, safe] });
    view.client.approve.mockResolvedValueOnce({ ok: true, approval: good, resolution: { kind: "workflow_gate_approved" } })
      .mockResolvedValueOnce({ ok: true, approval: bad,
        resolution: { kind: "tool_execution", execution: { status: "failed", output: { redacted: true, reason: "tool-io" } } },
      });
    await expect(view.run("approve-all", "--yes", "--risk", "dangerous", "--note", "batch")).rejects.toThrow("exit:1");
    expect(view.client.approve.mock.calls.map(([id, , note]) => [id, note])).toEqual([[good.id, "batch"], [bad.id, "batch"]]);
    expect(view.stdout.join("")).toContain("Done: 1 approved, 1 failed");
    expect(view.stderr.join("")).toContain("Tool execution failed in daemon");
  });

  it("forwards the rejection reason to the selected items and reports skipped races", async () => {
    const view = cli();
    const item = approval();
    const raced = approval({ id: "abcd1234" });
    view.client.list.mockResolvedValue({ approvals: [item, raced, approval({ id: "aaaaaaaa", risk: "safe" })] });
    view.client.reject.mockResolvedValueOnce({ ok: true, approval: item }).mockResolvedValueOnce({ ok: false, reason: "not_found" });
    const output = await view.run("reject-all", "--yes", "--risk", "dangerous", "--reason", "scope changed");
    expect(view.client.reject.mock.calls).toEqual([[item.id, "scope changed"], [raced.id, "scope changed"]]);
    expect(output).toContain("Done: 1 rejected");
    expect(output).toContain("no longer pending");
  });

  it("prints the selected risk when a batch is empty", async () => {
    const view = cli();
    expect(await view.run("approve-all", "--yes", "--risk", "dangerous")).toContain('No pending approvals with risk level "dangerous"');
    expect(view.client.approve).not.toHaveBeenCalled();
  });
});
