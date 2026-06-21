#!/usr/bin/env node
const groups = ["amber", "cobalt", "fern", "slate", "violet"];
const usage = `badge-code

Usage:
  node src/badge-code.mjs <label>

Prints: <normalized-label> <family>-<checksum>
`;

function exitWith(message) {
  console.error(`error: ${message}`);
  process.exit(2);
}

function normalizedLabel(input) {
  if (/[^A-Za-z0-9 _-]/.test(input)) {
    exitWith("label contains unsupported characters");
  }
  const label = input
    .trim()
    .toLowerCase()
    .replace(/[ _-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/[a-z0-9]/.test(label)) {
    exitWith("label must contain at least one alphanumeric character");
  }
  if (label.length > 24) {
    exitWith("normalized label exceeds 24 characters");
  }
  return label;
}

function checksum(label) {
  const mixed = Array.from(label).reduce(
    (state, char, index) =>
      (state * 31 +
        char.charCodeAt(0) * (index + 7) +
        (char.charCodeAt(0) % 13) * 17 +
        index * 19) %
      997,
    23,
  );
  return (mixed + label.length * 53) % 997;
}

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  console.log(usage.trimEnd());
  process.exit(0);
}
if (args.length !== 1) {
  exitWith("expected exactly one label argument");
}

const label = normalizedLabel(args[0]);
const value = checksum(label);
const family = groups[value % groups.length];
const suffix = value.toString(36).toUpperCase().padStart(2, "0");
console.log(`${label} ${family}-${suffix}`);
