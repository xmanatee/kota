import { afterEach, describe, expect, it, vi } from "vitest";
import { approval, cleanup, cli } from "./cli-test-support.integration.js";

const confirmation = vi.hoisted(() => vi.fn<(message: string) => Promise<boolean>>());
vi.mock("./cli-support.js", async (original) => ({
  ...await original<typeof import("./cli-support.js")>(), promptConfirm: confirmation,
}));
afterEach(cleanup);

describe("approval CLI review", () => {
  it("shows the safe descriptor before confirming and forwards its digest and note", async () => {
    const view = cli();
    const item = approval({ context: "user: publish; token=raw-context-token" });
    view.client.list.mockResolvedValue({ approvals: [item] });
    confirmation.mockImplementation(async () => {
      expect(view.stdout.join("")).toContain('"command":"git push origin main"');
      expect(view.stdout.join("")).toContain("Digest:");
      expect(view.client.approve).not.toHaveBeenCalled();
      return true;
    });
    view.client.approve.mockResolvedValue({ ok: true, approval: item,
      resolution: { kind: "tool_execution", execution: { status: "succeeded", output: { redacted: true, reason: "tool-io", bytes: 2 } } },
    });
    const output = await view.run("approve", item.id, "--note", "reviewed");
    expect(item.review.status).toBe("available");
    if (item.review.status !== "available") throw new Error("fixture has no review");
    expect(view.client.approve).toHaveBeenCalledWith(item.id, item.review.digest, "reviewed");
    expect(confirmation).toHaveBeenCalledWith("Approve and execute this exact operation? [y/N] ");
    expect(output).toContain('"accessToken":"[redacted]"');
    expect(output).not.toContain("raw-token");
    expect(output).not.toContain("raw-context-token");
    expect(output).toContain("Approved and executed shell");
    expect(output).toContain("output redacted by daemon policy");
  });

  it("does not submit a declined review", async () => {
    const view = cli();
    const item = approval();
    view.client.list.mockResolvedValue({ approvals: [item] });
    confirmation.mockResolvedValue(false);
    expect(await view.run("approve", item.id)).toContain("Aborted.");
    expect(view.client.approve).not.toHaveBeenCalled();
  });

  it("labels workflow gate confirmation without promising tool execution", async () => {
    const view = cli();
    const item = approval({ kind: "workflow_gate", tool: "workflow-approval/release/gate" });
    view.client.list.mockResolvedValue({ approvals: [item] });
    confirmation.mockResolvedValue(true);
    view.client.approve.mockResolvedValue({ ok: true, approval: item, resolution: { kind: "workflow_gate_approved" } });
    expect(await view.run("approve", item.id)).toContain("Approved workflow gate");
    expect(confirmation).toHaveBeenCalledWith("Approve this exact workflow gate? [y/N] ");
  });

  it("exits nonzero and prints a recovery instruction for a changed review", async () => {
    const view = cli();
    const item = approval();
    view.client.list.mockResolvedValue({ approvals: [item] });
    confirmation.mockResolvedValue(true);
    view.client.approve.mockResolvedValue({ ok: false, reason: "review_mismatch" });
    await expect(view.run("approve", item.id)).rejects.toThrow("exit:1");
    expect(view.stderr.join("")).toContain("Refresh the queue and review the current operation");
  });

  it("reports a failed execution on stderr with exit status 1", async () => {
    const view = cli();
    const item = approval();
    view.client.list.mockResolvedValue({ approvals: [item] });
    confirmation.mockResolvedValue(true);
    view.client.approve.mockResolvedValue({ ok: true, approval: item,
      resolution: { kind: "tool_execution", execution: { status: "failed", output: { redacted: true, reason: "tool-io" } } },
    });
    await expect(view.run("approve", item.id)).rejects.toThrow("exit:1");
    expect(view.stderr.join("")).toContain("Tool execution failed in daemon");
  });
});
