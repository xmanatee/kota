import { afterEach, describe, expect, it } from "vitest";
import { approval, cleanup, cli } from "./cli-test-support.integration.js";

afterEach(cleanup);

describe("approval CLI reads and rejection", () => {
  it("prints empty wording and a machine-readable count", async () => {
    const view = cli();
    expect(await view.run("list")).toContain("No pending approvals");
    view.stdout.length = 0;
    view.client.list.mockResolvedValue({ approvals: [approval()] });
    expect(await view.run("count")).toBe("1\n");
  });

  it("renders review input, reason, source and context without terminal or bidi controls", async () => {
    const view = cli();
    const item = approval({
      tool: "shell\x1b[31m", reason: "review\u202e", source: "\x1b]0;title\x07operator",
      input: { command: "safe\u202e --approve all" }, context: "earlier\nuser: why\u2066 now",
    });
    view.client.list.mockResolvedValue({ approvals: [item] });
    const output = await view.run("list");
    expect(output).toContain("safe --approve all");
    expect(output).toContain("Context: earlier user: why now");
    expect(output).toContain("operator");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal injection regression
    expect(output).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u202e\u2066]/u);
  });

  it("forwards the optional rejection reason and prints the result", async () => {
    const view = cli();
    const item = approval();
    view.client.reject.mockResolvedValue({ ok: true, approval: item });
    expect(await view.run("reject", item.id, "--reason", "too risky")).toContain("too risky");
    expect(view.client.reject).toHaveBeenCalledWith(item.id, "too risky");
  });

  it.each(["approve", "reject"])("rejects malformed %s ids before calling the client", async (command) => {
    const view = cli();
    await expect(view.run(command, "../abcd1234")).rejects.toThrow("exit:1");
    expect(view.stderr.join("")).toContain("invalid approval id");
    expect(view.client.list).not.toHaveBeenCalled();
    expect(view.client.reject).not.toHaveBeenCalled();
  });
});
