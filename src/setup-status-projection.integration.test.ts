import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url));
const TSX_LOADER_PATH = fileURLToPath(import.meta.resolve("tsx"));

function runSetupCli(
  projectDir: string,
  args: readonly string[],
  stdin?: string,
): string {
  const homeDir = join(projectDir, "operator-home");
  mkdirSync(homeDir, { recursive: true });
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=source",
      "--import",
      TSX_LOADER_PATH,
      CLI_PATH,
      "setup",
      ...args,
    ],
    {
      cwd: projectDir,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir },
      ...(stdin !== undefined && { input: stdin }),
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `setup CLI failed (${result.status ?? "signal"}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

describe("shipped setup status client projection", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("executes a revoked-to-ready CLI journey without disclosing submitted secrets", { timeout: 60_000 }, () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-setup-operator-journey-"));
    projectDirs.push(projectDir);

    const revoked = runSetupCli(projectDir, ["revoke", "telegram", "bot-credentials"]);
    expect(revoked).toContain("telegram/bot-credentials: revoked");
    const revokedList = runSetupCli(projectDir, ["list"]);
    expect(revokedList).toContain("credentials_revoked — Credentials were revoked");
    expect(revokedList).toContain("secret TELEGRAM_BOT_TOKEN: missing");
    expect(revokedList).toContain("kota setup start telegram bot-credentials");

    const started = JSON.parse(
      runSetupCli(projectDir, ["start", "telegram", "bot-credentials", "--json"]),
    ) as { action: { actionId: string } };
    const pendingList = runSetupCli(projectDir, ["list"]);
    expect(pendingList).toContain(
      `kota setup complete ${started.action.actionId} --secret-values-stdin`,
    );
    expect(pendingList).toContain(
      "stdin JSON keys TELEGRAM_BOT_TOKEN, TELEGRAM_ALERT_CHAT_ID",
    );

    const botToken = "operator-journey-bot-secret-123456";
    const alertChat = "operator-journey-chat-secret-123456";
    const completed = runSetupCli(
      projectDir,
      ["complete", started.action.actionId, "--secret-values-stdin"],
      JSON.stringify({
        TELEGRAM_BOT_TOKEN: botToken,
        TELEGRAM_ALERT_CHAT_ID: alertChat,
      }),
    );
    expect(completed).toContain("telegram/bot-credentials: ready");

    const readyList = runSetupCli(projectDir, ["list"]);
    expect(readyList).toContain("secret TELEGRAM_BOT_TOKEN: present");
    expect(readyList).toContain("secret TELEGRAM_ALERT_CHAT_ID: present");
    expect(readyList).not.toContain(botToken);
    expect(readyList).not.toContain(alertChat);
  });
});
