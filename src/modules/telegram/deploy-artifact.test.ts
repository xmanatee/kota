import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AgentRuntimeConfig, resolveAgentRuntime } from "#core/model/preset.js";
import { createModelClientImpl } from "#modules/model-clients/factory.js";

const deploy = resolve(import.meta.dirname, "../../../deploy/telegram-assistant");
let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "telegram-deploy-"));
  env = { PATH: `${dir}:${dirname(process.execPath)}:/usr/bin:/bin`, KOTA_SCOPE_ROOT: join(dir, "scope") };
  // Docker is the external process port. Record invocations without simulating
  // Compose, supervisor state, the daemon, or Telegram transport.
  writeFileSync(join(dir, "docker"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$DEPLOY_CALLS"\nexit "\${DEPLOY_EXIT:-0}"\n`, { mode: 0o755 });
  env.DEPLOY_CALLS = join(dir, "calls");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(script: string, args: string[] = []) {
  return spawnSync("bash", [join(deploy, script), ...args], { env, encoding: "utf8" });
}
function secrets(content: string) {
  const path = join(dir, "secret-input");
  writeFileSync(path, content, { mode: 0o600 });
  return path;
}
function calls() { return existsSync(env.DEPLOY_CALLS!) ? readFileSync(env.DEPLOY_CALLS!, "utf8") : ""; }
function entrypoint(overrides: NodeJS.ProcessEnv = {}) {
  copyFileSync(join(deploy, "entrypoint.sh"), join(dir, "entrypoint.sh"));
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "bin/kota.mjs"), "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
  return spawnSync("bash", [join(dir, "entrypoint.sh"), "daemon", "--scope-root", env.KOTA_SCOPE_ROOT!], {
    env: { ...env, TELEGRAM_BOT_TOKEN: "fixture-token", TELEGRAM_ALERT_CHAT_ID: "123", KOTA_MODEL: "openrouter/openrouter/auto", ...overrides }, encoding: "utf8",
  });
}

describe("Telegram deploy boundary", () => {
  it("passes a literal secrets file to Compose without executing or logging its values", () => {
    const marker = join(dir, "executed");
    const secret = `$(touch ${marker})`;
    const path = secrets(`TELEGRAM_BOT_TOKEN=${secret}\nTELEGRAM_ALERT_CHAT_ID=123\n`);
    const result = run("install.sh", ["--mode", "docker", "--env-file", path]);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(result.stdout + result.stderr + calls()).not.toContain(secret);
    expect(calls()).toContain("up --detach --build --wait");
  });

  it.each([
    "TELEGRAM_BOT_TOKEN=fixture\n",
    "TELEGRAM_BOT_TOKEN=fixture\nTELEGRAM_ALERT_CHAT_ID=123\nNODE_OPTIONS=--require evil\n",
    "TELEGRAM_BOT_TOKEN=fixture\nTELEGRAM_ALERT_CHAT_ID=123\nTELEGRAM_ALERT_CHAT_ID=456\n",
  ])("rejects incomplete, process-authority or duplicate inputs before launch", (input) => {
    const result = run("install.sh", ["--mode", "docker", "--env-file", secrets(input)]);
    expect(result.status).not.toBe(0);
    expect(calls()).toBe("");
  });

  it("does not report success when the supervisor fails", () => {
    env.DEPLOY_EXIT = "7";
    const result = run("install.sh", ["--mode", "docker", "--env-file", secrets("TELEGRAM_BOT_TOKEN=fixture\nTELEGRAM_ALERT_CHAT_ID=123\n")]);
    expect(result.status).toBe(7);
    expect(result.stdout).not.toContain("healthy");
  });

  it("rolls back without secrets and purges state only when requested", () => {
    expect(run("rollback.sh", ["--mode", "docker"]).status).toBe(0);
    expect(calls()).toContain(" down");
    expect(calls()).not.toContain("--volumes");
    expect(run("rollback.sh", ["--mode", "docker", "--purge-state"]).status).toBe(0);
    expect(calls()).toContain("down --volumes");
  });

  it("writes private config, preserves unrelated settings and launches the requested daemon command", () => {
    const configPath = join(env.KOTA_SCOPE_ROOT!, ".kota/config.json");
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ verbose: true, modules: { telegram: { allowedChatIds: [999] } } }), { mode: 0o644 });
    const result = entrypoint({ KOTA_MODEL: "openrouter/openrouter/auto", OPENROUTER_API_KEY: "private-fixture-key" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["daemon", "--scope-root", env.KOTA_SCOPE_ROOT]);
    const raw = readFileSync(configPath, "utf8");
    expect(JSON.parse(raw)).toMatchObject({ verbose: true, model: "openrouter/openrouter/auto", defaultPreset: "openrouter", modules: { telegram: { allowedChatIds: [123], defaultAutonomyMode: "supervised" } } });
    expect(raw).not.toContain("private-fixture-key");
    expect(raw).not.toContain("fixture-token");
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it.each([undefined, "openrouter-lab"])("resolves deploy workflow tiers to usable OpenRouter clients with preset %s", (preset) => {
    const result = entrypoint({ KOTA_DEFAULT_PRESET: preset });
    expect(result.status, result.stderr).toBe(0);
    const config: AgentRuntimeConfig = JSON.parse(readFileSync(join(env.KOTA_SCOPE_ROOT!, ".kota/config.json"), "utf8"));
    const runtime = resolveAgentRuntime(config, {});
    expect(runtime.preset.id).toBe(preset ?? "openrouter");
    expect(runtime.harness).toBe("openai-tools");
    for (const model of Object.values(runtime.tiers)) {
      // Production provider resolution and client construction, without a
      // network request or host secret-store access. This caught the previous
      // unqualified Codex workflow tiers despite a valid OpenRouter chat model.
      const resolved = createModelClientImpl({ model, apiKey: "fixture-key" });
      expect(resolved.providerName).toBe("openrouter");
    }
  });

  it("requires a workflow preset when the chat provider cannot supply the deploy default", () => {
    const result = entrypoint({ KOTA_MODEL: "openai/gpt-4.1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("KOTA_DEFAULT_PRESET is required");
    expect(result.stdout).toBe("");
    expect(existsSync(join(env.KOTA_SCOPE_ROOT!, ".kota/config.json"))).toBe(false);
  });

  it("preserves an existing explicit preset and lets it select the harness", () => {
    const configPath = join(env.KOTA_SCOPE_ROOT!, ".kota/config.json");
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ defaultPreset: "claude" }));
    const result = entrypoint({ KOTA_MODEL: "anthropic/claude-sonnet-4-6" });
    expect(result.status, result.stderr).toBe(0);
    const config: AgentRuntimeConfig = JSON.parse(readFileSync(configPath, "utf8"));
    expect(resolveAgentRuntime(config, {}).harness).toBe("claude-agent-sdk");
  });

  it.each([" ", "1,", "9007199254740993", "all"])("rejects invalid allowlists without writing config or launching: %s", (ids) => {
    const result = entrypoint({ KOTA_TELEGRAM_ALLOWED_CHAT_IDS: ids });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(existsSync(join(env.KOTA_SCOPE_ROOT!, ".kota/config.json"))).toBe(false);
  });

  it("encodes literal systemd secrets without shell expansion", () => {
    const source = secrets('TELEGRAM_BOT_TOKEN=a$HOME`id`"\\z\nTELEGRAM_ALERT_CHAT_ID=123\n');
    const output = join(dir, "systemd-input");
    const result = spawnSync(process.execPath, [join(deploy, "systemd-env.mjs"), source, output], { env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(output, "utf8")).toBe('TELEGRAM_BOT_TOKEN="a$HOME`id`\\"\\\\z"\nTELEGRAM_ALERT_CHAT_ID="123"\n');
    expect(statSync(output).mode & 0o777).toBe(0o600);
  });
});
