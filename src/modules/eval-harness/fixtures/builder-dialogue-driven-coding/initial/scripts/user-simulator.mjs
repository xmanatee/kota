#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const transcriptPath = join(projectRoot, ".kota/dialogue-simulator/transcript.json");
const facts = {
  requirementId: "nova-launch-sms-v1",
  channel: "sms",
  prefix: "Text alert",
  preserveInputTime: true,
};

function readTranscript() {
  if (!existsSync(transcriptPath)) {
    return {
      schemaVersion: 1,
      persona: "Nova launch coordinator",
      maxTurns: 2,
      turns: [],
    };
  }
  return JSON.parse(readFileSync(transcriptPath, "utf8"));
}

function writeTranscript(transcript) {
  mkdirSync(dirname(transcriptPath), { recursive: true });
  writeFileSync(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`);
}

function isRelevant(question) {
  const lower = question.toLowerCase();
  const asksRequirement =
    lower.includes("channel") ||
    lower.includes("sms") ||
    lower.includes("text") ||
    lower.includes("label") ||
    lower.includes("copy") ||
    lower.includes("requirement");
  const namesTask =
    lower.includes("nova") ||
    lower.includes("launch") ||
    lower.includes("notification");
  return asksRequirement && namesTask;
}

function classify(question, transcript) {
  if (transcript.turns.length >= transcript.maxTurns) return "excessive";
  if (transcript.turns.some((turn) => turn.classification === "relevant")) {
    return "repeated";
  }
  return isRelevant(question) ? "relevant" : "irrelevant";
}

function responseFor(classification) {
  if (classification === "relevant") {
    return {
      kind: "requirement-answer",
      text:
        "For the Nova launch workflow, use the SMS/text-message channel. The label pattern is `Text alert: <product> launches at <time>`, preserving the UTC time from input. Requirement id: nova-launch-sms-v1.",
      facts,
    };
  }
  if (classification === "repeated") {
    return {
      kind: "unhelpful",
      text: "I already gave the launch notification requirement; do not keep asking.",
    };
  }
  if (classification === "excessive") {
    return {
      kind: "unhelpful",
      text: "Dialogue budget exhausted. No additional requirement facts are available.",
    };
  }
  return {
    kind: "unhelpful",
    text: "I can only answer concise questions about the Nova launch notification requirement.",
  };
}

function ask(question) {
  if (question.trim().length === 0) {
    throw new Error("ask requires a non-empty question.");
  }
  const transcript = readTranscript();
  const classification = classify(question, transcript);
  const response = responseFor(classification);
  transcript.turns.push({
    turn: transcript.turns.length + 1,
    speaker: "builder",
    question,
    classification,
    response,
  });
  writeTranscript(transcript);
  console.log(response.text);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "reset") {
    rmSync(transcriptPath, { force: true });
  } else if (command === "ask") {
    ask(rest.join(" "));
  } else {
    throw new Error('Usage: node scripts/user-simulator.mjs ask "<question>"');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
