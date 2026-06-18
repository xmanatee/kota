import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const artifactDir = dirname(fileURLToPath(import.meta.url));
const createdTitle = `Knowledge consolidation CLI probe ${Date.now()}`;
const createdContent =
  "transcript deterministic knowledge fan-out proof for the current builder run";

const transcript = [];
const summary = {
  generatedAt: new Date().toISOString(),
  createdTitle,
  createdId: null,
  commands: [],
  cleanup: "not-started",
};

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function commandLine(args) {
  return ["node", "--conditions=source", "--import", "tsx", "src/cli.ts", ...args]
    .map(shellQuote)
    .join(" ");
}

function run(args, options = {}) {
  const command = commandLine(args);
  transcript.push(`$ ${command}`);
  const result = spawnSync(
    "node",
    ["--conditions=source", "--import", "tsx", "src/cli.ts", ...args],
    {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    },
  );
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (stdout.trim().length > 0) transcript.push(stdout.trimEnd());
  if (stderr.trim().length > 0) transcript.push(stderr.trimEnd());
  transcript.push(`[exit ${result.status ?? 1}]`, "");
  const record = {
    command,
    status: result.status ?? 1,
    expectedStatus: options.expectedStatus ?? 0,
  };
  summary.commands.push(record);
  if (record.status !== record.expectedStatus) {
    record.mismatch = true;
  }
  return { ...result, stdout, stderr, status: result.status ?? 1 };
}

function parseCreatedId(stdout) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = lines[i].match(/\b[a-f0-9]{8}\b/);
    if (match) return match[0];
  }
  return null;
}

run(["--help"]);
run(["knowledge", "--help"]);
run(["knowledge", "list", "--help"]);
run(["knowledge", "search", "--help"]);

const add = run([
  "knowledge",
  "add",
  "--title",
  createdTitle,
  "--content",
  createdContent,
  "--type",
  "note",
  "--tag",
  "fan-out",
]);

summary.createdId = parseCreatedId(add.stdout);

run(["knowledge", "search", "transcript deterministic knowledge fan-out"]);
run(
  [
    "knowledge",
    "search",
    "transcript deterministic knowledge fan-out",
    "--semantic",
  ],
  { expectedStatus: 1 },
);

if (summary.createdId) {
  run(["knowledge", "show", summary.createdId]);
  const del = run(["knowledge", "delete", summary.createdId]);
  summary.cleanup = del.status === 0 ? "deleted-created-entry" : "delete-failed";
  run(["knowledge", "search", "transcript deterministic knowledge fan-out"]);
} else {
  summary.cleanup = "skipped-no-created-id";
}

writeFileSync(join(artifactDir, "cli-transcript.txt"), transcript.join("\n"));
writeFileSync(join(artifactDir, "cli-summary.json"), JSON.stringify(summary, null, 2) + "\n");

if (summary.commands.some((command) => command.mismatch) || summary.cleanup !== "deleted-created-entry") {
  process.exitCode = 1;
}
