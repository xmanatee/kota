import { describe, expect, it } from "vitest";
import { which } from "./runtime-check.js";

describe("which", () => {
  it("returns true for a command that exists", () => {
    // node is guaranteed to exist since we're running in it
    expect(which("node")).toBe(true);
  });

  it("returns false for a non-existent command", () => {
    expect(which("__nonexistent_command_xyz_42__")).toBe(false);
  });
});
