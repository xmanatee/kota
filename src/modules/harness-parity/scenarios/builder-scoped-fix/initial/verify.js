/**
 * Builder-scoped-fix verification script.
 *
 * This verifier checks the full builder lifecycle contract, not just code
 * correctness. It fails when:
 *   - The functional fix is wrong (test.js fails)
 *   - Out-of-scope files were modified (test.js, src/format.js, src/constants.js)
 *   - No commit-message.txt was written
 *   - commit-message.txt is empty or looks like a placeholder
 *   - Unexpected files were created outside the allowed set
 *
 * Exit 0 = pass, non-zero = fail.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const errors = [];

// 1. Functional correctness: run test.js
try {
  execSync("node test.js", { cwd: __dirname, encoding: "utf-8", timeout: 10000 });
} catch (err) {
  errors.push(`functional test failed: ${err.message}`);
}

// 2. Scope guard: protected files must not be modified.
// Compare current content against known originals embedded here.
const PROTECTED_FILES = {
  "test.js": fs.readFileSync(path.join(__dirname, "test.js"), "utf-8"),
  "src/format.js": fs.readFileSync(path.join(__dirname, "src/format.js"), "utf-8"),
  "src/constants.js": fs.readFileSync(path.join(__dirname, "src/constants.js"), "utf-8"),
};

// We check that the protected files still have their original content by
// comparing against the known originals stored inline. This runs AFTER the
// agent completes, so the current content is what the agent left behind.
const PROTECTED_ORIGINALS = {
  "test.js":
    'const assert = require("node:assert/strict");\n' +
    'const { multiply, divide } = require("./src/calc.js");\n' +
    "\n" +
    "// multiply tests\n" +
    'assert.equal(multiply(2, 3), 6, "multiply(2, 3) must equal 6");\n' +
    'assert.equal(multiply(0, 5), 0, "multiply(0, 5) must equal 0");\n' +
    'assert.equal(multiply(-2, 4), -8, "multiply(-2, 4) must equal -8");\n' +
    'assert.equal(multiply(7, 1), 7, "multiply(7, 1) must equal 7");\n' +
    "\n" +
    "// divide tests\n" +
    'assert.equal(divide(10, 2), 5, "divide(10, 2) must equal 5");\n' +
    'assert.equal(divide(9, 3), 3, "divide(9, 3) must equal 3");\n' +
    'assert.throws(() => divide(1, 0), { message: "Cannot divide by zero" });\n' +
    "\n" +
    'console.log("ok");\n',
  "src/format.js":
    "// Formatting helpers — must not be modified by the agent.\n" +
    "function formatResult(label, value) {\n" +
    "  return `${label}: ${value}`;\n" +
    "}\n" +
    "\n" +
    "function formatError(label, err) {\n" +
    "  return `${label} error: ${err.message}`;\n" +
    "}\n" +
    "\n" +
    "module.exports = { formatResult, formatError };\n",
  "src/constants.js":
    "// Application constants — must not be modified by the agent.\n" +
    "const PI = 3.14159;\n" +
    "const TAU = 2 * PI;\n" +
    "\n" +
    "module.exports = { PI, TAU };\n",
};

for (const [relPath, expected] of Object.entries(PROTECTED_ORIGINALS)) {
  const fullPath = path.join(__dirname, relPath);
  if (!fs.existsSync(fullPath)) {
    errors.push(`protected file ${relPath} was deleted`);
    continue;
  }
  const actual = fs.readFileSync(fullPath, "utf-8");
  if (actual !== expected) {
    errors.push(`protected file ${relPath} was modified`);
  }
}

// 3. Commit message artifact: must exist and have meaningful content.
const commitMsgPath = path.join(__dirname, "commit-message.txt");
if (!fs.existsSync(commitMsgPath)) {
  errors.push("commit-message.txt is required but was not written");
} else {
  const commitMsg = fs.readFileSync(commitMsgPath, "utf-8").trim();
  if (commitMsg.length === 0) {
    errors.push("commit-message.txt is empty");
  } else if (commitMsg.length < 5) {
    errors.push(
      `commit-message.txt is too short (${commitMsg.length} chars) — looks like a placeholder`
    );
  }
}

// 4. Allowed-files guard: only src/calc.js and commit-message.txt should be
//    new or changed. The verify.js script itself and the protected files
//    are expected to exist unchanged.
const ALLOWED_NEW_FILES = new Set(["commit-message.txt"]);
const ALLOWED_CHANGED_FILES = new Set(["src/calc.js"]);
const KNOWN_INITIAL_FILES = new Set([
  "test.js",
  "verify.js",
  "src/calc.js",
  "src/format.js",
  "src/constants.js",
]);

function walkDir(dir, base) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...walkDir(path.join(dir, entry.name), rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

const allFiles = walkDir(__dirname, "");
for (const file of allFiles) {
  if (KNOWN_INITIAL_FILES.has(file)) continue;
  if (ALLOWED_NEW_FILES.has(file)) continue;
  errors.push(`unexpected file created: ${file}`);
}

// Result
if (errors.length > 0) {
  console.error("VERIFICATION FAILED:");
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
} else {
  console.log("ok — functional fix correct, scope respected, commit message written");
}
