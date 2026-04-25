import { Command } from "commander";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import { expandAlias, loadConfig } from "#core/config/config.js";
import { expandUserPromptReferences } from "#core/prompt-input/index.js";
import { getActiveKotaClient } from "#core/server/client-holder.js";
import { resolveKotaClient } from "#core/server/client-selector.js";
import { setSkipConfirmations } from "#core/util/confirm.js";
import { blank, line, span } from "#modules/rendering/primitives.js";
import { TerminalTransport } from "#modules/rendering/transport.js";
import { resolveAgentHarness, runAgentHarness } from "./core/agent-harness/index.js";
import { runAgentLoop } from "./core/loop/loop.js";
import { buildKotaSystemPrompt } from "./core/loop/system-prompt.js";
import { formatAuthError } from "./core/model/auth-error.js";
import { createModelClient } from "./core/model/model-client.js";
import { discoverModules } from "./core/modules/module-discovery.js";
import { ModuleLoader } from "./core/modules/module-loader.js";
import { discoverProjectModules } from "./core/modules/project-discovery.js";
import { runHarnessRepl } from "./core/repl/index.js";
import {
  interactiveMode,
  parseIntOption,
  registerHistoryCommands,
  resolveRunContinue,
  runPipeLoop,
} from "./modules/history/cli.js";
import { parseModelString, resolveApiKey } from "./modules/model-clients/factory.js";

export { formatAuthError } from "./core/model/auth-error.js";
export { parseIntOption } from "./modules/history/cli.js";

let stderrRenderer: TerminalTransport | null = null;
function stderr(): TerminalTransport {
  if (!stderrRenderer) stderrRenderer = new TerminalTransport({ stream: process.stderr });
  return stderrRenderer;
}

let stdoutRenderer: TerminalTransport | null = null;
function stdout(): TerminalTransport {
  if (!stdoutRenderer) stdoutRenderer = new TerminalTransport({ stream: process.stdout });
  return stdoutRenderer;
}

const program = new Command();

/**
 * Announce the active harness on the stderr banner before the first turn.
 * Operators need to see which adapter is driving the session — claude-agent-sdk,
 * thin, or the classic ModelClient loop — so switching harnesses via
 * --provider or config.defaultAgentHarness is visible, not silent.
 * Skipped when stderr is not a TTY so scripted pipelines stay quiet.
 */
function announceActiveHarness(harness: string, model: string): void {
  if (!process.stderr.isTTY) return;
  stderr().write(
    line(
      span("kota ", "muted"),
      span(`[${harness}]`, "accent"),
      span(" ", "muted"),
      span(model, "info"),
    ),
  );
}

function ensureAnthropicApiKey(
  providerName: string | undefined,
  modelSpec: string,
  explicitApiKey: string | undefined,
): void {
  const effectiveProvider = providerName || parseModelString(modelSpec).provider || "anthropic";
  if (effectiveProvider !== "anthropic") return;
  if (resolveApiKey("anthropic", explicitApiKey)) return;
  const message = formatAuthError(
    new Error("Could not resolve authentication method. Expected apiKey to be set."),
  ) ?? "Error: ANTHROPIC_API_KEY environment variable is not set.";
  stderr().write(line(span(message, "error")));
  process.exit(1);
}

program
  .name("kota")
  .description("KOTA — Keep Only The Awesome. A general-purpose AI agent.")
  .version("0.1.0");

program
  .command("run", { isDefault: true })
  .description("Run KOTA with a prompt")
  .argument("[prompt...]", "The task to perform")
  .option("-m, --model <model>", "Model (default: claude-sonnet-4-6). Supports provider/model notation: ollama/llama3, openai/gpt-4o")
  .option("--provider <name>", "Model provider: anthropic, openai, ollama, groq, together, lmstudio, agent-sdk (Claude Agent SDK)")
  .option("--base-url <url>", "Base URL for OpenAI-compatible provider (overrides preset)")
  .option("--editor-model <model>", "Model for editor pass and sub-agents (defaults to --model)")
  .option("--max-tokens <n>", "Max tokens per response")
  .option("-v, --verbose", "Show debug output")
  .option("-a, --architect", "Enable Architect/Editor split (two-pass reasoning)")
  .option("-i, --interactive", "Interactive mode (REPL)")
  .option("--harness <name>", "Agent harness adapter (e.g. claude-agent-sdk, thin). Overrides --provider and config.defaultAgentHarness for this run")
  .option("-s, --session <path>", "Session file for persistence/resume")
  .option("-y, --yes", "Skip confirmation prompts for destructive commands")
  .option("-t, --think", "Enable extended thinking for deeper reasoning")
  .option("--think-budget <tokens>", "Thinking budget in tokens (default: 10000, min: 1024)")
  .option("-c, --continue [id]", "Continue most recent conversation (or specify conversation ID)")
  .option("--no-history", "Disable automatic conversation history")
  .option("--no-reflect", "Disable self-reflection before delivering responses")
  .option("--no-cost", "Suppress per-turn cost display")
  .action(async (promptWords: string[], opts) => {
    const parsedMaxTokens = opts.maxTokens ? parseIntOption(opts.maxTokens, "max-tokens") : undefined;
    const parsedThinkBudget = opts.thinkBudget ? parseIntOption(opts.thinkBudget, "think-budget") : undefined;

    const config = loadConfig();

    const providerName = opts.provider || config.modelProvider?.type;
    const explicitHarness = opts.harness as string | undefined;
    if (explicitHarness || providerName === "agent-sdk") {
      const modelSpec = opts.model || config.model || "claude-sonnet-4-6";
      const { model } = parseModelString(modelSpec);
      let prompt = promptWords.join(" ");
      prompt = expandAlias(prompt, config.aliases);
      // Operators pick the adapter explicitly via --harness or from
      // config.defaultAgentHarness. No silent pin: if neither is set, fail
      // loudly via the registry rather than quietly resolving to claude.
      const harnessName = explicitHarness ?? config.defaultAgentHarness;
      if (!harnessName) {
        stderr().write(
          line(
            span(
              "No agent harness configured: set --harness <name> or config.defaultAgentHarness. No implicit default.",
              "error",
            ),
          ),
        );
        process.exit(1);
      }
      const harness = resolveAgentHarness(harnessName);
      const systemPrompt = buildKotaSystemPrompt(
        config,
        undefined,
        process.cwd(),
        process.cwd(),
      );
      const runOverrides = {
        verbose: opts.verbose || config.verbose || false,
        effort: "xhigh" as const,
        systemPrompt,
      };
      if (opts.interactive || !prompt) {
        announceActiveHarness(harnessName, model);
        await runHarnessRepl({
          harness,
          model,
          cwd: process.cwd(),
          run: runOverrides,
        });
        return;
      }
      prompt = expandUserPromptReferences(prompt, process.cwd()).text;
      announceActiveHarness(harnessName, model);
      const result = await runAgentHarness(harness, {
        prompt,
        model,
        cwd: process.cwd(),
        ...runOverrides,
      });
      if (!result.streamedText && result.text) process.stdout.write(result.text);
      stdout().write(blank());
      return;
    }

    const modelSpec = opts.model || config.model || "claude-sonnet-4-6";
    ensureAnthropicApiKey(providerName, modelSpec, config.modelProvider?.apiKey);
    const resolved = createModelClient({
      model: modelSpec,
      provider: providerName,
      baseUrl: opts.baseUrl || config.modelProvider?.baseUrl,
      apiKey: config.modelProvider?.apiKey,
    });
    const model = resolved.model;
    const editorModel = opts.editorModel || config.editorModel;
    const maxTokens = parsedMaxTokens || config.maxTokens || 8192;
    const verbose = opts.verbose || config.verbose || false;
    const architectEnabled =
      opts.architect || (config.modules?.architect as { enabled?: boolean } | undefined)?.enabled || false;
    if (architectEnabled) {
      config.modules = {
        ...config.modules,
        architect: {
          ...(config.modules?.architect ?? {}),
          enabled: true,
        },
      };
    }
    const thinkEnabled = opts.think || config.thinking || false;
    const thinkBudget = parsedThinkBudget
      ? Math.max(1024, parsedThinkBudget)
      : (config.thinkingBudget || 10000);
    const skipConfirm = opts.yes || config.skipConfirmations || false;

    if (skipConfirm) setSkipConfirmations(true);

    const resumeId = await resolveRunContinue(getActiveKotaClient(), opts);

    const options = {
      autonomyMode: resolveChannelAutonomyMode(
        config.cli?.defaultAutonomyMode,
        config,
        "cli run",
      ),
      model,
      editorModel,
      maxTokens,
      verbose,
      sessionPath: opts.session,
      thinkingEnabled: thinkEnabled,
      thinkingBudget: thinkEnabled ? Math.max(1024, thinkBudget) : undefined,
      config,
      resumeConversation: resumeId,
      noHistory: opts.history === false,
      reflectionEnabled: opts.reflect !== false,
      client: resolved.client,
      showCost: opts.cost !== false && (config.serve?.showCost ?? true),
    };

    let prompt = promptWords.join(" ");
    prompt = expandAlias(prompt, config.aliases);

    if (opts.interactive || !prompt) {
      announceActiveHarness("classic-loop", model);
      await interactiveMode(options, config);
    } else {
      prompt = expandUserPromptReferences(prompt, process.cwd()).text;
      announceActiveHarness("classic-loop", model);
      await runAgentLoop(prompt, options);
    }
  });

registerHistoryCommands(program);

// Handle stdin pipe mode
async function checkPipeMode() {
  if (!process.stdin.isTTY && process.argv.length <= 2) {
    const chunks: string[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk.toString());
    }
    const piped = chunks.join("").trim();
    if (piped) {
      const config = loadConfig();

      if (config.modelProvider?.type === "agent-sdk") {
        const modelSpec = config.model || "claude-sonnet-4-6";
        const { model } = parseModelString(modelSpec);
        const harnessName = config.defaultAgentHarness;
        if (!harnessName) {
          stderr().write(
            line(
              span(
                'No agent harness configured: set config.defaultAgentHarness when modelProvider.type is "agent-sdk". No implicit default.',
                "error",
              ),
            ),
          );
          process.exit(1);
        }
        announceActiveHarness(harnessName, model);
        const harness = resolveAgentHarness(harnessName);
        const result = await runAgentHarness(harness, {
          prompt: expandUserPromptReferences(piped, process.cwd()).text,
          model,
          verbose: config.verbose,
          cwd: process.cwd(),
          effort: "xhigh",
          systemPrompt: buildKotaSystemPrompt(
            config,
            undefined,
            process.cwd(),
            process.cwd(),
          ),
        });
        if (!result.streamedText && result.text) process.stdout.write(result.text);
        stdout().write(blank());
        return true;
      }

      await runPipeLoop(expandUserPromptReferences(piped, process.cwd()).text);
      return true;
    }
  }
  return false;
}

async function main() {
  // Discover project modules first so their registration side effects (model
  // clients, agent harness adapters, etc.) run before any pipe path or action
  // handler resolves something from a core registry.
  const projectModules = await discoverProjectModules();
  const modules = await discoverModules(undefined, false);

  const wasPiped = await checkPipeMode();
  if (wasPiped) return;

  const config = loadConfig();
  const loader = new ModuleLoader(config, false, { commandsOnly: true });
  await loader.loadAll(projectModules, modules);
  // Resolve the active KotaClient exactly once: daemon when reachable,
  // otherwise a LocalKotaClient assembled from the namespace handlers
  // modules registered during load. CLI subcommands consume this through
  // ctx.client and never re-decide the daemon-vs-local policy.
  resolveKotaClient({ localHandlers: loader.getLocalClientHandlers() });
  for (const cmd of loader.getCommands()) {
    program.addCommand(cmd);
  }

  await program.parseAsync();
}

main().catch((err) => {
  const authMsg = formatAuthError(err);
  const message = authMsg ?? `Fatal: ${err.message}`;
  stderr().write(line(span(message, "error")));
  process.exit(1);
});
