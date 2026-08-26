import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertIsolatedTrialWorkspace,
	copyScopeToTrialWorkspace,
} from "./trial-files.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function initializeRepository(workspaceRoot: string): void {
	execFileSync("git", ["init", "--quiet", "--initial-branch=main"], {
		cwd: workspaceRoot,
	});
	execFileSync("git", ["config", "user.email", "trial@test.local"], {
		cwd: workspaceRoot,
	});
	execFileSync("git", ["config", "user.name", "Trial Test"], {
		cwd: workspaceRoot,
	});
	execFileSync("git", ["commit", "--allow-empty", "--message", "initial", "--quiet"], {
		cwd: workspaceRoot,
	});
}

describe("trial project isolation proof", () => {
	it("accepts only a copied temp-root repository distinct from the source checkout", () => {
		const sourceScopeRoot = mkdtempSync(join(tmpdir(), "kota-trial-source-"));
		roots.push(sourceScopeRoot);
		mkdirSync(join(sourceScopeRoot, "data"), { recursive: true });
		writeFileSync(join(sourceScopeRoot, "data", "seed.txt"), "seed\n");

		const trialWorkspaceRoot = copyScopeToTrialWorkspace(sourceScopeRoot, "attempt-1");
		roots.push(join(trialWorkspaceRoot, ".."));
		initializeRepository(trialWorkspaceRoot);

		expect(() =>
			assertIsolatedTrialWorkspace(sourceScopeRoot, trialWorkspaceRoot)
		).not.toThrow();
		expect(() =>
			assertIsolatedTrialWorkspace(sourceScopeRoot, sourceScopeRoot)
		).toThrow(/isolated trial root proof/i);
	});
});
