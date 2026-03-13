import { Command } from "commander";
import { createInterface } from "node:readline";
import { runAgentLoop } from "./loop.js";

const program = new Command();

program
  .name("kota")
  .description("KOTA — Keep Only The Awesome. An AI coding agent.")
  .version("0.1.0");

program
  .command("run", { isDefault: true })
  .description("Run KOTA with a prompt")
  .argument("[prompt...]", "The task to perform")
  .option("-m, --model <model>", "Model to use", "claude-sonnet-4-20250514")
  .option("--max-tokens <n>", "Max tokens per response", "8192")
  .option("-v, --verbose", "Show debug output")
  .option("-i, --interactive", "Interactive mode (REPL)")
  .action(async (promptWords: string[], opts) => {
    const prompt = promptWords.join(" ");
    const options = {
      model: opts.model,
      maxTokens: Number.parseInt(opts.maxTokens, 10),
      verbose: opts.verbose,
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
        model: "claude-sonnet-4-20250514",
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
