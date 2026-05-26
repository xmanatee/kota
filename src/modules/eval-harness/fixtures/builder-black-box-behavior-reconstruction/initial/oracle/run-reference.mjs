#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const wasmBase64 = readFileSync(join(here, "reference.wasm.base64"), "utf8").trim();
const wasmBytes = Buffer.from(wasmBase64, "base64");
const { instance } = await WebAssembly.instantiate(wasmBytes);
const { mix, finish } = instance.exports;

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

function checksumFor(normalized) {
  let state = 23;
  for (let index = 0; index < normalized.length; index += 1) {
    state = mix(state, normalized.charCodeAt(index), index);
  }
  return finish(state, normalized.length);
}

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  console.log(help.trimEnd());
  process.exit(0);
}
if (args.length !== 1) {
  fail("expected exactly one label argument");
}
if (process.env.KOTA_BLACK_BOX_REFERENCE_FORBIDDEN === "1") {
  fail("reference oracle is not available to candidate implementations");
}

const normalized = normalize(args[0]);
const checksum = checksumFor(normalized);
const family = families[checksum % families.length];
const code = checksum.toString(36).toUpperCase().padStart(2, "0");
console.log(`${normalized} ${family}-${code}`);
