#!/usr/bin/env node
// Scan KOTA run artifacts for agent-progress filler phrases.
//
// Usage:
//   node scripts/scan-run-filler.mjs [--runs-dir <dir>] [--include-events] [--since <iso>]
//
// Default scan covers the persisted-summary surface a reviewer reads first
// (metadata.json plus steps/*.json, excluding the raw SDK event log). Pass
// --include-events to also scan steps/*.events.jsonl.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FILLER_PATTERNS = [
  /\bNow let me\b/g,
  /\bLet me (check|look|verify|run|see|read|find|grep|search|examine|inspect|now)\b/gi,
  /\bI'll (check|look|verify|run|see|read|find|grep|search|examine|inspect|now|start|begin|implement|add|create|write|update|fix|investigate|first|next)\b/gi,
  /\bI will (check|look|verify|run|see|read|find|grep|search|examine|inspect|now|start|begin|implement|add|create|write|update|fix|investigate|first|next)\b/gi,
  /\bNow I'll\b/g,
  /\bNow I'm going to\b/g,
  /\bFirst,? I'll\b/g,
  /\bNext,? I'll\b/g,
];

function parseArgs(argv) {
  const opts = { runsDir: ".kota/runs", includeEvents: false, since: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--runs-dir") opts.runsDir = argv[++i];
    else if (arg === "--include-events") opts.includeEvents = true;
    else if (arg === "--since") opts.since = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: scan-run-filler.mjs [--runs-dir <dir>] [--include-events] [--since <iso>]",
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function listRunDirs(runsDir) {
  return readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listScanFiles(runDir, includeEvents) {
  const files = [];
  const metadataPath = join(runDir, "metadata.json");
  try {
    statSync(metadataPath);
    files.push(metadataPath);
  } catch {}
  const stepsDir = join(runDir, "steps");
  let stepEntries;
  try {
    stepEntries = readdirSync(stepsDir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of stepEntries) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".json")) files.push(join(stepsDir, entry.name));
    else if (includeEvents && entry.name.endsWith(".events.jsonl"))
      files.push(join(stepsDir, entry.name));
  }
  return files;
}

function countFiller(text) {
  let total = 0;
  for (const pattern of FILLER_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) total += matches.length;
  }
  return total;
}

function runStartedAt(runDirName) {
  // Run dirs start with ISO-ish prefix: 2026-04-22T04-13-50-676Z-...
  const match = runDirName.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/);
  if (!match) return null;
  // Convert "2026-04-22T04-13-50-676Z" → "2026-04-22T04:13:50.676Z"
  const [, raw] = match;
  const iso = raw.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, "T$1:$2:$3.$4Z");
  return new Date(iso);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const runs = listRunDirs(opts.runsDir);
  const sinceDate = opts.since ? new Date(opts.since) : null;

  let totalRuns = 0;
  let runsWithFiller = 0;
  let totalHits = 0;
  const perRun = [];

  for (const name of runs) {
    if (sinceDate) {
      const startedAt = runStartedAt(name);
      if (startedAt && startedAt < sinceDate) continue;
    }
    const runDir = join(opts.runsDir, name);
    const files = listScanFiles(runDir, opts.includeEvents);
    let runHits = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      runHits += countFiller(text);
    }
    totalRuns += 1;
    totalHits += runHits;
    if (runHits > 0) {
      runsWithFiller += 1;
      perRun.push({ run: name, hits: runHits });
    }
  }

  perRun.sort((a, b) => b.hits - a.hits);
  console.log(`Scanned ${totalRuns} run(s) under ${opts.runsDir}`);
  console.log(
    `Runs with filler: ${runsWithFiller} (${
      totalRuns ? ((runsWithFiller / totalRuns) * 100).toFixed(1) : "0.0"
    }%)`,
  );
  console.log(`Total filler hits: ${totalHits}`);
  if (opts.includeEvents) console.log("(included events.jsonl raw SDK logs)");
  if (perRun.length > 0) {
    console.log("\nTop runs by filler density:");
    for (const entry of perRun.slice(0, 10)) {
      console.log(`  ${entry.hits.toString().padStart(4)}  ${entry.run}`);
    }
  }
}

main();
