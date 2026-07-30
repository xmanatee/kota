import { describe, expect, it } from "vitest";
import { detectObservabilityObligationReview } from "./observability-obligation.js";

function diffFor(
	file: string,
	addedLines: readonly string[],
	deletedLines: readonly string[] = [],
): string {
	return [
		`diff --git a/${file} b/${file}`,
		"index 0000001..0000002 100644",
		`--- a/${file}`,
		`+++ b/${file}`,
		`@@ -1,${Math.max(deletedLines.length, 1)} +1,${Math.max(addedLines.length, 1)} @@`,
		...deletedLines.map((line) => `-${line}`),
		...addedLines.map((line) => `+${line}`),
	].join("\n");
}

describe("approval descriptor observability recheck", () => {
	it("maps every file missing from commit f4017df14b96 to focused assertions", () => {
		const executionAssertion =
			"src/modules/approval-queue/approval-execution.test.ts";
		const routeAssertion =
			"src/modules/approval-queue/routes-approval-descriptor-race.test.ts";
		const citedFiles = [
			"src/modules/approval-queue/approval-execution.ts",
			"src/modules/approval-queue/route-handlers.ts",
			"src/modules/approval-queue/route-helpers.ts",
			"src/modules/approval-queue/route-registrations.ts",
		];
		const review = detectObservabilityObligationReview(
			[
				diffFor(citedFiles[0]!, [
					"throw new ApprovalExecutionDescriptorMismatchError(item);",
				]),
				diffFor(citedFiles[1]!, [
					'import { writeApproveApprovalMutation } from "./route-approval-execution.js";',
				]),
				diffFor(
					citedFiles[2]!,
					[],
					[
						"export async function writeApproveApprovalMutation() {",
						"  return approvalQueue.approveForExecution(id);",
						"}",
					],
				),
				diffFor(citedFiles[3]!, [
					'import { writeApproveApprovalMutation } from "./route-approval-execution.js";',
				]),
				diffFor(routeAssertion, [
					"expect(result.status).toBe(409);",
					'expect(result.body.reason).toBe("approval_execution_descriptor_mismatch");',
				]),
				diffFor(executionAssertion, [
					'expect(result.error).toBeInstanceOf(ApprovalExecutionDescriptorMismatchError);',
				]),
			].join("\n"),
		);

		expect(review).toMatchObject({ outcome: "ok", missingFiles: [] });
		expect(review.satisfiedFiles).toEqual(citedFiles);
		expect(review.candidates.map((candidate) => candidate.evidence[0])).toEqual([
			expect.objectContaining({ kind: "focused-test-assertion", ref: executionAssertion }),
			expect.objectContaining({ kind: "focused-test-assertion", ref: routeAssertion }),
			expect.objectContaining({ kind: "focused-test-assertion", ref: routeAssertion }),
			expect.objectContaining({ kind: "focused-test-assertion", ref: routeAssertion }),
		]);
	});
});
