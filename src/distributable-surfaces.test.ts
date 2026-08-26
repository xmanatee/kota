import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGE = JSON.parse(
  readFileSync(resolve(ROOT, "package.json"), "utf-8"),
);

describe("CLI entry points", () => {
  it("package.json bin target exists and imports a resolvable module", () => {
    const binPath = PACKAGE.bin?.kota;
    expect(binPath).toBeDefined();

    const resolved = resolve(ROOT, binPath);
    expect(existsSync(resolved), `bin target does not exist: ${resolved}`).toBe(true);

    const content = readFileSync(resolved, "utf-8");
    const importMatch = content.match(/import\(["']([^"']+)["']\)/);
    expect(importMatch, "bin entry must contain a dynamic import").toBeTruthy();

    const importTarget = importMatch![1];
    const importResolved = resolve(resolved, "..", importTarget);
    expect(
      existsSync(importResolved),
      `built import target not found: ${importTarget} (checked ${importResolved})`,
    ).toBe(true);
  });

  it("uses the source entry point for workspace commands", () => {
    expect(PACKAGE.scripts?.kota).toBe(PACKAGE.scripts?.dev);
    expect(PACKAGE.scripts?.kota).toContain("src/cli.ts");
  });
});

describe("examples/github-actions/kota-trigger.yml", () => {
  const yamlPath = resolve(ROOT, "examples/github-actions/kota-trigger.yml");

  it("references expected env vars and webhook path shape", () => {
    expect(existsSync(yamlPath), "YAML file must exist").toBe(true);
    const content = readFileSync(yamlPath, "utf-8");

    expect(content).toContain("KOTA_WEBHOOK_SECRET");
    expect(content).toContain("KOTA_DAEMON_URL");

    expect(content).toMatch(/\/webhooks\/\$\{?WORKFLOW_NAME\}?/);
  });

  it("webhook path pattern matches the contributed control route", () => {
    const triggerRoutePath = resolve(ROOT, "src/modules/webhook/trigger-route.ts");
    expect(existsSync(triggerRoutePath), "trigger-route.ts must exist").toBe(true);
    const handlerSrc = readFileSync(triggerRoutePath, "utf-8");

    expect(
      handlerSrc.includes('/webhooks/'),
      "webhook module must contribute the /webhooks/ control route",
    ).toBe(true);
  });

  it("signature header matches the webhook module's trigger handler", () => {
    const triggerRoutePath = resolve(ROOT, "src/modules/webhook/trigger-route.ts");
    expect(existsSync(triggerRoutePath), "trigger-route.ts must exist").toBe(true);
    const handlerSrc = readFileSync(triggerRoutePath, "utf-8");

    const yamlContent = readFileSync(yamlPath, "utf-8");

    expect(yamlContent).toContain("X-Kota-Webhook-Signature");
    expect(handlerSrc).toContain("x-kota-webhook-signature");

    expect(yamlContent).toContain("X-Kota-Webhook-Timestamp");
    expect(handlerSrc).toContain("x-kota-webhook-timestamp");
  });
});
