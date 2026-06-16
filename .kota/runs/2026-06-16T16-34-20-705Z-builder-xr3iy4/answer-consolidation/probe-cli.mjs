import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import { registerAnswerCommand } from "../../../../src/modules/answer/cli.ts";

const here = dirname(fileURLToPath(import.meta.url));

const successResult = {
  ok: true,
  answer:
    "Recall ranks across stores [knowledge:k1] and prior answers [answer:a1].",
  citations: [
    { source: "knowledge", id: "k1" },
    { source: "answer", id: "a1" },
  ],
  hits: [
    {
      source: "knowledge",
      score: 1,
      id: "k1",
      title: "Recall design",
      preview: "Cross-store recall ranks typed hits.",
      updated: "2026-04-26",
    },
    {
      source: "answer",
      score: 0.8,
      id: "a1",
      query: "How does answer history work?",
      preview: "Answer history re-renders stored envelopes.",
      citationCount: 1,
      createdAt: "2026-06-16T16:00:00.000Z",
      result: { ok: true },
    },
  ],
};

const logEntries = [
  {
    id: "answer-rec-1",
    createdAt: "2026-06-16T16:00:00.000Z",
    query: "How does answer history work?",
    result: { ok: true, citationCount: 2 },
  },
  {
    id: "answer-rec-2",
    createdAt: "2026-06-16T15:59:00.000Z",
    query: "What if nothing matches?",
    result: { ok: false, reason: "no_hits" },
  },
];

const foundRecord = {
  id: "answer-rec-1",
  createdAt: "2026-06-16T16:00:00.000Z",
  query: "How does answer history work?",
  filter: { topK: 8 },
  recallHits: successResult.hits,
  result: successResult,
};

function context() {
  return {
    client: {
      answer: {
        async answer(query, filter) {
          if (query.includes("empty store")) {
            return { ok: false, reason: "no_hits" };
          }
          return { ...successResult, observedFilter: filter };
        },
        async log() {
          return { entries: logEntries };
        },
        async show(id) {
          if (id === "answer-rec-1") {
            return { ok: true, record: foundRecord };
          }
          return { ok: false, reason: "not_found" };
        },
      },
    },
  };
}

class ProcessExit extends Error {
  constructor(code) {
    super(`process.exit:${code}`);
    this.code = code;
  }
}

async function capture(args) {
  const program = new Command();
  program.name("kota");
  program.exitOverride();
  program.configureOutput({
    writeOut: (chunk) => {
      captureState.stdout += String(chunk);
    },
    writeErr: (chunk) => {
      captureState.stderr += String(chunk);
    },
  });
  registerAnswerCommand(program, context());

  const captureState = { stdout: "", stderr: "" };
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalExit = process.exit;
  process.stdout.write = (chunk) => {
    captureState.stdout += String(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    captureState.stderr += String(chunk);
    return true;
  };
  process.exit = (code = 0) => {
    throw new ProcessExit(code);
  };

  let exitCode = 0;
  try {
    await program.parseAsync(["node", "kota", ...args]);
  } catch (err) {
    if (err instanceof ProcessExit) {
      exitCode = err.code;
    } else if (err instanceof CommanderError) {
      exitCode = err.exitCode;
    } else {
      exitCode = 1;
      captureState.stderr += `${err instanceof Error ? err.stack : String(err)}\n`;
    }
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exit = originalExit;
  }

  return {
    command: `kota ${args.map(formatArg).join(" ")}`,
    exitCode,
    stdout: captureState.stdout.trimEnd(),
    stderr: captureState.stderr.trimEnd(),
  };
}

function formatArg(arg) {
  if (arg === "") return '""';
  if (/\s/.test(arg)) return JSON.stringify(arg);
  return arg;
}

const commands = [
  ["answer", "--help"],
  ["answer", "ask", "How does recall work?"],
  ["answer", "ask", "empty store"],
  ["answer", "ask", ""],
  ["answer", "log"],
  ["answer", "log", "--json"],
  ["answer", "show", "answer-rec-1"],
  ["answer", "show", "missing"],
  ["answer", "show", "missing", "--json"],
];

const results = [];
for (const command of commands) {
  results.push(await capture(command));
}

const transcript = results
  .map((result) => {
    const lines = [`$ ${result.command}`, `[exit ${result.exitCode}]`];
    if (result.stdout) {
      lines.push("stdout:", result.stdout);
    }
    if (result.stderr) {
      lines.push("stderr:", result.stderr);
    }
    return lines.join("\n");
  })
  .join("\n\n");

writeFileSync(join(here, "cli-transcript.txt"), `${transcript}\n`);
console.log(JSON.stringify({ wrote: "cli-transcript.txt", commands: results.length }));
