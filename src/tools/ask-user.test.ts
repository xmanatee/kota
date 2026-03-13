import { describe, it, expect, afterEach } from "vitest";
import { runAskUser, setPromptOverride } from "./ask-user.js";

afterEach(() => {
  setPromptOverride(null);
});

describe("runAskUser", () => {
  it("returns error when question is missing", async () => {
    const result = await runAskUser({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("question is required");
  });

  it("returns error for empty question", async () => {
    const result = await runAskUser({ question: "" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("question is required");
  });

  it("returns user answer via prompt override", async () => {
    setPromptOverride(async () => "yes, do it");
    const result = await runAskUser({ question: "Should I proceed?" });
    expect(result.content).toBe("yes, do it");
    expect(result.is_error).toBeUndefined();
  });

  it("passes question to the prompt function", async () => {
    let receivedQuestion = "";
    setPromptOverride(async (q) => {
      receivedQuestion = q;
      return "answer";
    });
    await runAskUser({ question: "What color?" });
    expect(receivedQuestion).toBe("What color?");
  });

  it("handles empty user response", async () => {
    setPromptOverride(async () => "");
    const result = await runAskUser({ question: "Type something" });
    expect(result.content).toContain("proceed with your best judgment");
  });

  it("handles prompt function throwing", async () => {
    setPromptOverride(async () => {
      throw new Error("No TTY");
    });
    const result = await runAskUser({ question: "Hello?" });
    expect(result.content).toContain("No interactive terminal available");
    expect(result.is_error).toBeUndefined();
  });

  it("graceful fallback message is actionable", async () => {
    setPromptOverride(async () => {
      throw new Error("No TTY");
    });
    const result = await runAskUser({ question: "Which file?" });
    expect(result.content).toContain("Proceed with your best judgment");
  });
});
