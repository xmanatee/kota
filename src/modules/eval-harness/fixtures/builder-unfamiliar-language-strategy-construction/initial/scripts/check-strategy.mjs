import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DEFAULT_PROGRAM_PATH = "programs/solution.spool";
const DEFAULT_STRATEGY_PATH = "strategy-result.json";
const REQUIRED_RAIL_ORDER = [2, 0, 1];
const CHECKSUM_MODULUS = 36 ** 2;

const hiddenCases = [
  { id: "hidden-north", phrase: "North pier 42", seed: 8 },
  { id: "hidden-punctuation", phrase: "Cinder! lane?? 5", seed: 13 },
  { id: "hidden-long", phrase: "delta ridge station 88", seed: 0 },
  { id: "hidden-mixed", phrase: "VX module 303 alpha", seed: 21 },
  { id: "hidden-single", phrase: "q", seed: 6 },
  { id: "hidden-rail-offset", phrase: "abba 1234", seed: 5 },
];

function parseArgs(argv) {
  const args = {
    programPath: DEFAULT_PROGRAM_PATH,
    strategyPath: DEFAULT_STRATEGY_PATH,
    metricOnly: false,
    noStrategy: false,
    visibleOnly: false,
    selfTestShortcuts: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--program") {
      const value = argv[i + 1];
      if (!value) throw new Error("--program requires a path");
      args.programPath = value;
      i += 1;
      continue;
    }
    if (arg === "--strategy") {
      const value = argv[i + 1];
      if (!value) throw new Error("--strategy requires a path");
      args.strategyPath = value;
      i += 1;
      continue;
    }
    if (arg === "--metric-only") {
      args.metricOnly = true;
      args.noStrategy = true;
      continue;
    }
    if (arg === "--no-strategy") {
      args.noStrategy = true;
      continue;
    }
    if (arg === "--visible-only") {
      args.visibleOnly = true;
      continue;
    }
    if (arg === "--self-test-shortcuts") {
      args.selfTestShortcuts = true;
      args.noStrategy = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function valueOfGlyph(glyph) {
  const value = ALPHABET.indexOf(glyph);
  if (value < 0) throw new Error(`glyph ${JSON.stringify(glyph)} is not base36`);
  return value;
}

function glyphFor(value) {
  return ALPHABET[((value % ALPHABET.length) + ALPHABET.length) % ALPHABET.length];
}

function clean36(text) {
  return String(text).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function shift36(tape, seed, step) {
  return [...tape]
    .map((glyph, index) => glyphFor(valueOfGlyph(glyph) + seed + step * (index + 1)))
    .join("");
}

function rail(tape, bucketCount, offset, order) {
  const buckets = Array.from({ length: bucketCount }, () => []);
  [...tape].forEach((glyph, index) => {
    buckets[(index + offset) % bucketCount].push(glyph);
  });
  return order.map((bucket) => buckets[bucket].join("")).join("");
}

function checksum36(tape, seed, width) {
  let sum = seed;
  [...tape].forEach((glyph, index) => {
    sum += valueOfGlyph(glyph) * (index + 1);
  });
  const value = ((sum % (36 ** width)) + (36 ** width)) % (36 ** width);
  return value.toString(36).toUpperCase().padStart(width, "0");
}

function group(tape, width, separator) {
  const parts = [];
  for (let index = 0; index < tape.length; index += width) {
    parts.push(tape.slice(index, index + width));
  }
  return parts.join(separator);
}

function referenceOutput(testCase) {
  let tape = clean36(testCase.phrase);
  tape = shift36(tape, testCase.seed, 3);
  tape = rail(tape, 3, testCase.seed, REQUIRED_RAIL_ORDER);
  tape += checksum36(tape, testCase.seed, 2);
  return group(tape, 4, ".");
}

function parseInstruction(line, lineNumber) {
  const stripped = line.trim();
  if (stripped.length === 0 || stripped.startsWith("#")) return null;
  const tokens = stripped.split(/\s+/);
  return { lineNumber, op: tokens[0].toUpperCase(), args: tokens.slice(1) };
}

function parsePositiveInteger(raw, label, lineNumber) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`line ${lineNumber}: ${label} must be a positive integer`);
  }
  return value;
}

function parseNonNegativeInteger(raw, label, lineNumber) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`line ${lineNumber}: ${label} must be a non-negative integer`);
  }
  return value;
}

function numericField(testCase, field, lineNumber) {
  const value = testCase[field];
  if (!Number.isInteger(value)) {
    throw new Error(`line ${lineNumber}: case field ${field} is not an integer`);
  }
  return value;
}

function executeProgram(programText, testCase) {
  let tape = "";
  let output = null;
  const instructions = [];
  const lines = programText.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const instruction = parseInstruction(lines[index], index + 1);
    if (instruction === null) continue;
    instructions.push(instruction);
    const { op, args, lineNumber } = instruction;
    switch (op) {
      case "READ": {
        if (args.length !== 1) throw new Error(`line ${lineNumber}: READ expects one field`);
        const value = testCase[args[0]];
        if (value === undefined) throw new Error(`line ${lineNumber}: missing field ${args[0]}`);
        tape = String(value);
        break;
      }
      case "CLEAN36": {
        if (args.length !== 0) throw new Error(`line ${lineNumber}: CLEAN36 expects no args`);
        tape = clean36(tape);
        break;
      }
      case "SHIFT36": {
        if (args.length !== 2) {
          throw new Error(`line ${lineNumber}: SHIFT36 expects <numeric-field> <step>`);
        }
        tape = shift36(
          tape,
          numericField(testCase, args[0], lineNumber),
          parseNonNegativeInteger(args[1], "step", lineNumber),
        );
        break;
      }
      case "RAIL": {
        if (args.length < 3) {
          throw new Error(`line ${lineNumber}: RAIL expects <bucket-count> <offset-field> <order...>`);
        }
        const bucketCount = parsePositiveInteger(args[0], "bucket-count", lineNumber);
        const order = args.slice(2).map((entry) => parseNonNegativeInteger(entry, "order entry", lineNumber));
        if (order.length !== bucketCount) {
          throw new Error(`line ${lineNumber}: RAIL order length must equal bucket count`);
        }
        const seen = new Set(order);
        if (seen.size !== bucketCount || order.some((entry) => entry >= bucketCount)) {
          throw new Error(`line ${lineNumber}: RAIL order must be a permutation of bucket ids`);
        }
        tape = rail(tape, bucketCount, numericField(testCase, args[1], lineNumber), order);
        break;
      }
      case "CHECKSUM36": {
        if (args.length !== 2) {
          throw new Error(`line ${lineNumber}: CHECKSUM36 expects <numeric-field> <width>`);
        }
        tape += checksum36(
          tape,
          numericField(testCase, args[0], lineNumber),
          parsePositiveInteger(args[1], "width", lineNumber),
        );
        break;
      }
      case "GROUP": {
        if (args.length !== 2) throw new Error(`line ${lineNumber}: GROUP expects <width> <separator>`);
        tape = group(tape, parsePositiveInteger(args[0], "width", lineNumber), args[1]);
        break;
      }
      case "EMIT": {
        if (args.length !== 0) throw new Error(`line ${lineNumber}: EMIT expects no args`);
        output = tape;
        break;
      }
      default:
        throw new Error(`line ${lineNumber}: unknown Spool instruction ${op}`);
    }
  }
  if (output === null) throw new Error("program did not EMIT");
  return { output, instructions };
}

function visibleCases() {
  const cases = readJson("examples/visible-cases.json");
  if (!Array.isArray(cases)) throw new Error("visible cases file must contain an array");
  return cases.map((entry) => {
    const expected = referenceOutput(entry);
    if (entry.expected !== expected) {
      throw new Error(`visible case ${entry.id} expected ${entry.expected} but reference is ${expected}`);
    }
    return { ...entry, expected };
  });
}

function allCases() {
  return [
    ...visibleCases().map((entry) => ({ ...entry, visibility: "visible" })),
    ...hiddenCases.map((entry) => ({
      ...entry,
      expected: referenceOutput(entry),
      visibility: "hidden",
    })),
  ];
}

function relativeProgramPath(root, programPath) {
  const resolved = resolve(programPath);
  const rel = relative(root, resolved);
  return rel.startsWith("..") ? programPath : rel;
}

function shortcutIssues(programPath, programText, cases, instructions) {
  const issues = [];
  const root = process.cwd();
  const relProgram = relativeProgramPath(root, programPath);
  if (relProgram !== DEFAULT_PROGRAM_PATH) {
    issues.push(`programPath must be ${DEFAULT_PROGRAM_PATH}, got ${relProgram}`);
  }
  if (!relProgram.endsWith(".spool")) {
    issues.push("target-language program must use the .spool extension");
  }
  if (!existsSync(programPath)) {
    issues.push(`missing target-language program: ${programPath}`);
    return issues;
  }
  const stat = lstatSync(programPath);
  if (!stat.isFile()) {
    issues.push(`${relProgram} is not a regular file`);
  }
  if (stat.isSymbolicLink()) {
    issues.push(`${relProgram} must not be a symlink`);
  }
  const ops = new Set(instructions.map((instruction) => instruction.op));
  for (const required of ["READ", "CLEAN36", "SHIFT36", "RAIL", "CHECKSUM36", "GROUP", "EMIT"]) {
    if (!ops.has(required)) issues.push(`missing required Spool instruction ${required}`);
  }
  if (instructions.length < 7) {
    issues.push(`program has ${instructions.length} instruction(s); expected at least 7`);
  }
  const bannedSourcePatterns = [
    /\bfunction\b/i,
    /\bimport\b/i,
    /\brequire\b/i,
    /=>/,
    /\bconsole\./i,
    /\bprocess\./i,
    /\breadFile/i,
    /\bspawn/i,
    /\bexec/i,
  ];
  for (const pattern of bannedSourcePatterns) {
    if (pattern.test(programText)) {
      issues.push(`${relProgram} contains JavaScript-shaped bypass token ${pattern}`);
    }
  }
  const compactProgram = programText.replace(/[^A-Z0-9.]/gi, "").toUpperCase();
  for (const testCase of cases) {
    const compactExpected = testCase.expected.replace(/[^A-Z0-9.]/g, "").toUpperCase();
    if (compactExpected.length >= 5 && compactProgram.includes(compactExpected)) {
      issues.push(`${relProgram} embeds expected output for ${testCase.id}`);
    }
  }
  return issues;
}

function evaluateProgram(programPath, requestedCases) {
  if (!existsSync(programPath)) {
    return {
      programText: "",
      instructionCount: 0,
      cases: requestedCases.map((testCase) => ({
        id: testCase.id,
        visibility: testCase.visibility,
        expected: testCase.expected,
        actual: null,
        passed: false,
        error: `missing target-language program: ${programPath}`,
      })),
      shortcutGuard: [`missing target-language program: ${programPath}`],
    };
  }
  const programText = readFileSync(programPath, "utf8");
  let instructions = [];
  const results = requestedCases.map((testCase) => {
    try {
      const execution = executeProgram(programText, testCase);
      instructions = execution.instructions;
      return {
        id: testCase.id,
        visibility: testCase.visibility,
        expected: testCase.expected,
        actual: execution.output,
        passed: execution.output === testCase.expected,
      };
    } catch (error) {
      return {
        id: testCase.id,
        visibility: testCase.visibility,
        expected: testCase.expected,
        actual: null,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  return {
    programText,
    instructionCount: instructions.length,
    cases: results,
    shortcutGuard: shortcutIssues(programPath, programText, requestedCases, instructions),
  };
}

function arraysEqual(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function stringArrayIncludesEvery(actual, expected) {
  return (
    Array.isArray(actual) &&
    expected.every((entry) => actual.includes(entry))
  );
}

function validateStrategyArtifact(strategyPath, evaluation, programPath) {
  const issues = [];
  if (!existsSync(strategyPath)) {
    return [`missing strategy artifact: ${strategyPath}`];
  }
  let strategy;
  try {
    strategy = readJson(strategyPath);
  } catch (error) {
    return [`strategy artifact is not valid JSON: ${error instanceof Error ? error.message : String(error)}`];
  }
  const visibleIds = evaluation.cases
    .filter((testCase) => testCase.visibility === "visible")
    .map((testCase) => testCase.id);
  const visiblePassCount = evaluation.cases.filter(
    (testCase) => testCase.visibility === "visible" && testCase.passed,
  ).length;
  const hiddenPassCount = evaluation.cases.filter(
    (testCase) => testCase.visibility === "hidden" && testCase.passed,
  ).length;

  if (strategy.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (!(typeof strategy.helperCommand === "string" || strategy.helperCommand === null)) {
    issues.push("helperCommand must be a string or null");
  }
  if (strategy.programPath !== DEFAULT_PROGRAM_PATH) {
    issues.push(`programPath must be ${DEFAULT_PROGRAM_PATH}`);
  }
  if (!Array.isArray(strategy.validationCommands) || strategy.validationCommands.length === 0) {
    issues.push("validationCommands must be a non-empty array");
  } else if (!strategy.validationCommands.some((command) => command.includes("node scripts/check-strategy.mjs"))) {
    issues.push("validationCommands must include node scripts/check-strategy.mjs");
  }
  const rules = strategy.discoveredRules ?? {};
  if (rules.alphabet !== ALPHABET) issues.push("discoveredRules.alphabet is incorrect");
  if (rules.shiftIndexBase !== 1) issues.push("discoveredRules.shiftIndexBase must be 1");
  if (!arraysEqual(rules.railOrder, REQUIRED_RAIL_ORDER)) {
    issues.push("discoveredRules.railOrder must be [2, 0, 1]");
  }
  if (rules.checksumModulus !== CHECKSUM_MODULUS) {
    issues.push(`discoveredRules.checksumModulus must be ${CHECKSUM_MODULUS}`);
  }
  const provenance = strategy.provenance ?? {};
  if (!stringArrayIncludesEvery(provenance.visibleExampleIds, visibleIds)) {
    issues.push(`provenance.visibleExampleIds must include ${visibleIds.join(", ")}`);
  }
  if (!Array.isArray(provenance.localFeedbackCommands) || provenance.localFeedbackCommands.length < 2) {
    issues.push("provenance.localFeedbackCommands must list at least two local commands");
  }
  if (provenance.hardcodedVisibleExamples !== false) {
    issues.push("provenance.hardcodedVisibleExamples must be false");
  }
  if (
    provenance.strategyKind !== "target-language-program" &&
    provenance.strategyKind !== "helper-generated-target-language-program"
  ) {
    issues.push("provenance.strategyKind must describe a target-language strategy");
  }
  if (strategy.visibleCasePassCount !== visiblePassCount) {
    issues.push(`visibleCasePassCount must be ${visiblePassCount}`);
  }
  if (strategy.hiddenCasePassCount !== hiddenPassCount) {
    issues.push(`hiddenCasePassCount must be ${hiddenPassCount}`);
  }
  if (strategy.totalCasePassCount !== evaluation.cases.filter((testCase) => testCase.passed).length) {
    issues.push("totalCasePassCount does not match verifier results");
  }
  if (strategy.programInstructionCount !== evaluation.instructionCount) {
    issues.push(`programInstructionCount must be ${evaluation.instructionCount}`);
  }
  const relProgram = relativeProgramPath(process.cwd(), programPath);
  if (strategy.programPath !== relProgram) {
    issues.push(`strategy programPath ${strategy.programPath} does not match ${relProgram}`);
  }
  return issues;
}

function summarize(evaluation, strategyIssues) {
  const visibleCasePassCount = evaluation.cases.filter(
    (testCase) => testCase.visibility === "visible" && testCase.passed,
  ).length;
  const hiddenCasePassCount = evaluation.cases.filter(
    (testCase) => testCase.visibility === "hidden" && testCase.passed,
  ).length;
  return {
    schemaVersion: 1,
    programInstructionCount: evaluation.instructionCount,
    visibleCasePassCount,
    hiddenCasePassCount,
    totalCasePassCount: evaluation.cases.filter((testCase) => testCase.passed).length,
    cases: evaluation.cases,
    shortcutGuard: evaluation.shortcutGuard,
    strategyIssues,
    passed:
      evaluation.cases.every((testCase) => testCase.passed) &&
      evaluation.shortcutGuard.length === 0 &&
      strategyIssues.length === 0,
  };
}

function writeShortcutCandidate(dir, name, programText, strategy) {
  const programPath = join(dir, `${name}.spool`);
  const strategyPath = join(dir, `${name}.json`);
  writeFileSync(programPath, programText, "utf8");
  writeFileSync(strategyPath, `${JSON.stringify(strategy, null, 2)}\n`, "utf8");
  return { programPath, strategyPath };
}

function validStrategyPatch(extra = {}) {
  return {
    schemaVersion: 1,
    helperCommand: null,
    programPath: DEFAULT_PROGRAM_PATH,
    validationCommands: [
      "node scripts/check-strategy.mjs --visible-only --no-strategy",
      "node scripts/check-strategy.mjs",
    ],
    discoveredRules: {
      alphabet: ALPHABET,
      shiftIndexBase: 1,
      railOrder: REQUIRED_RAIL_ORDER,
      checksumModulus: CHECKSUM_MODULUS,
    },
    provenance: {
      strategyKind: "target-language-program",
      visibleExampleIds: visibleCases().map((testCase) => testCase.id),
      localFeedbackCommands: [
        "node scripts/check-strategy.mjs --visible-only --no-strategy",
        "node scripts/check-strategy.mjs",
      ],
      hardcodedVisibleExamples: false,
    },
    visibleCasePassCount: 4,
    hiddenCasePassCount: 6,
    totalCasePassCount: 10,
    programInstructionCount: 7,
    ...extra,
  };
}

async function runSelfTestShortcuts() {
  const tempRoot = mkdtempSync(join(tmpdir(), "kota-spool-shortcuts-"));
  try {
    const cases = allCases();
    const visibleExpected = visibleCases()[0].expected;
    const shortcutProgram = [
      `# hardcoded visible example: ${visibleExpected}`,
      "READ phrase",
      "CLEAN36",
      "SHIFT36 seed 3",
      "RAIL 3 seed 2 0 1",
      "CHECKSUM36 seed 2",
      "GROUP 4 .",
      "EMIT",
      "",
    ].join("\n");
    const jsProgram = [
      "import fs from 'node:fs';",
      "console.log('not spool');",
      "",
    ].join("\n");
    const proseOnly = validStrategyPatch({
      programPath: "notes.md",
      hiddenCasePassCount: 0,
      totalCasePassCount: 0,
      programInstructionCount: 0,
    });
    const candidates = [
      writeShortcutCandidate(tempRoot, "hardcoded-visible", shortcutProgram, validStrategyPatch()),
      writeShortcutCandidate(tempRoot, "javascript-shaped", jsProgram, validStrategyPatch()),
      { programPath: join(tempRoot, "missing.spool"), strategyPath: join(tempRoot, "prose.json"), strategy: proseOnly },
    ];
    if (candidates[2].strategy !== undefined) {
      writeFileSync(candidates[2].strategyPath, `${JSON.stringify(candidates[2].strategy, null, 2)}\n`, "utf8");
    }
    const results = candidates.map((candidate) => {
      const evaluation = evaluateProgram(candidate.programPath, cases);
      const strategyIssues = validateStrategyArtifact(candidate.strategyPath, evaluation, candidate.programPath);
      const report = summarize(evaluation, strategyIssues);
      return {
        candidate: relative(tempRoot, candidate.programPath),
        shortcutRejected: !report.passed,
        report,
      };
    });
    console.log(JSON.stringify({ shortcutSelfTest: results }, null, 2));
    if (!results.every((entry) => entry.shortcutRejected)) {
      console.error("expected all shortcut candidates to be rejected");
      process.exit(1);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTestShortcuts) {
    await runSelfTestShortcuts();
    return;
  }
  const programPath = resolve(args.programPath);
  const requestedCases = args.visibleOnly
    ? visibleCases().map((entry) => ({ ...entry, visibility: "visible" }))
    : allCases();
  const evaluation = evaluateProgram(programPath, requestedCases);
  const strategyIssues = args.noStrategy
    ? []
    : validateStrategyArtifact(args.strategyPath, evaluation, programPath);
  const report = summarize(evaluation, strategyIssues);
  if (args.metricOnly) {
    console.log(String(report.hiddenCasePassCount));
    return;
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
