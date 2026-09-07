import { describe, expect, it } from "vitest";
import { decodeIssueDisposition } from "./issue-disposition.js";

const base = {
  recoveryAction: "",
  rationale: "Current evidence does not justify new implementation work.",
  taskTitle: "",
  taskSummary: "",
  taskPriority: "p2",
  taskHowWeWillKnow: "",
  ownerQuestion: "",
  ownerReason: "",
  proposedAnswers: [],
} as const;

describe("issue disposition contract", () => {
  it.each(["observe", "accept", "no-action"] as const)(
    "accepts the %s no-work outcome",
    (action) => {
      expect(decodeIssueDisposition({ ...base, action })).toMatchObject({
        action,
      });
    },
  );

  it("requires a durable issue identity for a duplicate disposition", () => {
    expect(() => decodeIssueDisposition({ ...base, action: "duplicate" })).toThrow(
      /duplicateOfIssueKey/,
    );
    expect(
      decodeIssueDisposition({
        ...base,
        action: "duplicate",
        duplicateOfIssueKey: "autonomy-issue-existing",
      }),
    ).toMatchObject({
      action: "duplicate",
      duplicateOfIssueKey: "autonomy-issue-existing",
    });
  });

  it("admits only the allowlisted deterministic recovery action", () => {
    expect(
      decodeIssueDisposition({
        ...base,
        action: "recover",
        recoveryAction: "doctor.fix",
      }),
    ).toMatchObject({ action: "recover", recoveryAction: "doctor.fix" });
    expect(() =>
      decodeIssueDisposition({ ...base, action: "recover" })
    ).toThrow(/recoveryAction/);
  });
});
