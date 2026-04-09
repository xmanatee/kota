/**
 * Integration test for the foreign module loader.
 *
 * Spawns the Python demo module and verifies:
 * 1. The handshake completes and tools are registered.
 * 2. Tool invocation returns the expected result.
 * 3. Cleanup via onUnload shuts down the subprocess.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ForeignModuleConfig } from "./foreign-module.js";
import { loadForeignModules } from "./foreign-module-loader.js";

const DEMO_SCRIPT = resolve(process.cwd(), "examples/modules/kota-demo.py");

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

    const modules = await loadForeignModules([config], process.cwd());
    expect(modules).toHaveLength(1);

    const ext = modules[0];
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
    await ext.onUnload?.();
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
