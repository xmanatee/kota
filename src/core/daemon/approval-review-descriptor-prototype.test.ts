import { describe, expect, it } from "vitest";
import { createApprovalReviewDescriptor } from "./approval-review-descriptor.js";

const approval = {
	id: "approval-a",
	tool: "shell",
	scopeId: "scope-a",
	risk: "dangerous" as const,
	reason: "production deployment",
};

describe("approval review descriptor prototype-sensitive input", () => {
	it("preserves own JSON properties in the descriptor and digest", () => {
		const firstInput = JSON.parse(
			'{"command":"deploy","__proto__":{"operation":"replace","path":"/srv/one"}}',
		) as object;
		const changedInput = JSON.parse(
			'{"command":"deploy","__proto__":{"operation":"replace","path":"/srv/two"}}',
		) as object;

		const first = createApprovalReviewDescriptor(approval, firstInput);
		const changed = createApprovalReviewDescriptor(approval, changedInput);

		expect(Object.hasOwn(first.input, "__proto__")).toBe(true);
		expect(JSON.stringify(first.input)).toContain(
			'"__proto__":{"operation":"replace","path":"/srv/one"}',
		);
		expect(changed.digest).not.toBe(first.digest);
	});
});
