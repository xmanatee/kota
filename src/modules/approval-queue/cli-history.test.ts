import { afterEach, describe, expect, it } from "vitest";
import { approval, cleanup, cli } from "./cli-test-support.integration.js";

afterEach(cleanup);

describe("approval CLI history", () => {
  it("prints the empty history message", async () => {
    expect(await cli().run("history")).toContain("No resolved approvals");
  });

  it("applies status, duration and limit options to the displayed history", async () => {
    const view = cli();
    view.client.list.mockResolvedValue({ approvals: [
      approval({ tool: "old", status: "approved", resolvedAt: new Date(Date.now() - 7_200_000).toISOString() }),
      approval({ id: "aaaaaaaa", tool: "pending" }),
      approval({ id: "bbbbbbbb", tool: "rejected", status: "rejected", resolvedAt: new Date().toISOString() }),
      approval({ id: "cccccccc", tool: "recent", status: "approved", resolvedAt: new Date().toISOString() }),
    ] });
    const output = await view.run("history", "--status", "approved", "--since", "1h", "-n", "1");
    expect(output).toContain("recent");
    expect(output).not.toContain("old");
    expect(output).not.toContain("pending");
    expect(output).not.toContain("rejected");
    expect(output).toContain("1 resolved approval(s)");
  });

  it("sanitizes resolved notes and rejection reasons", async () => {
    const view = cli();
    view.client.list.mockResolvedValue({ approvals: [
      approval({ status: "approved", approvalNote: "operator \x1b[31m\u202enote", source: "\x1b]0;title\x07source" }),
      approval({ id: "aaaaaaaa", status: "rejected", rejectionReason: "reject \x9b32m\u2066reason" }),
    ] });
    const output = await view.run("history");
    expect(output).toContain("operator note");
    expect(output).toContain("reject reason");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal injection regression
    expect(output).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u202e\u2066]/u);
  });

  it("rejects an invalid status with exit status 1", async () => {
    const view = cli();
    await expect(view.run("history", "--status", "bogus")).rejects.toThrow("exit:1");
    expect(view.stderr.join("")).toContain("invalid --status");
  });
});
