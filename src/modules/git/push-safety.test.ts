import { describe, expect, it } from "vitest";
import {
	protectedNonLeaseForcePushTarget,
	resolveGitToolEffect,
} from "./push-safety.js";

function configReader(
	values: Readonly<Record<string, readonly string[]>> = {},
): {
	getAll: (key: string) => Promise<readonly string[]>;
	getBoolean: (key: string) => Promise<boolean | null>;
	getRemoteGroup: (name: string) => Promise<readonly string[]>;
	hasRemote: (name: string) => Promise<boolean>;
} {
	return {
		getAll: async (key) => values[key] ?? [],
		getBoolean: async (key) => {
			const value = values[key]?.at(-1);
			if (value === undefined) return null;
			return ["1", "on", "true", "yes"].includes(value.toLowerCase());
		},
		getRemoteGroup: async (name) => (
			values[`remotes.${name}`]?.flatMap((value) => value.split(/\s+/)) ?? []
		),
		hasRemote: async (name) => (
			values[`remote.${name}.push`] !== undefined ||
			values[`remote.${name}.mirror`] !== undefined
		),
	};
}

describe("protectedNonLeaseForcePushTarget", () => {
	it("recognizes short, fully-qualified, wildcard, and repo-option destinations", async () => {
		await expect(
			protectedNonLeaseForcePushTarget(
				"-fu origin feature:refs/heads/main",
				"feature",
				configReader(),
			),
		).resolves.toBe("refs/heads/main");
		await expect(
			protectedNonLeaseForcePushTarget(
				"--force origin refs/heads/*:refs/heads/*",
				"feature",
				configReader(),
			),
		).resolves.toBe("refs/heads/*");
		await expect(
			protectedNonLeaseForcePushTarget(
				"--repo=origin",
				"feature",
				configReader({
					"remote.origin.push": ["+HEAD:master"],
				}),
			),
		).resolves.toBe("master");
		await expect(
			protectedNonLeaseForcePushTarget(
				"--repo=origin +HEAD:main",
				"feature",
				configReader(),
			),
		).resolves.toBe("main");
		await expect(
			protectedNonLeaseForcePushTarget(
				"--force origin @",
				"main",
				configReader(),
			),
		).resolves.toBe("main");
		await expect(
			protectedNonLeaseForcePushTarget(
				"--force origin heads/main",
				"feature",
				configReader(),
			),
		).resolves.toBe("refs/heads/main");
	});

	it("blocks all-branch forced updates independently of the current branch", async () => {
		await expect(
			protectedNonLeaseForcePushTarget(
				"--force --all origin",
				"feature",
				configReader(),
			),
		).resolves.toBe("main/master");
	});

	it("skips separate option values without shifting the repository or refspec", async () => {
		await expect(
			protectedNonLeaseForcePushTarget(
				"--force --recurse-submodules check origin HEAD:main",
				"feature",
				configReader(),
			),
		).resolves.toBe("main");
	});

	it.each([
		"--mirr origin",
		"--rep=origin +HEAD:main",
	])("fails closed on unsupported or abbreviated long options: %s", async (args) => {
		await expect(
			protectedNonLeaseForcePushTarget(
				args,
				"feature",
				configReader(),
			),
		).rejects.toThrow("unsupported or abbreviated push option");
		expect(resolveGitToolEffect({ op: "push", args })).toMatchObject({
			kind: "destructive",
			scope: "external-network",
		});
	});

	it("allows leased protection and force updates to non-protected destinations", async () => {
		await expect(
			protectedNonLeaseForcePushTarget(
				"--force-with-lease origin HEAD:main",
				"feature",
				configReader(),
			),
		).resolves.toBeNull();
		await expect(
			protectedNonLeaseForcePushTarget(
				"origin +HEAD:feature",
				"feature",
				configReader(),
			),
		).resolves.toBeNull();
	});

	it("resolves positive and globally forced remote push refspecs", async () => {
		await expect(
			protectedNonLeaseForcePushTarget(
				"origin",
				"feature",
				configReader({
					"remote.origin.push": ["+HEAD:main"],
				}),
			),
		).resolves.toBe("main");
		await expect(
			protectedNonLeaseForcePushTarget(
				"--force origin",
				"feature",
				configReader({
					"remote.origin.push": ["HEAD:refs/heads/main"],
				}),
			),
		).resolves.toBe("refs/heads/main");
	});

	it("resolves push remotes and upstream destinations from config precedence", async () => {
		await expect(
			protectedNonLeaseForcePushTarget(
				"--force",
				"feature",
				configReader({
					"branch.feature.pushRemote": ["fork"],
					"remote.fork.push": ["HEAD:master"],
					"remote.pushDefault": ["origin"],
					"remote.origin.push": ["HEAD:feature"],
				}),
			),
		).resolves.toBe("master");
		await expect(
			protectedNonLeaseForcePushTarget(
				"--force origin",
				"feature",
				configReader({
					"branch.feature.merge": ["refs/heads/main"],
					"push.default": ["upstream"],
				}),
			),
		).resolves.toBe("refs/heads/main");
	});

	it("resolves tracking defaults and each member of a remote group", async () => {
		await expect(
			protectedNonLeaseForcePushTarget(
				"--force origin",
				"feature",
				configReader({
					"branch.feature.merge": ["refs/heads/main"],
					"push.default": ["tracking"],
				}),
			),
		).resolves.toBe("refs/heads/main");
		await expect(
			protectedNonLeaseForcePushTarget(
				"publish",
				"feature",
				configReader({
					"remote.backup.push": ["+HEAD:main"],
					"remote.origin.push": ["HEAD:feature"],
					"remotes.publish": ["origin backup"],
				}),
			),
		).resolves.toBe("main");
	});

	it("honors configured mirror and non-protected destinations", async () => {
		await expect(
			protectedNonLeaseForcePushTarget(
				"origin",
				"feature",
				configReader({
					"remote.origin.mirror": ["true"],
				}),
			),
		).resolves.toBe("main/master");
		await expect(
			protectedNonLeaseForcePushTarget(
				"origin",
				"feature",
				configReader({
					"remote.origin.push": ["+HEAD:feature"],
				}),
			),
		).resolves.toBeNull();
	});

	it.each([
		"--force-with-lease origin HEAD:feature",
		"--delete origin feature",
		"origin :feature",
		"--mirror origin",
		"--prune origin",
	])("classifies remote-destructive push arguments: %s", (args) => {
		expect(resolveGitToolEffect({ op: "push", args })).toMatchObject({
			kind: "destructive",
			scope: "external-network",
		});
	});

	it("classifies config-selected push refspecs conservatively", () => {
		expect(resolveGitToolEffect({ op: "push", args: "origin" })).toMatchObject({
			kind: "destructive",
			scope: "external-network",
		});
		expect(
			resolveGitToolEffect({ op: "push", args: "origin HEAD:feature" }),
		).toMatchObject({
			kind: "write",
			scope: "external-network",
		});
	});
});
