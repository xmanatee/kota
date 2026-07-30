import { describe, expect, it } from "vitest";
import { createApprovalReviewDescriptor } from "./approval-review-descriptor.js";

const approval = {
	id: "approval-a",
	tool: "shell",
	scopeId: "scope-a",
	risk: "dangerous" as const,
	reason: "production deployment",
};

describe("approval review descriptor argv redaction", () => {
	it("redacts curl credentials passed after separately-tokenized short flags", () => {
		const descriptor = createApprovalReviewDescriptor(approval, {
			command: "curl",
			args: [
				"-u",
				"admin:origin-secret",
				"-U",
				"proxy:proxy-secret",
				"-uattached:attached-secret",
				"-U=proxy:equals-secret",
				"https://example.test/private",
			],
		});

		expect(descriptor.input).toEqual({
			command: "curl",
			args: [
				"-u",
				"admin:[redacted]",
				"-U",
				"proxy:[redacted]",
				"-uattached:[redacted]",
				"-U=proxy:[redacted]",
				"https://example.test/private",
			],
		});
		expect(JSON.stringify(descriptor)).not.toMatch(
			/origin-secret|proxy-secret|attached-secret|equals-secret/,
		);
	});

	it("redacts separated and attached curl short-flag credentials in command text", () => {
		const descriptor = createApprovalReviewDescriptor(approval, {
			command: "curl -U proxy:one-secret https://example.test -uadmin:two-secret",
		});

		expect(descriptor.input).toEqual({
			command: "curl -U proxy:[redacted] https://example.test -uadmin:[redacted]",
		});
		expect(JSON.stringify(descriptor)).not.toMatch(/one-secret|two-secret/);
	});

	it("preserves the same short flag for commands where it is not a credential option", () => {
		const python = createApprovalReviewDescriptor(approval, {
			command: "python",
			args: ["-u", "/srv/deploy.py"],
		});
		const mysql = createApprovalReviewDescriptor(approval, {
			command: "mysql",
			args: ["-P3306", "-p", "reporting"],
		});

		expect(python.input).toEqual({
			command: "python",
			args: ["-u", "/srv/deploy.py"],
		});
		expect(mysql.input).toEqual({
			command: "mysql",
			args: ["-P3306", "-p", "reporting"],
		});
	});

	it("redacts command-specific short password flags without hiding later operations", () => {
		const sshpass = createApprovalReviewDescriptor(approval, {
			command: "sshpass",
			args: ["-p", "hunter2", "ssh", "deploy@example.test", "rm", "/srv/old"],
		});
		const mysql = createApprovalReviewDescriptor(approval, {
			command: "mysql",
			args: ["-psupersecret", "--execute", "DROP DATABASE old_app"],
		});

		expect(sshpass.input).toEqual({
			command: "sshpass",
			args: ["-p", "[redacted]", "ssh", "deploy@example.test", "rm", "/srv/old"],
		});
		expect(mysql.input).toEqual({
			command: "mysql",
			args: ["-p[redacted]", "--execute", "DROP DATABASE old_app"],
		});
		expect(JSON.stringify({ sshpass, mysql })).not.toMatch(/hunter2|supersecret/);
	});

	it("recognizes conventional executable and argv process shapes", () => {
		const executableArgs = createApprovalReviewDescriptor(approval, {
			executable: "sshpass",
			args: ["-p", "hunter2", "ssh", "deploy@example.test", "rm", "/srv/app"],
		});
		const programArgv = createApprovalReviewDescriptor(approval, {
			program: "mysql",
			argv: ["-psupersecret", "--execute", "DROP DATABASE old_app"],
		});

		expect(executableArgs.input).toEqual({
			executable: "sshpass",
			args: ["-p", "[redacted]", "ssh", "deploy@example.test", "rm", "/srv/app"],
		});
		expect(programArgv.input).toEqual({
			program: "mysql",
			argv: ["-p[redacted]", "--execute", "DROP DATABASE old_app"],
		});
		expect(JSON.stringify({ executableArgs, programArgv })).not.toMatch(
			/hunter2|supersecret/,
		);
	});

	it("recognizes the conventional cmd process shape", () => {
		const descriptor = createApprovalReviewDescriptor(approval, {
			cmd: "sshpass",
			args: ["-p", "raw-secret", "ssh", "deploy@example.test", "rm", "/srv/app"],
		});

		expect(descriptor.input).toEqual({
			cmd: "sshpass",
			args: ["-p", "[redacted]", "ssh", "deploy@example.test", "rm", "/srv/app"],
		});
		expect(JSON.stringify(descriptor)).not.toContain("raw-secret");
	});

	it("redacts command-specific short password flags in shell text", () => {
		const descriptor = createApprovalReviewDescriptor(approval, {
			command: "sshpass -p 'hunt;er2' ssh deploy@example.test rm /srv/old && mysql -P3306 -psupersecret --execute 'DROP DATABASE old_app'",
		});

		expect(descriptor.input).toEqual({
			command: "sshpass -p '[redacted]' ssh deploy@example.test rm /srv/old && mysql -P3306 -p[redacted] --execute 'DROP DATABASE old_app'",
		});
		expect(JSON.stringify(descriptor)).not.toMatch(/hunt;er2|supersecret/);
	});

	it("redacts the Redis and Valkey --pass alias in shell text and argv", () => {
		const shellText = createApprovalReviewDescriptor(approval, {
			command: "redis-cli --pass raw-redis-secret FLUSHALL",
		});
		const structuredArgv = createApprovalReviewDescriptor(approval, {
			executable: "valkey-cli",
			argv: ["--pass", "raw-valkey-secret", "FLUSHALL"],
		});

		expect(shellText.input).toEqual({
			command: "redis-cli --pass [redacted] FLUSHALL",
		});
		expect(structuredArgv.input).toEqual({
			executable: "valkey-cli",
			argv: ["--pass", "[redacted]", "FLUSHALL"],
		});
		expect(JSON.stringify({ shellText, structuredArgv })).not.toMatch(
			/raw-redis-secret|raw-valkey-secret/,
		);
	});
});
