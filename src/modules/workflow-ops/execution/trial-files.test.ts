import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertIsolatedTrialWorkspace,
	copyScopeToTrialWorkspace,
	snapshotTrialFiles,
} from "./trial-files.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function initializeRepository(scopeRoot: string): void {
	execFileSync("git", ["init", "--quiet", "--initial-branch=main"], {
		cwd: scopeRoot,
	});
	execFileSync("git", ["config", "user.email", "trial@test.local"], {
		cwd: scopeRoot,
	});
	execFileSync("git", ["config", "user.name", "Trial Test"], {
		cwd: scopeRoot,
	});
	execFileSync("git", ["commit", "--allow-empty", "--message", "initial", "--quiet"], {
		cwd: scopeRoot,
	});
}

describe("trial project isolation proof", () => {
	it("accepts only a copied temp-root repository distinct from the source checkout", () => {
		const sourceProjectDir = mkdtempSync(join(tmpdir(), "kota-trial-source-"));
		roots.push(sourceProjectDir);
		mkdirSync(join(sourceProjectDir, "data"), { recursive: true });
		writeFileSync(join(sourceProjectDir, "data", "seed.txt"), "seed\n");

		const trialProjectDir = copyScopeToTrialWorkspace(sourceProjectDir, "attempt-1");
		roots.push(join(trialProjectDir, ".."));
		initializeRepository(trialProjectDir);

		expect(() =>
			assertIsolatedTrialWorkspace(sourceProjectDir, trialProjectDir)
		).not.toThrow();
		expect(() =>
			assertIsolatedTrialWorkspace(sourceProjectDir, sourceProjectDir)
		).toThrow(/isolated trial root proof/i);
	});

	it("copies declarative project inputs without operational runtime state", () => {
		const sourceProjectDir = mkdtempSync(join(tmpdir(), "kota-trial-state-source-"));
		roots.push(sourceProjectDir);
		writeFileSync(join(sourceProjectDir, "source.txt"), "source\n");
		mkdirSync(join(sourceProjectDir, ".kota", "modules", "fixture"), { recursive: true });
		writeFileSync(join(sourceProjectDir, ".kota", "modules", "fixture", "index.mjs"), "export default {};\n");
		writeFileSync(join(sourceProjectDir, ".kota", "config.json"), "{}\n");
		mkdirSync(join(sourceProjectDir, ".kota", "runtime", "worktrees"), { recursive: true });
		writeFileSync(join(sourceProjectDir, ".kota", "runtime", "worktrees", "owned"), "state\n");
		mkdirSync(join(sourceProjectDir, ".kota", "runs", "run-1"), { recursive: true });
		writeFileSync(join(sourceProjectDir, ".kota", "runs", "run-1", "run.json"), "{}\n");

		const trialProjectDir = copyScopeToTrialWorkspace(sourceProjectDir, "state-isolation");
		roots.push(join(trialProjectDir, ".."));
		expect(existsSync(join(trialProjectDir, ".kota", "modules", "fixture", "index.mjs"))).toBe(true);
		expect(existsSync(join(trialProjectDir, ".kota", "config.json"))).toBe(true);
		expect(existsSync(join(trialProjectDir, ".kota", "runtime"))).toBe(false);
		expect(existsSync(join(trialProjectDir, ".kota", "runs"))).toBe(false);
	});

	it("rejects copied symlinks before they can escape the trial root", () => {
		const sourceProjectDir = mkdtempSync(join(tmpdir(), "kota-trial-symlink-source-"));
		roots.push(sourceProjectDir);
		const outsidePath = join(sourceProjectDir, "..", `${sourceProjectDir.split("/").pop()}-outside.txt`);
		roots.push(outsidePath);
		writeFileSync(outsidePath, "outside\n");
		symlinkSync(outsidePath, join(sourceProjectDir, "escape.txt"));

		expect(() => copyScopeToTrialWorkspace(sourceProjectDir, "symlink-escape"))
			.toThrow(/symbolic link/i);
	});

	it("rejects symlinks while snapshotting trial output", () => {
		const trialProjectDir = mkdtempSync(join(tmpdir(), "kota-trial-snapshot-symlink-"));
		roots.push(trialProjectDir);
		writeFileSync(join(trialProjectDir, "target.txt"), "target\n");
		symlinkSync("target.txt", join(trialProjectDir, "linked.txt"));

		expect(() => snapshotTrialFiles(trialProjectDir)).toThrow(/symbolic link/i);
	});
});
