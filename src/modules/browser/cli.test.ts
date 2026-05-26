import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToolMiddleware, resetToolMiddleware } from "#core/tools/tool-middleware.js";
import { buildBrowserCommand } from "./cli.js";

const mocks = vi.hoisted(() => ({
  executeTool: vi.fn(),
  isPlaywrightAvailable: vi.fn(),
  loadConfig: vi.fn(),
  loadRuntimeModules: vi.fn(),
}));

vi.mock("#core/config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("#core/modules/runtime-loader.js", () => ({
  loadRuntimeModules: mocks.loadRuntimeModules,
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: mocks.executeTool,
}));

vi.mock("./lifecycle.js", () => ({
  isPlaywrightAvailable: mocks.isPlaywrightAvailable,
}));

describe("browser CLI", () => {
  let tempDir: string;
  let unloadAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetToolMiddleware();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "kota-browser-cli-"));
    writeFileSync(join(tempDir, "profile.json"), '{"cookies":[],"origins":[]}\n', "utf8");

    unloadAll = vi.fn(async () => {});
    const runtimeConfig = {
      modules: {
        browser: {
          storageStatePath: "profile.json",
          persistProfile: false,
        },
      },
    };
    mocks.loadConfig.mockReturnValue(runtimeConfig);
    mocks.isPlaywrightAvailable.mockReturnValue(true);
    mocks.loadRuntimeModules.mockImplementation(async () => {
      getToolMiddleware().add(
        "runtime-cli-test-marker",
        async (_call, next) => {
          const result = await next();
          return {
            ...result,
            content: `${result.content}\n[runtime-cli-middleware]`,
          };
        },
      );
      return { unloadAll };
    });
    mocks.executeTool.mockImplementation(async (name: string) => ({
      content: `${name} content Authorization: Bearer secret-token`,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetToolMiddleware();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("hydrates runtime modules before invoking source-access reader tools", async () => {
    const commandModeCallTool = vi.fn(async () => ({
      content: "commands-mode context should not be used",
      is_error: true,
    }));
    const ctx = {
      cwd: tempDir,
      config: {},
      getModuleConfig: vi.fn(() => ({})),
      callTool: commandModeCallTool,
    } as never;
    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const command = buildBrowserCommand(ctx);
    await command.parseAsync(
      [
        "source-access-report",
        "--article-url",
        "https://example.com/article",
        "--timeout-ms",
        "1234",
        "--out-dir",
        join(tempDir, "report"),
      ],
      { from: "user" },
    );

    expect(mocks.loadRuntimeModules).toHaveBeenCalledWith({
      config: mocks.loadConfig.mock.results[0].value,
      cwd: tempDir,
    });
    expect(mocks.isPlaywrightAvailable).toHaveBeenCalledWith(tempDir);
    expect(mocks.loadRuntimeModules.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.executeTool.mock.invocationCallOrder[0],
    );
    expect(mocks.executeTool).toHaveBeenCalledWith("rendered_article_read", {
      url: "https://example.com/article",
      timeout: 1234,
    });
    expect(commandModeCallTool).not.toHaveBeenCalled();
    expect(unloadAll).toHaveBeenCalledTimes(1);

    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("[runtime-cli-middleware]");
    expect(output).toContain("Authorization: [redacted]");
    expect(output).not.toContain("secret-token");
  });
});
