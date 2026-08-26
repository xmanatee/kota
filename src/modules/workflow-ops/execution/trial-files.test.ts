import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertIsolatedTrialProjectRoot,
	copyProjectForTrial,
} from "./trial-files.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function initializeRepository(projectDir: string): void {
	execFileSync("git", ["init", "--quiet", "--initial-branch=main"], {
		cwd: projectDir,
	});
	execFileSync("git", ["config", "user.email", "trial@test.local"], {
		cwd: projectDir,
	});
	execFileSync("git", ["config", "user.name", "Trial Test"], {
		cwd: projectDir,
	});
	execFileSync("git", ["commit", "--allow-empty", "--message", "initial", "--quiet"], {
		cwd: projectDir,
	});
}

describe("trial project isolation proof", () => {
	it("accepts only a copied temp-root repository distinct from the source checkout", () => {
		const sourceProjectDir = mkdtempSync(join(tmpdir(), "kota-trial-source-"));
		roots.push(sourceProjectDir);
		mkdirSync(join(sourceProjectDir, "data"), { recursive: true });
		writeFileSync(join(sourceProjectDir, "data", "seed.txt"), "seed\n");

		const trialProjectDir = copyProjectForTrial(sourceProjectDir, "attempt-1");
		roots.push(join(trialProjectDir, ".."));
		initializeRepository(trialProjectDir);

		expect(() =>
			assertIsolatedTrialProjectRoot(sourceProjectDir, trialProjectDir)
		).not.toThrow();
		expect(() =>
			assertIsolatedTrialProjectRoot(sourceProjectDir, sourceProjectDir)
		).toThrow(/isolated trial root proof/i);
	});
});
