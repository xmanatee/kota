import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import {
	setStderrTransport,
	setTerminalTransport,
	TerminalTransport,
} from "#modules/rendering/transport.js";
import {
	isPositivelyIdentifiedIsolatedEvalRoot,
	overrideWorkflowAgentExecution,
	registerExecCommand,
} from "./exec.js";

const roots: string[] = [];
let stdout: string[];
let stderr: string[];

beforeEach(() => {
	stdout = [];
	stderr = [];
	setTerminalTransport(new TerminalTransport({
		stream: {
			write: (chunk) => {
				stdout.push(chunk);
				return true;
			},
		},
	}));
	setStderrTransport(new TerminalTransport({
		stream: {
			write: (chunk) => {
				stderr.push(chunk);
				return true;
			},
		},
	}));
});

afterEach(() => {
	process.exitCode = undefined;
	setTerminalTransport(null);
	setStderrTransport(null);
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function initRepository(projectDir: string, email: string): void {
	execFileSync("git", ["init", "--quiet", "--initial-branch=main"], {
		cwd: projectDir,
	});
	execFileSync("git", ["config", "user.email", email], { cwd: projectDir });
	execFileSync("git", ["config", "user.name", "Workflow Exec Test"], {
		cwd: projectDir,
	});
	execFileSync("git", ["commit", "--allow-empty", "--message", "initial", "--quiet"], {
		cwd: projectDir,
	});
}

describe("workflow exec agent execution override", () => {
  it("forces harness, model, and effort while removing tier routing", () => {
    const definition = {
      steps: [
        {
          id: "evaluate",
          type: "agent",
          harness: "claude-agent-sdk",
          model: "claude-old",
          tier: "capable",
          effort: "low",
        },
      ],
    } as RegisteredWorkflowDefinitionInput;

    const overridden = overrideWorkflowAgentExecution(definition, {
      harness: "antigravity-cli",
      model: "gemini-3.6-flash",
      effort: "max",
    });

    expect(overridden.steps[0]).toMatchObject({
      id: "evaluate",
      type: "agent",
      harness: "antigravity-cli",
      model: "gemini-3.6-flash",
      effort: "max",
    });
    expect(overridden.steps[0]).not.toHaveProperty("tier");
  });
});

describe("workflow exec authority", () => {
	it("does not classify an ordinary checkout as an isolated eval root", () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-workflow-exec-canonical-"));
		roots.push(projectDir);
		initRepository(projectDir, "developer@example.com");

		expect(
			isPositivelyIdentifiedIsolatedEvalRoot(projectDir, {
				KOTA_PROJECT_DIR: projectDir,
				HOME: join(projectDir, "node_modules", ".kota-eval-runtime", "home"),
			}),
		).toBe(false);
	});

	it("recognizes the eval harness isolated root from its existing runtime facts", () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-eval-workflow-exec-"));
		roots.push(projectDir);
		initRepository(projectDir, "eval-harness@kota.local");
		const runtimeRoot = join(projectDir, "node_modules", ".kota-eval-runtime");
		const env = {
			KOTA_PROJECT_DIR: projectDir,
			HOME: join(runtimeRoot, "home"),
			COREPACK_HOME: join(runtimeRoot, "corepack"),
			PNPM_HOME: join(runtimeRoot, "pnpm-home"),
			XDG_CACHE_HOME: join(runtimeRoot, "cache"),
			XDG_DATA_HOME: join(runtimeRoot, "data"),
			XDG_STATE_HOME: join(runtimeRoot, "state"),
			npm_config_cache: join(runtimeRoot, "npm-cache"),
			npm_config_store_dir: join(runtimeRoot, "pnpm-store"),
		};
		mkdirSync(env.HOME, { recursive: true });

		expect(
			isPositivelyIdentifiedIsolatedEvalRoot(realpathSync(projectDir), env),
		).toBe(true);
	});

	it("routes a canonical execution through the scoped daemon client and waits for terminal status", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-workflow-exec-canonical-"));
		roots.push(projectDir);
		initRepository(projectDir, "developer@example.com");
		const calls: unknown[] = [];
		const workflow = {
			listDefinitions: async () => ({
				source: "daemon" as const,
				definitions: [{
					name: "builder",
					enabled: true,
					stepCount: 1,
					triggers: [],
				}],
			}),
			triggerByName: async (name: string, options: unknown) => {
				calls.push(["trigger", name, options]);
				return {
					ok: true as const,
					path: "daemon" as const,
					queued: name,
					runId: "canonical-builder-run",
				};
			},
			getRun: async (id: string) => {
				calls.push(["getRun", id]);
				return {
					found: true as const,
					run: {
						id,
						workflow: "builder",
						status: "success",
						triggerEvent: "manual",
						triggerSchemaRef: null,
						startedAt: "2026-08-26T00:00:00.000Z",
						completedAt: "2026-08-26T00:00:01.000Z",
						steps: [],
					},
				};
			},
		};
		const scopedClient = { workflow };
		const client = {
			forScope: (scopeId: string) => {
				calls.push(["forScope", scopeId]);
				return scopedClient;
			},
			forProject: () => scopedClient,
			workflow,
		};
		const command = new Command("workflow");
		command.exitOverride();
		registerExecCommand(command, {
			cwd: projectDir,
			client,
		} as unknown as ModuleContext);

		await command.parseAsync(["exec", "builder"], { from: "user" });

		expect(calls[0]).toEqual([
			"forScope",
			deriveDirectoryScopeId(projectDir),
		]);
		expect(calls[1]).toEqual(["trigger", "builder", expect.objectContaining({
			event: "manual",
			runId: expect.stringContaining("builder"),
		})]);
		expect(calls[2]).toEqual(["getRun", "canonical-builder-run"]);
		expect(stdout.join("")).toContain("canonical-builder-run");
		expect(process.exitCode).toBeUndefined();
	});

	it("fails closed when no daemon-owned canonical runtime is available", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-workflow-exec-canonical-"));
		roots.push(projectDir);
		initRepository(projectDir, "developer@example.com");
		let triggered = false;
		const workflow = {
			listDefinitions: async () => ({ source: "static" as const, definitions: [] }),
			triggerByName: async () => {
				triggered = true;
				return { ok: false as const, reason: "daemon_required" as const };
			},
		};
		const scopedClient = { workflow };
		const client = {
			forScope: () => scopedClient,
			forProject: () => scopedClient,
			workflow,
		};
		const command = new Command("workflow");
		command.exitOverride();
		registerExecCommand(command, {
			cwd: projectDir,
			client,
		} as unknown as ModuleContext);

		await command.parseAsync(["exec", "builder"], { from: "user" });

		expect(triggered).toBe(false);
		expect(stderr.join("")).toMatch(/no daemon-owned workflow authority/i);
		expect(process.exitCode).toBe(1);
	});

	it("reports the missing daemon override API instead of executing canonically", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-workflow-exec-canonical-"));
		roots.push(projectDir);
		initRepository(projectDir, "developer@example.com");
		let contactedDaemon = false;
		const workflow = {
			listDefinitions: async () => {
				contactedDaemon = true;
				return { source: "daemon" as const, definitions: [] };
			},
		};
		const scopedClient = { workflow };
		const client = {
			forScope: () => scopedClient,
			forProject: () => scopedClient,
			workflow,
		};
		const command = new Command("workflow");
		command.exitOverride();
		registerExecCommand(command, {
			cwd: projectDir,
			client,
		} as unknown as ModuleContext);

		await command.parseAsync([
			"exec",
			"builder",
			"--agent-harness",
			"openai-tools",
			"--agent-model",
			"gpt-5",
		], { from: "user" });

		expect(contactedDaemon).toBe(false);
		expect(stderr.join("")).toMatch(/does not support per-run agent overrides/i);
		expect(process.exitCode).toBe(1);
	});
});
