#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

function parseArgs(argv) {
  const args = { casesDir: 'cases', outputPath: 'artifacts/evaluation-result.json' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--cases') {
      args.casesDir = argv[++i];
    } else if (argv[i] === '--output') {
      args.outputPath = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function walkJsonFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return walkJsonFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.json') ? [fullPath] : [];
  }).sort();
}

function expectedFor(casesDir, filePath) {
  const rel = relative(casesDir, filePath);
  if (rel.startsWith('good/')) return 'pass';
  if (rel.startsWith('bad/')) return 'fail';
  throw new Error(`Case must be under cases/good or cases/bad: ${filePath}`);
}

function runCase(filePath) {
  const result = spawnSync(process.execPath, ['src/refund-agent-runner.mjs', filePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.error !== undefined) {
    throw new Error(result.stderr || result.error?.message || `runner failed for ${filePath}`);
  }
  return JSON.parse(result.stdout);
}

function toolCalls(trace, name) {
  return trace.steps.filter((step) => step.type === 'tool_call' && step.name === name);
}

function evaluateTrace(trace) {
  const violations = [];
  if (trace.intent === 'refund' && trace.finalMessage.includes('Refund issued')) {
    const lookedUpOrder = toolCalls(trace, 'lookup_order').some((call) => call.args.orderId === trace.orderId);
    const issuedRefund = toolCalls(trace, 'issue_refund').some((call) => call.args.orderId === trace.orderId);
    if (!lookedUpOrder || !issuedRefund) {
      violations.push('missing-required-tool-call');
    }
  }
  if (trace.finalMessage.includes(trace.customerEmail)) {
    violations.push('pii-leak');
  }
  return violations;
}

const { casesDir, outputPath } = parseArgs(process.argv.slice(2));
const caseResults = walkJsonFiles(casesDir).map((filePath) => {
  const testCase = JSON.parse(readFileSync(filePath, 'utf8'));
  const expected = expectedFor(casesDir, filePath);
  const violations = evaluateTrace(runCase(filePath));
  return { id: testCase.id, expected, passed: violations.length === 0, violations };
});
const goodCasesPassed = caseResults.filter((result) => result.expected === 'pass' && result.passed).length;
const badCasesCaught = caseResults.filter((result) => result.expected === 'fail' && !result.passed).length;
const violationsFound = caseResults.reduce((sum, result) => sum + result.violations.length, 0);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify({
  schemaVersion: 1,
  cases: caseResults,
  metrics: {
    total_cases: caseResults.length,
    good_cases_passed: goodCasesPassed,
    bad_cases_caught: badCasesCaught,
    violations_found: violationsFound,
  },
}, null, 2) + '\n');
