import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { registerWebhookCommands } from "./cli.js";
import type { WebhookClient } from "./client.js";
import {
  generateWebhookSecret,
  listWebhooks,
  removeWebhookSecret,
} from "./webhook-operations.js";

type JsonFixture = string | number | boolean | null | JsonFixture[] | {
  [key: string]: JsonFixture | undefined;
};

const { FAKE_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports: vi.hoisted runs before ESM imports are initialized.
  const { join } = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports: vi.hoisted runs before ESM imports are initialized.
  const { tmpdir } = require("node:os") as typeof import("node:os");
  return { FAKE_HOME: join(tmpdir(), `kota-webhook-cli-home-${Date.now()}`) };
});

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return { ...original, homedir: () => FAKE_HOME };
});

export function cleanupFakeHome(): void {
  rmSync(FAKE_HOME, { recursive: true, force: true });
}

export function workflowDef(
  name: string,
  triggers: RegisteredWorkflowDefinitionInput["triggers"],
): RegisteredWorkflowDefinitionInput {
  return {
    name,
    triggers,
    steps: [],
    enabled: true,
    definitionPath: `src/modules/test/workflows/${name}/workflow.ts`,
  };
}

export function stubCtxWithLocalClient(
  cwd: string,
  workflows: RegisteredWorkflowDefinitionInput[] = [],
): ModuleContext {
  const ctxBase = {
    cwd,
    config: {},
    getContributedWorkflows: () => workflows,
  } as ModuleContext;
  const webhook: WebhookClient = {
    async list() {
      return listWebhooks(ctxBase);
    },
    async secretGenerate(workflow) {
      return generateWebhookSecret(ctxBase, workflow);
    },
    async secretRemove(workflow) {
      return removeWebhookSecret(ctxBase, workflow);
    },
  };
  return new Proxy(ctxBase, {
    get(target, prop, receiver) {
      if (prop === "client") return { webhook };
      return Reflect.get(target, prop, receiver);
    },
  });
}

export function makeProjectDir(): string {
  return mkdtempSync(join(tmpdir(), "kota-webhook-cli-"));
}

export function trustProjectConfig(projectDir: string): void {
  mkdirSync(join(FAKE_HOME, ".kota"), { recursive: true });
  writeFileSync(
    join(FAKE_HOME, ".kota", "config.json"),
    JSON.stringify({ trustedProjects: [projectDir] }),
  );
}

export function writeProjectConfig(projectDir: string, value: JsonFixture): void {
  mkdirSync(join(projectDir, ".kota"), { recursive: true });
  writeFileSync(join(projectDir, ".kota", "config.json"), JSON.stringify(value));
}

export function readProjectConfig(projectDir: string): JsonFixture {
  return JSON.parse(
    readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"),
  );
}

export function projectConfigExists(projectDir: string): boolean {
  return existsSync(join(projectDir, ".kota", "config.json"));
}

export function makeProgram(ctx: ModuleContext): Command {
  const program = new Command();
  program.exitOverride();
  const webhookCmd = program.command("webhook").description("Manage webhook secrets");
  registerWebhookCommands(webhookCmd, ctx);
  return program;
}

export async function captureOutput(
  fn: () => Promise<void>,
): Promise<{ out: string; err: string }> {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    outLines.push(`${args.join(" ")}\n`);
  });
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
    outLines.push(String(data));
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((data) => {
    errLines.push(String(data));
    return true;
  });
  try {
    await fn();
  } finally {
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
  return { out: outLines.join(""), err: errLines.join("") };
}
