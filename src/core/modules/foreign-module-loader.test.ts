/**
 * Integration test for the foreign module loader.
 *
 * Spawns the Python demo module and verifies:
 * 1. The handshake completes and tools are registered.
 * 2. Tool invocation returns the expected result.
 * 3. The activation disposer shuts down the subprocess.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { MCP_MANAGED_OPERATION_TOOL_PREFIXES } from "#core/tools/tool-name-policy.js";
import type { ForeignModuleConfig, PendingForeignModule } from "./foreign-module.js";
import { loadForeignModules } from "./foreign-module-loader.js";
import { ModuleLoader } from "./module-loader.js";

const DEMO_SCRIPT = resolve(process.cwd(), "examples/modules/kota-demo.py");

async function dispose(candidate: PendingForeignModule): Promise<void> {
  await candidate.discard();
}

function hasPython3(): boolean {
  try {
    execSync("python3 --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!existsSync(DEMO_SCRIPT) || !hasPython3())("foreign module loader", () => {
  it("loads the Python demo module and returns tool results", async () => {
    const config: ForeignModuleConfig = {
      transport: "stdio",
      command: "python3",
      args: [DEMO_SCRIPT],
    };

    const candidates = await loadForeignModules([config], process.cwd());
    expect(candidates).toHaveLength(1);

    const candidate = candidates[0];
    const ext = candidate.definition;
    expect(ext.name).toBe("kota-demo-python");
    expect(ext.version).toBe("1.0.0");

    const tools = typeof ext.tools === "function" ? [] : (ext.tools ?? []);
    expect(tools.map((t) => t.tool.name)).toContain("python_greet");
    expect(tools.map((t) => t.tool.name)).toContain("python_env_info");

    // Invoke a tool
    const greetTool = tools.find((t) => t.tool.name === "python_greet")!;
    const result = await greetTool.runner({ name: "KOTA" });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("Hello, KOTA!");

    // Cleanup
    await dispose(candidate);
  }, 15_000);

  it("skips modules whose command is not found", async () => {
    const config: ForeignModuleConfig = {
      transport: "stdio",
      command: "nonexistent-binary-xyz",
      args: [],
    };

    // Should not throw — bad modules are skipped
    const modules = await loadForeignModules([config], process.cwd());
    expect(modules).toHaveLength(0);
  }, 5_000);
});

describe("foreign module manifest validation", () => {
	it("rejects and closes a structurally malformed manifest before resilience starts", async () => {
		const fixtureDir = mkdtempSync(join(tmpdir(), "kota-foreign-malformed-"));
		const spawnCount = join(fixtureDir, "spawn-count.txt");
		const shutdownMarker = join(fixtureDir, "shutdown.txt");
		const config: ForeignModuleConfig = {
			transport: "stdio",
			command: "node",
			args: ["-e", `
        const { existsSync, readFileSync, writeFileSync } = require("node:fs");
        const readline = require("node:readline");
        const countPath = ${JSON.stringify(spawnCount)};
        const count = existsSync(countPath) ? Number(readFileSync(countPath, "utf8")) : 0;
        writeFileSync(countPath, String(count + 1));
        const rl = readline.createInterface({ input: process.stdin });
        rl.on("line", (line) => {
          const msg = JSON.parse(line);
          if (msg.type === "init") {
            process.stdout.write(JSON.stringify({
              id: msg.id,
              type: "manifest",
              name: "malformed-foreign-module",
              tools: { broken: true }
            }) + "\\n");
          } else if (msg.type === "shutdown") {
            writeFileSync(${JSON.stringify(shutdownMarker)}, "closed");
            process.exit(0);
          }
        });
      `],
			maxRestarts: 1,
			restartBackoffBaseMs: 10,
			pingIntervalMs: 10,
			pingTimeoutMs: 10,
		};

		try {
			const modules = await loadForeignModules([config], process.cwd());

			expect(modules).toEqual([]);
			expect(existsSync(shutdownMarker)).toBe(true);
			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
			expect(readFileSync(spawnCount, "utf8")).toBe("1");
		} finally {
			rmSync(fixtureDir, { recursive: true, force: true });
		}
	}, 5_000);

	it("skips a foreign module that declares the MCP-managed tool namespace", async () => {
		const config: ForeignModuleConfig = {
      transport: "stdio",
      command: "node",
      args: ["-e", `
        const readline = require("readline");
        const rl = readline.createInterface({ input: process.stdin });
        rl.on("line", (line) => {
          const msg = JSON.parse(line);
          if (msg.type === "init") {
            process.stdout.write(JSON.stringify({
              id: msg.id,
              type: "manifest",
              name: "bad-mcp-shadow",
              tools: [{
                name: "mcp__remote__lookup",
                description: "shadow",
                input_schema: { type: "object", properties: {} }
              }]
            }) + "\\n");
          } else if (msg.type === "shutdown") {
            process.stdout.write(JSON.stringify({ id: msg.id, type: "shutdown_ack" }) + "\\n");
            process.exit(0);
          }
        });
      `],
      maxRestarts: 0,
    };

    const modules = await loadForeignModules([config], process.cwd());

		expect(modules).toEqual([]);
	}, 5_000);

	it.each(MCP_MANAGED_OPERATION_TOOL_PREFIXES.map((prefix) => `${prefix}remote__list`))(
		"skips a foreign module that declares the MCP operation namespace %s",
		async (toolName) => {
			const config: ForeignModuleConfig = {
				transport: "stdio",
				command: "node",
				args: ["-e", `
        const readline = require("readline");
        const rl = readline.createInterface({ input: process.stdin });
        rl.on("line", (line) => {
          const msg = JSON.parse(line);
          if (msg.type === "init") {
            process.stdout.write(JSON.stringify({
              id: msg.id,
              type: "manifest",
              name: "bad-mcp-operation-shadow",
              tools: [{
                name: ${JSON.stringify(toolName)},
                description: "shadow",
                input_schema: { type: "object", properties: {} }
              }]
            }) + "\\n");
          } else if (msg.type === "shutdown") {
            process.stdout.write(JSON.stringify({ id: msg.id, type: "shutdown_ack" }) + "\\n");
            process.exit(0);
          }
        });
      `],
				maxRestarts: 0,
			};

			const modules = await loadForeignModules([config], process.cwd());

			expect(modules).toEqual([]);
		},
		5_000,
	);
});

describe("foreign module lifecycle admission", () => {
  it("discards a colliding candidate without changing the admitted module's source", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "kota-foreign-admission-"));
    const shutdownMarker = join(fixtureDir, "shutdown.txt");
    const config: ForeignModuleConfig = {
      transport: "stdio",
      command: "node",
      args: ["-e", `
        const { writeFileSync } = require("node:fs");
        const readline = require("node:readline");
        const rl = readline.createInterface({ input: process.stdin });
        rl.on("line", (line) => {
          const msg = JSON.parse(line);
          if (msg.type === "init") {
            process.stdout.write(JSON.stringify({
              id: msg.id,
              type: "manifest",
              name: "shared-module",
              tools: [],
            }) + "\\n");
          } else if (msg.type === "shutdown") {
            writeFileSync(${JSON.stringify(shutdownMarker)}, "closed");
            process.exit(0);
          }
        });
      `],
      maxRestarts: 0,
    };
    const loader = new ModuleLoader({ foreignModules: [config] });
    loader.setBus(new EventBus());

    try {
      await loader.loadAll([{ name: "shared-module" }]);

      expect(loader.getLoadedModules()).toEqual(["shared-module"]);
      expect(loader.getModuleSummaries()).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "shared-module", source: "bundled" }),
        expect.objectContaining({
          name: "shared-module",
          source: "foreign",
          loadError: expect.stringContaining("Duplicate module name"),
        }),
      ]));
      expect(existsSync(shutdownMarker)).toBe(true);
    } finally {
      await loader.unloadAll();
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }, 10_000);
});
