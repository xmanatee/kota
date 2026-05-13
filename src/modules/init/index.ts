import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import type { KotaModule } from "#core/modules/module-types.js";
import {
  REPO_INBOX_DIR,
  REPO_TASK_STATES,
  REPO_TASKS_DIR,
} from "#modules/repo-tasks/repo-tasks-domain.js";

const KOTA_CONFIG_TEMPLATE = `import type { KotaConfig } from "kota/module";

const config: KotaConfig = {
  // Active preset bundle (claude | codex | gemini). Selects harness, default
  // model, fast/balanced/capable tier mapping, default reasoning effort, and
  // required env vars together. Override per-run with \`--preset <id>\` or
  // \`KOTA_PRESET=<id>\`. Defaults to "codex" when unset.
  // defaultPreset: "codex",

  // Optional explicit override for the active preset's defaultModel. Most
  // operators leave this unset and let the preset drive.
  // model: "<provider-specific model id>",

  // Modules — uncomment and configure the ones you need.
  modules: {
    // Telegram notifications (requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars)
    // "telegram": {
    //   botToken: process.env.TELEGRAM_BOT_TOKEN,
    //   chatId: process.env.TELEGRAM_CHAT_ID,
    // },

    // Slack notifications (requires SLACK_WEBHOOK_URL env var)
    // "slack": {
    //   webhookUrl: process.env.SLACK_WEBHOOK_URL,
    // },

    // Webhook notifications (generic HTTP POST on workflow events)
    // "webhook": {
    //   url: "https://your-endpoint.example.com/kota",
    //   secret: process.env.WEBHOOK_SECRET,
    // },
  },
};

export default config;
`;

type ScaffoldResult = { created: string[]; skipped: string[] };

export function runInit(projectDir: string, force: boolean): ScaffoldResult {
  const created: string[] = [];
  const skipped: string[] = [];

  function maybeWrite(filePath: string, content: string, overwrite = false): void {
    if (existsSync(filePath) && !overwrite) {
      skipped.push(filePath);
      return;
    }
    writeFileSync(filePath, content, "utf-8");
    created.push(filePath);
  }

  function ensureDir(dirPath: string): void {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  // kota.config.ts
  const configPath = join(projectDir, "kota.config.ts");
  maybeWrite(configPath, KOTA_CONFIG_TEMPLATE, force);

  // data/ queue layout
  const dataDir = join(projectDir, "data");
  ensureDir(dataDir);

  const inboxDir = join(projectDir, REPO_INBOX_DIR);
  ensureDir(inboxDir);

  const tasksDir = join(projectDir, REPO_TASKS_DIR);
  ensureDir(tasksDir);
  for (const state of REPO_TASK_STATES) {
    const stateDir = join(tasksDir, state);
    ensureDir(stateDir);
  }

  // docs/
  const docsDir = join(projectDir, "docs");
  ensureDir(docsDir);

  // .kota/ runtime directory
  const kotaDir = join(projectDir, ".kota");
  ensureDir(kotaDir);

  return { created, skipped };
}

const initModule: KotaModule = {
  name: "init",
  version: "1.0.0",
  description: "Scaffolds a new KOTA project",
  dependencies: ["repo-tasks"],

  commands: () => {
    const cmd = new Command("init")
      .description("Scaffold a new KOTA project in the current directory")
      .option("--force", "Overwrite kota.config.ts even if it already exists")
      .action((opts: { force?: boolean }) => {
        const projectDir = process.cwd();
        const { created, skipped } = runInit(projectDir, opts.force ?? false);

        if (created.length > 0) {
          console.log("Created:");
          for (const f of created) {
            console.log(`  ${f}`);
          }
        }

        if (skipped.length > 0) {
          console.log("Skipped (already exist):");
          for (const f of skipped) {
            console.log(`  ${f}`);
          }
        }

        console.log();
        console.log("Project scaffolded. Next steps:");
        console.log("  1. Review kota.config.ts and uncomment any modules you need.");
        console.log("  2. Run `kota doctor` to verify your setup.");
      });
    return [cmd];
  },
};

export default initModule;
