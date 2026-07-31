import { describe, expect, it } from "vitest";
import { createApprovalReviewDescriptor } from "./approval-review-descriptor.js";

const approval = {
	id: "approval-context",
	kind: "tool_call" as const,
	tool: "shell",
	scopeId: "scope-a",
	risk: "dangerous" as const,
	reason: "production deployment",
};

describe("approval review descriptor context redaction", () => {
	it("redacts a complete unquoted multi-word passphrase", () => {
		const descriptor = createApprovalReviewDescriptor(
			approval,
			{ command: "deploy", path: "/srv/app" },
			[
				"assistant: deployment path is /srv/app",
				"user: the passphrase is correct horse battery staple",
				"assistant: deploy with --target production",
			].join("\n"),
		);

		expect(descriptor.context).toBe([
			"assistant: deployment path is /srv/app",
			"user: the passphrase is [redacted]",
			"assistant: deploy with --target production",
		].join("\n"));
		expect(JSON.stringify(descriptor)).not.toMatch(/correct|horse|battery|staple/);
	});

	it("preserves context after an explicit credential clause boundary", () => {
		const descriptor = createApprovalReviewDescriptor(
			approval,
			{ command: "deploy" },
			"user: the passphrase is four secret words, then deploy /srv/app.",
		);

		expect(descriptor.context).toBe(
			"user: the passphrase is [redacted], then deploy /srv/app.",
		);
	});

	it("preserves operations after unquoted authorization values", () => {
		const commaBoundary = createApprovalReviewDescriptor(
			approval,
			{ command: "deploy /srv/app" },
			"User: Authorization: Bearer rawtoken, then delete /srv/app. Confirm the target.",
		);
		const sentenceBoundary = createApprovalReviewDescriptor(
			approval,
			{ command: "rotate /srv/key" },
			"User: Authorization: Bearer other-token. Then rotate /srv/key.",
		);

		expect(commaBoundary.context).toBe(
			"User: Authorization: [redacted], then delete /srv/app. Confirm the target.",
		);
		expect(sentenceBoundary.context).toBe(
			"User: Authorization: [redacted]. Then rotate /srv/key.",
		);
		expect(JSON.stringify({ commaBoundary, sentenceBoundary })).not.toMatch(
			/rawtoken|other-token/,
		);
	});

	it("preserves operations after natural-language credential clauses", () => {
		const proseCredential = createApprovalReviewDescriptor(
			approval,
			{ command: "delete /srv/app" },
			"user: password is hunter2 then delete /srv/app",
		);
		const authorizationCredential = createApprovalReviewDescriptor(
			approval,
			{ command: "delete /srv/app" },
			"user: authorization: token ghp_secret then delete /srv/app",
		);

		expect(proseCredential.context).toBe(
			"user: password is [redacted] then delete /srv/app",
		);
		expect(authorizationCredential.context).toBe(
			"user: authorization: [redacted] then delete /srv/app",
		);
		expect(JSON.stringify({ proseCredential, authorizationCredential })).not.toMatch(
			/hunter2|ghp_secret/,
		);
	});

	it("preserves operations after plain conjunctions without exposing passphrase words", () => {
		const operationClause = createApprovalReviewDescriptor(
			approval,
			{ command: "delete /srv/app" },
			"User: password is hunter2 and delete /srv/app",
		);
		const passphraseConjunction = createApprovalReviewDescriptor(
			approval,
			{ command: "deploy /srv/app" },
			"User: passphrase is rock and roll",
		);

		expect(operationClause.context).toBe(
			"User: password is [redacted] and delete /srv/app",
		);
		expect(passphraseConjunction.context).toBe(
			"User: passphrase is [redacted]",
		);
		expect(JSON.stringify({ operationClause, passphraseConjunction })).not.toMatch(
			/hunter2|rock|roll/,
		);
	});
});
