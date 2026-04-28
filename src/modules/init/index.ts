import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import type { KotaModule } from "#core/modules/module-types.js";
import { REPO_INBOX_DIR, REPO_TASK_STATES, REPO_TASKS_DIR } from "#modules/repo-tasks/repo-tasks-domain.js";

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
- Move items out once they are understood, following the destination
  directory's local contract.
`;

const TASKS_AGENTS_STUB = `# Tasks

This directory is the live work queue.

- \`data/inbox/\` is for quick captures and owner ideas.
- Only normalized work specs belong here.
- State and priority are separate: priority describes importance; state
  describes scheduling/lifecycle.
- Use \`pnpm kota task create\` to scaffold tasks. The scaffold and validator
  are the schema boundary.
`;

const TASK_STATE_AGENTS_STUBS: Record<string, string> = {
  ready: `# Ready

This state is the short execution queue.

- Keep only actionable normalized tasks here.
- Items here should be specific enough for a builder to pick up without
  re-scoping.
- Keep the queue short and intentionally selected for near-term work.
`,
  doing: `# Doing

This state is for active work in progress.

- Keep WIP low.
- A task should move here only when a human or workflow is actively working on it.
- Do not use this as a reservation or parking state.
- If work stalls or pauses, move it to the state that reflects reality instead
  of leaving it here.
`,
  backlog: `# Backlog

This state is the normalized reserve queue.

- Keep only normalized tasks here: valid future work that is not selected for
  immediate execution.
- Priority is independent from this state.
- Do not use backlog for rough captures, blocked work, or forgotten work.
- Promote an item when it should enter the short execution queue; drop it when
  it is no longer worth doing.
`,
  blocked: `# Blocked

This state is for normalized work that cannot currently advance.

- Use this only when a specific condition must change before the task can
  proceed. Do not use it for deprioritization.
- The task body must state the unblock precondition in the validator-supported
  format so automation can re-check it without reinterpreting prose.
- Keep blockers fresh. If the condition changes, move the task to the state
  that matches its new lifecycle.
`,
  done: `# Done

This state is for completed work.

- Keep the task record concise, factual, and outcome-focused.
- Use this only when the task's Done When criteria are actually satisfied.
- Do not keep open-ended follow-up work here; create a new task instead.
`,
  dropped: `# Dropped

This state is for normalized work that was consciously dismissed.

- Record the reason briefly in the task body.
- Use this state for conscious decisions, not forgotten work or temporary
  deprioritization.
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
        console.log("  3. See docs/ for reference documentation.");
      });
    return [cmd];
  },
};

export default initModule;
