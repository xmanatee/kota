import { realpathSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import { expandAlias, loadConfig } from "#core/config/config.js";
import { expandUserPromptReferences } from "#core/prompt-input/index.js";
import { getActiveKotaClient } from "#core/server/client-holder.js";
import { resolveKotaClient } from "#core/server/client-selector.js";
import { setSkipConfirmations } from "#core/util/confirm.js";
import {
  ProcessSignalAbortError,
  withProcessSignalAbort,
} from "#core/util/process-signal-abort.js";
import { blank, line, span } from "#modules/rendering/primitives.js";
import { createRenderingProvider } from "#modules/rendering/rendering-provider.js";
import { TerminalTransport, writeStdout } from "#modules/rendering/transport.js";
import { resolveAgentHarness, runAgentHarness } from "./core/agent-harness/index.js";
import { runAgentLoop } from "./core/loop/loop.js";
import { buildKotaSystemPrompt } from "./core/loop/system-prompt.js";
import {
  createAskUserMcpAuthorizationResolver,
  createAskUserMcpInputResolver,
} from "./core/mcp/operator-input.js";
import { formatAuthError } from "./core/model/auth-error.js";
import {
  createModelClient,
  modelProviderSelectionFromConfig,
} from "./core/model/model-client.js";
import {
  checkPresetAuth,
  PRESET_ENV_VAR,
  type Preset,
  type PresetResolution,
  resolvePreset,
} from "./core/model/preset.js";
import { discoverBundledModules } from "./core/modules/bundled-module-discovery.js";
import { discoverModules } from "./core/modules/module-discovery.js";
import { ModuleLoader } from "./core/modules/module-loader.js";
import {
  getProviderRegistry,
  initProviderRegistry,
  RENDERING_PROVIDER_TOKEN,
} from "./core/modules/provider-registry.js";
import {
  interactiveMode,
  parseIntOption,
  registerHistoryCommands,
  reportResumeCwdSelection,
  resolveRunContinue,
  runPipeLoop,
} from "./modules/history/cli.js";
import {
  openHarnessResumeConversation,
  runAgentHarnessWithConversationResume,
} from "./modules/history/harness-resume.js";
import {
  apiKeyNameForProvider,
  parseModelString,
  resolveApiKey,
  resolveModelProviderName,
} from "./modules/model-clients/factory.js";
import { runHarnessRepl } from "./modules/repl/index.js";

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

function ensureCliRenderingProvider(): void {
  const registry = getProviderRegistry() ?? initProviderRegistry();
  if (!registry.get(RENDERING_PROVIDER_TOKEN)) {
    registry.register(RENDERING_PROVIDER_TOKEN, "rendering", createRenderingProvider());
  }
}

/**
 * Announce the active preset/harness on the stderr banner before the first
 * turn. Operators need to see which preset and adapter are driving the
 * session — the banner prints `kota [<preset-id>] <model>` so a preset
 * switch is visible at a glance. Always emits to stderr so pipe consumers
 * redirect explicitly with `2>/dev/null` rather than the banner being
 * silently invisible.
 */
function announceActivePreset(args: {
  presetId: string;
  harnessOverride?: string;
  model: string;
}): void {
  const label = args.harnessOverride && args.harnessOverride !== args.presetId
    ? `${args.presetId}:${args.harnessOverride}`
    : args.presetId;
  stderr().write(
    line(
      span("kota ", "muted"),
      span(`[${label}]`, "accent"),
      span(" ", "muted"),
      span(args.model, "info"),
    ),
  );
}

/**
 * Resolve the active preset from CLI flag → KOTA_PRESET env → config.defaultPreset
 * → shipped default. Throws with a single-line error and exits when an
 * explicitly named preset is unknown.
 */
function resolveActivePreset(
  flagValue: string | undefined,
  configValue: string | undefined,
): PresetResolution & { preset: Preset } {
  try {
    return resolvePreset({
      flag: flagValue,
      env: process.env[PRESET_ENV_VAR],
      config: configValue,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    stderr().write(line(span(detail, "error")));
    process.exit(1);
  }
}

function resolveHarnessForPreset(args: {
  explicitHarness?: string;
  configHarness?: string;
  presetResolution: PresetResolution & { preset: Preset };
}): string {
  if (args.explicitHarness) return args.explicitHarness;
  if (args.presetResolution.source === "flag" || args.presetResolution.source === "env") {
    return args.presetResolution.preset.harness;
  }
  return args.configHarness ?? args.presetResolution.preset.harness;
}

/**
 * Preflight the preset's env-auth requirements before launching the harness.
 * When the harness is overridden (e.g. `--harness thin` for a local probe),
 * skip the preset auth check — the operator picked a different harness whose
 * auth requirements are not the preset's. Exits 1 with a single-line message
 * naming the preset and missing vars when the preset declares env auth and
 * none of the alternates are set.
 */
function preflightPresetAuth(preset: Preset, harnessName: string): void {
  if (harnessName !== preset.harness) return;
  const { missing } = checkPresetAuth(preset);
  if (missing.length === 0) return;
  const list = missing.join(" or ");
  stderr().write(
    line(
      span("Error: ", "error"),
      span(`preset "${preset.id}" requires `, "muted"),
      span(list, "warn"),
      span(" — set the env var or run `kota doctor --preset ", "muted"),
      span(preset.id, "info"),
      span("` to diagnose.", "muted"),
    ),
  );
  process.exit(1);
}

function warnMissingModelProviderKey(
  providerName: string | undefined,
  modelSpec: string,
  explicitApiKey: string | undefined,
  scopeRoot: string,
): void {
  const effectiveProvider = resolveModelProviderName(modelSpec, providerName);
  if (!effectiveProvider) return;
  const envName = apiKeyNameForProvider(effectiveProvider);
  if (!envName) return;
  if (resolveApiKey(effectiveProvider, explicitApiKey, { scopeRoot })) return;
  stderr().write(
    line(
      span("Warning: ", "warn"),
      span(
        `No API key configured for provider "${effectiveProvider}". Set ${envName} or config.modelProvider.apiKey.`,
        "muted",
      ),
    ),
  );
}

function isModelClientHarness(harnessName: string): boolean {
  return harnessName === "openai-tools" || harnessName === "thin";
}

function modelForHarness(modelSpec: string, harnessName: string): string {
  return isModelClientHarness(harnessName)
    ? modelSpec
    : parseModelString(modelSpec).model;
}

program
  .name("kota")
  .description("KOTA — a local-first agent automation runtime and operator control plane.")
  .version("0.1.0")
  .addHelpText(
    "after",
    `
Default client:
  bare kota on a TTY launches the shared UI CLI client.
  Use kota run <prompt> for the explicit prompt path; pipes keep one-shot behavior.
`,
  );

program
  .command("run", { isDefault: true })
  .description("Run an explicit prompt or interactive agent REPL")
  .argument("[prompt...]", "The task to perform")
  .option("-m, --model <model>", "Model. Defaults to the active preset's defaultModel. Supports provider/model notation: ollama/<model>, openai/<model>, openrouter/<model>, anthropic/<model>")
  .option("--provider <name>", "Model provider: anthropic, openai, openrouter, ollama, groq, together, lmstudio, agent-sdk (Claude Agent SDK)")
  .option("--base-url <url>", "Base URL for OpenAI-compatible provider (overrides preset)")
  .option("--editor-model <model>", "Model for editor pass and sub-agents (defaults to --model)")
  .option("--max-tokens <n>", "Max tokens per response")
  .option("-v, --verbose", "Show debug output")
  .option("-a, --architect", "Enable Architect/Editor split (two-pass reasoning)")
  .option("-i, --interactive", "Interactive mode (REPL)")
  .option("--preset <id>", `Preset bundle (claude | codex | openrouter | openrouter-lab | gemini | gemini-cli | antigravity-cli). Sets harness, default model, tiers, effort, and auth contract together. Overrides $${PRESET_ENV_VAR} and config.defaultPreset.`)
  .option("--harness <name>", "Agent harness adapter (e.g. claude-agent-sdk, thin). Overrides the active preset's harness for this run")
  .option("-s, --session <path>", "Session file for persistence/resume")
  .option("-y, --yes", "Skip confirmation prompts for destructive commands")
  .option("-t, --think", "Enable extended thinking for deeper reasoning")
  .option("--think-budget <tokens>", "Thinking budget in tokens (default: 10000, min: 1024)")
  .option("-c, --continue [id]", "Continue most recent conversation (or specify conversation ID)")
  .option("--resume-here", "Resume explicit conversations in the caller's current directory instead of the saved cwd")
  .option("--no-history", "Disable automatic conversation history")
  .option("--no-reflect", "Disable self-reflection before delivering responses")
  .option("--no-cost", "Suppress per-turn cost display")
  .action(async (promptWords: string[], opts) => {
    const parsedMaxTokens = opts.maxTokens ? parseIntOption(opts.maxTokens, "max-tokens") : undefined;
    const parsedThinkBudget = opts.thinkBudget ? parseIntOption(opts.thinkBudget, "think-budget") : undefined;

    const resumeSelection = await resolveRunContinue(getActiveKotaClient(), opts);
    reportResumeCwdSelection(resumeSelection);
    const runScopeRoot = resumeSelection?.scopeRoot ?? process.cwd();
    const config = loadConfig(runScopeRoot);

    const providerName = opts.provider || config.modelProvider?.type;
    const explicitHarness = opts.harness as string | undefined;
    const presetResolution = resolveActivePreset(opts.preset, config.defaultPreset);

    // Take the harness path whenever the operator did not name a non-agent-sdk
    // model provider. The active preset drives harness, default model, and
    // effort; `--harness` is the per-invocation escape hatch.
    const useHarnessPath =
      Boolean(explicitHarness) ||
      providerName === "agent-sdk" ||
      providerName === undefined;

    if (useHarnessPath) {
      const { preset } = presetResolution;
      const modelSpec = opts.model || config.model || preset.defaultModel;
      let prompt = promptWords.join(" ");
      prompt = expandAlias(prompt, config.aliases);
      const harnessName = resolveHarnessForPreset({
        explicitHarness,
        configHarness: config.defaultAgentHarness,
        presetResolution,
      });
      const model = modelForHarness(modelSpec, harnessName);
      const modelProvider = modelProviderSelectionFromConfig(config);
      announceActivePreset({
        presetId: preset.id,
        harnessOverride: harnessName !== preset.harness ? harnessName : undefined,
        model,
      });
      preflightPresetAuth(preset, harnessName);
      const harness = resolveAgentHarness(harnessName);
      const systemPrompt = buildKotaSystemPrompt(
        config,
        undefined,
        runScopeRoot,
        runScopeRoot,
      );
      const runOverrides = {
        verbose: opts.verbose || config.verbose || false,
        effort: preset.defaultEffort,
        systemPrompt,
        ...(modelProvider !== undefined ? { modelProvider } : {}),
      };
      const conversationOptions = resumeSelection
        ? {
            autonomyMode: resolveChannelAutonomyMode(
              config.cli?.defaultAutonomyMode,
              config,
              "cli run",
            ),
            model,
            verbose: opts.verbose || config.verbose || false,
            config,
            resumeConversation: resumeSelection.id,
            noHistory: opts.history === false,
            reflectionEnabled: opts.reflect !== false,
            showCost: opts.cost !== false && (config.serve?.showCost ?? true),
            mcpInputResolver: createAskUserMcpInputResolver(),
            mcpAuthorizationResolver: createAskUserMcpAuthorizationResolver(),
            scopeRoot: runScopeRoot,
          }
        : undefined;
      if (opts.interactive || !prompt) {
        const resumeStore = conversationOptions
          ? openHarnessResumeConversation(runScopeRoot, conversationOptions.resumeConversation)
          : undefined;
        await runHarnessRepl({
          harness,
          model,
          cwd: runScopeRoot,
          run: runOverrides,
          chrome: createRenderingProvider().createReplChrome(),
          ...(resumeStore
            ? {
                initialTranscript: resumeStore.transcript,
                onUserInput: (input: string) => {
                  resumeStore.appendUserInput(input);
                },
                onAssistantResponse: (_turn, result) => {
                  resumeStore.appendAssistantResult(result);
                },
              }
            : {}),
        });
        return;
      }
      prompt = expandUserPromptReferences(prompt, runScopeRoot).text;
      const result = await withProcessSignalAbort((abortController) =>
        runAgentHarnessWithConversationResume({
          harness,
          prompt,
          run: {
            model,
            cwd: runScopeRoot,
            ...runOverrides,
            abortController,
          },
          conversation: conversationOptions,
        }),
      );
      if (!result.streamedText && result.text) writeStdout(result.text);
      stdout().write(blank());
      if (result.isError) {
        process.exitCode = 1;
      }
      return;
    }

    const { preset: classicPreset } = presetResolution;
    const modelSpec = opts.model || config.model || classicPreset.defaultModel;
    warnMissingModelProviderKey(
      providerName,
      modelSpec,
      config.modelProvider?.apiKey,
      runScopeRoot,
    );
    const resolved = createModelClient({
      model: modelSpec,
      provider: providerName,
      baseUrl: opts.baseUrl || config.modelProvider?.baseUrl,
      apiKey: config.modelProvider?.apiKey,
      scopeRoot: runScopeRoot,
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
      resumeConversation: resumeSelection?.id,
      noHistory: opts.history === false,
      reflectionEnabled: opts.reflect !== false,
      client: resolved.client,
      showCost: opts.cost !== false && (config.serve?.showCost ?? true),
      mcpInputResolver: createAskUserMcpInputResolver(),
      mcpAuthorizationResolver: createAskUserMcpAuthorizationResolver(),
      scopeRoot: runScopeRoot,
    };

    let prompt = promptWords.join(" ");
    prompt = expandAlias(prompt, config.aliases);

    if (opts.interactive || !prompt) {
      announceActivePreset({ presetId: "classic-loop", model });
      await interactiveMode(options, config);
    } else {
      prompt = expandUserPromptReferences(prompt, runScopeRoot).text;
      announceActivePreset({ presetId: "classic-loop", model });
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

      const presetResolution = resolveActivePreset(undefined, config.defaultPreset);
      const { preset } = presetResolution;

      // The harness path runs whenever no non-agent-sdk model provider is named.
      // The active preset drives harness, default model, and effort.
      const provider = config.modelProvider?.type;
      const useHarnessPath = provider === undefined || provider === "agent-sdk";
      if (useHarnessPath) {
        const modelSpec = config.model || preset.defaultModel;
        const harnessName = resolveHarnessForPreset({
          configHarness: config.defaultAgentHarness,
          presetResolution,
        });
        const model = modelForHarness(modelSpec, harnessName);
        const modelProvider = modelProviderSelectionFromConfig(config);
        preflightPresetAuth(preset, harnessName);
        announceActivePreset({
          presetId: preset.id,
          harnessOverride: harnessName !== preset.harness ? harnessName : undefined,
          model,
        });
        const harness = resolveAgentHarness(harnessName);
        const result = await withProcessSignalAbort((abortController) =>
          runAgentHarness(harness, {
            prompt: expandUserPromptReferences(piped, process.cwd()).text,
            model,
            ...(modelProvider !== undefined ? { modelProvider } : {}),
            verbose: config.verbose,
            cwd: process.cwd(),
            effort: preset.defaultEffort,
            abortController,
            systemPrompt: buildKotaSystemPrompt(
              config,
              undefined,
              process.cwd(),
              process.cwd(),
            ),
          }),
        );
        if (!result.streamedText && result.text) writeStdout(result.text);
        stdout().write(blank());
        if (result.isError) {
          process.exitCode = 1;
        }
        return true;
      }

      await runPipeLoop(expandUserPromptReferences(piped, process.cwd()).text);
      return true;
    }
  }
  return false;
}

async function main() {
  ensureCliRenderingProvider();
  // Discover bundled and installed modules first so their registration side effects (model
  // clients, agent harness adapters, etc.) run before any pipe path or action
  // handler resolves something from a core registry.
  const bundledModules = await discoverBundledModules();
  const modules = await discoverModules(undefined, false);

  const wasPiped = await checkPipeMode();
  if (wasPiped) return;

  const config = loadConfig();
  const processProviders = getProviderRegistry();
  if (!processProviders) {
    throw new Error("CLI provider authority was not initialized");
  }
  const loader = new ModuleLoader(config, false, {
    mode: "commands",
    providerRegistry: processProviders,
  });
  await loader.loadAll(bundledModules, modules);
  // Resolve the active KotaClient exactly once: daemon when reachable,
  // otherwise a LocalKotaClient assembled from the namespace handlers
  // modules registered during load. CLI subcommands consume this through
  // ctx.client and never re-decide the daemon-vs-local policy. On the
  // daemon-up path the selector also queries the loader's daemonClient
  // factories so module-contributed handlers can override the core stub.
  await resolveKotaClient({
    localHandlers: loader.getLocalClientHandlers(),
    assembleDaemonHandlers: (transport) =>
      loader.assembleDaemonClientHandlers(transport),
  });
  for (const cmd of loader.getCommands()) {
    program.addCommand(cmd);
  }

  if (shouldLaunchDefaultOperatorConsole(process.argv, process.stdin.isTTY === true)) {
    await program.parseAsync(["navigate"], { from: "user" });
    return;
  }

  await program.parseAsync();
}

export function shouldLaunchDefaultOperatorConsole(argv: string[], stdinIsTty: boolean): boolean {
  return stdinIsTty && argv.length === 2;
}

function isCliEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  if (basename(entry) === "kota.mjs" || basename(entry) === "kota") {
    return true;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  main().catch((err) => {
    if (err instanceof ProcessSignalAbortError) {
      process.exit(err.exitCode);
    }
    const authMsg = formatAuthError(err);
    const message = authMsg ?? `Fatal: ${err.message}`;
    stderr().write(line(span(message, "error")));
    process.exit(1);
  });
}
