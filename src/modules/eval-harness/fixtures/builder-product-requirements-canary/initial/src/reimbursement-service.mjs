import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--input" || key === "--output" || key === "--actor" || key === "--request-id") {
      if (!value) throw new Error(`${key} requires a value`);
      args[key.slice(2)] = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${key}`);
  }
  for (const required of ["input", "output", "actor", "request-id"]) {
    if (!args[required]) throw new Error(`Missing --${required}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const outputPath = resolve(args.output);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      schemaVersion: 1,
      source: {
        inputPath: args.input,
        actorId: args.actor,
        requestId: args["request-id"],
        runToken: process.env.REQUIREMENTS_RUN_TOKEN ?? null
      },
      note: "TODO: implement the reimbursement policy from docs/product-brief.md and docs/follow-up-change.md",
      decisions: []
    },
    null,
    2
  )
);
