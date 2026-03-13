import { Command } from "commander";
import { createInterface } from "node:readline";
import { runAgentLoop } from "./loop.js";
import { setSkipConfirmations } from "./confirm.js";

const program = new Command();

program
  .name("kota")
  .description("KOTA — Keep Only The Awesome. An AI coding agent.")
  .version("0.1.0");

program
  .command("run", { isDefault: true })
  .description("Run KOTA with a prompt")
  .argument("[prompt...]", "The task to perform")
  .option("-m, --model <model>", "Model to use", "claude-sonnet-4-6")
  .option("--editor-model <model>", "Model for editor pass and sub-agents (defaults to --model)")
  .option("--max-tokens <n>", "Max tokens per response", "8192")
  .option("-v, --verbose", "Show debug output")
  .option("-a, --architect", "Enable Architect/Editor split (two-pass reasoning)")
  .option("-i, --interactive", "Interactive mode (REPL)")
  .option("-s, --session <path>", "Session file for persistence/resume")
  .option("-y, --yes", "Skip confirmation prompts for destructive commands")
  .option("-t, --think", "Enable extended thinking for deeper reasoning")
  .option("--think-budget <tokens>", "Thinking budget in tokens (default: 10000, min: 1024)", "10000")
  .action(async (promptWords: string[], opts) => {
    const prompt = promptWords.join(" ");
    if (opts.yes) setSkipConfirmations(true);
    const options = {
      model: opts.model,
      editorModel: opts.editorModel,
      maxTokens: Number.parseInt(opts.maxTokens, 10),
      verbose: opts.verbose,
      architectMode: opts.architect,
      sessionPath: opts.session,
      thinkingEnabled: opts.think,
      thinkingBudget: opts.think ? Math.max(1024, Number.parseInt(opts.thinkBudget, 10)) : undefined,
    };

    if (opts.interactive || !prompt) {
      await interactiveMode(options);
    } else {
      await runAgentLoop(prompt, options);
    }
  });

async function interactiveMode(options: {
  model: string;
  maxTokens: number;
  verbose?: boolean;
}) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr, // Use stderr for prompts so stdout stays clean
    prompt: "kota> ",
  });

  console.error("KOTA — interactive mode. Type your task, or 'exit' to quit.\n");
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input || input === "exit" || input === "quit") {
      rl.close();
      return;
    }

    try {
      await runAgentLoop(input, options);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
    }
    console.log(); // blank line between interactions
    rl.prompt();
  });

  rl.on("close", () => {
    console.error("\nGoodbye.");
    process.exit(0);
  });
}

// Handle stdin pipe mode
async function checkPipeMode() {
  if (!process.stdin.isTTY && process.argv.length <= 2) {
    // Reading from pipe
    const chunks: string[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk.toString());
    }
    const piped = chunks.join("").trim();
    if (piped) {
      await runAgentLoop(piped, {
        model: "claude-sonnet-4-6",
        maxTokens: 8192,
      });
      return true;
    }
  }
  return false;
}

async function main() {
  const wasPiped = await checkPipeMode();
  if (!wasPiped) {
    await program.parseAsync();
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
