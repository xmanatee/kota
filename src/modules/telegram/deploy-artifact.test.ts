/**
 * Static coverage for the Telegram personal-assistant deploy artifact in
 * `deploy/telegram-assistant/`. The integration path — daemon + telegram
 * channels running together — is covered by `daemon-integration.test.ts`.
 * These tests guard the deploy artifact itself against drift: required
 * files exist, every env var referenced by docker-compose and the
 * systemd unit is listed in .env.example, and the install script wires
 * the same required inputs.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DEPLOY_DIR = resolve(__dirname, "../../../deploy/telegram-assistant");

const REQUIRED_RUNTIME_ENV = [
  "ANTHROPIC_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALERT_CHAT_ID",
];

const OPTIONAL_RUNTIME_ENV = ["OPENAI_API_KEY"];

function read(name: string): string {
  return readFileSync(resolve(DEPLOY_DIR, name), "utf8");
}

describe("telegram-assistant deploy artifact", () => {
  it("ships the expected files", () => {
    for (const file of [
      "Dockerfile",
      "docker-compose.yml",
      "kota-telegram.service",
      ".env.example",
      "install.sh",
      "rollback.sh",
      "smoke-test.sh",
      "README.md",
    ]) {
      // readFileSync throws if absent, which is the assertion we want.
      expect(() => read(file)).not.toThrow();
    }
  });

  it(".env.example declares every required runtime env var", () => {
    const env = read(".env.example");
    for (const name of REQUIRED_RUNTIME_ENV) {
      expect(env).toMatch(new RegExp(`^${name}=`, "m"));
    }
    for (const name of OPTIONAL_RUNTIME_ENV) {
      expect(env).toMatch(new RegExp(`^${name}=`, "m"));
    }
  });

  it("docker-compose.yml references every required env var with a fail-loud marker", () => {
    const compose = read("docker-compose.yml");
    for (const name of REQUIRED_RUNTIME_ENV) {
      // `${VAR:?...}` makes compose fail at parse time when the var is
      // unset, which is the no-silent-default contract the deploy owes.
      expect(compose).toContain(`\${${name}:?`);
    }
    // Optional vars use the `:-` default form so they can be empty.
    for (const name of OPTIONAL_RUNTIME_ENV) {
      expect(compose).toMatch(new RegExp(`\\$\\{${name}:-\\}`));
    }
  });

  it("docker-compose.yml pins a non-default restart policy and hardens the container", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toMatch(/restart:\s*unless-stopped/);
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toMatch(/cap_drop:\s*\n\s*- ALL/);
    expect(compose).toMatch(/healthcheck:/);
  });

  it("systemd unit runs under a non-root user with hardening directives", () => {
    const unit = read("kota-telegram.service");
    expect(unit).toMatch(/^User=kota$/m);
    expect(unit).toMatch(/^Group=kota$/m);
    expect(unit).toMatch(/^EnvironmentFile=\/etc\/kota\/telegram-assistant\.env$/m);
    expect(unit).toMatch(/^Restart=on-failure$/m);
    expect(unit).toMatch(/^NoNewPrivileges=true$/m);
    expect(unit).toMatch(/^ProtectSystem=strict$/m);
    expect(unit).toMatch(/^ReadWritePaths=\/var\/lib\/kota$/m);
    expect(unit).toMatch(/^ExecStart=.+ daemon .+\/var\/lib\/kota$/m);
  });

  it("install.sh enforces every required env var before starting a supervisor", () => {
    const install = read("install.sh");
    for (const name of REQUIRED_RUNTIME_ENV) {
      expect(install).toMatch(new RegExp(`require_env\\s+${name}\\b`));
    }
    // Supports both supervisor paths.
    expect(install).toMatch(/--mode docker\|systemd/);
    expect(install).toMatch(/docker compose/);
    expect(install).toMatch(/systemctl enable --now kota-telegram\.service/);
  });

  it("rollback.sh removes both supervisor paths and preserves state by default", () => {
    const rollback = read("rollback.sh");
    expect(rollback).toMatch(/docker compose .* down/);
    expect(rollback).toMatch(/systemctl disable --now kota-telegram\.service/);
    expect(rollback).toMatch(/rm -f \/etc\/systemd\/system\/kota-telegram\.service/);
    // State purge is explicit, not default.
    expect(rollback).toMatch(/--purge-state/);
  });

  it("README documents inputs, supervisors, and rollback", () => {
    const readme = read("README.md");
    expect(readme).toMatch(/## Inputs/);
    expect(readme).toMatch(/## Supervisors/);
    expect(readme).toMatch(/## Rollback/);
    for (const name of REQUIRED_RUNTIME_ENV) {
      expect(readme).toContain(name);
    }
    // Honest acknowledgment of the staging-bot acceptance step.
    expect(readme).toMatch(/staging bot|live staging/i);
  });
});
