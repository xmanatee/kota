#!/usr/bin/env node
const families = ["amber", "cobalt", "fern", "slate", "violet"];
const help = `badge-code

Usage:
  node src/badge-code.mjs <label>

Prints: <normalized-label> <family>-<checksum>
`;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(2);
}

function normalize(raw) {
  if (/[^A-Za-z0-9 _-]/.test(raw)) {
    fail("label contains unsupported characters");
  }
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[ _-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/[a-z0-9]/.test(normalized)) {
    fail("label must contain at least one alphanumeric character");
  }
  if (normalized.length > 24) {
    fail("normalized label exceeds 24 characters");
  }
  return normalized;
}

function mix(state, code, index) {
  return (state * 31 + code * (index + 7) + (code % 13) * 17 + index * 19) % 997;
}

function complete(state, length) {
  return (state + length * 53) % 997;
}

function checksumFor(normalized) {
  let state = 23;
  for (let index = 0; index < normalized.length; index += 1) {
    state = mix(state, normalized.charCodeAt(index), index);
  }
  return complete(state, normalized.length);
}

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  console.log(help.trimEnd());
  process.exit(0);
}
if (args.length !== 1) {
  fail("expected exactly one label argument");
}
const normalized = normalize(args[0]);
const checksum = checksumFor(normalized);
const family = families[checksum % families.length];
const code = checksum.toString(36).toUpperCase().padStart(2, "0");
console.log(`${normalized} ${family}-${code}`);
