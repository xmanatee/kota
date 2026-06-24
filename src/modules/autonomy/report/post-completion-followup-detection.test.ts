import { describe, expect, it } from "vitest";
import { classifyCorrectiveReasons } from "./post-completion-followup-detection.js";
import { taskWithText } from "./post-completion-followups.test-helpers.js";

describe("post-completion follow-up detection", () => {
  it("detects explicit CI, build, and integration-test failure wording", () => {
    for (const text of [
      "failing CI after the completed task landed",
      "the build is broken after completion",
      "failed integration tests after the merge",
      "post-merge test-suite breakage after an accepted task",
    ]) {
      expect(classifyCorrectiveReasons(taskWithText(text))).toContain(
        "ci-build-failure",
      );
    }

    expect(
      classifyCorrectiveReasons(
        taskWithText("planned test expansion adds ordinary integration tests"),
      ),
    ).not.toContain("ci-build-failure");
  });
});
