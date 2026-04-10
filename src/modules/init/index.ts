import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import type { KotaModule } from "../../module-types.js";
import { REPO_INBOX_DIR, REPO_TASK_STATES, REPO_TASKS_DIR } from "../repo-tasks/repo-tasks.js";

const KOTA_CONFIG_TEMPLATE = `import type { KotaConfig } from "kota/module";

const config: KotaConfig = {
  // Model selection (default: claude-sonnet-4-6)
  // model: "claude-sonnet-4-6",

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

const INBOX_AGENTS_STUB = `# Inbox

This state is for newly captured ideas that have not been triaged yet.

- Keep entries concise.
- Rough captures are allowed here.
- Use filename convention: \`task-<slug>.md\`.
- Move items out quickly once they are understood.
`;

const TASKS_AGENTS_STUB = `# Tasks

This directory is the live work queue.

- \`data/inbox/\` is for quick captures and owner ideas.
- Only normalized work specs belong here.
- Pull actionable work from \`ready/\`.
`;

const TASK_STATE_AGENTS_STUBS: Record<string, string> = {
  ready: `# Ready

This state is the actionable pull queue.

- Keep it short and prioritized.
- Items here should be specific enough to execute without deep re-scoping.
- Pull from here before creating new work.
`,
  doing: `# Doing

This state is for active work in progress.

- Keep WIP low.
- A task should move here only when somebody is actively working on it.
- If work stalls on an external blocker, move it to \`blocked/\`.
`,
  backlog: `# Backlog

This state is for unscheduled work that is not yet ready to pull.

- Items here may need scoping, research, or prerequisite work.
- Promote to \`ready/\` when an item becomes actionable.
`,
  blocked: `# Blocked

This state is for work that cannot currently advance.

- The task body should make the blocker explicit.
- Move blocked work back to \`ready/\` when it becomes actionable again.
`,
  done: `# Done

This state is for completed work.

- Do not edit completed tasks unless correcting factual errors.
- Use this directory as a historical record.
`,
  dropped: `# Dropped

This state is for intentionally deprioritized work.

- Include a brief reason for dropping in the task body.
- May be reconsidered later if circumstances change.
`,
};

const DOCS_AGENTS_STUB = `# Docs

This directory contains durable reference documentation for this project.

- Keep docs concise, high-level, and current.
- Prefer one clear source of truth per topic.
- Update docs when the behavior they describe changes.
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
  maybeWrite(join(inboxDir, "AGENTS.md"), INBOX_AGENTS_STUB);

  const tasksDir = join(projectDir, REPO_TASKS_DIR);
  ensureDir(tasksDir);
  maybeWrite(join(tasksDir, "AGENTS.md"), TASKS_AGENTS_STUB);
  for (const state of REPO_TASK_STATES) {
    const stateDir = join(tasksDir, state);
    ensureDir(stateDir);
    maybeWrite(join(stateDir, "AGENTS.md"), TASK_STATE_AGENTS_STUBS[state]);
  }

  // docs/
  const docsDir = join(projectDir, "docs");
  ensureDir(docsDir);
  maybeWrite(join(docsDir, "AGENTS.md"), DOCS_AGENTS_STUB);

  // .kota/ runtime directory
  const kotaDir = join(projectDir, ".kota");
  ensureDir(kotaDir);

  return { created, skipped };
}

const initModule: KotaModule = {
  name: "init",
  version: "1.0.0",
  description: "Scaffolds a new KOTA project",

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
        console.log("  3. See docs/ for reference documentation.");
      });
    return [cmd];
  },
};

export default initModule;
