import { spawnSync } from "node:child_process";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalQueue } from "./approval-queue.js";
import { ApprovalRecordStorage } from "./approval-record-storage.js";
import { APPROVAL_RECORD_STORAGE_HELPER_SOURCE } from "./approval-record-storage-helper-source.js";

describe("ApprovalQueue filesystem boundary", () => {
	let root: string;
	let dir: string;
	let queue: ApprovalQueue;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "approval-filesystem-security-"));
		dir = join(root, "approvals");
		queue = new ApprovalQueue(dir);
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("creates daemon-private approval directories and records", () => {
		const item = queue.enqueue("shell", { command: "echo ok" }, "moderate", "test");

		expect(statSync(dir).mode & 0o777).toBe(0o700);
		expect(statSync(join(dir, `${item.id}.json`)).mode & 0o777).toBe(0o600);
	});

	it("rejects an approval directory reached through a symbolic link", () => {
		const realDirectory = join(root, "real-approvals");
		const linkedDirectory = join(root, "linked-approvals");
		mkdirSync(realDirectory);
		symlinkSync(realDirectory, linkedDirectory, "dir");

		expect(() => new ApprovalQueue(linkedDirectory)).toThrow(
			/approval directory must not contain symbolic links/,
		);
	});

	it("anchors storage through a canonicalized ancestor alias", () => {
		const realRoot = join(root, "real-root");
		const linkedRoot = join(root, "linked-root");
		mkdirSync(realRoot);
		symlinkSync(realRoot, linkedRoot, "dir");

		const aliasedQueue = new ApprovalQueue(join(linkedRoot, "approvals"));
		const item = aliasedQueue.enqueue("shell", { command: "echo ok" }, "moderate", "test");

		expect(
			JSON.parse(readFileSync(join(realRoot, "approvals", `${item.id}.json`), "utf8")),
		).toMatchObject({ id: item.id, status: "pending" });
	});

	it("rejects a replaced approval directory before resolving a record", () => {
		const item = queue.enqueue("shell", { command: "echo ok" }, "moderate", "test");
		const record = readFileSync(join(dir, `${item.id}.json`), "utf8");
		const parkedDirectory = join(root, "parked-approvals");
		const replacementDirectory = join(root, "replacement-approvals");
		renameSync(dir, parkedDirectory);
		mkdirSync(replacementDirectory);
		writeFileSync(join(replacementDirectory, `${item.id}.json`), record);
		symlinkSync(replacementDirectory, dir, "dir");

		expect(() => queue.approve(item.id)).toThrow(/approval directory/);
		expect(readFileSync(join(replacementDirectory, `${item.id}.json`), "utf8")).toBe(record);
	});

	it.each(["approve", "reject", "expire"] as const)(
		"refuses to %s a symbolic-link approval record without changing its target",
		(transition) => {
			const item = queue.enqueue("shell", { command: "echo ok" }, "moderate", "test");
			const recordPath = join(dir, `${item.id}.json`);
			const targetPath = join(root, `${transition}-target.json`);
			const targetContents = readFileSync(recordPath, "utf8");
			writeFileSync(targetPath, targetContents);
			unlinkSync(recordPath);
			symlinkSync(targetPath, recordPath);

			const act = () => {
				if (transition === "approve") queue.approve(item.id);
				else if (transition === "reject") queue.reject(item.id);
				else queue.expireStale(-1);
			};

			expect(act).toThrow(/approval record must not be a symbolic link/);
			expect(readFileSync(targetPath, "utf8")).toBe(targetContents);
		},
	);

	it("fails an update when the approval record identity changed after reading", () => {
		const storage = new ApprovalRecordStorage(dir);
		storage.write("deadbeef.json", "original", null);
		const snapshot = storage.read("deadbeef.json");
		expect(snapshot).not.toBeNull();
		const recordPath = join(dir, "deadbeef.json");
		unlinkSync(recordPath);
		writeFileSync(recordPath, "replacement");

		expect(() => storage.write("deadbeef.json", "updated", snapshot!.identity)).toThrow(
			/approval record changed during the transition/,
		);
		expect(readFileSync(recordPath, "utf8")).toBe("replacement");
	});

	it("fails when a symbolic link replaces the record after the transition read", () => {
		const storage = new ApprovalRecordStorage(dir);
		storage.write("deadbeef.json", "original", null);
		const snapshot = storage.read("deadbeef.json");
		expect(snapshot).not.toBeNull();
		const recordPath = join(dir, "deadbeef.json");
		const targetPath = join(root, "transition-target.json");
		writeFileSync(targetPath, "host contents");
		unlinkSync(recordPath);
		symlinkSync(targetPath, recordPath);

		expect(() => storage.write("deadbeef.json", "updated", snapshot!.identity)).toThrow(
			/approval record must not be a symbolic link/,
		);
		expect(readFileSync(targetPath, "utf8")).toBe("host contents");
	});

	it("fails closed when the record path is substituted immediately before descriptor mutation", () => {
		const storage = new ApprovalRecordStorage(dir);
		storage.write("deadbeef.json", "original", null);
		const snapshot = storage.read("deadbeef.json");
		expect(snapshot).not.toBeNull();
		const recordPath = join(dir, "deadbeef.json");
		const targetPath = join(root, "descriptor-race-target.json");
		const preloadPath = join(root, "substitute-before-truncate.cjs");
		writeFileSync(targetPath, "host contents");
		writeFileSync(
			preloadPath,
			`const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const originalFtruncateSync = fs.ftruncateSync;
let substituted = false;
fs.ftruncateSync = function ftruncateSync(fd, length) {
  if (!substituted) {
    substituted = true;
    fs.unlinkSync(process.env.KOTA_TEST_APPROVAL_RECORD);
    fs.symlinkSync(
      process.env.KOTA_TEST_APPROVAL_TARGET,
      process.env.KOTA_TEST_APPROVAL_RECORD,
    );
  }
  return originalFtruncateSync(fd, length);
};
syncBuiltinESMExports();
`,
		);
		const directoryStats = statSync(dir);
		const canonicalDirectory = realpathSync.native(dir);
		const result = spawnSync(
			process.execPath,
			["--require", preloadPath, "--input-type=module", "--eval", APPROVAL_RECORD_STORAGE_HELPER_SOURCE],
			{
				encoding: "utf8",
				env: {
					KOTA_TEST_APPROVAL_RECORD: recordPath,
					KOTA_TEST_APPROVAL_TARGET: targetPath,
				},
				input: JSON.stringify({
					operation: "write",
					directoryPath: canonicalDirectory,
					directoryIdentity: { dev: directoryStats.dev, ino: directoryStats.ino },
					filename: "deadbeef.json",
					contents: "updated",
					expectedIdentity: snapshot!.identity,
				}),
			},
		);

		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			ok: false,
			reason: "approval record changed during the transition",
		});
		expect(lstatSync(recordPath).isSymbolicLink()).toBe(true);
		expect(readFileSync(targetPath, "utf8")).toBe("host contents");
	});

	it("refuses a non-regular approval record", () => {
		mkdirSync(join(dir, "deadbeef.json"));

		expect(() => queue.list()).toThrow(/approval record must be a regular file/);
	});
});
