import { describe, expect, it } from "vitest";
import { createApprovalReviewDescriptor } from "./approval-review-descriptor.js";

const approval = {
	id: "approval-a",
	kind: "tool_call" as const,
	tool: "shell",
	scopeId: "scope-a",
	risk: "dangerous" as const,
	reason: "production deployment",
};

describe("approval review descriptors", () => {
	it("preserves the operation while selectively redacting credentials", () => {
		const descriptor = createApprovalReviewDescriptor(approval, {
			command: "curl https://example.test/deploy?token=raw-query-token --client-secret raw-cli-secret --password 'two words' --data secret=raw-body-token",
			cwd: "/srv/project",
			args: ["deploy", "--notify", "owner@example.test", "--force"],
			contactEmail: "owner@example.test",
			authorization: "Bearer raw-auth-token",
			privateKey: "raw-private-key",
			passphrase: "raw-passphrase",
			accessKeyId: "raw-access-key-id",
			env: {
				OPENAI_API_KEY: "raw-api-key",
				DEPLOY_ENV: "production",
			},
			headers: [
				{ name: "Authorization", value: "Bearer raw-header-token" },
				{ name: "X-Operation", value: "replace" },
				{ key: "password", Value: "raw-case-insensitive-token" },
			],
		}, "user: deploy to owner@example.test with token=raw-context-token");

		expect(descriptor).toEqual({
			status: "available",
			input: {
				command: "curl https://example.test/deploy?token=[redacted] --client-secret [redacted] --password [redacted] --data secret=[redacted]",
				cwd: "/srv/project",
				args: ["deploy", "--notify", "owner@example.test", "--force"],
				contactEmail: "owner@example.test",
				authorization: "[redacted]",
				privateKey: "[redacted]",
				passphrase: "[redacted]",
				accessKeyId: "[redacted]",
				env: {
					OPENAI_API_KEY: "[redacted]",
					DEPLOY_ENV: "production",
				},
				headers: [
					{ name: "Authorization", value: "[redacted]" },
					{ name: "X-Operation", value: "replace" },
					{ key: "password", Value: "[redacted]" },
				],
			},
			context: "user: deploy to owner@example.test with token=[redacted]",
			digest: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		expect(JSON.stringify(descriptor)).not.toContain("raw-");
	});

	it("changes the digest when any displayed operation field changes", () => {
		const first = createApprovalReviewDescriptor(approval, {
			command: "deploy",
			path: "/srv/one",
			accessToken: "first-secret",
		});
		const changedCredential = createApprovalReviewDescriptor(approval, {
			command: "deploy",
			path: "/srv/one",
			accessToken: "second-secret",
		});
		const changedPath = createApprovalReviewDescriptor(approval, {
			command: "deploy",
			path: "/srv/two",
			accessToken: "first-secret",
		});
		const changedContext = createApprovalReviewDescriptor(approval, {
			command: "deploy",
			path: "/srv/one",
			accessToken: "first-secret",
		}, "user: deploy the canary");
		const originalContext = createApprovalReviewDescriptor(approval, {
			command: "deploy",
			path: "/srv/one",
			accessToken: "first-secret",
		}, "user: deploy production");

		expect(changedCredential.digest).toBe(first.digest);
		expect(changedPath.digest).not.toBe(first.digest);
		expect(changedContext.digest).not.toBe(originalContext.digest);
	});

	it("preserves resource names while redacting URI and explicit credential values", () => {
		const descriptor = createApprovalReviewDescriptor(approval, {
			command: "kubectl delete secret production && psql postgresql://admin:raw-password@example.test/db",
			fallback: "https://raw-user-token@example.test/private",
		});

		expect(descriptor.input).toEqual({
			command: "kubectl delete secret production && psql postgresql://admin:[redacted]@example.test/db",
			fallback: "https://[redacted]@example.test/private",
		});
		expect(JSON.stringify(descriptor)).not.toContain("raw-password");
		expect(JSON.stringify(descriptor)).not.toContain("raw-user-token");
	});

	it("redacts environment, access-key, basic-auth, and user-password command values", () => {
		const descriptor = createApprovalReviewDescriptor(approval, {
			command: [
				"OPENAI_API_KEY=raw-api",
				"AWS_ACCESS_KEY_ID=raw-access",
				"AWS_SECRET_ACCESS_KEY=raw-secret",
				"PASSWORD_FILE=/run/secrets/raw-password-file",
				"curl --user admin:raw-password",
				"-H 'Authorization: Basic YWRtaW46cmF3LWJhc2lj'",
			].join(" "),
		});

		expect(descriptor.input).toEqual({
			command: [
				"OPENAI_API_KEY=[redacted]",
				"AWS_ACCESS_KEY_ID=[redacted]",
				"AWS_SECRET_ACCESS_KEY=[redacted]",
				"PASSWORD_FILE=[redacted]",
				"curl --user admin:[redacted]",
				"-H 'Authorization: [redacted]'",
			].join(" "),
		});
		for (const credential of [
			"raw-api",
			"raw-access",
			"raw-secret",
			"raw-password-file",
			"raw-password",
			"YWRtaW46cmF3LWJhc2lj",
		]) {
			expect(JSON.stringify(descriptor)).not.toContain(credential);
		}
	});

	it("redacts non-Basic authorization schemes without exposing their credential", () => {
		const descriptor = createApprovalReviewDescriptor(approval, {
			command: "curl -H 'Authorization: token raw-github-token' https://api.github.test/repos/example",
		});

		expect(descriptor.input).toEqual({
			command: "curl -H 'Authorization: [redacted]' https://api.github.test/repos/example",
		});
		expect(JSON.stringify(descriptor)).not.toContain("raw-github-token");
	});

	it("redacts complete multi-part authorization values in input and context", () => {
		const descriptor = createApprovalReviewDescriptor(
			approval,
			{
				command: [
					"curl -H 'Authorization: AWS4-HMAC-SHA256 Credential=raw-access/20260729/eu-west-2/service/aws4_request, SignedHeaders=content-type;host;x-date, Signature=raw-signature' https://api.example.test/deploy",
					`curl -H 'Authorization: Digest username="raw-user", realm="raw-realm", nonce="raw-nonce", uri="/private", response="raw-response"' https://api.example.test/private`,
				].join(" && "),
			},
			[
				"assistant: the deployment is ready",
				"tool: Authorization: AWS4-HMAC-SHA256 Credential=raw-context-access, SignedHeaders=host;x-date, Signature=raw-context-signature",
				`tool: Authorization: Digest username="raw-context-user", nonce="raw-context-nonce", uri="/admin", response="raw-context-response"`,
				"user: continue the deployment",
			].join("\n"),
		);

		expect(descriptor.input).toEqual({
			command: [
				"curl -H 'Authorization: [redacted]' https://api.example.test/deploy",
				"curl -H 'Authorization: [redacted]' https://api.example.test/private",
			].join(" && "),
		});
		expect(descriptor.context).toBe([
			"assistant: the deployment is ready",
			"tool: Authorization: [redacted]",
			"tool: Authorization: [redacted]",
			"user: continue the deployment",
		].join("\n"));
		for (const credential of [
			"raw-access",
			"raw-signature",
			"raw-user",
			"raw-realm",
			"raw-nonce",
			"raw-response",
			"raw-context-access",
			"raw-context-signature",
			"raw-context-user",
			"raw-context-nonce",
			"raw-context-response",
		]) {
			expect(JSON.stringify(descriptor)).not.toContain(credential);
		}
	});

	it("redacts credential values passed separately from argument flags", () => {
		const descriptor = createApprovalReviewDescriptor(approval, {
			command: "deploy",
			args: [
				"--target",
				"production",
				"--password",
				"raw-password",
				"--authorization",
				'Digest username="raw-user", response="raw-response"',
				"--notify",
				"owner@example.test",
			],
		});

		expect(descriptor.input).toEqual({
			command: "deploy",
			args: [
				"--target",
				"production",
				"--password",
				"[redacted]",
				"--authorization",
				"[redacted]",
				"--notify",
				"owner@example.test",
			],
		});
		expect(JSON.stringify(descriptor)).not.toMatch(
			/raw-password|raw-user|raw-response/,
		);
	});

	it("redacts credential values in pair-encoded arrays", () => {
		const descriptor = createApprovalReviewDescriptor(approval, {
			headers: [
				["Authorization", "token ghp_REAL_SECRET"],
				["X-API-Key", "REAL_API_SECRET"],
				["X-Operation", "replace"],
			],
		});

		expect(descriptor.input).toEqual({
			headers: [
				["Authorization", "[redacted]"],
				["X-API-Key", "[redacted]"],
				["X-Operation", "replace"],
			],
		});
		expect(JSON.stringify(descriptor)).not.toMatch(
			/ghp_REAL_SECRET|REAL_API_SECRET/,
		);
	});

	it("preserves non-credential short flags and redacts the complete embedded credential vocabulary", () => {
		const descriptor = createApprovalReviewDescriptor(approval, {
			command: [
				"python -u /srv/deploy.py --target production",
				"curl -u admin:raw-curl-password https://example.test/deploy",
				`node deploy.js --payload '{"client_secret":"raw-client","access_token":"raw-access","secret_key":"raw-secret-key"}'`,
			].join(" && "),
		});

		expect(descriptor.input).toEqual({
			command: [
				"python -u /srv/deploy.py --target production",
				"curl -u admin:[redacted] https://example.test/deploy",
				`node deploy.js --payload '{"client_secret":"[redacted]","access_token":"[redacted]","secret_key":"[redacted]"}'`,
			].join(" && "),
		});
		for (const credential of ["raw-curl-password", "raw-client", "raw-access", "raw-secret-key"]) {
			expect(JSON.stringify(descriptor)).not.toContain(credential);
		}
	});

	it("binds the receipt to the approval identity and reviewed policy fields", () => {
		const input = { command: "deploy", path: "/srv/app" };
		const original = createApprovalReviewDescriptor(approval, input);

		for (const changed of [
			{ ...approval, id: "approval-b" },
			{ ...approval, kind: "workflow_gate" as const },
			{ ...approval, tool: "filesystem_write" },
			{ ...approval, scopeId: "scope-b" },
			{ ...approval, risk: "moderate" as const },
			{ ...approval, reason: "staging deployment" },
		]) {
			expect(createApprovalReviewDescriptor(changed, input).digest).not.toBe(
				original.digest,
			);
		}
	});

});
