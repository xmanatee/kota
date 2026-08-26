import { describe, expect, it } from "vitest";
import { decodeIssueDisposition } from "./issue-disposition.js";

const base = {
  rationale: "Current evidence does not justify new implementation work.",
  taskTitle: "",
  taskSummary: "",
  taskPriority: "p2",
  taskArea: "autonomy",
  taskClass: "Meta",
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
});
