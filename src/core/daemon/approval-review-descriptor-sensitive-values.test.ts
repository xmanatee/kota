import { describe, expect, it } from "vitest";
import { createApprovalReviewDescriptor } from "./approval-review-descriptor.js";

const approval = {
	id: "approval-sensitive-values",
	tool: "mcp__provider__deploy",
	scopeId: "scope-a",
	risk: "dangerous" as const,
	reason: "production deployment",
};

describe("approval review descriptor named credential values", () => {
	it("redacts conventional database credential environment variables", () => {
		const descriptor = createApprovalReviewDescriptor(approval, {
			command: "PGPASSWORD=postgres-shell MYSQL_PWD=mysql-shell psql -c 'DROP DATABASE prod'",
			env: {
				PGPASSWORD: "postgres-secret",
				MYSQL_PWD: "mysql-secret",
			},
		});

		expect(descriptor.input).toEqual({
			command: "PGPASSWORD=[redacted] MYSQL_PWD=[redacted] psql -c 'DROP DATABASE prod'",
			env: {
				PGPASSWORD: "[redacted]",
				MYSQL_PWD: "[redacted]",
			},
		});
		expect(JSON.stringify(descriptor)).not.toMatch(
			/postgres-secret|mysql-secret|postgres-shell|mysql-shell/,
		);
	});

	it("preserves credential-protocol destinations for operator review", () => {
		const descriptor = createApprovalReviewDescriptor(approval, {
			authorizationUrl: "https://attacker.example/oauth",
			tokenEndpoint: "https://attacker.example/token",
			operation: "connect",
			target: "prod",
		});

		expect(descriptor.input).toEqual({
			authorizationUrl: "https://attacker.example/oauth",
			tokenEndpoint: "https://attacker.example/token",
			operation: "connect",
			target: "prod",
		});
	});

	it("redacts sensitive named payloads while preserving operation metadata", () => {
		const descriptor = createApprovalReviewDescriptor(approval, {
			command: "deploy /srv/app",
			fields: [
				{
					name: "API_KEY",
					values: ["raw-list-secret"],
					defaultValue: "sk-raw-default-secret",
				},
				{
					key: "password",
					current: "raw-current-secret",
					operation: "delete",
					path: "/srv/app",
				},
				{
					name: "deploymentTarget",
					values: ["production"],
				},
			],
		});

		expect(descriptor.input).toEqual({
			command: "deploy /srv/app",
			fields: [
				{
					name: "API_KEY",
					values: "[redacted]",
					defaultValue: "[redacted]",
				},
				{
					key: "password",
					current: "[redacted]",
					operation: "delete",
					path: "/srv/app",
				},
				{
					name: "deploymentTarget",
					values: ["production"],
				},
			],
		});
		expect(JSON.stringify(descriptor)).not.toMatch(
			/raw-list-secret|sk-raw-default-secret|raw-current-secret/,
		);
	});
});
