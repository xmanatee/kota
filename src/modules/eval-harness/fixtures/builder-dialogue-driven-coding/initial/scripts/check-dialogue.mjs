#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const scopeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const transcriptPath = ".kota/dialogue-simulator/transcript.json";
const resultPath = "dialogue-result.json";
const sourcePath = "src/notification-copy.mjs";
const testCommand = "node --test test/notification-copy.test.mjs";
const verificationCommand = "node scripts/check-dialogue.mjs";
const requiredFacts = {
  requirementId: "nova-launch-sms-v1",
  channel: "sms",
  prefix: "Text alert",
  preserveInputTime: true,
};

class CheckError extends Error {
  constructor(message) {
    super(message);
    this.name = "CheckError";
  }
}

function fail(message) {
  throw new CheckError(message);
}

function readJson(relativePath) {
  const absolute = join(scopeRoot, relativePath);
  if (!existsSync(absolute)) fail(`missing JSON file: ${relativePath}`);
  try {
    return JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`);
  }
}

function writeJson(relativePath, value) {
  const absolute = join(scopeRoot, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFact(facts, key, expected) {
  if (facts[key] !== expected) {
    fail(`elicited fact ${key} must be ${JSON.stringify(expected)}`);
  }
}

function validateTranscript(transcript) {
  if (!isRecord(transcript)) fail("transcript must be a JSON object");
  if (transcript.schemaVersion !== 1) fail("transcript schemaVersion must be 1");
  if (!Array.isArray(transcript.turns)) fail("transcript turns must be an array");
  if (transcript.turns.length < 1) fail("transcript must contain at least one clarifying turn");
  if (transcript.turns.length > 2) fail("transcript exceeds the two-turn dialogue budget");
  const badTurns = transcript.turns.filter((turn) => turn.classification !== "relevant");
  if (badTurns.length > 0) {
    fail(`transcript contains irrelevant, repeated, or excessive question turn(s): ${badTurns.map((turn) => turn.turn).join(", ")}`);
  }
  const helpfulTurns = transcript.turns.filter(
    (turn) => isRecord(turn.response) && turn.response.kind === "requirement-answer",
  );
  if (helpfulTurns.length !== 1) {
    fail(`transcript must contain exactly one requirement-answer turn; got ${helpfulTurns.length}`);
  }
  const facts = helpfulTurns[0].response.facts;
  if (!isRecord(facts)) fail("requirement-answer turn must include facts");
  requireFact(facts, "requirementId", requiredFacts.requirementId);
  requireFact(facts, "channel", requiredFacts.channel);
  requireFact(facts, "prefix", requiredFacts.prefix);
  requireFact(facts, "preserveInputTime", requiredFacts.preserveInputTime);
  return {
    turns: transcript.turns,
    elicitedFacts: {
      requirementId: facts.requirementId,
      channel: facts.channel,
      prefix: facts.prefix,
      preserveInputTime: facts.preserveInputTime,
    },
  };
}

function runLocalTests() {
  const result = spawnSync(process.execPath, ["--test", "test/notification-copy.test.mjs"], {
    cwd: scopeRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  return {
    command: testCommand,
    status: result.status,
    signal: result.signal,
    stdoutTail: result.stdout.slice(-1200),
    stderrTail: result.stderr.slice(-1200),
    error: result.error?.message,
  };
}

function sourceText() {
  return readFileSync(join(scopeRoot, sourcePath), "utf8");
}

async function loadImplementation() {
  const url = pathToFileURL(join(scopeRoot, sourcePath));
  url.search = `check=${Date.now()}`;
  return import(url.href);
}

function expectedLabel(facts, productName, launchAtUtc) {
  return `${facts.prefix}: ${productName} launches at ${launchAtUtc}`;
}

function validateImplementationOutput(formatLaunchNotification, facts, source) {
  const primary = formatLaunchNotification({
    productName: "Nova",
    launchAtUtc: "09:00 UTC",
    channel: facts.channel,
  });
  const holdout = formatLaunchNotification({
    productName: "Orion",
    launchAtUtc: "14:30 UTC",
    channel: facts.channel,
  });
  const expectedPrimary = expectedLabel(facts, "Nova", "09:00 UTC");
  const expectedHoldout = expectedLabel(facts, "Orion", "14:30 UTC");
  if (primary !== expectedPrimary) {
    fail(`primary label does not reflect simulator answer; expected ${JSON.stringify(expectedPrimary)}, got ${JSON.stringify(primary)}`);
  }
  if (holdout !== expectedHoldout) {
    fail("implementation hardcodes the Nova example instead of using product and time inputs");
  }
  if (!source.includes("sms")) {
    fail("source does not encode the simulator-provided sms channel requirement");
  }
  if (source.includes(expectedPrimary) || source.includes("Nova launches at 09:00 UTC")) {
    fail("source hardcodes the primary Nova label instead of deriving it from inputs");
  }
  return {
    sourcePath,
    outputs: { primary, holdout },
    answerInfluence: ["channel:sms", "prefix:Text alert", "input-time-preserved"],
  };
}

async function runMain({ metricOnly }) {
  rmSync(join(scopeRoot, resultPath), { force: true });
  const transcript = validateTranscript(readJson(transcriptPath));
  const tests = runLocalTests();
  if (tests.status !== 0 || tests.error !== undefined) {
    fail(`local tests failed: ${tests.stderrTail || tests.stdoutTail || tests.error}`);
  }
  const implementation = await loadImplementation();
  if (typeof implementation.formatLaunchNotification !== "function") {
    fail("src/notification-copy.mjs must export formatLaunchNotification");
  }
  const implementationEvidence = validateImplementationOutput(
    implementation.formatLaunchNotification,
    transcript.elicitedFacts,
    sourceText(),
  );
  const result = {
    schemaVersion: 1,
    status: "passed",
    transcript: {
      turnCount: transcript.turns.length,
      turns: transcript.turns,
    },
    elicitedFacts: transcript.elicitedFacts,
    finalDecision: {
      requirementId: transcript.elicitedFacts.requirementId,
      channel: transcript.elicitedFacts.channel,
      labelPattern: "Text alert: <product> launches at <time>",
    },
    verificationCommand,
    localTests: tests,
    implementationEvidence,
    dialogueQualityScore: 1,
  };
  writeJson(resultPath, result);
  if (metricOnly) {
    console.log(result.dialogueQualityScore);
  } else {
    console.log(JSON.stringify({ status: "ok", evidence: resultPath, turns: transcript.turns.length }, null, 2));
  }
}

function expectFailure(name, fn, expectedNeedle) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expectedNeedle)) {
      throw new CheckError(`${name} failed for the wrong reason: ${message}`);
    }
    return;
  }
  throw new CheckError(`${name} unexpectedly passed`);
}

function validTranscriptFixture() {
  return {
    schemaVersion: 1,
    turns: [
      {
        turn: 1,
        classification: "relevant",
        question: "Which channel and label pattern should the Nova launch notification use?",
        response: { kind: "requirement-answer", facts: requiredFacts },
      },
    ],
  };
}

function runNegativeSelfTests() {
  expectFailure("no-ask-patching", () => validateTranscript({ schemaVersion: 1, turns: [] }), "at least one");
  expectFailure(
    "irrelevant-question",
    () =>
      validateTranscript({
        schemaVersion: 1,
        turns: [{ turn: 1, classification: "irrelevant", response: { kind: "unhelpful" } }],
      }),
    "irrelevant",
  );
  expectFailure(
    "repeated-question",
    () =>
      validateTranscript({
        ...validTranscriptFixture(),
        turns: [
          ...validTranscriptFixture().turns,
          { turn: 2, classification: "repeated", response: { kind: "unhelpful" } },
        ],
      }),
    "repeated",
  );
  expectFailure(
    "answer-ignoring-patch",
    () =>
      validateImplementationOutput(
        () => "Email update: Nova launches at 09:00 UTC",
        requiredFacts,
        "export function formatLaunchNotification() { return \"Email update\"; }",
      ),
    "simulator answer",
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        negativeCases: ["no-ask-patching", "irrelevant-question", "repeated-question", "answer-ignoring-patch"],
      },
      null,
      2,
    ),
  );
}

const args = process.argv.slice(2);
try {
  if (args.includes("--self-test-negative-cases")) {
    runNegativeSelfTests();
  } else {
    await runMain({ metricOnly: args.includes("--metric-only") });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
