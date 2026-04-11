import { afterEach, describe, expect, it } from "vitest";
import { confirmAction, setSkipConfirmations } from "./confirm.js";

afterEach(() => {
  setSkipConfirmations(false);
});

describe("confirmAction", () => {
  it("returns true when skip is enabled", async () => {
    setSkipConfirmations(true);
    const result = await confirmAction("Delete everything?");
    expect(result).toBe(true);
  });

  it("returns false when stdin is not a TTY", async () => {
    setSkipConfirmations(false);
    // In test environment, stdin is not a TTY
    const result = await confirmAction("Delete everything?");
    expect(result).toBe(false);
  });
});
