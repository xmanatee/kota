import { describe, expect, it } from "vitest";
import { getGlobalConfigPath } from "#core/config/config.js";
import { runShell } from "./shell.js";

describe("shell scope-authority boundary", () => {
  it("denies access to the machine-owned operator token", async () => {
    const result = await runShell(
      {
        command: "cat ~/.kota/scope-authority-token.json",
        stream_output: false,
      },
      { authorityConfigPath: getGlobalConfigPath() },
    );
    expect(result.is_error).toBe(true);
  });
});
